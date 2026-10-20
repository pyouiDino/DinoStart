import { useRef, useState } from 'react';
import { Copy, ExternalLink, ImageUp, MessageCircle, ShieldCheck, Palette, Rocket, Search, SlidersHorizontal, Trash2, CloudCog } from 'lucide-react';
import { SearchHistory } from '../../search/history';
import { CHROME_PAGES, dinoStartPageUrl, getOpenMode, getVersion, openChromePage } from '../../search/browser';
import { DISCORD_URL } from '../links';
import { SEARCH_ENGINE_URLS } from '../../core/defaults';
import { updateSettings, updateWidget } from '../../core/ops';
import { SEARCH_ENGINES, type Settings } from '../../core/types';
import { validateSearchTemplate } from '../../core/url';
import { Button, Field, Toggle } from '../common';
import { useApp, type SettingsTab } from '../context';
import { contrastRatio, prepareBackgroundImage } from '../theme';
import { WidgetConfigForm } from '../widgets/WidgetConfigForm';
import { WIDGET_TITLES } from '../widgets/widgets';
import { SyncPanel } from './SyncPanel';
import { COLOR_PRESETS } from '../presets';
import { ShortcutsManager } from '../ShortcutsManager';

type Ap = Settings['appearance'];

function Appearance() {
  const { doc, store, act, bgImage, setBgImage, toast } = useApp();
  const a = doc.settings.appearance;
  const fileRef = useRef<HTMLInputElement>(null);
  const setAp = (patch: Partial<Ap>) => void act(store.mutate((d, c) => updateSettings(d, c, (s) => ({ ...s, appearance: { ...s.appearance, ...patch } }))));
  const setShow = (patch: Partial<Settings['show']>) => void act(store.mutate((d, c) => updateSettings(d, c, (s) => ({ ...s, show: { ...s.show, ...patch } }))));
  const bg = a.background ?? (document.documentElement.dataset.theme === 'light' ? '#f6f2ec' : '#14110e');
  const low = a.background && contrastRatio(a.primary, a.background) < 3;

  const onImage = async (file?: File) => {
    if (!file) return;
    const r = await prepareBackgroundImage(file);
    if (!r.ok) { toast(r.error, 'error'); return; }
    const w = await setBgImage(r.dataUrl);
    if (!w.ok) { toast(w.error, 'error'); return; }
    setAp({ useBackgroundImage: true });
    toast('Image de fond enregistrée sur cet appareil', 'success');
    if (fileRef.current) fileRef.current.value = '';
  };
  return (
    <div className="stack">
      <section className="panel"><h2><Palette size={18} />Thème et couleurs</h2>
        <div className="form-grid">
          <fieldset className="field"><legend className="field-label">Thème</legend>
            <div className="seg">{([['dark', 'Sombre'], ['light', 'Clair'], ['system', 'Système']] as const).map(([k, l]) => <button key={k} className={a.mode === k ? 'on' : ''} aria-pressed={a.mode === k} onClick={() => setAp({ mode: k })}>{l}</button>)}</div></fieldset>
          <div className="three-col">
            <Field label="Couleur principale"><input type="color" value={a.primary} onChange={(e) => setAp({ primary: e.target.value })} /></Field>
            <Field label="Couleur d’accent"><input type="color" value={a.accent} onChange={(e) => setAp({ accent: e.target.value })} /></Field>
            <Field label="Couleur de fond" hint="Le texte s’adapte automatiquement."><span className="row-gap"><input type="color" value={bg} onChange={(e) => setAp({ background: e.target.value })} /><Button variant="ghost" disabled={!a.background} onClick={() => setAp({ background: null })}>Par défaut</Button></span></Field>
          </div>
          {low && <p className="notice">Le contraste entre la couleur principale et le fond est faible : certains boutons seront difficiles à lire.</p>}
          <Button variant="ghost" onClick={() => setAp({ primary: COLOR_PRESETS[0].primary, accent: COLOR_PRESETS[0].accent, background: null })}>Restaurer les couleurs d’origine</Button>
          <div className="field"><span className="field-label">Image de fond (stockée sur cet appareil uniquement)</span>
            <div className="row-gap"><input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/avif" aria-label="Choisir une image de fond" onChange={(e) => void onImage(e.target.files?.[0])} />
              {bgImage && <Button variant="ghost" icon={<Trash2 size={16} />} onClick={() => void setBgImage(null).then(() => setAp({ useBackgroundImage: false }))}>Retirer l’image</Button>}</div>
            {bgImage && <Toggle label="Afficher l’image de fond" checked={a.useBackgroundImage} onChange={(v) => setAp({ useBackgroundImage: v })} />}
            <span className="field-hint"><ImageUp size={12} /> Réduite à 1920 px. Elle n’est pas synchronisée ni exportée.</span></div>
        </div></section>
      <section className="panel"><h2><SlidersHorizontal size={18} />Cartes et espacement</h2>
        <div className="form-grid">
          <Field label={`Opacité des cartes : ${Math.round(a.cardOpacity * 100)} %`}><input type="range" min={20} max={100} value={Math.round(a.cardOpacity * 100)} onChange={(e) => setAp({ cardOpacity: Number(e.target.value) / 100 })} /></Field>
          <Field label={`Espacement de la grille : ${a.gap} px`}><input type="range" min={0} max={48} step={2} value={a.gap} onChange={(e) => setAp({ gap: Number(e.target.value) })} /></Field>
          <div className="two-col">
            <Field label="Taille des cartes"><select value={a.cardSize} onChange={(e) => setAp({ cardSize: e.target.value as Ap['cardSize'] })}><option value="compact">Compacte</option><option value="medium">Moyenne</option><option value="large">Grande</option></select></Field>
            <Field label="Densité de l’interface"><select value={a.density} onChange={(e) => setAp({ density: e.target.value as Ap['density'] })}><option value="compact">Compacte</option><option value="comfortable">Confortable</option><option value="spacious">Aérée</option></select></Field>
          </div></div></section>
      <section className="panel"><h2><Rocket size={18} />Assistant de démarrage</h2>
        <p className="muted">Refaire la configuration guidée (moteur de recherche, apparence). Vos données ne sont pas touchées.</p>
        <div><Button variant="secondary" onClick={() => void act(store.mutate((d, c) => updateSettings(d, c, (x) => ({ ...x, general: { ...x.general, onboardingDone: false } }))))}>Relancer l’assistant</Button></div></section>
      <section className="panel"><h2>Éléments affichés</h2>
        <div className="form-grid">
          <Toggle label="Indicateur de synchronisation dans l’en-tête" checked={doc.settings.show.syncIndicator} onChange={(v) => setShow({ syncIndicator: v })} />
          <Toggle label="Titres sous les icônes de favoris" checked={doc.settings.show.favoriteTitles} onChange={(v) => setShow({ favoriteTitles: v })} />
          <Toggle label="Statut des projets" checked={doc.settings.show.projectStatus} onChange={(v) => setShow({ projectStatus: v })} />
          <Toggle label="Échéances des tâches" checked={doc.settings.show.taskDueDates} onChange={(v) => setShow({ taskDueDates: v })} />
          <Toggle label="Message d’accueil (bonjour, bonsoir…)" checked={doc.settings.show.greeting} onChange={(v) => setShow({ greeting: v })} />
        </div></section>
    </div>
  );
}

function Widgets() {
  const { doc, store, act } = useApp();
  const sorted = [...doc.widgets].sort((a, b) => a.y - b.y || a.x - b.x);
  return (
    <div className="stack">
      <p className="muted">Activez, masquez et configurez chaque widget. L’ordre et la taille se règlent directement sur l’accueil avec le bouton « Disposition ».</p>
      {sorted.map((w) => (
        <details key={w.type} className="panel acc">
          <summary><span>{WIDGET_TITLES[w.type]}</span><span className={`chip ${w.enabled ? 'chip-status-active' : ''}`}>{w.enabled ? 'Activé' : 'Masqué'}</span></summary>
          <div className="form-grid"><Toggle label="Activé" checked={w.enabled} onChange={(v) => void act(store.mutate((d, c) => updateWidget(d, c, w.type, { enabled: v })))} /><WidgetConfigForm widget={w} /></div>
        </details>
      ))}
    </div>
  );
}

function SearchSettings() {
  const { doc, store, act, toast } = useApp();
  const s = doc.settings.search;
  const [custom, setCustom] = useState(s.customUrl);
  const check = s.engine === 'custom' ? validateSearchTemplate(custom) : null;
  const patch = (p: Partial<Settings['search']>) => act(store.mutate((d, c) => updateSettings(d, c, (x) => ({ ...x, search: { ...x.search, ...p } }))));
  const set = (engine: Settings['search']['engine'], customUrl: string) => patch({ engine, customUrl });
  return (
    <div className="stack">
      <section className="panel"><h2><Search size={18} />Moteur de recherche</h2>
        <p className="muted">La recherche dans vos favoris, projets, notes et tâches reste locale. Le moteur choisi n’est contacté que lorsque vous lancez une recherche Web.</p>
        <div className="form-grid">
          <Field label="Moteur de recherche"><select value={s.engine} onChange={(e) => void set(e.target.value as Settings['search']['engine'], custom)}>
            {SEARCH_ENGINES.map((k) => <option key={k} value={k}>{k === 'custom' ? 'Personnalisé…' : SEARCH_ENGINE_URLS[k].label}</option>)}</select></Field>
          {s.engine === 'custom' && (<Field label="Modèle d’adresse" hint="Exemple : https://exemple.fr/search?q={query}" error={custom && check && !check.ok ? check.error : null}>
            <input value={custom} onChange={(e) => setCustom(e.target.value)} onBlur={() => { if (check?.ok) void set('custom', custom); }} spellCheck={false} /></Field>)}
          {s.engine === 'custom' && <div><Button variant="primary" disabled={!check?.ok || custom === s.customUrl} onClick={() => void set('custom', custom)}>Enregistrer le modèle</Button></div>}
        </div></section>
      <section className="panel"><h2>Suggestions et historique</h2>
        <div className="form-grid">
          <Toggle label="Suggestions Google pendant la frappe" checked={s.googleSuggestions} onChange={(v) => void patch({ googleSuggestions: v })} />
          <p className="muted small">Le texte tapé est envoyé à Google (suggestqueries.google.com) pour obtenir des suggestions. Aucun cookie ni identifiant n’est envoyé. Désactivé : plus aucune requête n’est faite pendant la frappe.</p>
          <Toggle label="Retenir mes recherches sur cet appareil" checked={s.rememberSearches} onChange={(v) => void patch({ rememberSearches: v })} />
          <p className="muted small">Proposées quand vous cliquez dans la barre ou commencez à taper. Elles ne quittent pas cet ordinateur : ni synchronisées, ni exportées. Les recherches en navigation privée ne sont jamais enregistrées.</p>
          <div><Button variant="ghost" icon={<Trash2 size={16} />} onClick={() => void new SearchHistory(store).clear().then(() => toast('Historique des recherches effacé', 'success'))}>Effacer l’historique des recherches</Button></div>
        </div></section>
      <section className="panel"><h2>Raccourcis sous la barre de recherche</h2>
        <div className="form-grid">
          <Toggle label="Recherche par image (Google Lens)" checked={s.showLens} onChange={(v) => void patch({ showLens: v })} />
          <ShortcutsManager />
        </div></section>
    </div>
  );
}

function OpenSettings() {
  const { toast } = useApp();
  const url = dinoStartPageUrl();
  const copy = async () => { try { await navigator.clipboard.writeText(url ?? ''); toast('Adresse copiée', 'success'); } catch { toast('Copie impossible : sélectionnez l’adresse et faites Ctrl+C.', 'error'); } };
  const open = async (key: keyof typeof CHROME_PAGES) => { const r = await openChromePage(key); if (!r.ok) toast(r.error, 'error'); };
  return (
    <div className="stack">
      <section className="panel"><h2><ExternalLink size={18} />Ouvrir DinoStart</h2>
        <p className="muted">Cette version ne remplace pas le nouvel onglet : il n’y a donc pas de barre Chrome en bas. Vous ouvrez DinoStart de quatre façons :</p>
        <ol className="steps">
          <li><strong>Le bouton DinoStart</strong> dans la barre d’outils de Chrome. S’il n’y est pas : cliquez sur l’icône puzzle, puis sur la punaise à côté de DinoStart.</li>
          <li><strong>Le raccourci clavier Alt + Maj + D.</strong> Vous pouvez le changer ci-dessous.</li>
          <li><strong>Le bouton « Page d’accueil »</strong> (la maison) de Chrome, ou Alt + Origine, avec l’adresse ci-dessous.</li>
          <li><strong>Au démarrage de Chrome</strong>, en ajoutant l’adresse ci-dessous comme page de démarrage.</li>
        </ol>
        <div className="field"><span className="field-label">Adresse de DinoStart</span>
          <div className="inline-add"><input readOnly value={url ?? 'Adresse indisponible'} aria-label="Adresse de DinoStart" onFocus={(e) => e.currentTarget.select()} /><Button variant="secondary" icon={<Copy size={16} />} onClick={() => void copy()} disabled={!url}>Copier l’adresse</Button></div>
          <span className="field-hint">Chaque ordinateur a sa propre adresse : copiez-la depuis cet écran sur chaque PC.</span></div>
      </section>
      <section className="panel"><h2>Réglages de Chrome</h2>
        <div className="form-grid">
          <div><p className="muted small">Page d’accueil : « Afficher le bouton Page d’accueil » → « Saisir une adresse web personnalisée » → collez l’adresse.</p><Button variant="secondary" onClick={() => void open('appearance')}>Ouvrir « Apparence » de Chrome</Button></div>
          <div><p className="muted small">Au démarrage : « Ouvrir une page ou un ensemble de pages spécifiques » → « Ajouter une nouvelle page » → collez l’adresse.</p><Button variant="secondary" onClick={() => void open('startup')}>Ouvrir « Au démarrage » de Chrome</Button></div>
          <div><p className="muted small">Changer le raccourci clavier de DinoStart.</p><Button variant="secondary" onClick={() => void open('shortcuts')}>Ouvrir les raccourcis des extensions</Button></div>
        </div></section>
    </div>
  );
}

function HelpSettings() {
  return (
    <div className="stack">
      <section className="panel"><h2><MessageCircle size={18} />Un bug, une idée, une question ?</h2>
        <p>Dites-le sur le <strong>Discord de DinoStart</strong> : c'est là que sont suivis les problèmes et les idées d'amélioration.</p>
        <div><a className="btn btn-primary" href={DISCORD_URL} target="_blank" rel="noopener noreferrer"><MessageCircle size={16} />Rejoindre le Discord</a></div>
        <h3>Pour qu'on puisse vous aider, indiquez :</h3>
        <ul className="steps">
          <li>ce que vous avez fait juste avant, étape par étape ;</li>
          <li>ce qui s'est passé, et ce que vous attendiez ;</li>
          <li>une capture d'écran si possible ;</li>
          <li>la version de DinoStart : <strong>{getVersion()}</strong> (celle de cet écran).</li>
        </ul>
        <p className="notice"><ShieldCheck size={16} /><span>Ne publiez jamais votre jeton GitHub (il commence par github_pat_) ni un fichier de sauvegarde : ils contiennent des informations personnelles.</span></p>
      </section>
      <section className="panel"><h2>Une barre en bas de la page ?</h2>
        <p>Si Chrome affiche en bas de l'écran une barre avec « DinoStart » et « Personnaliser Chrome », elle vient de Chrome, pas de DinoStart.</p>
        <p><strong>Faites un clic droit dessus et désactivez-la.</strong> L'intitulé exact du choix dépend de votre version de Chrome. Si elle revient un jour (par exemple après une mise à jour de Chrome), refaites la même chose.</p>
      </section>
    </div>
  );
}

export function SettingsView() {
  const { nav, go } = useApp();
  const tab: SettingsTab = nav.settingsTab ?? 'appearance';
  const tabs: [SettingsTab, string][] = [['appearance', 'Apparence'], ['widgets', 'Widgets'], ['search', 'Recherche'], ['sync', 'Synchronisation'], ...(getOpenMode() === 'page' ? [['open', 'Ouverture'] as [SettingsTab, string]] : []), ['help', 'Aide']];
  return (
    <div className="main-col">
      <div className="seg seg-tabs" role="tablist" aria-label="Sections des paramètres">
        {tabs.map(([k, l]) => <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => go({ view: 'settings', settingsTab: k })}>{k === 'sync' && <CloudCog size={14} />}{l}</button>)}
      </div>
      <div role="tabpanel">{tab === 'appearance' ? <Appearance /> : tab === 'widgets' ? <Widgets /> : tab === 'search' ? <SearchSettings /> : tab === 'open' ? <OpenSettings /> : tab === 'help' ? <HelpSettings /> : <SyncPanel />}</div>
    </div>
  );
}
