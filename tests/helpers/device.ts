import { GithubClient } from '../../src/sync/githubClient';
import { SyncEngine } from '../../src/sync/syncEngine';
import { MemoryStorageAdapter } from '../../src/storage/adapters';
import { DinoStore, KEYS } from '../../src/storage/store';
import { FakeGithub, TEST_TOKEN } from './fakeGithub';
import { addFavorite, addNote, addTask } from '../../src/core/ops';
import type { SyncConfig } from '../../src/sync/config';

export function makeClock(startIso = '2026-01-01T00:00:00.000Z') {
  let t = Date.parse(startIso);
  return () => new Date((t += 1000)).toISOString();
}

export const CONFIG: SyncConfig = { owner: 'moi', repo: 'dinostart-data', branch: 'main', path: 'dinostart/data.json', autoSync: false };

export interface Device {
  name: string;
  adapter: MemoryStorageAdapter;
  store: DinoStore;
  engine: SyncEngine;
  online: { value: boolean };
}

/** Un « PC » : stockage local propre, moteur de synchro, mais horloge et serveur partagés. */
export async function makeDevice(name: string, gh: FakeGithub, clock: () => string, opts: { configure?: boolean } = {}): Promise<Device> {
  const adapter = new MemoryStorageAdapter();
  let n = 0;
  const store = new DinoStore(adapter, clock, () => `${name}-${++n}`);
  await store.init();
  const online = { value: true };
  const engine = new SyncEngine({
    store,
    createClient: (token) => new GithubClient({ token, fetchImpl: gh.fetch, now: () => Date.parse(clock()) }),
    isOnline: () => online.value,
    now: () => Date.parse(clock()),
  });
  if (opts.configure !== false) {
    const r = await engine.saveConfig(CONFIG, TEST_TOKEN);
    if (!r.ok) throw new Error(r.error);
  }
  return { name, adapter, store, engine, online };
}

export const mustOk = <T>(r: { ok: true; value: T } | { ok: false; error: string }): T => {
  if (!r.ok) throw new Error(`Résultat en échec : ${r.error}`);
  return r.value;
};

export const addFav = (d: Device, title: string, url = 'https://exemple.fr', categoryId: string | null = null) =>
  d.store.mutateAdd((doc, ctx) => addFavorite(doc, ctx, { title, url, categoryId })).then(mustOk);
export const addNoteTo = (d: Device, title: string, content = '') => d.store.mutateAdd((doc, ctx) => addNote(doc, ctx, { title, content })).then(mustOk);
export const addTaskTo = (d: Device, title: string) => d.store.mutateAdd((doc, ctx) => addTask(doc, ctx, { title })).then(mustOk);
export { KEYS };
