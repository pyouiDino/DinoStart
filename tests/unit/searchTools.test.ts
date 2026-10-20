import { describe, expect, it, vi } from 'vitest';
import { createDefaultDocument } from '../../src/core/defaults';
import { addCategory, addFavorite, createCtx, groupIntoNewFolder, live } from '../../src/core/ops';
import type { Result } from '../../src/core/types';
import { addEntry, matchEntries, removeEntry, SearchHistory, MAX_HISTORY } from '../../src/search/history';
import { fetchSuggestions, parseSuggestions, suggestionUrl } from '../../src/search/suggestions';
import { faviconUrl, openChromeHistory, openPrivateWindow } from '../../src/search/browser';
import { MemoryStorageAdapter } from '../../src/storage/adapters';
import { DinoStore, KEYS } from '../../src/storage/store';

const u = <T,>(r: Result<T>): T => { if (!r.ok) throw new Error(r.error); return r.value; };

describe('historique de recherche', () => {
  it('ajoute en tête, sans doublon (casse et accents ignorés), borné', () => {
    let l = addEntry([], 'Météo Paris', '2026-01-01T00:00:00Z');
    l = addEntry(l, 'recette crêpes', '2026-01-02T00:00:00Z');
    l = addEntry(l, 'meteo paris', '2026-01-03T00:00:00Z');
    expect(l.map((e) => e.q)).toEqual(['meteo paris', 'recette crêpes']);
    expect(addEntry(l, '   ', 'x')).toBe(l);
    let big: ReturnType<typeof addEntry> = [];
    for (let i = 0; i < MAX_HISTORY + 30; i++) big = addEntry(big, `requête ${i}`, 'x');
    expect(big).toHaveLength(MAX_HISTORY);
  });
  it('filtre selon la saisie : débuts d’abord, puis contenus ; récentes si vide', () => {
    const l = ['pomme tarte', 'tarte aux fraises', 'recette tarte', 'chat'].map((q) => ({ q, at: 'x' })).reverse();
    expect(matchEntries(l, 'tar').map((e) => e.q)).toEqual(['tarte aux fraises', 'recette tarte', 'pomme tarte']);
    expect(matchEntries(l, '', 2)).toHaveLength(2);
    expect(matchEntries(l, 'tarte aux fraises')).toEqual([]); // identique à la saisie : inutile
    expect(removeEntry(l, 'chat')).toHaveLength(3);
  });
  it('persiste sur l’appareil, se supprime, ignore les données corrompues', async () => {
    const adapter = new MemoryStorageAdapter();
    const store = new DinoStore(adapter); await store.init();
    const h = new SearchHistory(store);
    await h.add('premier'); await h.add('second');
    expect((await h.list()).map((e) => e.q)).toEqual(['second', 'premier']);
    expect((await new SearchHistory(store).list())).toHaveLength(2);
    await h.remove('second');
    expect((await h.list()).map((e) => e.q)).toEqual(['premier']);
    await adapter.set({ [KEYS.searchHistory]: 'n’importe quoi' });
    expect(await h.list()).toEqual([]);
    await h.add('x'); await h.clear();
    expect(await h.list()).toEqual([]);
  });
  it('n’est jamais dans le document synchronisé ni dans les sauvegardes', async () => {
    const adapter = new MemoryStorageAdapter();
    const store = new DinoStore(adapter); await store.init();
    await new SearchHistory(store).add('secret très personnel');
    await store.createBackup('x');
    expect(JSON.stringify(adapter.dump()[KEYS.doc])).not.toContain('secret très');
    expect(JSON.stringify(adapter.dump()[KEYS.backups])).not.toContain('secret très');
  });
});

describe('suggestions Google', () => {
  it('construit une URL vers le seul domaine attendu et encode la saisie', () => {
    const url = new URL(suggestionUrl('café & thé'));
    expect(url.host).toBe('suggestqueries.google.com');
    expect(url.searchParams.get('q')).toBe('café & thé');
  });
  it('analyse la réponse et rejette tout format inattendu', () => {
    expect(parseSuggestions(['chat', ['chat noir', 'chat', 'Chat noir', '', 42, 'x'.repeat(200)]])).toEqual(['chat noir', 'chat']);
    expect(parseSuggestions(['a', Array.from({ length: 20 }, (_, i) => `s${i}`)], 4)).toHaveLength(4);
    for (const bad of [null, {}, 'x', [], ['a'], ['a', 'pas un tableau'], 42]) expect(parseSuggestions(bad)).toEqual([]);
  });
  it('ne lève jamais d’erreur : réseau coupé, 500, JSON invalide ou saisie trop courte', async () => {
    const ok = vi.fn(async () => new Response(JSON.stringify(['ab', ['abc', 'abd']])));
    expect(await fetchSuggestions('ab', { fetchImpl: ok as unknown as typeof fetch })).toEqual(['abc', 'abd']);
    const call = ok.mock.calls[0] as unknown as [string, RequestInit];
    expect(call[1]).toMatchObject({ credentials: 'omit', referrerPolicy: 'no-referrer' });
    expect(await fetchSuggestions('a', { fetchImpl: ok as unknown as typeof fetch })).toEqual([]);
    expect(ok).toHaveBeenCalledTimes(1);
    expect(await fetchSuggestions('abc', { fetchImpl: (async () => { throw new TypeError('offline'); }) as unknown as typeof fetch })).toEqual([]);
    expect(await fetchSuggestions('abc', { fetchImpl: (async () => new Response('x', { status: 500 })) as unknown as typeof fetch })).toEqual([]);
    expect(await fetchSuggestions('abc', { fetchImpl: (async () => new Response('pas du json')) as unknown as typeof fetch })).toEqual([]);
  });
});

describe('actions du navigateur', () => {
  it('sans API Chrome : icône absente et messages de repli clairs (pas d’exception)', async () => {
    expect(faviconUrl('https://exemple.fr')).toBeNull();
    const p = await openPrivateWindow('https://www.google.com');
    expect(!p.ok && p.error).toMatch(/Ctrl\+Maj\+N/);
    const h = await openChromeHistory();
    expect(!h.ok && h.error).toMatch(/Ctrl\+H/);
  });
  it('avec l’API Chrome : URL _favicon locale, fenêtre privée et historique', async () => {
    const create = vi.fn(async () => ({}));
    const tabs = vi.fn(async () => ({}));
    vi.stubGlobal('chrome', { runtime: { getURL: (p: string) => `chrome-extension://abc${p}` }, windows: { create }, tabs: { create: tabs } });
    try {
      const f = new URL(faviconUrl('https://exemple.fr/page', 32)!);
      expect(f.href.startsWith('chrome-extension://abc/_favicon/')).toBe(true);
      expect(f.pathname).toBe('/_favicon/');
      expect(f.searchParams.get('pageUrl')).toBe('https://exemple.fr/page');
      expect((await openPrivateWindow('https://www.google.com/search?q=x')).ok).toBe(true);
      expect(create).toHaveBeenCalledWith({ incognito: true, url: 'https://www.google.com/search?q=x' });
      expect((await openChromeHistory()).ok).toBe(true);
      expect(tabs).toHaveBeenCalledWith({ url: 'chrome://history' });
      create.mockRejectedValueOnce(new Error('refusé'));
      expect((await openPrivateWindow('https://x.fr')).ok).toBe(false);
    } finally { vi.unstubAllGlobals(); }
  });
});

describe('dossiers façon téléphone', () => {
  let n = 0;
  const ctx = createCtx('t', () => '2026-01-01T00:00:00.000Z', () => `d${++n}`);
  it('glisser un favori sur un autre crée un dossier qui contient les deux', () => {
    let d = createDefaultDocument();
    const a = u(addFavorite(d, ctx, { title: 'A', url: 'https://a.fr', categoryId: null })); d = a.doc;
    const b = u(addFavorite(d, ctx, { title: 'B', url: 'https://b.fr', categoryId: null })); d = b.doc;
    const c = u(addFavorite(d, ctx, { title: 'C', url: 'https://c.fr', categoryId: null })); d = c.doc;
    const r = u(groupIntoNewFolder(d, ctx, a.id, b.id));
    const folder = live(r.doc.categories).find((x) => x.id === r.id)!;
    expect(folder.name).toBe('Nouveau dossier');
    const inside = live(r.doc.favorites).filter((f) => f.categoryId === folder.id).sort((x, y) => x.order - y.order).map((f) => f.title);
    expect(inside).toEqual(['A', 'B']);
    expect(live(r.doc.favorites).find((f) => f.id === c.id)!.categoryId).toBeNull();
    const again = u(groupIntoNewFolder(r.doc, ctx, c.id, a.id));
    expect(live(again.doc.categories).map((x) => x.name).sort()).toEqual(['Nouveau dossier', 'Nouveau dossier 2']);
  });
  it('refuse sans rien modifier si un favori n’existe pas ou si c’est le même', () => {
    let d = createDefaultDocument();
    const a = u(addFavorite(d, ctx, { title: 'A', url: 'https://a.fr', categoryId: null })); d = a.doc;
    expect(groupIntoNewFolder(d, ctx, a.id, a.id).ok).toBe(false);
    expect(groupIntoNewFolder(d, ctx, a.id, 'inconnu').ok).toBe(false);
    expect(live(d.categories)).toHaveLength(0);
    void addCategory;
  });
});
