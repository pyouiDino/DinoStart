import { defaultSettings, defaultWidgetConfig } from './defaults';
import {
  ICON_NAMES, PROJECT_STATUSES, SCHEMA_VERSION, SEARCH_ENGINES, SHORTCUT_ICONS, WIDGET_TYPES,
  type Category, type DinoDocument, type Favorite, type FavoriteIcon, type IconName, type Note, type Project,
  type Shortcut, type ShortcutIcon, type ShortcutIconName, type ProjectLink, type Settings, type Task, type Widget, type WidgetConfigs, type WidgetType,
  type EntityMeta, type Result, ok, fail,
} from './types';
import { validateSearchTemplate, validateUrl } from './url';

// ---------- lecteurs bas niveau : construisent de nouveaux objets (liste blanche de champs) ----------

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const HEX = /^#[0-9a-fA-F]{6}$/;
const ID = /^[A-Za-z0-9_-]{1,64}$/;

export const LIMITS = { title: 200, name: 100, description: 2000, noteContent: 50_000, label: 100, path: 500, links: 30, collection: 5000 } as const;

class Reader {
  errors: string[] = [];
  bad(path: string, msg: string) { this.errors.push(`${path} : ${msg}`); }

  str(o: Obj, k: string, path: string, max: number, opts: { min?: number } = {}): string {
    const v = o[k];
    if (typeof v !== 'string') { this.bad(`${path}.${k}`, 'texte attendu'); return ''; }
    if (v.length > max) { this.bad(`${path}.${k}`, `${max} caractères maximum`); return v.slice(0, max); }
    if (v.trim().length < (opts.min ?? 0)) this.bad(`${path}.${k}`, 'valeur obligatoire');
    return v;
  }
  bool(o: Obj, k: string, path: string): boolean {
    const v = o[k];
    if (typeof v !== 'boolean') { this.bad(`${path}.${k}`, 'booléen attendu'); return false; }
    return v;
  }
  num(o: Obj, k: string, path: string, min: number, max: number, int = false): number {
    const v = o[k];
    if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max || (int && !Number.isInteger(v))) {
      this.bad(`${path}.${k}`, `nombre${int ? ' entier' : ''} entre ${min} et ${max} attendu`);
      return min;
    }
    return v;
  }
  oneOf<T extends string | number>(o: Obj, k: string, path: string, allowed: readonly T[]): T {
    const v = o[k];
    if (!allowed.includes(v as T)) { this.bad(`${path}.${k}`, `valeur parmi ${allowed.join(', ')}`); return allowed[0] as T; }
    return v as T;
  }
  iso(o: Obj, k: string, path: string): string {
    const v = o[k];
    if (typeof v !== 'string' || !ISO.test(v) || Number.isNaN(Date.parse(v))) { this.bad(`${path}.${k}`, 'date ISO 8601 UTC attendue'); return '1970-01-01T00:00:00.000Z'; }
    return v;
  }
  isoOrNull(o: Obj, k: string, path: string): string | null {
    return o[k] === null ? null : this.iso(o, k, path);
  }
  color(o: Obj, k: string, path: string): string {
    const v = o[k];
    if (typeof v !== 'string' || !HEX.test(v)) { this.bad(`${path}.${k}`, 'couleur #RRGGBB attendue'); return '#808080'; }
    return v.toLowerCase();
  }
  idRef(o: Obj, k: string, path: string): string | null {
    const v = o[k];
    if (v === null) return null;
    if (typeof v !== 'string' || !ID.test(v)) { this.bad(`${path}.${k}`, 'identifiant invalide'); return null; }
    return v;
  }
  obj(v: unknown, path: string): Obj {
    if (!isObj(v)) { this.bad(path, 'objet attendu'); return {}; }
    return v;
  }
  meta(o: Obj, path: string): EntityMeta {
    const idv = o.id;
    let id = '';
    if (typeof idv !== 'string' || !ID.test(idv)) this.bad(`${path}.id`, 'identifiant invalide'); else id = idv;
    const origin = this.str(o, 'origin', path, 64, { min: 1 });
    return { id, createdAt: this.iso(o, 'createdAt', path), updatedAt: this.iso(o, 'updatedAt', path), deletedAt: this.isoOrNull(o, 'deletedAt', path), origin };
  }
}

function readIcon(r: Reader, o: Obj, path: string): FavoriteIcon {
  const icon = r.obj(o.icon, `${path}.icon`);
  const kind = r.oneOf(icon, 'kind', `${path}.icon`, ['auto', 'initial', 'icon'] as const);
  if (kind === 'auto' || kind === 'initial') return { kind };
  return { kind, name: r.oneOf<IconName>(icon, 'name', `${path}.icon`, ICON_NAMES) };
}

export function validateProjectLinkTarget(kind: 'url' | 'path', target: string): Result<string> {
  if (kind === 'url') return validateUrl(target);
  const t = target.trim();
  if (!t) return fail('Le chemin est obligatoire.');
  if (t.length > LIMITS.path) return fail(`${LIMITS.path} caractères maximum.`);
  return ok(t);
}

function readLinks(r: Reader, v: unknown, path: string): ProjectLink[] {
  if (!Array.isArray(v)) { r.bad(path, 'liste attendue'); return []; }
  if (v.length > LIMITS.links) r.bad(path, `${LIMITS.links} liens maximum`);
  const seen = new Set<string>();
  return v.slice(0, LIMITS.links).map((item, i) => {
    const p = `${path}[${i}]`;
    const o = r.obj(item, p);
    const id = typeof o.id === 'string' && ID.test(o.id) ? o.id : '';
    if (!id) r.bad(`${p}.id`, 'identifiant invalide');
    if (seen.has(id)) r.bad(`${p}.id`, 'identifiant en double'); else seen.add(id);
    const kind = r.oneOf(o, 'kind', p, ['url', 'path'] as const);
    const label = r.str(o, 'label', p, LIMITS.label);
    let target = r.str(o, 'target', p, 2048);
    const t = validateProjectLinkTarget(kind, target);
    if (!t.ok) r.bad(`${p}.target`, t.error); else target = t.value;
    return { id, label, target, kind };
  });
}

export function normalizeWidgetConfig<T extends WidgetType>(type: T, raw: unknown, errors?: Reader, path = 'config'): WidgetConfigs[T] {
  const base = defaultWidgetConfig(type) as unknown as Obj;
  const r = errors ?? new Reader();
  const o: Obj = isObj(raw) ? raw : {};
  const out: Obj = { ...base };
  const pick = <K extends string>(k: K, check: (v: unknown) => boolean) => {
    if (o[k] === undefined) return;
    if (check(o[k])) out[k] = o[k]; else r.bad(`${path}.${k}`, 'valeur invalide');
  };
  const int = (min: number, max: number) => (v: unknown) => typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max;
  switch (type) {
    case 'clock': pick('hour12', (v) => typeof v === 'boolean'); pick('seconds', (v) => typeof v === 'boolean'); break;
    case 'date': pick('style', (v) => v === 'long' || v === 'short'); break;
    case 'search': pick('placeholder', (v) => typeof v === 'string' && v.length <= 80); break;
    case 'favorites': pick('categoryId', (v) => v === null || (typeof v === 'string' && ID.test(v))); pick('layout', (v) => v === 'folders' || v === 'sections'); break;
    case 'projects': pick('limit', int(1, 20)); pick('status', (v) => v === 'all' || (PROJECT_STATUSES as readonly unknown[]).includes(v)); break;
    case 'tasks': pick('limit', int(1, 30)); pick('hideDone', (v) => typeof v === 'boolean'); break;
    case 'quickNotes': pick('limit', int(1, 10)); break;
    case 'quickLinks': break;
  }
  return out as unknown as WidgetConfigs[T];
}

// ---------- entités ----------

function readCategory(r: Reader, v: unknown, path: string): Category {
  const o = r.obj(v, path);
  return { ...r.meta(o, path), name: r.str(o, 'name', path, LIMITS.name, { min: 1 }), color: r.color(o, 'color', path), order: r.num(o, 'order', path, -1e9, 1e9) };
}

function readFavorite(r: Reader, v: unknown, path: string): Favorite {
  const o = r.obj(v, path);
  const meta = r.meta(o, path);
  let url = r.str(o, 'url', path, 2048);
  const u = validateUrl(url);
  if (!u.ok) r.bad(`${path}.url`, u.error); else url = u.value;
  return {
    ...meta, title: r.str(o, 'title', path, LIMITS.title, { min: 1 }), url, categoryId: r.idRef(o, 'categoryId', path),
    icon: readIcon(r, o, path), order: r.num(o, 'order', path, -1e9, 1e9), quick: r.bool(o, 'quick', path),
  };
}

function readProject(r: Reader, v: unknown, path: string): Project {
  const o = r.obj(v, path);
  return {
    ...r.meta(o, path), name: r.str(o, 'name', path, LIMITS.name, { min: 1 }), description: r.str(o, 'description', path, LIMITS.description),
    status: r.oneOf(o, 'status', path, PROJECT_STATUSES), color: r.color(o, 'color', path), links: readLinks(r, o.links, `${path}.links`),
  };
}

function readNote(r: Reader, v: unknown, path: string): Note {
  const o = r.obj(v, path);
  const title = r.str(o, 'title', path, LIMITS.title);
  const content = r.str(o, 'content', path, LIMITS.noteContent);
  const meta = r.meta(o, path);
  if (!meta.deletedAt && !title.trim() && !content.trim()) r.bad(path, 'une note doit avoir un titre ou un contenu');
  return { ...meta, title, content, projectId: r.idRef(o, 'projectId', path), starred: r.bool(o, 'starred', path) };
}

function readTask(r: Reader, v: unknown, path: string): Task {
  const o = r.obj(v, path);
  let dueDate: string | null = null;
  if (o.dueDate !== null) {
    if (typeof o.dueDate === 'string' && DAY.test(o.dueDate) && !Number.isNaN(Date.parse(o.dueDate))) dueDate = o.dueDate;
    else r.bad(`${path}.dueDate`, 'date AAAA-MM-JJ attendue');
  }
  return {
    ...r.meta(o, path), title: r.str(o, 'title', path, LIMITS.title, { min: 1 }), description: r.str(o, 'description', path, LIMITS.description),
    done: r.bool(o, 'done', path), projectId: r.idRef(o, 'projectId', path), dueDate,
  };
}

function readWidget(r: Reader, v: unknown, path: string): Widget {
  const o = r.obj(v, path);
  const meta = r.meta(o, path);
  const type = r.oneOf<WidgetType>(o, 'type', path, WIDGET_TYPES);
  if (meta.id !== type) r.bad(`${path}.id`, 'l’identifiant d’un widget doit être son type');
  const w = r.num(o, 'w', path, 1, 12, true);
  const x = r.num(o, 'x', path, 0, 11, true);
  if (x + w > 12) r.bad(`${path}.x`, 'la carte dépasse les 12 colonnes');
  return {
    ...meta, type, enabled: r.bool(o, 'enabled', path), x, y: r.num(o, 'y', path, 0, 400, true), w, h: r.num(o, 'h', path, 1, 40, true),
    config: normalizeWidgetConfig(type, o.config, r, `${path}.config`),
  } as Widget;
}

function readShortcuts(r: Reader, v: unknown, path: string): Shortcut[] {
  if (!Array.isArray(v)) { r.bad(path, 'liste attendue'); return []; }
  if (v.length > 24) { r.bad(path, '24 raccourcis maximum'); return []; }
  const seen = new Set<string>();
  return v.map((item, i) => {
    const p = `${path}[${i}]`;
    const o = r.obj(item, p);
    const id = typeof o.id === 'string' && ID.test(o.id) ? o.id : '';
    if (!id) r.bad(`${p}.id`, 'identifiant invalide');
    if (seen.has(id)) r.bad(`${p}.id`, 'identifiant en double'); else seen.add(id);
    const kind = r.oneOf(o, 'kind', p, ['link', 'private', 'history'] as const);
    let url: string | null = null;
    if (o.url !== null && o.url !== undefined) {
      const u = typeof o.url === 'string' ? validateUrl(o.url) : fail<string>('texte attendu');
      if (!u.ok) r.bad(`${p}.url`, u.error); else url = u.value;
    }
    if (kind === 'link' && !url) r.bad(`${p}.url`, 'une adresse est obligatoire pour un lien');
    let queryUrl: string | null = null;
    if (o.queryUrl !== null && o.queryUrl !== undefined) {
      const q = typeof o.queryUrl === 'string' ? validateSearchTemplate(o.queryUrl) : fail<string>('texte attendu');
      if (!q.ok) r.bad(`${p}.queryUrl`, q.error); else queryUrl = q.value;
    }
    const ic = r.obj(o.icon, `${p}.icon`);
    const iconKind = r.oneOf(ic, 'kind', `${p}.icon`, ['auto', 'icon'] as const);
    const icon: ShortcutIcon = iconKind === 'auto' ? { kind: 'auto' } : { kind: 'icon', name: r.oneOf<ShortcutIconName>(ic, 'name', `${p}.icon`, SHORTCUT_ICONS) };
    return { id, label: r.str(o, 'label', p, 40, { min: 1 }), kind, icon, url, queryUrl, enabled: r.bool(o, 'enabled', p) };
  });
}

export function readSettings(r: Reader, v: unknown, path = 'settings'): Settings {
  const d = defaultSettings();
  const o = r.obj(v, path);
  const ap = o.appearance === undefined ? (d.appearance as unknown as Obj) : r.obj(o.appearance, `${path}.appearance`);
  const se = o.search === undefined ? (d.search as unknown as Obj) : r.obj(o.search, `${path}.search`);
  const sh = o.show === undefined ? (d.show as unknown as Obj) : r.obj(o.show, `${path}.show`);
  const ge = o.general === undefined ? (d.general as unknown as Obj) : r.obj(o.general, `${path}.general`);
  const bg = ap.background;
  let background: string | null = null;
  if (bg !== null && bg !== undefined) {
    if (typeof bg === 'string' && HEX.test(bg)) background = bg.toLowerCase(); else r.bad(`${path}.appearance.background`, 'couleur #RRGGBB ou null attendue');
  }
  const customUrl = r.str(se, 'customUrl', `${path}.search`, 2048);
  const engine = r.oneOf(se, 'engine', `${path}.search`, SEARCH_ENGINES);
  if (engine === 'custom') {
    const t = validateSearchTemplate(customUrl);
    if (!t.ok) r.bad(`${path}.search.customUrl`, t.error);
  }
  return {
    updatedAt: r.iso(o, 'updatedAt', path),
    origin: r.str(o, 'origin', path, 64, { min: 1 }),
    appearance: {
      mode: r.oneOf(ap, 'mode', `${path}.appearance`, ['dark', 'light', 'system'] as const),
      primary: r.color(ap, 'primary', `${path}.appearance`),
      accent: r.color(ap, 'accent', `${path}.appearance`),
      background,
      useBackgroundImage: r.bool(ap, 'useBackgroundImage', `${path}.appearance`),
      cardOpacity: r.num(ap, 'cardOpacity', `${path}.appearance`, 0.2, 1),
      cardSize: r.oneOf(ap, 'cardSize', `${path}.appearance`, ['compact', 'medium', 'large'] as const),
      gap: r.num(ap, 'gap', `${path}.appearance`, 0, 48, true),
      density: r.oneOf(ap, 'density', `${path}.appearance`, ['compact', 'comfortable', 'spacious'] as const),
    },
    search: {
      engine, customUrl,
      googleSuggestions: r.bool(se, 'googleSuggestions', `${path}.search`),
      rememberSearches: r.bool(se, 'rememberSearches', `${path}.search`),
      showLens: r.bool(se, 'showLens', `${path}.search`),
      shortcuts: readShortcuts(r, se.shortcuts, `${path}.search.shortcuts`),
    },
    general: { onboardingDone: r.bool(ge, 'onboardingDone', `${path}.general`) },
    show: {
      syncIndicator: r.bool(sh, 'syncIndicator', `${path}.show`), favoriteTitles: r.bool(sh, 'favoriteTitles', `${path}.show`),
      projectStatus: r.bool(sh, 'projectStatus', `${path}.show`), taskDueDates: r.bool(sh, 'taskDueDates', `${path}.show`),
      greeting: r.bool(sh, 'greeting', `${path}.show`),
    },
  };
}

function readCollection<T extends EntityMeta>(r: Reader, v: unknown, key: string, read: (r: Reader, v: unknown, p: string) => T): T[] {
  if (!Array.isArray(v)) { r.bad(key, 'liste attendue'); return []; }
  if (v.length > LIMITS.collection) { r.bad(key, `${LIMITS.collection} éléments maximum`); return []; }
  const ids = new Set<string>();
  const out = v.map((item, i) => {
    const e = read(r, item, `${key}[${i}]`);
    if (e.id) { if (ids.has(e.id)) r.bad(`${key}[${i}].id`, 'identifiant en double'); ids.add(e.id); }
    return e;
  });
  return out;
}

/**
 * Valide un document déjà migré à la version courante.
 * Ne renvoie que des objets reconstruits à partir de champs connus (aucun champ inattendu, donc aucun jeton importé).
 */
export function validateDocument(raw: unknown): Result<DinoDocument> & { errors?: string[] } {
  const r = new Reader();
  if (!isObj(raw)) return { ...fail<DinoDocument>('Le document est vide ou n’est pas un objet JSON.'), errors: ['racine : objet attendu'] };
  if (raw.schemaVersion !== SCHEMA_VERSION) {
    const msg = `Version de schéma non prise en charge : ${String(raw.schemaVersion)} (attendue : ${SCHEMA_VERSION}).`;
    return { ...fail<DinoDocument>(msg), errors: [msg] };
  }
  const doc: DinoDocument = {
    schemaVersion: SCHEMA_VERSION,
    updatedAt: r.iso(raw, 'updatedAt', 'document'),
    categories: readCollection(r, raw.categories, 'categories', readCategory),
    favorites: readCollection(r, raw.favorites, 'favorites', readFavorite),
    projects: readCollection(r, raw.projects, 'projects', readProject),
    notes: readCollection(r, raw.notes, 'notes', readNote),
    tasks: readCollection(r, raw.tasks, 'tasks', readTask),
    widgets: readCollection(r, raw.widgets, 'widgets', readWidget),
    settings: readSettings(r, raw.settings),
  };
  const present = new Set(doc.widgets.map((w) => w.type));
  for (const t of WIDGET_TYPES) if (!present.has(t)) r.bad('widgets', `widget « ${t} » manquant`);
  if (r.errors.length) {
    const shown = r.errors.slice(0, 8);
    const more = r.errors.length > shown.length ? ` (+${r.errors.length - shown.length} autres)` : '';
    return { ...fail<DinoDocument>(`Document invalide : ${shown.join(' ; ')}${more}`), errors: r.errors };
  }
  return ok(doc);
}

export { Reader as _Reader };
