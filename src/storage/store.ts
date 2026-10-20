// Couche de stockage local : source immédiate de l'interface.
// Toutes les écritures sont sérialisées, validées avant enregistrement, et jamais appliquées en mémoire si elles échouent.
import { countDocument, docEquals, type DocCounts } from '../core/docutil';
import { createDefaultDocument } from '../core/defaults';
import { migrateDocument } from '../core/migrations';
import { createCtx, type OpCtx } from '../core/ops';
import { fail, ok, type DinoDocument, type Result } from '../core/types';
import { validateDocument } from '../core/validation';
import type { StorageAdapter } from './adapters';

export const KEYS = {
  doc: 'dinostart:doc',
  meta: 'dinostart:meta',
  base: 'dinostart:syncBase',
  backups: 'dinostart:backups',
  corrupt: 'dinostart:corrupt',
  bgImage: 'dinostart:bgImage',
  syncConfig: 'dinostart:syncConfig',
  syncState: 'dinostart:syncState',
  conflict: 'dinostart:conflict',
  searchHistory: 'dinostart:searchHistory', // recherches faites depuis la barre : propres à l'appareil, non synchronisées
  secret: 'dinostart:secret', // jeton GitHub : jamais exporté, jamais synchronisé, jamais journalisé
} as const;

export const MAX_BACKUPS = 8;

export interface Backup { id: string; createdAt: string; reason: string; counts: DocCounts; doc: DinoDocument }
interface Meta { deviceId: string; createdAt: string }

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

export class DinoStore {
  private doc: DinoDocument = createDefaultDocument();
  private base: DinoDocument | null = null;
  private deviceId = '';
  private queue: Promise<unknown> = Promise.resolve();
  private listeners = new Set<() => void>();
  private version = 0;
  private unsubscribe: (() => void) | null = null;
  /** Message à afficher si des données ont dû être récupérées au démarrage. */
  loadWarning: string | null = null;
  dirty = false;
  ready = false;

  constructor(
    readonly adapter: StorageAdapter,
    private readonly clock: () => string = () => new Date().toISOString(),
    private readonly newId: () => string = () => crypto.randomUUID(),
  ) {}

  // ---------- lecture ----------
  getDoc(): DinoDocument { return this.doc; }
  getBase(): DinoDocument | null { return this.base; }
  getDeviceId(): string { return this.deviceId; }
  /** Fonction fléchée : passée telle quelle à useSyncExternalStore, elle doit rester liée à l'instance. */
  getVersion = (): number => this.version;
  ctx(): OpCtx { return createCtx(this.deviceId || 'unknown', this.clock, this.newId); }
  now(): string { return this.clock(); }

  subscribe = (fn: () => void): (() => void) => { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; };
  private emit() { this.version++; this.listeners.forEach((l) => l()); }
  private enqueue<T>(job: () => Promise<T>): Promise<T> {
    const run = this.queue.then(job, job);
    this.queue = run.catch(() => undefined);
    return run;
  }

  // ---------- démarrage ----------
  async init(): Promise<void> {
    const got = await this.adapter.get([KEYS.doc, KEYS.meta, KEYS.base]);

    let meta = got[KEYS.meta] as Meta | undefined;
    if (!meta || typeof meta.deviceId !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(meta.deviceId)) {
      meta = { deviceId: this.newId(), createdAt: this.clock() };
      await this.adapter.set({ [KEYS.meta]: meta });
    }
    this.deviceId = meta.deviceId;

    if (got[KEYS.doc] === undefined) {
      this.doc = createDefaultDocument();
      await this.adapter.set({ [KEYS.doc]: this.doc });
    } else {
      const m = migrateDocument(got[KEYS.doc]);
      if (m.ok) {
        this.doc = m.value.doc;
        if (m.value.migrated) await this.adapter.set({ [KEYS.doc]: this.doc });
      } else {
        await this.recoverFromCorruption(got[KEYS.doc], m.error);
      }
    }
    if (got[KEYS.base] !== undefined) {
      const b = migrateDocument(got[KEYS.base]);
      this.base = b.ok ? b.value.doc : null;
    }
    this.refreshDirty();
    this.ready = true;
    this.unsubscribe?.();
    this.unsubscribe = this.adapter.subscribe?.((keys) => { void this.onExternalChange(keys); }) ?? null;
    this.emit();
  }

  /** Les données illisibles sont mises de côté (jamais supprimées), puis la dernière sauvegarde valide est utilisée. */
  private async recoverFromCorruption(raw: unknown, error: string) {
    let quarantined = true;
    try { await this.adapter.set({ [KEYS.corrupt]: { savedAt: this.clock(), error, raw } }); } catch { quarantined = false; }
    const backups = await this.readBackups();
    let recovered: { at: string; doc: DinoDocument } | null = null;
    for (const b of backups) {
      const m = migrateDocument(b.doc);
      if (m.ok) { recovered = { at: b.createdAt, doc: m.value.doc }; break; }
    }
    if (recovered) {
      this.doc = recovered.doc;
      this.loadWarning = `Les données locales étaient illisibles (${error}). La sauvegarde du ${recovered.at} a été restaurée.${quarantined ? ' Les données d’origine sont conservées à part.' : ''}`;
    } else {
      this.doc = createDefaultDocument();
      this.loadWarning = `Les données locales étaient illisibles (${error}) et aucune sauvegarde n’était disponible. ${quarantined ? 'Les données d’origine sont conservées à part.' : ''}`.trim();
    }
    await this.adapter.set({ [KEYS.doc]: this.doc });
  }

  private async onExternalChange(keys: string[]) {
    if (!keys.some((k) => k === KEYS.doc || k === KEYS.base)) { this.emit(); return; }
    const got = await this.adapter.get([KEYS.doc, KEYS.base]);
    const d = got[KEYS.doc] !== undefined ? migrateDocument(got[KEYS.doc]) : null;
    if (d?.ok) this.doc = d.value.doc;
    if (keys.includes(KEYS.base)) { const b = got[KEYS.base] !== undefined ? migrateDocument(got[KEYS.base]) : null; this.base = b?.ok ? b.value.doc : null; }
    this.refreshDirty();
    this.emit();
  }

  private refreshDirty() { this.dirty = !docEquals(this.doc, this.base ?? createDefaultDocument()); }

  // ---------- écriture ----------
  private async readCurrent(): Promise<DinoDocument> {
    try {
      const got = await this.adapter.get([KEYS.doc]);
      const m = got[KEYS.doc] === undefined ? null : migrateDocument(got[KEYS.doc]);
      if (m?.ok) return m.value.doc;
    } catch { /* lecture impossible : on s'appuie sur la dernière copie valide en mémoire */ }
    return this.doc;
  }

  /**
   * Applique une modification : lecture du dernier état, recette pure, validation, écriture, puis mise à jour de l'interface.
   * En cas d'échec, ni le stockage ni l'état en mémoire ne changent.
   */
  mutateWith<T>(recipe: (doc: DinoDocument, ctx: OpCtx) => Result<{ doc: DinoDocument; out: T }>): Promise<Result<T>> {
    return this.enqueue(async () => {
      const current = await this.readCurrent();
      let r: Result<{ doc: DinoDocument; out: T }>;
      try { r = recipe(current, this.ctx()); } catch (e) { return fail<T>(`Opération impossible : ${errMsg(e)}`); }
      if (!r.ok) return fail<T>(r.error);
      const valid = validateDocument(r.value.doc);
      if (!valid.ok) return fail<T>(valid.error);
      try { await this.adapter.set({ [KEYS.doc]: valid.value }); } catch (e) {
        return fail<T>(`L’enregistrement local a échoué (${errMsg(e)}). Vos données précédentes sont intactes.`);
      }
      this.doc = valid.value;
      this.refreshDirty();
      this.emit();
      return ok(r.value.out);
    });
  }

  mutate(recipe: (doc: DinoDocument, ctx: OpCtx) => Result<DinoDocument>): Promise<Result<DinoDocument>> {
    return this.mutateWith((doc, ctx) => { const r = recipe(doc, ctx); return r.ok ? ok({ doc: r.value, out: r.value }) : r; });
  }
  /** Pour les opérations qui créent un élément et renvoient son identifiant. */
  mutateAdd(recipe: (doc: DinoDocument, ctx: OpCtx) => Result<{ doc: DinoDocument; id: string }>): Promise<Result<string>> {
    return this.mutateWith((doc, ctx) => { const r = recipe(doc, ctx); return r.ok ? ok({ doc: r.value.doc, out: r.value.id }) : r; });
  }

  // ---------- sauvegardes locales ----------
  private async readBackups(): Promise<Backup[]> {
    const got = await this.adapter.get([KEYS.backups]);
    const list = got[KEYS.backups];
    return Array.isArray(list) ? (list as Backup[]).filter((b) => b && typeof b.id === 'string' && b.doc) : [];
  }
  listBackups(): Promise<Backup[]> { return this.readBackups(); }

  createBackup(reason: string): Promise<Result<Backup>> {
    return this.enqueue(async () => {
      try {
        const doc = await this.readCurrent();
        const backup: Backup = { id: this.newId(), createdAt: this.clock(), reason, counts: countDocument(doc), doc };
        const list = [backup, ...(await this.readBackups())].slice(0, MAX_BACKUPS);
        await this.adapter.set({ [KEYS.backups]: list });
        return ok(backup);
      } catch (e) {
        return fail<Backup>(`Impossible de créer la sauvegarde locale (${errMsg(e)}).`);
      }
    });
  }

  async deleteBackup(id: string): Promise<Result<true>> {
    return this.enqueue(async () => {
      try { await this.adapter.set({ [KEYS.backups]: (await this.readBackups()).filter((b) => b.id !== id) }); return ok(true as const); } catch (e) { return fail<true>(errMsg(e)); }
    });
  }

  /** Remplace tout le document, après une sauvegarde locale obligatoire. Si la sauvegarde échoue, rien n'est remplacé. */
  async replaceDocument(next: DinoDocument, reason: string): Promise<Result<DinoDocument>> {
    const valid = validateDocument(next);
    if (!valid.ok) return fail(valid.error);
    const backup = await this.createBackup(reason);
    if (!backup.ok) return fail(`Remplacement annulé : ${backup.error}`);
    return this.mutate(() => ok(valid.value));
  }

  async restoreBackup(id: string): Promise<Result<DinoDocument>> {
    const b = (await this.readBackups()).find((x) => x.id === id);
    if (!b) return fail('Sauvegarde introuvable.');
    const m = migrateDocument(b.doc);
    if (!m.ok) return fail(`Cette sauvegarde est illisible : ${m.error}`);
    return this.replaceDocument(m.value.doc, `Avant la restauration de la sauvegarde du ${b.createdAt}`);
  }

  // ---------- données propres à l'appareil (non synchronisées) ----------
  async getLocal<T>(key: string): Promise<T | undefined> { return (await this.adapter.get([key]))[key] as T | undefined; }
  async setLocal(key: string, value: unknown): Promise<Result<true>> {
    try { await this.adapter.set({ [key]: value }); this.emit(); return ok(true as const); } catch (e) { return fail(`Enregistrement impossible : ${errMsg(e)}`); }
  }
  async removeLocal(...keys: string[]): Promise<void> { await this.adapter.remove(keys); this.emit(); }

  async setBase(doc: DinoDocument | null): Promise<Result<true>> {
    try {
      if (doc) await this.adapter.set({ [KEYS.base]: doc }); else await this.adapter.remove([KEYS.base]);
      this.base = doc;
      this.refreshDirty();
      this.emit();
      return ok(true as const);
    } catch (e) { return fail(`Enregistrement de l’état de synchronisation impossible : ${errMsg(e)}`); }
  }

  destroy() { this.unsubscribe?.(); this.unsubscribe = null; }
}
