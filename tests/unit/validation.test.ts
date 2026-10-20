import { describe, expect, it } from 'vitest';
import { createDefaultDocument } from '../../src/core/defaults';
import { addCategory, addFavorite, addProject, createCtx } from '../../src/core/ops';
import { validateDocument } from '../../src/core/validation';

const ctx = createCtx('pc', () => '2026-01-01T00:00:00.000Z', (() => { let i = 0; return () => `x${++i}`; })());
function sample() {
  let d = createDefaultDocument();
  const c = addCategory(d, ctx, { name: 'A', color: '#aabbcc' }); if (!c.ok) throw new Error(c.error); d = c.value.doc;
  const f = addFavorite(d, ctx, { title: 'F', url: 'https://f.fr', categoryId: c.value.id }); if (!f.ok) throw new Error(f.error); d = f.value.doc;
  const p = addProject(d, ctx, { name: 'P', color: '#112233' }); if (!p.ok) throw new Error(p.error); d = p.value.doc;
  return d;
}
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v));

describe('validateDocument', () => {
  it('accepte un document valide et le document par défaut', () => {
    expect(validateDocument(sample()).ok).toBe(true);
    expect(validateDocument(createDefaultDocument()).ok).toBe(true);
  });
  it.each([
    ['null', null], ['tableau', []], ['texte', 'oups'], ['objet vide', {}],
  ])('rejette un document distant invalide : %s', (_n, raw) => {
    expect(validateDocument(raw).ok).toBe(false);
  });
  it('rejette une version de schéma inconnue', () => {
    const d = clone(sample()) as unknown as Record<string, unknown>; d.schemaVersion = 99;
    const r = validateDocument(d);
    expect(r.ok).toBe(false);
  });
  it('rejette les URL dangereuses dans les favoris importés', () => {
    const d = clone(sample()); d.favorites[0]!.url = 'javascript:alert(1)';
    expect(validateDocument(d).ok).toBe(false);
  });
  it('rejette types incorrects, dates invalides, doublons d’identifiants et widgets manquants', () => {
    let d = clone(sample()); (d.favorites[0] as unknown as Record<string, unknown>).title = 42; expect(validateDocument(d).ok).toBe(false);
    d = clone(sample()); d.favorites[0]!.updatedAt = 'hier'; expect(validateDocument(d).ok).toBe(false);
    d = clone(sample()); d.favorites.push({ ...d.favorites[0]! }); expect(validateDocument(d).ok).toBe(false);
    d = clone(sample()); d.widgets = d.widgets.slice(1); expect(validateDocument(d).ok).toBe(false);
    d = clone(sample()); d.projects[0]!.status = 'archivé' as never; expect(validateDocument(d).ok).toBe(false);
    d = clone(sample()); d.projects[0]!.color = 'rouge'; expect(validateDocument(d).ok).toBe(false);
  });
  it('ignore et supprime les champs inconnus : un jeton injecté ne survit pas à la validation', () => {
    const d = clone(sample()) as unknown as Record<string, unknown>;
    d.githubToken = 'github_pat_SECRET'; d.token = 'x';
    (d.favorites as Record<string, unknown>[])[0]!.token = 'github_pat_SECRET';
    (d.settings as Record<string, unknown>).githubToken = 'github_pat_SECRET';
    const r = validateDocument(d);
    expect(r.ok).toBe(true);
    expect(JSON.stringify(r.ok ? r.value : null)).not.toContain('SECRET');
  });
  it('limite la taille des champs', () => {
    const d = clone(sample()); d.favorites[0]!.title = 'x'.repeat(500);
    expect(validateDocument(d).ok).toBe(false);
  });

  describe('raccourcis de recherche', () => {
    const withShortcuts = (list: unknown) => { const d = clone(sample()) as unknown as { settings: { search: { shortcuts: unknown } } }; d.settings.search.shortcuts = list; return d; };
    const good = { id: 's1', label: 'Mon site', kind: 'link', icon: { kind: 'icon', name: 'star' }, url: 'https://exemple.fr/', queryUrl: null, enabled: true };
    it('accepte lien, navigation privée, historique, icône automatique', () => {
      expect(validateDocument(withShortcuts([good, { ...good, id: 's2', kind: 'private', url: null, icon: { kind: 'icon', name: 'mask' } }, { ...good, id: 's3', kind: 'history', url: null, icon: { kind: 'auto' } }])).ok).toBe(true);
    });
    it.each([
      ['lien sans adresse', { ...good, url: null }],
      ['adresse dangereuse', { ...good, url: 'javascript:alert(1)' }],
      ['modèle de question sans {query}', { ...good, queryUrl: 'https://exemple.fr/?q=' }],
      ['modèle de question non https', { ...good, queryUrl: 'http://exemple.fr/?q={query}' }],
      ['icône inconnue', { ...good, icon: { kind: 'icon', name: 'inconnue' } }],
      ['type inconnu', { ...good, kind: 'script' }],
      ['nom vide', { ...good, label: '  ' }],
      ['nom trop long', { ...good, label: 'x'.repeat(41) }],
    ])('rejette : %s', (_n, sc) => { expect(validateDocument(withShortcuts([sc])).ok).toBe(false); });
    it('rejette les doublons d’identifiant et plus de 24 raccourcis', () => {
      expect(validateDocument(withShortcuts([good, good])).ok).toBe(false);
      expect(validateDocument(withShortcuts(Array.from({ length: 25 }, (_, i) => ({ ...good, id: `s${i}` })))).ok).toBe(false);
    });
  });
});
