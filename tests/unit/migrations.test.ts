import { describe, expect, it } from 'vitest';
import { createDefaultDocument } from '../../src/core/defaults';
import { migrateDocument, type MigrationTable } from '../../src/core/migrations';
import { fail, ok, type DinoDocument, type Result } from '../../src/core/types';

const doc = () => JSON.parse(JSON.stringify(createDefaultDocument()));
const passthrough = (d: unknown): Result<DinoDocument> => ok(d as DinoDocument);

describe('migrations de schéma', () => {
  it('ne touche pas un document déjà à jour', () => {
    const r = migrateDocument(doc());
    expect(r.ok && r.value).toMatchObject({ fromVersion: 5, migrated: false });
  });
  it('rejette un document sans version ou avec une version invalide', () => {
    expect(migrateDocument({ ...doc(), schemaVersion: undefined }).ok).toBe(false);
    expect(migrateDocument({ ...doc(), schemaVersion: 0 }).ok).toBe(false);
    expect(migrateDocument({ ...doc(), schemaVersion: '1' }).ok).toBe(false);
    expect(migrateDocument(null).ok).toBe(false);
  });
  it('rejette un document plus récent que l’extension, sans le modifier', () => {
    const d = { ...doc(), schemaVersion: 7 };
    const r = migrateDocument(d);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toMatch(/plus récent/);
    expect(d.schemaVersion).toBe(7);
  });
  it('enchaîne les migrations successives dans l’ordre (table injectée pour le test)', () => {
    const table: MigrationTable = {
      1: (d) => ({ ...d, step1: true, order: [...((d.order as string[]) ?? []), '1→2'] }),
      2: (d) => ({ ...d, step2: true, order: [...((d.order as string[]) ?? []), '2→3'] }),
    };
    const r = migrateDocument({ ...doc(), schemaVersion: 1 }, table, 3, (d) => (d as { schemaVersion: number }).schemaVersion === 3 ? passthrough(d) : fail('version'));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.migrated).toBe(true);
      expect(r.value.doc).toMatchObject({ schemaVersion: 3, step1: true, step2: true, order: ['1→2', '2→3'] });
    }
  });
  it('échoue proprement si une migration manque ou lève une erreur, sans muter l’original', () => {
    const original = { ...doc(), schemaVersion: 1 };
    expect(migrateDocument(original, {}, 3, passthrough).ok).toBe(false);
    const boom: MigrationTable = { 1: () => { throw new Error('boom'); } };
    const r = migrateDocument(original, boom, 2, passthrough);
    expect(!r.ok && r.error).toContain('boom');
    expect(original.schemaVersion).toBe(1);
    expect(r.ok).toBe(false);
  });

  /** Widgets tels qu'avant le placement libre : « ordre » + « largeur en colonnes », sans position. */
  const OLD: Record<string, [number, number]> = { clock: [0, 6], date: [1, 6], search: [2, 12], favorites: [3, 8], quickLinks: [4, 4], tasks: [5, 4], projects: [6, 4], quickNotes: [7, 4] };
  function legacyWidgets(widgets: Record<string, unknown>[], v1 = false) {
    return widgets.map((w) => {
      const { x: _x, y: _y, w: _w, h: _h, ...rest } = w as Record<string, unknown> & { type: string; config: Record<string, unknown> };
      void _x; void _y; void _w; void _h;
      const t = rest.type;
      return { ...rest, order: OLD[t]![0], colSpan: OLD[t]![1], config: t === 'favorites' && v1 ? { categoryId: null } : rest.config };
    });
  }

  describe('migration réelle 2 → 3 (placement libre)', () => {
    const v2 = (mutate?: (ws: Record<string, unknown>[]) => Record<string, unknown>[]) => {
      const d = doc(); d.schemaVersion = 2;
      d.widgets = legacyWidgets(mutate ? mutate(d.widgets) : d.widgets);
      return d;
    };
    it('range les cartes ligne par ligne dans l’ancien ordre avec leur ancienne largeur', () => {
      const r = migrateDocument(v2());
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.value).toMatchObject({ fromVersion: 2, migrated: true });
      const pos = Object.fromEntries(r.value.doc.widgets.map((w) => [w.type, [w.x, w.y, w.w, w.h]]));
      expect(pos).toEqual({
        clock: [0, 0, 6, 4], date: [6, 0, 6, 4], search: [0, 4, 12, 4], favorites: [0, 8, 8, 9], quickLinks: [8, 8, 4, 4],
        tasks: [0, 17, 4, 5], projects: [4, 17, 4, 6], quickNotes: [8, 17, 4, 6],
      });
      for (const w of r.value.doc.widgets) expect('order' in w || 'colSpan' in w).toBe(false);
    });
    it('conserve activation et configuration ; une carte masquée ne laisse pas de trou', () => {
      const r = migrateDocument(v2((ws) => ws.map((w) => (w.type === 'date' ? { ...w, enabled: false } : w.type === 'tasks' ? { ...w, config: { limit: 3, hideDone: false } } : w))));
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      const by = Object.fromEntries(r.value.doc.widgets.map((w) => [w.type, w]));
      expect(by.date!.enabled).toBe(false);
      expect(by.tasks!.config).toEqual({ limit: 3, hideDone: false });
      expect([by.search!.x, by.search!.y]).toEqual([0, 4]); // « date » masquée : « search » (pleine largeur) passe à la ligne comme avant
      expect(by.clock!.y).toBe(0);
    });
    it('est déterministe et ne modifie pas l’original', () => {
      const a = v2(), snapshot = JSON.stringify(a);
      expect(JSON.stringify(migrateDocument(a))).toBe(JSON.stringify(migrateDocument(v2())));
      expect(JSON.stringify(a)).toBe(snapshot);
    });
  });

  describe('migration réelle 1 → 2', () => {
    /** Document tel que l'écrivait la première version de DinoStart. */
    function v1Document() {
      const d = doc();
      d.schemaVersion = 1;
      d.favorites = [{ id: 'f1', title: 'GitHub', url: 'https://github.com/', categoryId: null, icon: { kind: 'initial' }, order: 0, quick: false, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', deletedAt: null, origin: 'pc' },
        { id: 'f2', title: 'Mail', url: 'https://mail.exemple.fr/', categoryId: null, icon: { kind: 'icon', name: 'mail' }, order: 1, quick: true, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', deletedAt: null, origin: 'pc' }];
      d.settings.search = { engine: 'bing', customUrl: '' };
      delete d.settings.general;
      d.widgets = legacyWidgets(d.widgets, true);
      return d;
    }
    it('convertit un document v1 : icônes automatiques, nouveaux réglages, données conservées', () => {
      const r = migrateDocument(v1Document());
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.value).toMatchObject({ fromVersion: 1, migrated: true });
      const d = r.value.doc;
      expect(d.schemaVersion).toBe(5);
      expect(d.favorites.map((f) => f.icon)).toEqual([{ kind: 'auto' }, { kind: 'icon', name: 'mail' }]); // l'icône choisie reste
      expect(d.favorites.map((f) => f.title)).toEqual(['GitHub', 'Mail']);
      expect(d.settings.search).toMatchObject({ engine: 'bing', googleSuggestions: true, rememberSearches: true, showLens: true });
      expect(d.settings.search.shortcuts.map((x) => x.id)).toEqual(['private', 'history', 'chatgpt', 'gemini', 'claude', 'copilot', 'perplexity']);
      expect(d.settings.general.onboardingDone).toBe(false);
      expect(d.widgets.find((w) => w.type === 'favorites')!.config).toMatchObject({ layout: 'folders' });
    });
    it('est déterministe : deux appareils obtiennent exactement le même résultat', () => {
      const a = migrateDocument(v1Document()), b = migrateDocument(v1Document());
      expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    });
    it('ne modifie pas le document d’origine', () => {
      const v1 = v1Document(); const snapshot = JSON.stringify(v1);
      migrateDocument(v1);
      expect(JSON.stringify(v1)).toBe(snapshot);
    });
  });

  describe('migration réelle 3 → 4 (raccourcis modifiables)', () => {
    const v3 = (search: Record<string, unknown>) => {
      const d = doc(); d.schemaVersion = 3;
      d.settings.search = { engine: 'google', customUrl: '', googleSuggestions: true, rememberSearches: true, showLens: true, ...search };
      return d;
    };
    const ai = [{ id: 'chatgpt', label: 'ChatGPT', url: 'https://chatgpt.com/', queryUrl: 'https://chatgpt.com/?q={query}', enabled: true },
      { id: 'mon-ia', label: 'Mon IA', url: 'https://mon-ia.fr/', queryUrl: null, enabled: false }];
    it('fusionne boutons privé / historique et raccourcis IA en une seule liste, en gardant l’activation', () => {
      const r = migrateDocument(v3({ showPrivateButton: false, showHistoryButton: true, aiLinks: ai }));
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      const sc = r.value.doc.settings.search.shortcuts;
      expect(sc.map((x) => [x.id, x.kind, x.enabled])).toEqual([['private', 'private', false], ['history', 'history', true], ['chatgpt', 'link', true], ['mon-ia', 'link', false]]);
      expect(sc[2]).toMatchObject({ label: 'ChatGPT', url: 'https://chatgpt.com/', queryUrl: 'https://chatgpt.com/?q={query}', icon: { kind: 'icon', name: 'sparkles' } });
      const search = r.value.doc.settings.search as unknown as Record<string, unknown>;
      expect('aiLinks' in search || 'showPrivateButton' in search || 'showHistoryButton' in search).toBe(false);
    });
    it('tolère des réglages incomplets et reste déterministe', () => {
      const a = migrateDocument(v3({})), b = migrateDocument(v3({}));
      expect(a.ok && a.value.doc.settings.search.shortcuts.map((x) => x.id)).toEqual(['private', 'history']);
      expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    });
  });

  describe('migration réelle 4 → 5 (couleurs du logo)', () => {
    const v4 = (appearance: Record<string, unknown>) => { const d = doc(); d.schemaVersion = 4; d.settings.appearance = { ...d.settings.appearance, ...appearance }; return d; };
    it('remplace les anciennes couleurs d’origine (orange) par le bleu et la pêche du logo', () => {
      const r = migrateDocument(v4({ primary: '#f97316', accent: '#fbbf24', background: null }));
      expect(r.ok && r.value.doc.settings.appearance).toMatchObject({ primary: '#5194f5', accent: '#fdc096' });
    });
    it.each([
      ['couleur principale choisie', { primary: '#22c55e', accent: '#fbbf24', background: null }],
      ['accent choisi', { primary: '#f97316', accent: '#ff00ff', background: null }],
      ['fond personnalisé', { primary: '#f97316', accent: '#fbbf24', background: '#101820' }],
    ])('ne touche jamais une personnalisation de l’utilisateur (%s)', (_n, ap) => {
      const r = migrateDocument(v4(ap));
      expect(r.ok && r.value.doc.settings.appearance).toMatchObject({ primary: ap.primary, accent: ap.accent, background: ap.background });
    });
    it('est déterministe', () => {
      const a = v4({ primary: '#f97316', accent: '#fbbf24', background: null });
      expect(JSON.stringify(migrateDocument(a))).toBe(JSON.stringify(migrateDocument(structuredClone(a))));
    });
  });
});
