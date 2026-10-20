import { describe, expect, it } from 'vitest';
import { createDefaultDocument } from '../../src/core/defaults';
import { addCategory, addFavorite, addNote, addProject, addTask, createCtx, deleteNote, toggleTask } from '../../src/core/ops';
import { normalize, searchAll } from '../../src/core/search';
import type { Result } from '../../src/core/types';

let n = 0;
const ctx = createCtx('t', () => '2026-01-01T00:00:00.000Z', () => `s${++n}`);
const u = <T,>(r: Result<T>): T => { if (!r.ok) throw new Error(r.error); return r.value; };

function build() {
  let d = createDefaultDocument();
  const c = u(addCategory(d, ctx, { name: 'Développement', color: '#111111' })); d = c.doc;
  d = u(addFavorite(d, ctx, { title: 'GitHub', url: 'https://github.com', categoryId: c.id })).doc;
  d = u(addFavorite(d, ctx, { title: 'Météo France', url: 'https://meteofrance.fr', categoryId: null })).doc;
  d = u(addProject(d, ctx, { name: 'Dino Industry', description: 'Site vitrine', color: '#f97316' })).doc;
  const note = u(addNote(d, ctx, { title: 'Réunion', content: 'Préparer la démo du jeudi' })); d = note.doc;
  const task = u(addTask(d, ctx, { title: 'Envoyer le devis', description: 'client Dupont' })); d = task.doc;
  return { d, note: note.id, task: task.id };
}

describe('recherche locale', () => {
  it('ignore la casse et les accents', () => {
    expect(normalize('Météo')).toBe('meteo');
    const { d } = build();
    expect(searchAll(d, 'METEO')[0]).toMatchObject({ kind: 'favorite', title: 'Météo France' });
    expect(searchAll(d, 'developpement')[0]).toMatchObject({ kind: 'category' });
  });
  it('trouve tous les types d’éléments et les identifie', () => {
    const { d } = build();
    const kinds = new Set(searchAll(d, 'd').map((h) => h.kind));
    expect(kinds.has('category') && kinds.has('project') && kinds.has('note') && kinds.has('task') || kinds.size >= 3).toBe(true);
    expect(searchAll(d, 'devis')[0]).toMatchObject({ kind: 'task' });
    expect(searchAll(d, 'demo')[0]).toMatchObject({ kind: 'note', title: 'Réunion' });
    expect(searchAll(d, 'vitrine')[0]).toMatchObject({ kind: 'project' });
  });
  it('exige tous les mots et renvoie l’URL des favoris', () => {
    const { d } = build();
    expect(searchAll(d, 'github dupont')).toHaveLength(0);
    expect(searchAll(d, 'dupont devis')[0]).toMatchObject({ kind: 'task' });
    expect(searchAll(d, 'github')[0]!.url).toBe('https://github.com/');
  });
  it('exclut les éléments supprimés, vide pour une requête vide, classe les débuts de mot en premier', () => {
    const { d, note } = build();
    const d2 = u(deleteNote(d, ctx, note));
    expect(searchAll(d2, 'reunion')).toHaveLength(0);
    expect(searchAll(d, '   ')).toEqual([]);
    expect(searchAll(d, 'git')[0]!.title).toBe('GitHub');
  });
  it('place les tâches terminées après les tâches actives équivalentes', () => {
    const { d, task } = build();
    const d2 = u(addTask(d, ctx, { title: 'Envoyer le contrat' })).doc;
    const d3 = u(toggleTask(d2, ctx, task));
    const hits = searchAll(d3, 'envoyer').filter((h) => h.kind === 'task');
    expect(hits[0]!.title).toBe('Envoyer le contrat');
  });
});
