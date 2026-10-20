// Opérations métier pures : (document, contexte, entrée) → nouveau document ou erreur.
// Aucune dépendance au stockage ni à React.
import { defaultWidgets, defaultWidgetConfig } from './defaults';
import {
  ICON_NAMES, PROJECT_STATUSES, type Category, type CollectionKey, type DinoDocument, type EntityMeta,
  type Favorite, type FavoriteIcon, type Note, type Project, type ProjectLink, type ProjectStatus, type Settings, type Task,
  type Widget, type WidgetConfigs, type WidgetType, type Result, fail, ok,
} from './types';
import { LIMITS, normalizeWidgetConfig, readSettings, validateProjectLinkTarget, _Reader } from './validation';
import { validateUrl } from './url';
import { clampRect, DEFAULT_RECTS, MIN_SIZE, resolveLayout, sameRect, type Rect } from './layout';

export interface OpCtx { now: () => string; origin: string; newId: () => string }

export function createCtx(origin: string, now: () => string = () => new Date().toISOString(), newId: () => string = () => crypto.randomUUID()): OpCtx {
  return { now, origin, newId };
}

export const live = <T extends EntityMeta>(items: T[]): T[] => items.filter((i) => !i.deletedAt);

const HEX = /^#[0-9a-fA-F]{6}$/;
const nextOrder = (items: { order: number }[]) => (items.length ? Math.max(...items.map((i) => i.order)) + 1 : 0);
const byOrder = <T extends { order: number; id: string }>(a: T, b: T) => a.order - b.order || a.id.localeCompare(b.id);

function stamp<T extends EntityMeta>(e: T, ctx: OpCtx, patch: Partial<T> = {}): T {
  return { ...e, ...patch, updatedAt: ctx.now(), origin: ctx.origin };
}
function withDoc(doc: DinoDocument, ctx: OpCtx, patch: Partial<DinoDocument>): DinoDocument {
  return { ...doc, ...patch, updatedAt: ctx.now() };
}
function replace<T extends EntityMeta>(list: T[], e: T): T[] { return list.map((x) => (x.id === e.id ? e : x)); }
const findLive = <T extends EntityMeta>(list: T[], id: string): T | undefined => list.find((x) => x.id === id && !x.deletedAt);

function cleanText(v: string, label: string, max: number, required: boolean): Result<string> {
  const t = (v ?? '').trim();
  if (required && !t) return fail(`${label} : valeur obligatoire.`);
  if (t.length > max) return fail(`${label} : ${max} caractères maximum.`);
  return ok(t);
}
function checkColor(c: string, label = 'Couleur'): Result<string> {
  return HEX.test(c) ? ok(c.toLowerCase()) : fail(`${label} : format #RRGGBB attendu.`);
}
const checkCategory = (doc: DinoDocument, id: string | null): Result<string | null> =>
  id === null || findLive(doc.categories, id) ? ok(id) : fail('La catégorie choisie n’existe plus.');
const checkProject = (doc: DinoDocument, id: string | null): Result<string | null> =>
  id === null || findLive(doc.projects, id) ? ok(id) : fail('Le projet choisi n’existe plus.');

// ================= Catégories =================

export function addCategory(doc: DinoDocument, ctx: OpCtx, input: { name: string; color: string }): Result<{ doc: DinoDocument; id: string }> {
  const name = cleanText(input.name, 'Nom', LIMITS.name, true); if (!name.ok) return name;
  const color = checkColor(input.color); if (!color.ok) return color;
  if (live(doc.categories).some((c) => c.name.toLowerCase() === name.value.toLowerCase())) return fail('Une catégorie porte déjà ce nom.');
  const now = ctx.now();
  const cat: Category = { id: ctx.newId(), name: name.value, color: color.value, order: nextOrder(live(doc.categories)), createdAt: now, updatedAt: now, deletedAt: null, origin: ctx.origin };
  return ok({ doc: withDoc(doc, ctx, { categories: [...doc.categories, cat] }), id: cat.id });
}

export function updateCategory(doc: DinoDocument, ctx: OpCtx, id: string, patch: { name?: string; color?: string }): Result<DinoDocument> {
  const cat = findLive(doc.categories, id); if (!cat) return fail('Catégorie introuvable.');
  const next: Partial<Category> = {};
  if (patch.name !== undefined) {
    const n = cleanText(patch.name, 'Nom', LIMITS.name, true); if (!n.ok) return n;
    if (live(doc.categories).some((c) => c.id !== id && c.name.toLowerCase() === n.value.toLowerCase())) return fail('Une catégorie porte déjà ce nom.');
    next.name = n.value;
  }
  if (patch.color !== undefined) { const c = checkColor(patch.color); if (!c.ok) return c; next.color = c.value; }
  return ok(withDoc(doc, ctx, { categories: replace(doc.categories, stamp(cat, ctx, next)) }));
}

/** Supprime la catégorie (suppression logique) ; ses favoris sont conservés comme « non classés ». */
export function deleteCategory(doc: DinoDocument, ctx: OpCtx, id: string): Result<DinoDocument> {
  const cat = findLive(doc.categories, id); if (!cat) return fail('Catégorie introuvable.');
  const now = ctx.now();
  let order = nextOrder(live(doc.favorites).filter((f) => f.categoryId === null));
  const favorites = doc.favorites.map((f) => (f.categoryId === id && !f.deletedAt ? stamp(f, ctx, { categoryId: null, order: order++ }) : f));
  return ok(withDoc(doc, ctx, {
    categories: replace(doc.categories, { ...cat, deletedAt: now, updatedAt: now, origin: ctx.origin }), favorites,
  }));
}

export function reorderCategories(doc: DinoDocument, ctx: OpCtx, orderedIds: string[]): Result<DinoDocument> {
  const current = live(doc.categories);
  if (orderedIds.length !== current.length || !current.every((c) => orderedIds.includes(c.id))) return fail('Liste de catégories incohérente.');
  const categories = doc.categories.map((c) => {
    const idx = orderedIds.indexOf(c.id);
    return idx >= 0 && c.order !== idx ? stamp(c, ctx, { order: idx }) : c;
  });
  return ok(withDoc(doc, ctx, { categories }));
}

// ================= Favoris =================

export interface FavoriteInput { title: string; url: string; categoryId: string | null; icon?: FavoriteIcon; quick?: boolean }

function checkIcon(icon: FavoriteIcon): Result<FavoriteIcon> {
  if (icon.kind === 'initial' || icon.kind === 'auto') return ok(icon);
  return (ICON_NAMES as readonly string[]).includes(icon.name) ? ok(icon) : fail('Icône inconnue.');
}

export function addFavorite(doc: DinoDocument, ctx: OpCtx, input: FavoriteInput): Result<{ doc: DinoDocument; id: string }> {
  const title = cleanText(input.title, 'Titre', LIMITS.title, true); if (!title.ok) return title;
  const url = validateUrl(input.url); if (!url.ok) return url;
  const cat = checkCategory(doc, input.categoryId); if (!cat.ok) return cat;
  const icon = checkIcon(input.icon ?? { kind: 'auto' }); if (!icon.ok) return icon;
  const now = ctx.now();
  const fav: Favorite = {
    id: ctx.newId(), title: title.value, url: url.value, categoryId: cat.value, icon: icon.value, quick: input.quick ?? false,
    order: nextOrder(live(doc.favorites).filter((f) => f.categoryId === cat.value)), createdAt: now, updatedAt: now, deletedAt: null, origin: ctx.origin,
  };
  return ok({ doc: withDoc(doc, ctx, { favorites: [...doc.favorites, fav] }), id: fav.id });
}

export function updateFavorite(doc: DinoDocument, ctx: OpCtx, id: string, patch: Partial<FavoriteInput>): Result<DinoDocument> {
  const fav = findLive(doc.favorites, id); if (!fav) return fail('Favori introuvable.');
  const next: Partial<Favorite> = {};
  if (patch.title !== undefined) { const t = cleanText(patch.title, 'Titre', LIMITS.title, true); if (!t.ok) return t; next.title = t.value; }
  if (patch.url !== undefined) { const u = validateUrl(patch.url); if (!u.ok) return u; next.url = u.value; }
  if (patch.icon !== undefined) { const i = checkIcon(patch.icon); if (!i.ok) return i; next.icon = i.value; }
  if (patch.quick !== undefined) next.quick = patch.quick;
  if (patch.categoryId !== undefined && patch.categoryId !== fav.categoryId) {
    const c = checkCategory(doc, patch.categoryId); if (!c.ok) return c;
    next.categoryId = c.value;
    next.order = nextOrder(live(doc.favorites).filter((f) => f.categoryId === c.value));
  }
  return ok(withDoc(doc, ctx, { favorites: replace(doc.favorites, stamp(fav, ctx, next)) }));
}

export function deleteFavorite(doc: DinoDocument, ctx: OpCtx, id: string): Result<DinoDocument> {
  const fav = findLive(doc.favorites, id); if (!fav) return fail('Favori introuvable.');
  const now = ctx.now();
  return ok(withDoc(doc, ctx, { favorites: replace(doc.favorites, { ...fav, deletedAt: now, updatedAt: now, origin: ctx.origin }) }));
}

/** Déplace un favori vers une catégorie (ou « non classés » = null) à la position donnée. */
export function moveFavorite(doc: DinoDocument, ctx: OpCtx, id: string, toCategoryId: string | null, toIndex: number): Result<DinoDocument> {
  const fav = findLive(doc.favorites, id); if (!fav) return fail('Favori introuvable.');
  const cat = checkCategory(doc, toCategoryId); if (!cat.ok) return cat;
  const target = live(doc.favorites).filter((f) => f.categoryId === toCategoryId && f.id !== id).sort(byOrder);
  const idx = Math.max(0, Math.min(toIndex, target.length));
  target.splice(idx, 0, fav);
  const changes = new Map<string, Partial<Favorite>>();
  target.forEach((f, i) => { if (f.order !== i || f.categoryId !== toCategoryId) changes.set(f.id, { order: i, categoryId: toCategoryId }); });
  if (!changes.size) return ok(doc);
  return ok(withDoc(doc, ctx, { favorites: doc.favorites.map((f) => (changes.has(f.id) ? stamp(f, ctx, changes.get(f.id)) : f)) }));
}

/**
 * Façon téléphone : glisser un favori sur un autre crée un dossier (une catégorie) qui contient les deux.
 * Opération atomique : tout est créé ou rien.
 */
export function groupIntoNewFolder(doc: DinoDocument, ctx: OpCtx, aId: string, bId: string, name = 'Nouveau dossier'): Result<{ doc: DinoDocument; id: string }> {
  const a = findLive(doc.favorites, aId), b = findLive(doc.favorites, bId);
  if (!a || !b || a.id === b.id) return fail('Favoris introuvables.');
  const taken = new Set(live(doc.categories).map((c) => c.name.toLowerCase()));
  let unique = name, n = 2;
  while (taken.has(unique.toLowerCase())) unique = `${name} ${n++}`;
  const palette = ['#5194f5', '#f97316', '#fbbf24', '#22c55e', '#06b6d4', '#8b5cf6', '#ec4899', '#ef4444'];
  const created = addCategory(doc, ctx, { name: unique, color: palette[live(doc.categories).length % palette.length]! });
  if (!created.ok) return created;
  let next = created.value.doc;
  const moved = moveFavorite(next, ctx, b.id, created.value.id, 0); if (!moved.ok) return moved; next = moved.value;
  const moved2 = moveFavorite(next, ctx, a.id, created.value.id, 0); if (!moved2.ok) return moved2;
  return ok({ doc: moved2.value, id: created.value.id });
}

// ================= Projets =================

export interface ProjectInput { name: string; description?: string; status?: ProjectStatus; color: string; links?: ProjectLink[] }

function checkLinks(ctx: OpCtx, links: ProjectLink[]): Result<ProjectLink[]> {
  if (links.length > LIMITS.links) return fail(`${LIMITS.links} liens maximum par projet.`);
  const out: ProjectLink[] = [];
  for (const l of links) {
    const label = cleanText(l.label, 'Libellé du lien', LIMITS.label, false); if (!label.ok) return label;
    const target = validateProjectLinkTarget(l.kind, l.target);
    if (!target.ok) return fail(`Lien « ${l.label || l.target} » : ${target.error}`);
    out.push({ id: l.id || ctx.newId(), label: label.value, target: target.value, kind: l.kind });
  }
  return ok(out);
}

export function addProject(doc: DinoDocument, ctx: OpCtx, input: ProjectInput): Result<{ doc: DinoDocument; id: string }> {
  const name = cleanText(input.name, 'Nom', LIMITS.name, true); if (!name.ok) return name;
  const desc = cleanText(input.description ?? '', 'Description', LIMITS.description, false); if (!desc.ok) return desc;
  const color = checkColor(input.color); if (!color.ok) return color;
  const status = input.status ?? 'active';
  if (!PROJECT_STATUSES.includes(status)) return fail('Statut inconnu.');
  const links = checkLinks(ctx, input.links ?? []); if (!links.ok) return links;
  const now = ctx.now();
  const p: Project = { id: ctx.newId(), name: name.value, description: desc.value, status, color: color.value, links: links.value, createdAt: now, updatedAt: now, deletedAt: null, origin: ctx.origin };
  return ok({ doc: withDoc(doc, ctx, { projects: [...doc.projects, p] }), id: p.id });
}

export function updateProject(doc: DinoDocument, ctx: OpCtx, id: string, patch: Partial<ProjectInput>): Result<DinoDocument> {
  const p = findLive(doc.projects, id); if (!p) return fail('Projet introuvable.');
  const next: Partial<Project> = {};
  if (patch.name !== undefined) { const n = cleanText(patch.name, 'Nom', LIMITS.name, true); if (!n.ok) return n; next.name = n.value; }
  if (patch.description !== undefined) { const d = cleanText(patch.description, 'Description', LIMITS.description, false); if (!d.ok) return d; next.description = d.value; }
  if (patch.color !== undefined) { const c = checkColor(patch.color); if (!c.ok) return c; next.color = c.value; }
  if (patch.status !== undefined) { if (!PROJECT_STATUSES.includes(patch.status)) return fail('Statut inconnu.'); next.status = patch.status; }
  if (patch.links !== undefined) { const l = checkLinks(ctx, patch.links); if (!l.ok) return l; next.links = l.value; }
  return ok(withDoc(doc, ctx, { projects: replace(doc.projects, stamp(p, ctx, next)) }));
}

/** Supprime le projet ; ses notes et tâches sont conservées, simplement détachées. */
export function deleteProject(doc: DinoDocument, ctx: OpCtx, id: string): Result<DinoDocument> {
  const p = findLive(doc.projects, id); if (!p) return fail('Projet introuvable.');
  const now = ctx.now();
  return ok(withDoc(doc, ctx, {
    projects: replace(doc.projects, { ...p, deletedAt: now, updatedAt: now, origin: ctx.origin }),
    notes: doc.notes.map((n) => (n.projectId === id && !n.deletedAt ? stamp(n, ctx, { projectId: null }) : n)),
    tasks: doc.tasks.map((t) => (t.projectId === id && !t.deletedAt ? stamp(t, ctx, { projectId: null }) : t)),
  }));
}

// ================= Notes =================

export interface NoteInput { title?: string; content?: string; projectId?: string | null; starred?: boolean }

export function addNote(doc: DinoDocument, ctx: OpCtx, input: NoteInput): Result<{ doc: DinoDocument; id: string }> {
  const title = cleanText(input.title ?? '', 'Titre', LIMITS.title, false); if (!title.ok) return title;
  if ((input.content ?? '').length > LIMITS.noteContent) return fail(`Contenu : ${LIMITS.noteContent} caractères maximum.`);
  const content = input.content ?? '';
  if (!title.value && !content.trim()) return fail('Une note doit avoir un titre ou un contenu.');
  const pr = checkProject(doc, input.projectId ?? null); if (!pr.ok) return pr;
  const now = ctx.now();
  const n: Note = { id: ctx.newId(), title: title.value, content, projectId: pr.value, starred: input.starred ?? false, createdAt: now, updatedAt: now, deletedAt: null, origin: ctx.origin };
  return ok({ doc: withDoc(doc, ctx, { notes: [...doc.notes, n] }), id: n.id });
}

export function updateNote(doc: DinoDocument, ctx: OpCtx, id: string, patch: NoteInput): Result<DinoDocument> {
  const n = findLive(doc.notes, id); if (!n) return fail('Note introuvable.');
  const next: Partial<Note> = {};
  if (patch.title !== undefined) { const t = cleanText(patch.title, 'Titre', LIMITS.title, false); if (!t.ok) return t; next.title = t.value; }
  if (patch.content !== undefined) { if (patch.content.length > LIMITS.noteContent) return fail(`Contenu : ${LIMITS.noteContent} caractères maximum.`); next.content = patch.content; }
  if (patch.starred !== undefined) next.starred = patch.starred;
  if (patch.projectId !== undefined) { const p = checkProject(doc, patch.projectId); if (!p.ok) return p; next.projectId = p.value; }
  const merged = { ...n, ...next };
  if (!merged.title.trim() && !merged.content.trim()) return fail('Une note doit avoir un titre ou un contenu.');
  return ok(withDoc(doc, ctx, { notes: replace(doc.notes, stamp(n, ctx, next)) }));
}

export function deleteNote(doc: DinoDocument, ctx: OpCtx, id: string): Result<DinoDocument> {
  const n = findLive(doc.notes, id); if (!n) return fail('Note introuvable.');
  const now = ctx.now();
  return ok(withDoc(doc, ctx, { notes: replace(doc.notes, { ...n, deletedAt: now, updatedAt: now, origin: ctx.origin }) }));
}

// ================= Tâches =================

export interface TaskInput { title: string; description?: string; projectId?: string | null; dueDate?: string | null; done?: boolean }
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const checkDay = (d: string | null | undefined): Result<string | null> =>
  d === null || d === undefined || d === '' ? ok(null) : DAY.test(d) && !Number.isNaN(Date.parse(d)) ? ok(d) : fail('Date d’échéance invalide.');

export function addTask(doc: DinoDocument, ctx: OpCtx, input: TaskInput): Result<{ doc: DinoDocument; id: string }> {
  const title = cleanText(input.title, 'Titre', LIMITS.title, true); if (!title.ok) return title;
  const desc = cleanText(input.description ?? '', 'Description', LIMITS.description, false); if (!desc.ok) return desc;
  const pr = checkProject(doc, input.projectId ?? null); if (!pr.ok) return pr;
  const due = checkDay(input.dueDate); if (!due.ok) return due;
  const now = ctx.now();
  const t: Task = { id: ctx.newId(), title: title.value, description: desc.value, done: input.done ?? false, projectId: pr.value, dueDate: due.value, createdAt: now, updatedAt: now, deletedAt: null, origin: ctx.origin };
  return ok({ doc: withDoc(doc, ctx, { tasks: [...doc.tasks, t] }), id: t.id });
}

export function updateTask(doc: DinoDocument, ctx: OpCtx, id: string, patch: Partial<TaskInput>): Result<DinoDocument> {
  const t = findLive(doc.tasks, id); if (!t) return fail('Tâche introuvable.');
  const next: Partial<Task> = {};
  if (patch.title !== undefined) { const x = cleanText(patch.title, 'Titre', LIMITS.title, true); if (!x.ok) return x; next.title = x.value; }
  if (patch.description !== undefined) { const x = cleanText(patch.description, 'Description', LIMITS.description, false); if (!x.ok) return x; next.description = x.value; }
  if (patch.done !== undefined) next.done = patch.done;
  if (patch.projectId !== undefined) { const x = checkProject(doc, patch.projectId); if (!x.ok) return x; next.projectId = x.value; }
  if (patch.dueDate !== undefined) { const x = checkDay(patch.dueDate); if (!x.ok) return x; next.dueDate = x.value; }
  return ok(withDoc(doc, ctx, { tasks: replace(doc.tasks, stamp(t, ctx, next)) }));
}

export const toggleTask = (doc: DinoDocument, ctx: OpCtx, id: string): Result<DinoDocument> => {
  const t = findLive(doc.tasks, id);
  return t ? updateTask(doc, ctx, id, { done: !t.done }) : fail('Tâche introuvable.');
};

export function deleteTask(doc: DinoDocument, ctx: OpCtx, id: string): Result<DinoDocument> {
  const t = findLive(doc.tasks, id); if (!t) return fail('Tâche introuvable.');
  const now = ctx.now();
  return ok(withDoc(doc, ctx, { tasks: replace(doc.tasks, { ...t, deletedAt: now, updatedAt: now, origin: ctx.origin }) }));
}

// ================= Widgets =================

export interface WidgetPatch { enabled?: boolean; config?: Partial<WidgetConfigs[WidgetType]> }

const rectOf = (w: Widget): Rect => ({ x: w.x, y: w.y, w: w.w, h: w.h });

/** Applique une disposition calculée en ne modifiant que les cartes dont la position ou la taille change. */
function applyLayout(doc: DinoDocument, ctx: OpCtx, layout: Record<string, Rect>, extra: Record<string, Partial<Widget>> = {}): DinoDocument {
  const widgets = doc.widgets.map((w) => {
    const r = layout[w.type];
    const patch = extra[w.type] ?? {};
    const moved = r && !sameRect(r, rectOf(w));
    return moved || Object.keys(patch).length ? (stamp(w, ctx, { ...(moved ? r : {}), ...patch } as Partial<Widget>) as Widget) : w;
  });
  return withDoc(doc, ctx, { widgets });
}

/** Rectangles des cartes visibles : seules celles-ci se gênent entre elles. */
const visibleLayout = (doc: DinoDocument, includeType?: WidgetType): Record<string, Rect> =>
  Object.fromEntries(doc.widgets.filter((w) => w.enabled || w.type === includeType).map((w) => [w.type, rectOf(w)]));

export function updateWidget(doc: DinoDocument, ctx: OpCtx, type: WidgetType, patch: WidgetPatch): Result<DinoDocument> {
  const w = doc.widgets.find((x) => x.type === type); if (!w) return fail('Widget introuvable.');
  const extra: Partial<Widget> = {};
  if (patch.enabled !== undefined) extra.enabled = patch.enabled;
  if (patch.config !== undefined) {
    const r = new _Reader();
    const config = normalizeWidgetConfig(type, { ...w.config, ...patch.config }, r);
    if (r.errors.length) return fail(`Configuration invalide : ${r.errors[0]}`);
    extra.config = config;
  }
  // Réactiver une carte masquée : elle reprend sa place et pousse les autres si besoin.
  if (patch.enabled === true && !w.enabled) {
    const layout = resolveLayout(visibleLayout(doc, type), type, clampRect(rectOf(w), MIN_SIZE[type]));
    return ok(applyLayout(doc, ctx, layout, { [type]: extra }));
  }
  return ok(withDoc(doc, ctx, { widgets: replace(doc.widgets, stamp(w, ctx, extra) as Widget) }));
}

/**
 * Déplace et/ou redimensionne une carte sur la grille. Les cartes qui la chevauchent sont poussées vers le bas,
 * jamais superposées. Le rectangle est ramené dans la grille et à la taille minimale de la carte.
 */
export function placeWidget(doc: DinoDocument, ctx: OpCtx, type: WidgetType, rect: Rect): Result<DinoDocument> {
  const w = doc.widgets.find((x) => x.type === type); if (!w) return fail('Widget introuvable.');
  if (![rect.x, rect.y, rect.w, rect.h].every(Number.isFinite)) return fail('Position invalide.');
  const target = clampRect(rect, MIN_SIZE[type]);
  const layout = resolveLayout(visibleLayout(doc, type), type, target);
  return ok(applyLayout(doc, ctx, layout));
}

/** Restaure la disposition, les tailles et la configuration initiales de tous les widgets. */
export function resetWidgets(doc: DinoDocument, ctx: OpCtx): Result<DinoDocument> {
  const fresh = defaultWidgets(ctx.now(), ctx.origin);
  const widgets = fresh.map((w) => ({ ...w, createdAt: doc.widgets.find((x) => x.type === w.type)?.createdAt ?? w.createdAt }) as Widget);
  return ok(withDoc(doc, ctx, { widgets }));
}

export function resetWidget(doc: DinoDocument, ctx: OpCtx, type: WidgetType): Result<DinoDocument> {
  const base = defaultWidgets().find((w) => w.type === type);
  const cur = doc.widgets.find((w) => w.type === type);
  if (!base || !cur) return fail('Widget introuvable.');
  const layout = resolveLayout(visibleLayout(doc, type), type, DEFAULT_RECTS[type]);
  return ok(applyLayout(doc, ctx, layout, { [type]: { enabled: true, config: defaultWidgetConfig(type) } as Partial<Widget> }));
}

// ================= Paramètres =================

export function updateSettings(doc: DinoDocument, ctx: OpCtx, recipe: (s: Settings) => Settings): Result<DinoDocument> {
  const draft = recipe(structuredClone(doc.settings));
  const r = new _Reader();
  const valid = readSettings(r, { ...draft, updatedAt: ctx.now(), origin: ctx.origin });
  if (r.errors.length) return fail(`Paramètres invalides : ${r.errors[0]}`);
  return ok(withDoc(doc, ctx, { settings: valid }));
}

// ================= Intégrité référentielle =================

/**
 * Après une fusion : les éléments qui pointent vers une catégorie/un projet supprimé (sur un autre PC)
 * sont détachés au lieu de laisser une référence cassée.
 */
export function repairReferences(doc: DinoDocument, ctx: OpCtx): DinoDocument {
  const cats = new Set(live(doc.categories).map((c) => c.id));
  const projs = new Set(live(doc.projects).map((p) => p.id));
  let changed = false;
  const fix = <T extends EntityMeta, K extends keyof T>(items: T[], key: K, valid: Set<string>): T[] =>
    items.map((it) => {
      const ref = it[key] as unknown as string | null;
      if (it.deletedAt || ref === null || valid.has(ref)) return it;
      changed = true;
      return stamp(it, ctx, { [key]: null } as unknown as Partial<T>);
    });
  const favorites = fix(doc.favorites, 'categoryId', cats);
  const notes = fix(doc.notes, 'projectId', projs);
  const tasks = fix(doc.tasks, 'projectId', projs);
  return changed ? withDoc(doc, ctx, { favorites, notes, tasks }) : doc;
}

export type { CollectionKey };
