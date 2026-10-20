#!/usr/bin/env python3
"""
Test de bout en bout dans un VRAI Chromium (extension chargée, vraie souris, vrai chrome.storage).
Prérequis : `npm run build`, puis `pip install playwright` et un Chromium pour Playwright
(`python -m playwright install chromium`).
  python scripts/e2e-chromium.py         → version « nouvel onglet » (dist/)       (ou `npm run e2e`)
  python scripts/e2e-chromium.py home    → version « page d'accueil » (dist-home/) (ou `npm run e2e:home`)
Ce test est facultatif : `npm run check` n'en dépend pas.
"""
import os, shutil, sys, tempfile, time
from playwright.sync_api import sync_playwright

EXT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "dist"))
failures, passed = [], 0

def check(name, cond, detail=""):
    global passed
    if cond: passed += 1; print(f"  OK   {name}")
    else: failures.append(name); print(f"  FAIL {name} {detail}")

OVERFLOW = """() => [...document.querySelectorAll('.cell[data-widget]')].map(c => { const k=c.querySelector('.card'); return {w:c.dataset.widget, h:k.scrollWidth-k.clientWidth}; })"""
OVERLAP = """async()=>{const g=await chrome.storage.local.get('dinostart:doc');const ws=g['dinostart:doc'].widgets.filter(w=>w.enabled);let bad=[];
  for(const a of ws)for(const b of ws) if(a.type<b.type&&a.x<b.x+b.w&&b.x<a.x+a.w&&a.y<b.y+b.h&&b.y<a.y+a.h) bad.push(a.type+'/'+b.type); return bad}"""
WIDGET = """async(t)=>{const g=await chrome.storage.local.get('dinostart:doc');const w=g['dinostart:doc'].widgets.find(x=>x.type===t);return [w.x,w.y,w.w,w.h]}"""

def main_home():
    ext = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "dist-home"))
    if not os.path.isdir(ext): sys.exit("dist-home/ introuvable : lancez d'abord `npm run build`.")
    profile = tempfile.mkdtemp(prefix="dinostart-e2e-home-"); errors = []
    with sync_playwright() as p:
        ctx = p.chromium.launch_persistent_context(profile, headless=False, viewport={"width": 1400, "height": 900},
            args=[f"--disable-extensions-except={ext}", f"--load-extension={ext}", "--headless=new", "--no-sandbox"])
        sw = ctx.service_workers[0] if ctx.service_workers else ctx.wait_for_event("serviceworker", timeout=10000)
        ext_id = sw.url.split("/")[2]; page_url = f"chrome-extension://{ext_id}/newtab.html"
        print("Version page d'accueil")
        check("le service worker de l'extension démarre", sw.url.endswith("/background.js"))
        nt = ctx.new_page(); nt.goto("chrome://newtab"); time.sleep(1.5)
        check("le nouvel onglet de Chrome n'est PAS remplacé", not nt.url.startswith("chrome-extension://"), nt.url)
        with ctx.expect_page(timeout=8000) as opened:
            sw.evaluate("() => globalThis.dinoOpen()")   # même fonction que le bouton de la barre d'outils et le raccourci
        page = opened.value; page.wait_for_selector("#root *", timeout=10000)
        page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
        page.on("pageerror", lambda e: errors.append(str(e)))
        check("le bouton / raccourci ouvre DinoStart dans un onglet", page.url == page_url, page.url)
        check("l'onglet s'appelle « DinoStart »", page.title() == "DinoStart", page.title())
        page.get_by_role("button", name="Passer").click(); time.sleep(.4)
        check("DinoStart fonctionne (horloge, recherche)", page.locator("time.clock").is_visible() and page.get_by_role("combobox", name="Rechercher").is_visible())
        # fermer les autres onglets : il ne reste que DinoStart, sans barre « Personnaliser Chrome »
        for other in ctx.pages:
            if other != page: other.close()
        time.sleep(1.5)
        cdp = ctx.new_cdp_session(page)
        targets = [t["url"] for t in cdp.send("Target.getTargets")["targetInfos"] if t["type"] == "page"]
        check("aucune barre Chrome en bas (pas de chrome://newtab-footer)", not any("newtab-footer" in u for u in targets), str(targets))
        page.get_by_role("button", name="Paramètres").click(); page.get_by_role("tab", name="Ouverture").click(); time.sleep(.3)
        check("l'onglet Ouverture affiche l'adresse exacte de DinoStart", page.get_by_label("Adresse de DinoStart").input_value() == page_url)
        check("il indique le raccourci Alt + Maj + D", page.get_by_text("Alt + Maj + D").first.is_visible())
        page.get_by_role("button", name="Ouvrir « Apparence » de Chrome").click(); time.sleep(1.2)
        after = [t["url"] for t in cdp.send("Target.getTargets")["targetInfos"] if t["type"] == "page"]
        check("le bouton ouvre les réglages « Apparence » de Chrome", any(u.startswith("chrome://settings/appearance") for u in after), str(after))
        page.bring_to_front()
        check("aucune erreur dans la console (CSP comprise)", not errors, str(errors[:3]))
        ctx.close()
    shutil.rmtree(profile, ignore_errors=True)
    print(f"\n{passed} vérifications réussies, {len(failures)} échec(s)")
    sys.exit(1 if failures else 0)

def main():
    if len(sys.argv) > 1 and sys.argv[1] == "home": return main_home()
    if not os.path.isdir(EXT): sys.exit("dist/ introuvable : lancez d'abord `npm run build`.")
    profile = tempfile.mkdtemp(prefix="dinostart-e2e-")
    errors = []
    with sync_playwright() as p:
        ctx = p.chromium.launch_persistent_context(profile, headless=False, viewport={"width": 1400, "height": 900},
            args=[f"--disable-extensions-except={EXT}", f"--load-extension={EXT}", "--headless=new", "--no-sandbox"])
        page = ctx.new_page()
        page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.goto("chrome://newtab"); page.wait_for_selector("#root *", timeout=10000)
        print("Extension"); check("le nouvel onglet est remplacé par DinoStart", page.url.endswith("/newtab.html"))
        check("l'assistant de premier lancement s'affiche", page.get_by_role("dialog", name="Bienvenue dans DinoStart").is_visible())
        check("le logo (dino) de l'assistant est chargé", page.evaluate("(()=>{const i=document.querySelector('.ob-logo');return !!i&&i.complete&&i.naturalWidth>0})()"))
        page.get_by_role("button", name="Passer").click(); time.sleep(.4)
        check("le logo de l'en-tête est chargé", page.evaluate("(()=>{const i=document.querySelector('.brand-logo');return !!i&&i.complete&&i.naturalWidth>0})()"))
        check("la couleur principale par défaut est le bleu du logo", page.evaluate("getComputedStyle(document.documentElement).getPropertyValue('--primary').trim()") == "#5194f5")

        print("Bouton Personnaliser")
        btn = page.get_by_role("button", name="Personnaliser").bounding_box(); board = page.locator(".board").bounding_box()
        check("le bouton est après le tableau, dans le flux (pas flottant)", btn["y"] >= board["y"] + board["height"] - 1, f"btn={btn['y']} board_bas={board['y']+board['height']}")
        check("le bouton n'est pas en position fixe", page.evaluate("getComputedStyle(document.querySelector('.home-foot .btn')).position") != "fixed")

        print("Favoris et icônes")
        page.get_by_role("button", name="Favoris", exact=True).first.click()
        page.get_by_role("button", name="Ajouter un favori").first.click()
        d = page.get_by_role("dialog"); d.get_by_label("Titre").fill("Exemple"); d.get_by_label("Adresse").fill("example.com")
        d.get_by_role("button", name="Ajouter", exact=True).click(); time.sleep(.3)
        page.get_by_role("button", name="Accueil", exact=True).click(); time.sleep(.5)
        ok = page.evaluate("[...document.querySelectorAll('img[src*=_favicon]')].some(i=>i.complete&&i.naturalWidth>0)")
        check("l'icône automatique (API locale de Chrome) se charge", ok)

        print("Tableau libre (vraie souris)")
        page.get_by_role("button", name="Personnaliser").click(); time.sleep(.4)
        page.evaluate("window.scrollTo(0,0)"); time.sleep(.3)
        before = page.evaluate(WIDGET, "clock")
        bar = page.locator(".cell[data-widget=clock] .cell-title").bounding_box()
        page.mouse.move(bar["x"] + 10, bar["y"] + 8); page.mouse.down(); page.mouse.move(bar["x"] + 250, bar["y"] + 120, steps=12); page.mouse.up(); time.sleep(.7)
        after = page.evaluate(WIDGET, "clock")
        check("glisser la barre déplace la carte", after[:2] != before[:2], f"{before}->{after}")
        check("aucune carte ne se superpose après le déplacement", page.evaluate(OVERLAP) == [])
        page.evaluate("window.scrollTo(0,0)"); time.sleep(.3)
        h = page.locator(".cell[data-widget=date] .resize-handle").bounding_box(); b2 = page.evaluate(WIDGET, "date")
        page.mouse.move(h["x"] + 10, h["y"] + 10); page.mouse.down(); page.mouse.move(h["x"] - 160, h["y"] + 80, steps=10); page.mouse.up(); time.sleep(.7)
        a2 = page.evaluate(WIDGET, "date")
        check("tirer le coin en bas à droite redimensionne la carte", a2[2:] != b2[2:], f"{b2}->{a2}")
        check("toujours aucun chevauchement après le redimensionnement", page.evaluate(OVERLAP) == [])
        page.get_by_role("button", name="Terminer").last.click(); time.sleep(.3)
        page.reload(); page.wait_for_selector(".board"); time.sleep(.5)
        check("la disposition survit au rechargement", page.evaluate(WIDGET, "clock") == after)

        print("Cartes réduites au minimum")
        page.evaluate("""async()=>{const k='dinostart:doc';const g=await chrome.storage.local.get(k);const d=g[k];
          const R={clock:[0,0,2,3],date:[2,0,2,3],search:[4,0,4,4],favorites:[8,0,3,4],quickLinks:[0,5,2,3],tasks:[2,5,3,4],projects:[5,5,3,4],quickNotes:[8,5,3,4]};
          for(const w of d.widgets){[w.x,w.y,w.w,w.h]=R[w.type];} await chrome.storage.local.set({[k]:d});}""")
        page.reload(); page.wait_for_selector(".board"); time.sleep(.5)
        bad = [o for o in page.evaluate(OVERFLOW) if o["h"] > 0]
        check("aucun contenu ne déborde horizontalement de sa carte", not bad, str(bad))
        clock = page.evaluate("(()=>{const k=document.querySelector('.cell[data-widget=clock] .card');return k.scrollHeight-k.clientHeight})()")
        check("l'horloge tient aussi en hauteur", clock <= 0)

        print("Raccourcis")
        page.evaluate("""async()=>{const k='dinostart:doc';const g=await chrome.storage.local.get(k);const d=g[k];
          const R={clock:[0,0,6,4],date:[6,0,6,4],search:[0,4,12,4],favorites:[0,8,8,9],quickLinks:[8,8,4,5],tasks:[8,13,4,4],projects:[0,17,6,6],quickNotes:[6,17,6,6]};
          for(const w of d.widgets){[w.x,w.y,w.w,w.h]=R[w.type];} await chrome.storage.local.set({[k]:d});}""")
        page.reload(); page.wait_for_selector(".board")
        page.get_by_role("button", name="Paramètres").click(); page.get_by_role("tab", name="Recherche").click(); time.sleep(.3)
        page.get_by_role("button", name="Ajouter un raccourci").click()
        d = page.get_by_role("dialog"); d.get_by_label("Nom affiché").fill("Banque privée"); d.get_by_label("Type").select_option("private")
        d.get_by_label("Adresse à ouvrir en privé (facultatif)").fill("example.org"); d.get_by_role("button", name="Cadenas").click()
        d.get_by_role("button", name="Ajouter", exact=True).click(); time.sleep(.4)
        page.get_by_role("button", name="Accueil", exact=True).click(); time.sleep(.4)
        cdp = ctx.new_cdp_session(page)
        urls = lambda: [t["url"] for t in cdp.send("Target.getTargets")["targetInfos"] if t["type"] == "page"]
        check("le raccourci créé apparaît sous la recherche", page.get_by_role("button", name="Banque privée").is_visible())
        page.get_by_role("button", name="Banque privée").click(); time.sleep(2.5)
        check("il ouvre l'adresse choisie dans une vraie fenêtre privée", any(u.startswith("https://example.org") for u in urls()), str(urls()))
        page.get_by_role("button", name="Historique", exact=True).click(); time.sleep(1.5)
        check("le bouton Historique ouvre chrome://history", any(u.startswith("chrome://history") for u in urls()), str(urls()))

        check("aucune erreur dans la console (CSP comprise)", not errors, str(errors[:3]))
        ctx.close()
    shutil.rmtree(profile, ignore_errors=True)
    print(f"\n{passed} vérifications réussies, {len(failures)} échec(s)")
    sys.exit(1 if failures else 0)

main()
