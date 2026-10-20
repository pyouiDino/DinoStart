import { describe, expect, it } from 'vitest';
import { createDefaultDocument } from '../../src/core/defaults';
import { addFavorite, addNote, live, updateSettings } from '../../src/core/ops';
import { MemoryStorageAdapter } from '../../src/storage/adapters';
import { DinoStore, KEYS, MAX_BACKUPS } from '../../src/storage/store';
import { fail, ok } from '../../src/core/types';

const mkStore = async (adapter = new MemoryStorageAdapter()) => {
  let n = 0, t = Date.parse('2026-05-01T00:00:00Z');
  const store = new DinoStore(adapter, () => new Date((t += 1000)).toISOString(), () => `id${++n}`);
  await store.init();
  return { store, adapter };
};
const addFav = (store: DinoStore, title: string) => store.mutateAdd((d, c) => addFavorite(d, c, { title, url: `https://${title}.fr`, categoryId: null }));

describe('stockage local', () => {
  it('démarre avec un document vierge sans données de démonstration et un identifiant d’appareil stable', async () => {
    const { store, adapter } = await mkStore();
    expect(live(store.getDoc().favorites)).toHaveLength(0);
    expect(store.getDeviceId()).toMatch(/^id\d+$/);
    const again = await mkStore(adapter);
    expect(again.store.getDeviceId()).toBe(store.getDeviceId());
  });

  it('persiste les modifications et les restaure après « fermeture du navigateur » (nouvelle instance)', async () => {
    const { store, adapter } = await mkStore();
    expect((await addFav(store, 'a')).ok).toBe(true);
    expect((await store.mutate((d, c) => updateSettings(d, c, (s) => ({ ...s, appearance: { ...s.appearance, mode: 'light', primary: '#00aa00' } })))).ok).toBe(true);
    const reopened = (await mkStore(adapter)).store;
    expect(live(reopened.getDoc().favorites).map((f) => f.title)).toEqual(['a']);
    expect(reopened.getDoc().settings.appearance).toMatchObject({ mode: 'light', primary: '#00aa00' });
  });

  it('sérialise les écritures concurrentes sans perdre de modification', async () => {
    const { store } = await mkStore();
    const results = await Promise.all(Array.from({ length: 25 }, (_, i) => addFav(store, `f${i}`)));
    expect(results.every((r) => r.ok)).toBe(true);
    expect(live(store.getDoc().favorites)).toHaveLength(25);
    expect(new Set(store.getDoc().favorites.map((f) => f.id)).size).toBe(25);
  });

  it('refuse d’enregistrer un document invalide et ne change rien', async () => {
    const { store, adapter } = await mkStore();
    await addFav(store, 'ok');
    const before = JSON.stringify(adapter.dump()[KEYS.doc]);
    const r = await store.mutate((d) => ok({ ...d, favorites: d.favorites.map((f) => ({ ...f, url: 'javascript:alert(1)' })) }));
    expect(r.ok).toBe(false);
    expect(JSON.stringify(adapter.dump()[KEYS.doc])).toBe(before);
    expect(store.getDoc().favorites[0]!.url).toBe('https://ok.fr/');
  });

  it('conserve les données locales si l’écriture échoue (quota, erreur disque)', async () => {
    const { store, adapter } = await mkStore();
    await addFav(store, 'avant');
    adapter.failNextSets = 1;
    const r = await addFav(store, 'perdu');
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toMatch(/intactes/);
    expect(live(store.getDoc().favorites).map((f) => f.title)).toEqual(['avant']);
    const reopened = (await mkStore(adapter)).store;
    expect(live(reopened.getDoc().favorites).map((f) => f.title)).toEqual(['avant']);
    expect((await addFav(store, 'après')).ok).toBe(true); // la file n'est pas bloquée
  });

  it('une recette qui échoue ou lève une exception ne bloque pas la file', async () => {
    const { store } = await mkStore();
    expect((await store.mutate(() => fail('non'))).ok).toBe(false);
    expect((await store.mutate(() => { throw new Error('kaboom'); })).ok).toBe(false);
    expect((await addFav(store, 'z')).ok).toBe(true);
  });

  it('met les données corrompues en quarantaine et restaure la dernière sauvegarde valide', async () => {
    const { store, adapter } = await mkStore();
    await addFav(store, 'precieux');
    expect((await store.createBackup('test')).ok).toBe(true);
    await adapter.set({ [KEYS.doc]: { schemaVersion: 1, favorites: 'cassé' } });
    const reopened = (await mkStore(adapter)).store;
    expect(live(reopened.getDoc().favorites).map((f) => f.title)).toEqual(['precieux']);
    expect(reopened.loadWarning).toMatch(/illisibles/);
    expect(adapter.dump()[KEYS.corrupt]).toBeDefined();
  });

  it('sans sauvegarde, repart d’un document vierge mais conserve les données illisibles à part', async () => {
    const adapter = new MemoryStorageAdapter();
    await adapter.set({ [KEYS.doc]: { nimporte: 'quoi' } });
    const { store } = await mkStore(adapter);
    expect(live(store.getDoc().favorites)).toHaveLength(0);
    expect(store.loadWarning).not.toBeNull();
    expect((adapter.dump()[KEYS.corrupt] as { raw: unknown }).raw).toEqual({ nimporte: 'quoi' });
  });

  it('refuse un document plus récent que l’extension sans l’écraser silencieusement', async () => {
    const adapter = new MemoryStorageAdapter();
    await adapter.set({ [KEYS.doc]: { ...createDefaultDocument(), schemaVersion: 42 } });
    const { store } = await mkStore(adapter);
    expect(store.loadWarning).toMatch(/plus récent/);
    expect((adapter.dump()[KEYS.corrupt] as { raw: { schemaVersion: number } }).raw.schemaVersion).toBe(42);
  });

  it('sauvegardes : rotation, restauration, et sauvegarde préalable avant remplacement', async () => {
    const { store } = await mkStore();
    await addFav(store, 'v1');
    for (let i = 0; i < MAX_BACKUPS + 3; i++) await store.createBackup(`b${i}`);
    expect(await store.listBackups()).toHaveLength(MAX_BACKUPS);
    const b = (await store.listBackups())[0]!;
    await addNote(store.getDoc(), store.ctx(), { content: 'x' }); // pur : ne modifie pas le store
    const replaced = await store.replaceDocument(createDefaultDocument(), 'test remplacement');
    expect(replaced.ok).toBe(true);
    expect(live(store.getDoc().favorites)).toHaveLength(0);
    const restored = await store.restoreBackup(b.id);
    expect(restored.ok).toBe(true);
    expect(live(store.getDoc().favorites).map((f) => f.title)).toEqual(['v1']);
  });

  it('annule un remplacement destructif si la sauvegarde préalable échoue', async () => {
    const { store, adapter } = await mkStore();
    await addFav(store, 'garde-moi');
    adapter.failNextSets = 1; // la sauvegarde échoue
    const r = await store.replaceDocument(createDefaultDocument(), 'test');
    expect(r.ok).toBe(false);
    expect(live(store.getDoc().favorites).map((f) => f.title)).toEqual(['garde-moi']);
  });

  it('le jeton n’est jamais dans le document ni dans les sauvegardes', async () => {
    const { store, adapter } = await mkStore();
    await store.setLocal(KEYS.secret, { token: 'github_pat_SECRETSECRETSECRETSECRET' });
    await addFav(store, 'a');
    await store.createBackup('x');
    const dump = adapter.dump();
    expect(JSON.stringify(dump[KEYS.doc])).not.toContain('SECRET');
    expect(JSON.stringify(dump[KEYS.backups])).not.toContain('SECRET');
  });
});
