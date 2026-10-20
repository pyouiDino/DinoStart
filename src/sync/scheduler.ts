// Planificateur de la synchronisation automatique : regroupe les modifications, espace les appels
// et ralentit après un échec. Il ne bloque jamais l'interface (tout est asynchrone et en arrière-plan).
import type { DinoStore } from '../storage/store';
import type { SyncEngine } from './syncEngine';

export interface SchedulerOptions {
  /** Attente après la dernière modification avant d'envoyer (regroupe plusieurs éditions en un commit). */
  debounceMs?: number;
  /** Délai minimal entre deux synchronisations automatiques. */
  minIntervalMs?: number;
  /** Délai avant la première vérification après l'ouverture de la page. */
  startupDelayMs?: number;
  maxBackoffMs?: number;
  now?: () => number;
}

export class SyncScheduler {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private lastRun = 0;
  private failures = 0;
  private stopped = true;
  private unsubscribe: (() => void) | null = null;
  private lastSeenVersion = -1;
  private readonly o: Required<SchedulerOptions>;
  private readonly onOnline = () => { this.failures = 0; this.schedule(2_000); };

  constructor(private readonly engine: SyncEngine, private readonly store: DinoStore, opts: SchedulerOptions = {}, private readonly onResult?: () => void) {
    this.o = { debounceMs: 20_000, minIntervalMs: 60_000, startupDelayMs: 3_000, maxBackoffMs: 30 * 60_000, now: Date.now, ...opts };
  }

  start() {
    if (!this.stopped) return;
    this.stopped = false;
    this.unsubscribe = this.store.subscribe(() => {
      // Ne réagit qu'aux changements du document (pas aux mises à jour d'état de synchronisation).
      const doc = this.store.getDoc();
      const marker = Date.parse(doc.updatedAt);
      if (marker !== this.lastSeenVersion) { this.lastSeenVersion = marker; if (this.store.dirty) this.schedule(this.o.debounceMs); }
    });
    this.lastSeenVersion = Date.parse(this.store.getDoc().updatedAt);
    if (typeof window !== 'undefined') window.addEventListener('online', this.onOnline);
    this.schedule(this.o.startupDelayMs);
  }

  stop() {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.unsubscribe?.(); this.unsubscribe = null;
    if (typeof window !== 'undefined') window.removeEventListener('online', this.onOnline);
  }

  /** Planifie une synchronisation après `delay`, sans jamais descendre sous l'intervalle minimal ni le backoff. */
  schedule(delay: number) {
    if (this.stopped) return;
    const backoff = this.failures ? Math.min(this.o.maxBackoffMs, 60_000 * 2 ** (this.failures - 1)) : 0;
    const sinceLast = this.o.now() - this.lastRun;
    const wait = Math.max(delay, backoff, this.lastRun ? this.o.minIntervalMs - sinceLast : 0);
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => { void this.run(); }, wait);
  }

  private async run() {
    this.timer = null;
    if (this.stopped) return;
    const cfg = await this.engine.getConfig();
    if (!cfg || !cfg.autoSync || !(await this.engine.hasToken())) return;
    const state = await this.engine.getState();
    if (state.status === 'conflict') return; // attend la décision de l'utilisateur
    this.lastRun = this.o.now();
    const outcome = await this.engine.sync();
    this.onResult?.();
    if (outcome.status === 'error' || outcome.status === 'offline' || outcome.status === 'rate-limited') {
      this.failures++;
      if (outcome.status === 'rate-limited') {
        const s = await this.engine.getState();
        const wait = s.rateLimitedUntil ? Math.max(0, Date.parse(s.rateLimitedUntil) - this.o.now()) : 0;
        this.schedule(wait + 1_000);
      } else this.schedule(0);
    } else {
      this.failures = 0;
      if (this.store.dirty) this.schedule(this.o.debounceMs);
    }
  }
}
