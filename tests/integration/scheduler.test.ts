import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SyncScheduler } from '../../src/sync/scheduler';
import { FakeGithub } from '../helpers/fakeGithub';
import { CONFIG, addFav, makeClock, makeDevice, type Device } from '../helpers/device';
import { TEST_TOKEN } from '../helpers/fakeGithub';

let gh: FakeGithub; let A: Device; let sched: SyncScheduler | null = null;
beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
  vi.setSystemTime(new Date('2026-06-01T10:00:00Z'));
  gh = new FakeGithub();
  A = await makeDevice('A', gh, makeClock('2026-06-01T10:00:00.000Z'));
  await A.engine.saveConfig({ ...CONFIG, autoSync: true }, TEST_TOKEN);
});
afterEach(() => { sched?.stop(); sched = null; vi.useRealTimers(); });
const opts = { debounceMs: 20_000, minIntervalMs: 60_000, startupDelayMs: 3_000, maxBackoffMs: 30 * 60_000 };

describe('synchronisation automatique', () => {
  it('ne crée pas un commit par modification : les éditions rapprochées sont regroupées', async () => {
    sched = new SyncScheduler(A.engine, A.store, opts); sched.start();
    await vi.advanceTimersByTimeAsync(4_000);              // vérification de démarrage (crée le fichier vide)
    const base = gh.putCount();
    for (let i = 0; i < 10; i++) { await addFav(A, `f${i}`, `https://f${i}.fr`); await vi.advanceTimersByTimeAsync(1_000); }
    expect(gh.putCount()).toBe(base);                      // rien envoyé pendant les frappes
    await vi.advanceTimersByTimeAsync(90_000);
    expect(gh.putCount()).toBe(base + 1);                  // un seul commit pour les 10 ajouts
    expect(gh.getFileContent()).toContain('f9');
  });

  it('n’envoie rien quand les données n’ont pas changé (aucune requête d’écriture répétée)', async () => {
    sched = new SyncScheduler(A.engine, A.store, opts); sched.start();
    await vi.advanceTimersByTimeAsync(300_000);
    expect(gh.putCount()).toBeLessThanOrEqual(1);
  });

  it('ne fait rien si la synchronisation automatique est désactivée', async () => {
    await A.engine.setAutoSync(false);
    sched = new SyncScheduler(A.engine, A.store, opts); sched.start();
    await addFav(A, 'x');
    await vi.advanceTimersByTimeAsync(300_000);
    expect(gh.requests).toHaveLength(0);
  });

  it('ralentit après un échec (backoff exponentiel) au lieu de réessayer en boucle', async () => {
    gh.offline = true;
    sched = new SyncScheduler(A.engine, A.store, opts); sched.start();
    await addFav(A, 'x');
    await vi.advanceTimersByTimeAsync(10 * 60_000);        // 10 minutes
    const attempts = gh.requests.length;
    expect(attempts).toBeGreaterThan(0);
    expect(attempts).toBeLessThan(10);                     // pas de martèlement
    expect(A.store.getDoc().favorites).toHaveLength(1);    // données intactes
    gh.offline = false;
    await vi.advanceTimersByTimeAsync(40 * 60_000);
    expect(gh.getFileContent()).toContain('"x"');          // rattrape au retour du réseau
  });

  it('attend la décision de l’utilisateur quand un conflit est en cours', async () => {
    await A.store.setLocal('dinostart:syncState', { status: 'conflict' });
    sched = new SyncScheduler(A.engine, A.store, opts); sched.start();
    await vi.advanceTimersByTimeAsync(120_000);
    expect(gh.requests).toHaveLength(0);
  });
});
