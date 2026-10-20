#!/usr/bin/env python3
"""
Génère les captures d'écran de la documentation (docs/images/) à partir de la VRAIE extension dans un vrai Chromium.
Les données affichées sont des exemples fictifs, créés uniquement dans un profil temporaire pour ces captures.
Prérequis : `npm run build`, `pip install playwright pillow`, un Chromium pour Playwright.   Usage : python scripts/make-docs-images.py
"""
import datetime, os, re, shutil, sys, tempfile, time
from playwright.sync_api import sync_playwright
from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
EXT = os.path.join(ROOT, "dist")
OUT = os.path.join(ROOT, "docs", "images")
DSF = 1.25
VIEW = {"width": 1360, "height": 1280}
MARK = (255, 77, 109)  # couleur des repères numérotés
FONT = next((f for f in ["/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", "C:/Windows/Fonts/arialbd.ttf"] if os.path.exists(f)), None)

def annotate(path, boxes, origin=(0, 0)):
    """boxes : [(numéro, x, y, w, h)] en pixels CSS de la page ; origin = coin haut-gauche de la capture dans la page."""
    im = Image.open(path).convert("RGBA"); d = ImageDraw.Draw(im, "RGBA")
    font = ImageFont.truetype(FONT, int(17 * DSF)) if FONT else ImageFont.load_default()
    r = int(14 * DSF)
    for n, x, y, w, h in boxes:
        x0, y0 = (x - origin[0]) * DSF, (y - origin[1]) * DSF; x1, y1 = x0 + w * DSF, y0 + h * DSF
        d.rounded_rectangle((x0 - 4, y0 - 4, x1 + 4, y1 + 4), radius=int(12 * DSF), outline=MARK + (255,), width=int(3 * DSF))
        cx, cy = max(r + 2, x0 - 4), max(r + 2, y0 - 4)
        d.ellipse((cx - r, cy - r, cx + r, cy + r), fill=MARK + (255,), outline=(255, 255, 255, 255), width=2)
        d.text((cx, cy), str(n), fill=(255, 255, 255, 255), font=font, anchor="mm")
    im.convert("RGB").save(path, optimize=True)

def box(page, selector, **kw):
    loc = page.locator(selector).first
    loc.scroll_into_view_if_needed()
    b = loc.bounding_box(); assert b, selector
    return b["x"], b["y"], b["width"], b["height"]

def launch(p, profile):
    shutil.rmtree(profile, ignore_errors=True)
    return p.chromium.launch_persistent_context(profile, headless=False, viewport=VIEW, device_scale_factor=DSF,
        args=[f"--disable-extensions-except={EXT}", f"--load-extension={EXT}", "--headless=new", "--no-sandbox"])

def today(delta): return (datetime.date.today() + datetime.timedelta(days=delta)).isoformat()

def seed(page):
    """Données d'exemple fictives, écrites comme le ferait l'extension (schéma validé à l'ouverture)."""
    now = "2026-01-05T09:00:00.000Z"
    meta = lambda i: {"id": i, "createdAt": now, "updatedAt": now, "deletedAt": None, "origin": "demo"}
    cats = [("c1", "Travail", "#5194f5"), ("c2", "Loisirs", "#f97316"), ("c3", "Actualités", "#22c55e")]
    fav = lambda i, t, u, c, ic, o, q=False: {**meta(i), "title": t, "url": u, "categoryId": c, "icon": {"kind": "icon", "name": ic}, "order": o, "quick": q}
    favs = [fav("f1", "Gmail", "https://mail.google.com/", "c1", "mail", 0, True), fav("f2", "Agenda", "https://calendar.google.com/", "c1", "calendar", 1),
            fav("f3", "GitHub", "https://github.com/", "c1", "github", 2), fav("f4", "Drive", "https://drive.google.com/", "c1", "cloud", 3),
            fav("f5", "YouTube", "https://www.youtube.com/", "c2", "video", 0, True), fav("f6", "Musique", "https://open.spotify.com/", "c2", "music", 1),
            fav("f7", "Twitch", "https://www.twitch.tv/", "c2", "gamepad", 2), fav("f8", "Le Monde", "https://www.lemonde.fr/", "c3", "newspaper", 0),
            fav("f9", "Wikipédia", "https://fr.wikipedia.org/", "c3", "book", 1), fav("f10", "Météo", "https://meteofrance.com/", None, "cloud", 0, True),
            fav("f11", "Banque", "https://www.exemple-banque.fr/", None, "wallet", 1), fav("f12", "Cartes", "https://www.google.com/maps", None, "map", 2)]
    projects = [
        {**meta("p1"), "name": "Site vitrine", "description": "Refonte du site de l'atelier : maquettes, textes et mise en ligne.", "status": "active", "color": "#5194f5",
         "links": [{"id": "l1", "label": "Dépôt GitHub", "target": "https://github.com/", "kind": "url"}, {"id": "l2", "label": "Dossier du projet", "target": "C:\\\\Projets\\\\site-vitrine", "kind": "path"}]},
        {**meta("p2"), "name": "Rapport de stage", "description": "Plan validé, il reste la conclusion.", "status": "paused", "color": "#8b5cf6", "links": []},
        {**meta("p3"), "name": "Déménagement", "description": "", "status": "done", "color": "#22c55e", "links": []}]
    notes = [{**meta("n1"), "title": "Idées de vidéos", "content": "1. Présenter la nouvelle page d'accueil\\n2. Astuces de personnalisation", "projectId": None, "starred": True},
             {**meta("n2"), "title": "", "content": "Penser à renouveler le jeton GitHub avant la fin du mois.", "projectId": None, "starred": False},
             {**meta("n3"), "title": "Réunion du jeudi", "content": "Valider les couleurs, envoyer le devis.", "projectId": "p1", "starred": False}]
    task = lambda i, t, due, done=False, pr=None: {**meta(i), "title": t, "description": "", "done": done, "projectId": pr, "dueDate": due}
    tasks = [task("t1", "Envoyer le devis au client", today(1), pr="p1"), task("t2", "Réserver le train", today(5)), task("t3", "Appeler le dentiste", today(-1)),
             task("t4", "Sauvegarder les photos", None), task("t5", "Payer la facture", today(-3), True)]
    cats_e = [{**meta(i), "name": n, "color": c, "order": k} for k, (i, n, c) in enumerate(cats)]
    page.evaluate("""async (d) => {
      const k = 'dinostart:doc'; const got = await chrome.storage.local.get(k); const doc = got[k];
      Object.assign(doc, d); doc.settings.general.onboardingDone = true;
      // Mise en page des exemples : cartes ajustées à leur contenu (x, y, largeur, hauteur sur la grille de 12 colonnes)
      const R = { clock: [0,0,6,4], date: [6,0,6,4], search: [0,4,12,4], favorites: [0,8,8,5], quickLinks: [8,8,4,4], tasks: [8,12,4,5], projects: [0,13,4,5], quickNotes: [4,13,4,5] };
      for (const w of doc.widgets) if (R[w.type]) [w.x, w.y, w.w, w.h] = R[w.type];
      await chrome.storage.local.set({ [k]: doc });
      await chrome.storage.local.set({ 'dinostart:searchHistory': [
        {q: 'météo lyon demain', at: '2026-01-05T09:00:00.000Z'}, {q: 'recette tarte aux pommes', at: '2026-01-04T09:00:00.000Z'}, {q: 'horaires train paris', at: '2026-01-03T09:00:00.000Z'} ] });
    }""", {"categories": cats_e, "favorites": [{**f} for f in favs], "projects": projects, "notes": notes, "tasks": tasks})
    page.reload(); page.wait_for_selector(".board"); time.sleep(1.0)

def main():
    if not os.path.isdir(EXT): sys.exit("dist/ introuvable : lancez d'abord `npm run build`.")
    os.makedirs(OUT, exist_ok=True)
    tmp = tempfile.mkdtemp(prefix="dinostart-docs-")
    with sync_playwright() as p:
        # --- page chrome://extensions (Chrome de la machine : libellés en anglais ici)
        ctx = launch(p, os.path.join(tmp, "a")); time.sleep(1.5)
        pg = ctx.new_page(); pg.set_viewport_size({"width": 1180, "height": 560}); pg.goto("chrome://extensions"); time.sleep(1.5)
        pg.locator("#devMode").click(); time.sleep(.8)
        f = os.path.join(OUT, "00-chrome-extensions.png"); pg.screenshot(path=f)
        annotate(f, [(1, *box(pg, "#devMode")), (2, *box(pg, "#loadUnpacked")), (3, *box(pg, "extensions-item"))])
        ctx.close()

        # --- assistant du premier lancement
        ctx = launch(p, os.path.join(tmp, "b")); page = ctx.new_page(); page.goto("chrome://newtab"); page.wait_for_selector(".ob-card"); time.sleep(.6)
        page.get_by_role("button", name="Commencer").click(); time.sleep(.5)
        page.locator(".ob-card").screenshot(path=os.path.join(OUT, "02-assistant.png"))
        ctx.close()

        # --- l'application avec des données d'exemple
        ctx = launch(p, os.path.join(tmp, "c")); page = ctx.new_page(); page.goto("chrome://newtab"); page.wait_for_selector(".ob-card"); time.sleep(.4)
        seed(page)
        page.set_viewport_size({"width": 1360, "height": 860}); time.sleep(.4)
        page.screenshot(path=os.path.join(OUT, "00-hero.png"))
        page.set_viewport_size(VIEW); time.sleep(.4)
        f = os.path.join(OUT, "01-accueil.png"); page.screenshot(path=f)
        annotate(f, [(1, *box(page, ".gsearch .search")), (2, *box(page, ".quick-actions")), (3, *box(page, ".cell[data-widget=favorites]")),
                     (4, *box(page, ".cell[data-widget=tasks]")), (5, *box(page, ".home-foot .btn"))])
        # recherche
        s = page.get_by_role("combobox", name="Rechercher"); s.click(); time.sleep(.5)
        sb = page.locator(".cell[data-widget=search]").bounding_box()
        clip = {"x": sb["x"], "y": sb["y"], "width": sb["width"], "height": 430}
        page.screenshot(path=os.path.join(OUT, "05-recherche-recentes.png"), clip=clip)
        s.fill("gi"); time.sleep(.5)
        page.screenshot(path=os.path.join(OUT, "05-recherche-resultats.png"), clip=clip)
        s.fill(""); page.keyboard.press("Escape"); page.mouse.click(5, 5)
        # dossier ouvert
        page.get_by_role("button", name=lambda n: n.startswith("Dossier Travail")).click() if False else page.locator("button.tile.folder").first.click(); time.sleep(.5)
        page.locator("dialog.modal").screenshot(path=os.path.join(OUT, "04-dossier.png"))
        page.keyboard.press("Escape"); time.sleep(.4)
        # personnaliser
        page.get_by_role("button", name="Personnaliser").click(); page.evaluate("window.scrollTo(0,0)"); time.sleep(.8)
        f = os.path.join(OUT, "03-personnaliser.png"); page.screenshot(path=f)
        annotate(f, [(1, *box(page, ".cell[data-widget=clock] .cell-bar")), (2, *box(page, ".cell[data-widget=favorites] .resize-handle")), (3, *box(page, ".drawer"))])
        page.get_by_role("button", name="Terminer").last.click(); time.sleep(.4)
        # raccourcis
        page.get_by_role("button", name="Paramètres").click(); page.get_by_role("tab", name="Recherche").click(); time.sleep(.5)
        pan = page.locator("section.panel", has_text="Raccourcis sous la barre de recherche"); pan.scroll_into_view_if_needed(); time.sleep(.3)
        pan.screenshot(path=os.path.join(OUT, "06-raccourcis.png"))
        # projets
        page.get_by_role("button", name="Projets", exact=True).click(); time.sleep(.6); page.screenshot(path=os.path.join(OUT, "07-projets.png"))
        # synchronisation (formulaire rempli avec des valeurs d'exemple, jeton factice)
        page.get_by_role("button", name="Paramètres").click(); page.get_by_role("tab", name="Synchronisation").click(); time.sleep(.5)
        page.get_by_label("Propriétaire du dépôt").fill("ton-pseudo-github"); page.get_by_label("Nom du dépôt").fill("dinostart-data")
        page.get_by_label(re.compile("Jeton d’accès") if False else "Jeton d’accès fine-grained").fill("github_pat_XXXXXXXXXXXXXXXXXXXXXXXXXXXX")
        pan = page.locator("section.panel", has_text="Dépôt GitHub privé"); pan.scroll_into_view_if_needed(); time.sleep(.4)
        pb = pan.bounding_box(); clip = {"x": pb["x"], "y": pb["y"], "width": pb["width"], "height": pb["height"]}
        f = os.path.join(OUT, "08-synchro.png"); page.screenshot(path=f, clip=clip)
        annotate(f, [(1, *box(page, "input[placeholder='votre-pseudo']")), (2, *box(page, "input[placeholder='dinostart-data']")),
                     (3, *box(page, "label:has-text('Branche')")), (4, *box(page, "label:has-text('Chemin du fichier')")), (5, *box(page, "input[type=password]")),
                     (6, *box(page, "button:has-text('Vérifier les paramètres')")), (7, *box(page, "button:has-text('Enregistrer et synchroniser')"))], origin=(pb["x"], pb["y"]))
        # sauvegardes
        page.get_by_role("button", name="Sauvegardes").click(); time.sleep(.4)
        page.get_by_role("button", name="Créer une sauvegarde maintenant").click(); time.sleep(.8)
        page.screenshot(path=os.path.join(OUT, "09-sauvegardes.png"))
        ctx.close()
    shutil.rmtree(tmp, ignore_errors=True)
    print("Images écrites dans", OUT, ":", sorted(os.listdir(OUT)))

main()
