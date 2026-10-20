import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { Bookmark, Camera, CheckSquare, Clock, FolderKanban, Globe, Search, StickyNote, Tag, X } from 'lucide-react';
import { searchAll, KIND_LABELS, type SearchHit } from '../../core/search';
import { buildSearchUrl } from '../../core/url';
import { SEARCH_ENGINE_URLS } from '../../core/defaults';
import type { Shortcut } from '../../core/types';
import { ShortcutGlyph } from '../shortcutIcons';
import { openChromeHistory, openPrivateWindow } from '../../search/browser';
import { matchEntries, SearchHistory, type SearchEntry } from '../../search/history';
import { fetchSuggestions, MIN_SUGGEST_LENGTH } from '../../search/suggestions';
import { useApp } from '../context';

const KIND_ICON = { favorite: Bookmark, category: Tag, project: FolderKanban, note: StickyNote, task: CheckSquare } as const;
export const LENS_URL = 'https://lens.google.com/';

function engineTemplate(engine: string, customUrl: string): string {
  return engine === 'custom' ? customUrl : SEARCH_ENGINE_URLS[engine as keyof typeof SEARCH_ENGINE_URLS]?.url ?? SEARCH_ENGINE_URLS.google.url;
}
/** Moteur Web choisi par l'utilisateur ; renvoie une erreur si le modèle personnalisé est invalide. */
export function webSearchUrl(engine: string, customUrl: string, query: string) {
  return buildSearchUrl(engineTemplate(engine, customUrl), query);
}
/** Page d'accueil du moteur choisi (pour ouvrir une fenêtre privée sans recherche). */
export function engineHomeUrl(engine: string, customUrl: string): string {
  try { return `${new URL(engineTemplate(engine, customUrl).replace('{query}', '')).origin}/`; } catch { return 'https://www.google.com/'; }
}
/** Adresse ouverte par un raccourci « lien » : avec la recherche saisie si le raccourci sait la transmettre. */
export function shortcutTargetUrl(sc: Pick<Shortcut, 'url' | 'queryUrl'>, query: string): string {
  const q = query.trim();
  return q && sc.queryUrl ? sc.queryUrl.replace('{query}', encodeURIComponent(q)) : sc.url ?? '#';
}

type Row =
  | { k: 'history'; q: string }
  | { k: 'suggest'; q: string }
  | { k: 'local'; hit: SearchHit }
  | { k: 'web'; q: string };

export function SearchWidget({ placeholder }: { placeholder: string }) {
  const { doc, store, go, toast } = useApp();
  const s = doc.settings.search;
  const history = useMemo(() => new SearchHistory(store), [store]);
  const [q, setQ] = useState('');
  const [active, setActive] = useState(-1);
  const [open, setOpen] = useState(false);
  const [past, setPast] = useState<SearchEntry[]>([]);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const input = useRef<HTMLInputElement>(null);
  const typed = q.trim();

  useEffect(() => { if (s.rememberSearches) void history.list().then(setPast); else setPast([]); }, [history, s.rememberSearches]);

  // Suggestions Google : seulement si activées, saisie assez longue et réseau disponible ; une requête annulée à chaque frappe.
  useEffect(() => {
    if (!s.googleSuggestions || typed.length < MIN_SUGGEST_LENGTH || (typeof navigator !== 'undefined' && !navigator.onLine)) { setSuggestions([]); return; }
    const ctrl = new AbortController();
    const t = setTimeout(() => { void fetchSuggestions(typed, { signal: ctrl.signal }).then((r) => { if (!ctrl.signal.aborted) setSuggestions(r); }); }, 180);
    return () => { clearTimeout(t); ctrl.abort(); };
  }, [typed, s.googleSuggestions]);

  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (e.key === '/' && t && !/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) && !t.isContentEditable) { e.preventDefault(); input.current?.focus(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  useEffect(() => setActive(-1), [q]);

  const rows = useMemo<Row[]>(() => {
    const out: Row[] = [];
    const hist = s.rememberSearches ? matchEntries(past, typed, typed ? 3 : 6) : [];
    hist.forEach((h) => out.push({ k: 'history', q: h.q }));
    const seen = new Set(hist.map((h) => h.q.toLowerCase()));
    suggestions.filter((x) => !seen.has(x.toLowerCase())).forEach((x) => out.push({ k: 'suggest', q: x }));
    if (typed) {
      searchAll(doc, typed, 5).forEach((hit) => out.push({ k: 'local', hit }));
      out.push({ k: 'web', q: typed });
    }
    return out;
  }, [doc, typed, past, suggestions, s.rememberSearches]);

  const engineLabel = s.engine === 'custom' ? 'moteur personnalisé' : SEARCH_ENGINE_URLS[s.engine].label;
  const go_ = (url: string, newTab: boolean) => { if (newTab) window.open(url, '_blank', 'noopener,noreferrer'); else window.location.assign(url); };

  const webSearch = async (query: string, newTab: boolean) => {
    const r = webSearchUrl(s.engine, s.customUrl, query);
    if (!r.ok) { toast(r.error, 'error'); return; }
    if (s.rememberSearches) {
      const saved = history.add(query).then((r) => { if (r.ok) setPast(r.value); });
      await Promise.race([saved, new Promise((res) => setTimeout(res, 250))]); // ne pas retarder la navigation plus de 250 ms
    }
    go_(r.value, newTab);
  };
  const openHit = (h: SearchHit, newTab: boolean) => {
    setOpen(false); setQ('');
    if (h.kind === 'favorite' && h.url) go_(h.url, newTab);
    else if (h.kind === 'category') go({ view: 'favorites', categoryId: h.id });
    else if (h.kind === 'project') go({ view: 'projects', focusId: h.id });
    else if (h.kind === 'note') go({ view: 'notes', focusId: h.id });
    else go({ view: 'tasks', focusId: h.id });
  };
  const choose = (row: Row, newTab: boolean) => {
    if (row.k === 'local') openHit(row.hit, newTab); else void webSearch(row.q, newTab);
  };
  const runShortcut = async (sc: Shortcut) => {
    if (sc.kind === 'history') { const r = await openChromeHistory(); if (!r.ok) toast(r.error, 'error'); return; }
    // Navigation privée : sur l'adresse du raccourci si elle existe, sinon sur la recherche saisie ou l'accueil du moteur.
    // Une recherche privée n'est jamais enregistrée dans l'historique de DinoStart.
    const target = sc.url ? { ok: true as const, value: sc.url } : typed ? webSearchUrl(s.engine, s.customUrl, typed) : { ok: true as const, value: engineHomeUrl(s.engine, s.customUrl) };
    if (!target.ok) { toast(target.error, 'error'); return; }
    const w = await openPrivateWindow(target.value);
    if (!w.ok) toast(w.error, 'error'); else setQ('');
  };
  const forget = async (entry: string) => setPast(await history.remove(entry));

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setActive((a) => Math.min(a + 1, rows.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, -1)); }
    else if (e.key === 'Escape') { setOpen(false); setQ(''); }
    else if (e.key === 'Enter' && typed) {
      e.preventDefault();
      const newTab = e.ctrlKey || e.metaKey;
      const row = active >= 0 ? rows[active] : undefined;
      if (row && !e.altKey) choose(row, newTab); else void webSearch(typed, newTab);
    } else if (e.key === 'Enter' && active >= 0 && rows[active]) { e.preventDefault(); choose(rows[active]!, false); }
  };

  const shortcuts = s.shortcuts.filter((x) => x.enabled);
  const showList = open && rows.length > 0;

  return (
    <div className="gsearch">
      <div className="search" role="search">
        <Search size={20} className="search-icon" aria-hidden="true" />
        <input
          ref={input} type="search" value={q} placeholder={placeholder} aria-label="Rechercher" role="combobox" aria-expanded={showList} aria-controls="search-results"
          aria-activedescendant={showList && active >= 0 ? `sr-${active}` : undefined} autoComplete="off" spellCheck={false}
          onChange={(e) => { setQ(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 150)} onKeyDown={onKeyDown}
        />
        {q && <button className="icon-btn" aria-label="Effacer la recherche" onMouseDown={(e) => { e.preventDefault(); setQ(''); input.current?.focus(); }}><X size={18} /></button>}
        {s.showLens && <a className="icon-btn lens" href={LENS_URL} rel="noopener noreferrer" aria-label="Recherche par image (Google Lens)" title="Recherche par image (Google Lens)"><Camera size={20} /></a>}
        {showList && (
          <ul id="search-results" className="search-results" role="listbox">
            {rows.map((row, i) => {
              const cls = i === active ? 'active' : '';
              const common = { id: `sr-${i}`, role: 'option' as const, 'aria-selected': i === active, className: cls, onMouseEnter: () => setActive(i), onMouseDown: (e: React.MouseEvent) => { e.preventDefault(); choose(row, e.ctrlKey || e.metaKey); } };
              if (row.k === 'history') return (
                <li key={`h-${row.q}`} {...common}><Clock size={16} aria-hidden="true" /><span className="sr-title">{row.q}</span><span className="sr-sub">Recherche récente</span>
                  <button className="icon-btn" aria-label={`Oublier « ${row.q} »`} onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); void forget(row.q); }}><X size={14} /></button></li>);
              if (row.k === 'suggest') return (
                <li key={`s-${row.q}`} {...common}><Search size={16} aria-hidden="true" /><span className="sr-title">{row.q}</span><span className="sr-sub" /></li>);
              if (row.k === 'local') {
                const I = KIND_ICON[row.hit.kind];
                return (<li key={`l-${row.hit.kind}-${row.hit.id}`} {...common}><I size={16} aria-hidden="true" /><span className="sr-title">{row.hit.title}</span><span className="sr-sub">{row.hit.subtitle}</span><span className={`chip chip-${row.hit.kind}`}>{KIND_LABELS[row.hit.kind]}</span></li>);
              }
              return (<li key="web" {...common} className={`web ${cls}`}><Globe size={16} aria-hidden="true" /><span className="sr-title">Rechercher « {row.q} » sur le Web</span><span className="sr-sub">{engineLabel}</span><span className="chip">Web</span></li>);
            })}
          </ul>
        )}
      </div>
      {shortcuts.length > 0 && (
        <div className="quick-actions" aria-label="Raccourcis">
          {shortcuts.map((sc) => sc.kind === 'link' ? (
            <a key={sc.id} className="pill" href={shortcutTargetUrl(sc, typed)} rel="noopener noreferrer" title={sc.queryUrl && typed ? `Envoyer « ${typed} » vers ${sc.label}` : `Ouvrir ${sc.label}`}><ShortcutGlyph shortcut={sc} />{sc.label}</a>
          ) : (
            <button key={sc.id} className="pill" onClick={() => void runShortcut(sc)}
              title={sc.kind === 'history' ? 'Ouvrir l’historique de Chrome' : typed && !sc.url ? 'Lancer cette recherche en navigation privée' : 'Ouvrir une fenêtre de navigation privée'}><ShortcutGlyph shortcut={sc} />{sc.label}</button>
          ))}
        </div>
      )}
    </div>
  );
}
