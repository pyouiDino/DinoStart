import { describe, expect, it } from 'vitest';
import { createDefaultDocument } from '../../src/core/defaults';
import {
  addCategory, addFavorite, addNote, addProject, addTask, createCtx, deleteCategory, deleteFavorite, deleteNote, deleteProject, deleteTask, live,
  moveFavorite, reorderCategories, repairReferences, resetWidgets, toggleTask, updateCategory, updateFavorite, updateNote, updateProject, updateSettings,
  updateTask, updateWidget, placeWidget,
} from '../../src/core/ops';
import { validateDocument } from '../../src/core/validation';
import { intersects, type Rect } from '../../src/core/layout';
import { ok, type DinoDocument, type Result } from '../../src/core/types';

let n = 0;
let t = Date.parse('2026-03-01T10:00:00Z');
const ctx = createCtx('pc-test', () => new Date((t += 1000)).toISOString(), () => `id${++n}`);
const unwrap = <T,>(r: Result<T>): T => { if (!r.ok) throw new Error(r.error); return r.value; };
const doc0 = (): DinoDocument => createDefaultDocument();
const rectOf = (w: { x: number; y: number; w: number; h: number }): Rect => ({ x: w.x, y: w.y, w: w.w, h: w.h });

describe('favoris', () => {
  it('crée un favori complet avec identifiant stable, URL normalisée et dates', () => {
    const { doc, id } = unwrap(addFavorite(doc0(), ctx, { title: '  Dino Industry ', url: 'dino-industry.fr', categoryId: null }));
    const f = doc.favorites.find((x) => x.id === id)!;
    expect(f).toMatchObject({ title: 'Dino Industry', url: 'https://dino-industry.fr/', categoryId: null, order: 0, deletedAt: null, origin: 'pc-test', quick: false });
    expect(f.createdAt).toBe(f.updatedAt);
    expect(validateDocument(doc).ok).toBe(true);
  });
  it('refuse les schémas dangereux et titres vides', () => {
    expect(addFavorite(doc0(), ctx, { title: 'x', url: 'javascript:alert(1)', categoryId: null }).ok).toBe(false);
    expect(addFavorite(doc0(), ctx, { title: 'x', url: 'data:text/html;base64,AAAA', categoryId: null }).ok).toBe(false);
    expect(addFavorite(doc0(), ctx, { title: '  ', url: 'https://a.fr', categoryId: null }).ok).toBe(false);
  });
  it('refuse une catégorie inexistante', () => {
    expect(addFavorite(doc0(), ctx, { title: 'x', url: 'https://a.fr', categoryId: 'nope' }).ok).toBe(false);
  });
  it('modifie un favori : met à jour updatedAt mais pas createdAt, valide l’URL', () => {
    const a = unwrap(addFavorite(doc0(), ctx, { title: 'A', url: 'https://a.fr', categoryId: null }));
    const before = a.doc.favorites[0]!;
    const d2 = unwrap(updateFavorite(a.doc, ctx, a.id, { title: 'B', url: 'b.fr', quick: true }));
    const after = d2.favorites[0]!;
    expect(after).toMatchObject({ title: 'B', url: 'https://b.fr/', quick: true, createdAt: before.createdAt });
    expect(after.updatedAt > before.updatedAt).toBe(true);
    expect(updateFavorite(d2, ctx, a.id, { url: 'javascript:1' }).ok).toBe(false);
    expect(d2.favorites[0]!.url).toBe('https://b.fr/');
  });
  it('suppression logique : l’élément reste comme pierre tombale', () => {
    const a = unwrap(addFavorite(doc0(), ctx, { title: 'A', url: 'https://a.fr', categoryId: null }));
    const d2 = unwrap(deleteFavorite(a.doc, ctx, a.id));
    expect(live(d2.favorites)).toHaveLength(0);
    expect(d2.favorites[0]!.deletedAt).not.toBeNull();
    expect(deleteFavorite(d2, ctx, a.id).ok).toBe(false);
  });
  it('déplace et réordonne en préservant les catégories', () => {
    let d = doc0();
    const c1 = unwrap(addCategory(d, ctx, { name: 'Travail', color: '#ff0000' })); d = c1.doc;
    const c2 = unwrap(addCategory(d, ctx, { name: 'Loisirs', color: '#00ff00' })); d = c2.doc;
    const ids: string[] = [];
    for (const title of ['A', 'B', 'C']) { const r = unwrap(addFavorite(d, ctx, { title, url: `https://${title}.fr`, categoryId: c1.id })); d = r.doc; ids.push(r.id); }
    d = unwrap(moveFavorite(d, ctx, ids[2]!, c1.id, 0)); // C en tête
    const order = (cat: string | null) => live(d.favorites).filter((f) => f.categoryId === cat).sort((a, b) => a.order - b.order).map((f) => f.title);
    expect(order(c1.id)).toEqual(['C', 'A', 'B']);
    d = unwrap(moveFavorite(d, ctx, ids[0]!, c2.id, 0)); // A vers Loisirs
    expect(order(c1.id)).toEqual(['C', 'B']);
    expect(order(c2.id)).toEqual(['A']);
    d = unwrap(moveFavorite(d, ctx, ids[1]!, null, 5)); // B non classé
    expect(order(null)).toEqual(['B']);
    expect(live(d.favorites)).toHaveLength(3);
    expect(live(d.categories).map((c) => c.id).sort()).toEqual([c1.id, c2.id].sort());
    expect(validateDocument(d).ok).toBe(true);
  });
});

describe('catégories', () => {
  it('crée, renomme, refuse les doublons, réordonne', () => {
    let d = doc0();
    const a = unwrap(addCategory(d, ctx, { name: 'Outils', color: '#123456' })); d = a.doc;
    const b = unwrap(addCategory(d, ctx, { name: 'Veille', color: '#654321' })); d = b.doc;
    expect(addCategory(d, ctx, { name: 'outils', color: '#123456' }).ok).toBe(false);
    expect(addCategory(d, ctx, { name: 'X', color: 'rouge' }).ok).toBe(false);
    d = unwrap(updateCategory(d, ctx, a.id, { name: 'Outils dev' }));
    expect(updateCategory(d, ctx, a.id, { name: 'Veille' }).ok).toBe(false);
    d = unwrap(reorderCategories(d, ctx, [b.id, a.id]));
    expect(live(d.categories).sort((x, y) => x.order - y.order).map((c) => c.name)).toEqual(['Veille', 'Outils dev']);
    expect(reorderCategories(d, ctx, [a.id]).ok).toBe(false);
  });
  it('supprimer une catégorie conserve ses favoris comme « non classés »', () => {
    let d = doc0();
    const c = unwrap(addCategory(d, ctx, { name: 'Temp', color: '#111111' })); d = c.doc;
    d = unwrap(addFavorite(d, ctx, { title: 'Libre', url: 'https://l.fr', categoryId: null })).doc;
    d = unwrap(addFavorite(d, ctx, { title: 'Rangé', url: 'https://r.fr', categoryId: c.id })).doc;
    d = unwrap(deleteCategory(d, ctx, c.id));
    const favs = live(d.favorites);
    expect(favs).toHaveLength(2);
    expect(favs.every((f) => f.categoryId === null)).toBe(true);
    expect(new Set(favs.map((f) => f.order)).size).toBe(2);
    expect(validateDocument(d).ok).toBe(true);
  });
});

describe('projets', () => {
  it('cycle complet avec liens validés, statut et détachement à la suppression', () => {
    let d = doc0();
    const p = unwrap(addProject(d, ctx, { name: 'DinoStart', description: 'Extension', color: '#f97316', links: [
      { id: '', label: 'Dépôt', target: 'github.com/moi/dinostart', kind: 'url' },
      { id: '', label: 'Dossier', target: 'C:\\Projets\\DinoStart', kind: 'path' },
    ] }));
    d = p.doc;
    const proj = d.projects[0]!;
    expect(proj.links[0]!.target).toBe('https://github.com/moi/dinostart');
    expect(proj.links[1]!.target).toBe('C:\\Projets\\DinoStart');
    expect(proj.links.every((l) => l.id)).toBe(true);
    expect(updateProject(d, ctx, p.id, { links: [{ id: 'l1', label: 'x', target: 'javascript:alert(1)', kind: 'url' }] }).ok).toBe(false);
    d = unwrap(updateProject(d, ctx, p.id, { status: 'paused' }));
    expect(d.projects[0]!.status).toBe('paused');
    expect(updateProject(d, ctx, p.id, { status: 'archived' as never }).ok).toBe(false);
    d = unwrap(addNote(d, ctx, { title: 'Idée', projectId: p.id })).doc;
    d = unwrap(addTask(d, ctx, { title: 'Coder', projectId: p.id })).doc;
    d = unwrap(deleteProject(d, ctx, p.id));
    expect(live(d.projects)).toHaveLength(0);
    expect(live(d.notes)[0]!.projectId).toBeNull();
    expect(live(d.tasks)[0]!.projectId).toBeNull();
    expect(validateDocument(d).ok).toBe(true);
  });
  it('refuse nom vide et couleur invalide', () => {
    expect(addProject(doc0(), ctx, { name: ' ', color: '#ffffff' }).ok).toBe(false);
    expect(addProject(doc0(), ctx, { name: 'X', color: 'blue' }).ok).toBe(false);
  });
});

describe('notes', () => {
  it('titre facultatif mais contenu ou titre obligatoire', () => {
    expect(addNote(doc0(), ctx, { title: '', content: '' }).ok).toBe(false);
    const a = unwrap(addNote(doc0(), ctx, { content: 'Juste du texte' }));
    expect(a.doc.notes[0]!.title).toBe('');
    const d = unwrap(updateNote(a.doc, ctx, a.id, { title: 'Titré', starred: true }));
    expect(d.notes[0]).toMatchObject({ title: 'Titré', starred: true });
    expect(updateNote(d, ctx, a.id, { title: '', content: '' }).ok).toBe(false);
    expect(live(unwrap(deleteNote(d, ctx, a.id)).notes)).toHaveLength(0);
  });
  it('refuse un projet inexistant', () => {
    expect(addNote(doc0(), ctx, { content: 'x', projectId: 'ghost' }).ok).toBe(false);
  });
});

describe('tâches', () => {
  it('ajoute, termine, modifie l’échéance, supprime', () => {
    let d = doc0();
    const a = unwrap(addTask(d, ctx, { title: 'Écrire les tests', dueDate: '2026-04-01' })); d = a.doc;
    expect(d.tasks[0]).toMatchObject({ done: false, dueDate: '2026-04-01' });
    d = unwrap(toggleTask(d, ctx, a.id));
    expect(d.tasks[0]!.done).toBe(true);
    d = unwrap(toggleTask(d, ctx, a.id));
    expect(d.tasks[0]!.done).toBe(false);
    expect(addTask(d, ctx, { title: 'x', dueDate: '01/04/2026' }).ok).toBe(false);
    expect(addTask(d, ctx, { title: '' }).ok).toBe(false);
    d = unwrap(updateTask(d, ctx, a.id, { dueDate: null, description: 'Détails' }));
    expect(d.tasks[0]).toMatchObject({ dueDate: null, description: 'Détails' });
    expect(live(unwrap(deleteTask(d, ctx, a.id)).tasks)).toHaveLength(0);
  });
});

describe('widgets et paramètres', () => {
  it('désactive, configure, déplace librement, redimensionne et restaure', () => {
    let d = doc0();
    d = unwrap(updateWidget(d, ctx, 'clock', { enabled: false, config: { seconds: true } }));
    const get = (t: string) => d.widgets.find((w) => w.type === t)!;
    expect(get('clock')).toMatchObject({ enabled: false, config: { hour12: false, seconds: true } });
    expect(updateWidget(d, ctx, 'tasks', { config: { limit: 999 } }).ok).toBe(false);
    d = unwrap(placeWidget(d, ctx, 'tasks', { x: 1, y: 30, w: 5, h: 6 }));
    expect(get('tasks')).toMatchObject({ x: 1, y: 30, w: 5, h: 6 });
    d = unwrap(resetWidgets(d, ctx));
    expect(get('clock')).toMatchObject({ enabled: true, x: 0, y: 0, w: 6, h: 4, config: { hour12: false, seconds: false } });
    expect(validateDocument(d).ok).toBe(true);
  });
  it('placer une carte pousse celles qu’elle chevauche, sans jamais en superposer deux', () => {
    let d = doc0();
    d = unwrap(placeWidget(d, ctx, 'quickNotes', { x: 0, y: 8, w: 6, h: 6 })); // sur « Favoris »
    const vis = d.widgets.filter((w) => w.enabled);
    for (const a of vis) for (const b of vis) if (a !== b) expect(intersects(rectOf(a), rectOf(b))).toBe(false);
    expect(d.widgets.find((w) => w.type === 'quickNotes')).toMatchObject({ x: 0, y: 8, w: 6, h: 6 }); // la carte déplacée reste où on l’a mise
    expect(d.widgets.find((w) => w.type === 'favorites')!.y).toBeGreaterThanOrEqual(14);
    expect(validateDocument(d).ok).toBe(true);
  });
  it('ramène une taille ou une position hors limites dans la grille, avec la taille minimale', () => {
    let d = doc0();
    d = unwrap(placeWidget(d, ctx, 'search', { x: 9, y: -5, w: 99, h: 0 }));
    const w = d.widgets.find((x) => x.type === 'search')!;
    expect(w.x + w.w).toBeLessThanOrEqual(12);
    expect(w.y).toBe(0);
    expect(w.w).toBe(12); expect(w.x).toBe(0);
    expect(w.h).toBeGreaterThanOrEqual(3);
    expect(placeWidget(d, ctx, 'search', { x: NaN, y: 0, w: 4, h: 4 }).ok).toBe(false);
    expect(placeWidget(d, ctx, 'inconnu' as never, { x: 0, y: 0, w: 4, h: 4 }).ok).toBe(false);
  });
  it('réactiver une carte masquée la replace en poussant les autres', () => {
    let d = doc0();
    d = unwrap(updateWidget(d, ctx, 'favorites', { enabled: false }));
    d = unwrap(placeWidget(d, ctx, 'projects', { x: 0, y: 8, w: 6, h: 6 })); // occupe la place laissée libre
    d = unwrap(updateWidget(d, ctx, 'favorites', { enabled: true }));
    const vis = d.widgets.filter((w) => w.enabled);
    for (const a of vis) for (const b of vis) if (a !== b) expect(intersects(rectOf(a), rectOf(b))).toBe(false);
    expect(d.widgets.find((w) => w.type === 'favorites')).toMatchObject({ enabled: true, x: 0, y: 8 });
  });
  it('les cartes masquées ne gênent pas le placement des autres', () => {
    let d = doc0();
    d = unwrap(updateWidget(d, ctx, 'favorites', { enabled: false }));
    const before = d.widgets.find((w) => w.type === 'projects')!;
    d = unwrap(placeWidget(d, ctx, 'quickNotes', { x: 0, y: 8, w: 4, h: 4 }));
    expect(d.widgets.find((w) => w.type === 'projects')!.y).toBe(before.y); // pas poussée par une carte masquée
  });
  it('met à jour les paramètres de thème et refuse les valeurs invalides', () => {
    let d = doc0();
    d = unwrap(updateSettings(d, ctx, (s) => ({ ...s, appearance: { ...s.appearance, mode: 'light', primary: '#0088ff', cardOpacity: 0.5, gap: 24 } })));
    expect(d.settings.appearance).toMatchObject({ mode: 'light', primary: '#0088ff', cardOpacity: 0.5, gap: 24 });
    expect(updateSettings(d, ctx, (s) => ({ ...s, appearance: { ...s.appearance, primary: 'orange' } })).ok).toBe(false);
    expect(updateSettings(d, ctx, (s) => ({ ...s, appearance: { ...s.appearance, cardOpacity: 5 } })).ok).toBe(false);
    expect(updateSettings(d, ctx, (s) => ({ ...s, search: { ...s.search, engine: 'custom', customUrl: 'http://pas-https/?q={query}' } })).ok).toBe(false);
    expect(updateSettings(d, ctx, (s) => ({ ...s, search: { ...s.search, engine: 'custom', customUrl: 'https://ok.fr/?q={query}' } })).ok).toBe(true);
  });
});

describe('intégrité référentielle', () => {
  it('détache les éléments dont la catégorie ou le projet a été supprimé ailleurs', () => {
    let d = doc0();
    const c = unwrap(addCategory(d, ctx, { name: 'C', color: '#111111' })); d = c.doc;
    d = unwrap(addFavorite(d, ctx, { title: 'F', url: 'https://f.fr', categoryId: c.id })).doc;
    const cat = d.categories[0]!;
    d = { ...d, categories: [{ ...cat, deletedAt: '2026-03-02T00:00:00.000Z' }] };
    const fixed = repairReferences(d, ctx);
    expect(fixed.favorites[0]!.categoryId).toBeNull();
    expect(repairReferences(fixed, ctx)).toBe(fixed);
    expect(ok(1).ok).toBe(true);
  });
});
