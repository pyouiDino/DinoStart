import { describe, expect, it } from 'vitest';
import { createDefaultDocument } from '../../src/core/defaults';
import { docEquals } from '../../src/core/docutil';
import { mergeDocuments } from '../../src/core/merge';
import {
  addCategory, addFavorite, addNote, addTask, createCtx, deleteFavorite, deleteCategory, live, updateFavorite, updateNote, updateSettings, placeWidget, toggleTask,
} from '../../src/core/ops';
import type { DinoDocument, Result } from '../../src/core/types';

let tick = Date.parse('2026-02-01T00:00:00Z');
const clock = () => new Date((tick += 1000)).toISOString();
const mk = (origin: string) => { let n = 0; return createCtx(origin, clock, () => `${origin}-${++n}`); };
const A = mk('A'), B = mk('B'), M = mk('merge');
const u = <T,>(r: Result<T>): T => { if (!r.ok) throw new Error(r.error); return r.value; };

/** Document de base commun avec un favori, une note et une tâche. */
function baseDoc(): { doc: DinoDocument; fav: string; note: string; task: string; cat: string } {
  let d = createDefaultDocument();
  const ctx = mk('seed');
  const c = u(addCategory(d, ctx, { name: 'Cat', color: '#111111' })); d = c.doc;
  const f = u(addFavorite(d, ctx, { title: 'Fav', url: 'https://fav.fr', categoryId: c.id })); d = f.doc;
  const n = u(addNote(d, ctx, { title: 'Note', content: 'texte' })); d = n.doc;
  const t = u(addTask(d, ctx, { title: 'Tâche' })); d = t.doc;
  return { doc: d, fav: f.id, note: n.id, task: t.id, cat: c.id };
}

describe('fusion à 3 voies', () => {
  it('fusionne des ajouts indépendants des deux côtés', () => {
    const { doc: base } = baseDoc();
    const local = u(addFavorite(base, A, { title: 'Local', url: 'https://l.fr', categoryId: null })).doc;
    const remote = u(addNote(base, B, { title: 'Distant', content: 'x' })).doc;
    const r = mergeDocuments(base, local, remote, M);
    expect(r.conflicts).toEqual([]);
    expect(live(r.merged.favorites).map((f) => f.title).sort()).toEqual(['Fav', 'Local']);
    expect(live(r.merged.notes).map((n) => n.title).sort()).toEqual(['Distant', 'Note']);
  });

  it('fusionne des modifications de champs différents d’un même élément', () => {
    const { doc: base, fav } = baseDoc();
    const local = u(updateFavorite(base, A, fav, { title: 'Titre local' }));
    const remote = u(updateFavorite(base, B, fav, { url: 'https://autre.fr', quick: true }));
    const r = mergeDocuments(base, local, remote, M);
    expect(r.conflicts).toEqual([]);
    expect(r.merged.favorites.find((f) => f.id === fav)).toMatchObject({ title: 'Titre local', url: 'https://autre.fr/', quick: true });
  });

  it('modifications indépendantes de deux éléments différents : aucune perte', () => {
    const { doc: base, note, task } = baseDoc();
    const local = u(updateNote(base, A, note, { content: 'edit A' }));
    const remote = u(toggleTask(base, B, task));
    const r = mergeDocuments(base, local, remote, M);
    expect(r.conflicts).toEqual([]);
    expect(r.merged.notes.find((n) => n.id === note)!.content).toBe('edit A');
    expect(r.merged.tasks.find((t) => t.id === task)!.done).toBe(true);
  });

  it('détecte un conflit quand le même champ est modifié différemment', () => {
    const { doc: base, note } = baseDoc();
    const local = u(updateNote(base, A, note, { content: 'version A' }));
    const remote = u(updateNote(base, B, note, { content: 'version B' }));
    const r = mergeDocuments(base, local, remote, M);
    expect(r.conflicts).toHaveLength(1);
    expect(r.conflicts[0]).toMatchObject({ key: `notes:${note}`, kind: 'fields', fields: ['content'] });
    expect((r.conflicts[0]!.local as { content: string }).content).toBe('version A');
    expect((r.conflicts[0]!.remote as { content: string }).content).toBe('version B');
  });

  it('applique la résolution choisie (local ou distant), entité entière', () => {
    const { doc: base, note } = baseDoc();
    const local = u(updateNote(base, A, note, { content: 'version A', title: 'Titre A' }));
    const remote = u(updateNote(base, B, note, { content: 'version B' }));
    const keepLocal = mergeDocuments(base, local, remote, M, { [`notes:${note}`]: 'local' });
    expect(keepLocal.conflicts).toEqual([]);
    expect(keepLocal.merged.notes.find((n) => n.id === note)).toMatchObject({ content: 'version A', title: 'Titre A' });
    const keepRemote = mergeDocuments(base, local, remote, M, { [`notes:${note}`]: 'remote' });
    expect(keepRemote.merged.notes.find((n) => n.id === note)).toMatchObject({ content: 'version B', title: 'Note' });
  });

  it('une suppression sur un PC se propage à l’autre PC (pas de réapparition)', () => {
    const { doc: base, fav } = baseDoc();
    const local = u(deleteFavorite(base, A, fav));
    const r = mergeDocuments(base, local, base, M);
    expect(r.conflicts).toEqual([]);
    expect(live(r.merged.favorites)).toHaveLength(0);
    expect(r.merged.favorites.find((f) => f.id === fav)!.deletedAt).not.toBeNull();
    // et dans l'autre sens : l'autre PC (non modifié) reçoit la suppression
    const r2 = mergeDocuments(base, base, local, M);
    expect(live(r2.merged.favorites)).toHaveLength(0);
  });

  it('supprimé des deux côtés : pas de conflit', () => {
    const { doc: base, fav } = baseDoc();
    const r = mergeDocuments(base, u(deleteFavorite(base, A, fav)), u(deleteFavorite(base, B, fav)), M);
    expect(r.conflicts).toEqual([]);
    expect(live(r.merged.favorites)).toHaveLength(0);
  });

  it('suppression face à modification : conflit explicite, rien n’est supprimé silencieusement', () => {
    const { doc: base, fav } = baseDoc();
    const local = u(deleteFavorite(base, A, fav));
    const remote = u(updateFavorite(base, B, fav, { title: 'Modifié ailleurs' }));
    const r = mergeDocuments(base, local, remote, M);
    expect(r.conflicts).toHaveLength(1);
    expect(r.conflicts[0]!.kind).toBe('delete-edit');
    const kept = mergeDocuments(base, local, remote, M, { [`favorites:${fav}`]: 'remote' });
    expect(live(kept.merged.favorites)[0]!.title).toBe('Modifié ailleurs');
  });

  it('suppression d’une catégorie sur un PC et ajout d’un favori dedans sur l’autre : référence réparée', () => {
    const { doc: base, cat } = baseDoc();
    const local = u(deleteCategory(base, A, cat));
    const remote = u(addFavorite(base, B, { title: 'Nouveau', url: 'https://n.fr', categoryId: cat })).doc;
    const r = mergeDocuments(base, local, remote, M);
    expect(r.conflicts).toEqual([]);
    expect(live(r.merged.favorites).every((f) => f.categoryId === null)).toBe(true);
  });

  it('paramètres : réglages différents fusionnés, même réglage différent = conflit', () => {
    const { doc: base } = baseDoc();
    const local = u(updateSettings(base, A, (s) => ({ ...s, appearance: { ...s.appearance, primary: '#0000ff' } })));
    const remote = u(updateSettings(base, B, (s) => ({ ...s, appearance: { ...s.appearance, gap: 30 } })));
    const ok = mergeDocuments(base, local, remote, M);
    expect(ok.conflicts).toEqual([]);
    expect(ok.merged.settings.appearance).toMatchObject({ primary: '#0000ff', gap: 30 });
    const remote2 = u(updateSettings(base, B, (s) => ({ ...s, appearance: { ...s.appearance, primary: '#00ff00' } })));
    const bad = mergeDocuments(base, local, remote2, M);
    expect(bad.conflicts[0]).toMatchObject({ key: 'settings:settings', fields: ['appearance.primary'] });
  });

  it('widgets non modifiés n’entrent jamais en conflit avec la configuration d’un autre PC', () => {
    const fresh = createDefaultDocument();
    const remote = u(placeWidget(baseDoc().doc, B, 'clock', { x: 0, y: 0, w: 12, h: 4 }));
    const r = mergeDocuments(null, fresh, remote, M); // appareil vierge, jamais synchronisé
    expect(r.conflicts).toEqual([]);
    expect(r.merged.widgets.find((w) => w.type === 'clock')!.w).toBe(12);
    expect(live(r.merged.favorites)).toHaveLength(1);
  });

  it('est idempotent : fusionner deux fois donne le même contenu', () => {
    const { doc: base, fav } = baseDoc();
    const local = u(updateFavorite(base, A, fav, { title: 'X' }));
    const remote = u(addNote(base, B, { content: 'y' })).doc;
    const first = mergeDocuments(base, local, remote, M).merged;
    // Refusionner un résultat qui contient déjà les changements distants ne change rien.
    const again = mergeDocuments(base, first, remote, M).merged;
    expect(docEquals(first, again)).toBe(true);
    const settled = mergeDocuments(first, first, first, M).merged;
    expect(docEquals(first, settled)).toBe(true);
    expect(docEquals(mergeDocuments(base, remote, local, M).merged, first)).toBe(true); // commutatif
  });
});
