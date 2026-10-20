// Moteur de synchronisation GitHub. Principes :
//  - aucune réussite n'est déclarée sans réponse HTTP vérifiée ;
//  - jamais d'écrasement silencieux (fusion à 3 voies, conflits explicites, sauvegarde locale avant application) ;
//  - nombre de tentatives borné ; limites de débit respectées ; le jeton n'apparaît jamais dans les messages.
import { countDocument, docEquals, sortCanonical, type DocCounts } from '../core/docutil';
import { mergeDocuments, type Conflict, type Resolution } from '../core/merge';
import { migrateDocument } from '../core/migrations';
import { fail, ok, type DinoDocument, type Result } from '../core/types';
import { KEYS, type DinoStore } from '../storage/store';
import {
  DEFAULT_SYNC_CONFIG, EMPTY_SYNC_STATE, redact, validateSyncConfig, validateToken,
  type SyncConfig, type SyncState, type SyncStatus,
} from './config';
import { GithubClient, GithubError } from './githubClient';

export const MAX_ATTEMPTS = 3;

export interface SyncOutcome { status: SyncStatus; message: string; conflicts?: Conflict[] }
export interface AccessCheck { label: string; ok: boolean; detail: string }
export interface ConflictState { at: string; conflicts: Conflict[] }
export interface RemoteInspection { exists: boolean; counts: DocCounts | null; doc: DinoDocument | null }

class SyncFailure extends Error {
  constructor(readonly kind: string, message: string, readonly status: SyncStatus = 'error') { super(message); }
}

export interface SyncEngineDeps {
  store: DinoStore;
  createClient?: (token: string) => GithubClient;
  isOnline?: () => boolean;
  now?: () => number;
}

export const serializeDocument = (doc: DinoDocument): string => `${JSON.stringify(sortCanonical(doc), null, 2)}\n`;

export function parseRemoteDocument(content: string): Result<DinoDocument> {
  let raw: unknown;
  try { raw = JSON.parse(content); } catch { return fail('Le fichier distant n’est pas un JSON valide. Il n’a pas été modifié.'); }
  const m = migrateDocument(raw);
  return m.ok ? ok(m.value.doc) : fail(`Le fichier distant est refusé : ${m.error} Il n’a pas été modifié.`);
}

const lastLocalIso = (ms: number) => new Date(ms).toISOString();

export class SyncEngine {
  private running: Promise<SyncOutcome> | null = null;
  private readonly store: DinoStore;
  private readonly createClient: (token: string) => GithubClient;
  private readonly isOnline: () => boolean;
  private readonly now: () => number;

  constructor(deps: SyncEngineDeps) {
    this.store = deps.store;
    this.createClient = deps.createClient ?? ((token) => new GithubClient({ token }));
    this.isOnline = deps.isOnline ?? (() => (typeof navigator === 'undefined' ? true : navigator.onLine));
    this.now = deps.now ?? Date.now;
  }

  // ---------- configuration locale ----------
  async getConfig(): Promise<SyncConfig | null> {
    const raw = await this.store.getLocal<Partial<SyncConfig>>(KEYS.syncConfig);
    if (!raw) return null;
    const v = validateSyncConfig(raw);
    return v.ok ? v.value : null;
  }
  async hasToken(): Promise<boolean> { return Boolean((await this.store.getLocal<{ token?: string }>(KEYS.secret))?.token); }
  private async getToken(): Promise<string | null> {
    const t = (await this.store.getLocal<{ token?: string }>(KEYS.secret))?.token;
    return typeof t === 'string' && t ? t : null;
  }
  async getState(): Promise<SyncState> {
    const raw = await this.store.getLocal<Partial<SyncState>>(KEYS.syncState);
    const cfg = await this.getConfig();
    const s = { ...EMPTY_SYNC_STATE, ...(raw ?? {}) } as SyncState;
    if (!cfg) return { ...s, status: 'unconfigured' };
    return s.status === 'unconfigured' || s.status === 'syncing' ? { ...s, status: 'idle' } : s;
  }
  private async patchState(patch: Partial<SyncState>): Promise<void> {
    const cur = await this.store.getLocal<Partial<SyncState>>(KEYS.syncState);
    await this.store.setLocal(KEYS.syncState, { ...EMPTY_SYNC_STATE, ...(cur ?? {}), ...patch });
  }
  async getConflictState(): Promise<ConflictState | null> {
    return (await this.store.getLocal<ConflictState>(KEYS.conflict)) ?? null;
  }

  /** Enregistre la configuration (et le jeton si fourni). Un changement de cible réinitialise l'état de synchronisation. */
  async saveConfig(input: Partial<SyncConfig>, token?: string): Promise<Result<SyncConfig>> {
    const cfg = validateSyncConfig(input);
    if (!cfg.ok) return cfg;
    if (token !== undefined && token !== '') {
      const t = validateToken(token);
      if (!t.ok) return fail(t.error);
      const w = await this.store.setLocal(KEYS.secret, { token: t.value });
      if (!w.ok) return fail(w.error);
    }
    const prev = await this.getConfig();
    const targetChanged = !prev || prev.owner !== cfg.value.owner || prev.repo !== cfg.value.repo || prev.branch !== cfg.value.branch || prev.path !== cfg.value.path;
    const w = await this.store.setLocal(KEYS.syncConfig, cfg.value);
    if (!w.ok) return fail(w.error);
    if (targetChanged) {
      await this.store.setBase(null);
      await this.store.removeLocal(KEYS.syncState, KEYS.conflict);
    }
    return cfg;
  }
  async setAutoSync(enabled: boolean): Promise<Result<SyncConfig>> {
    const cfg = await this.getConfig();
    if (!cfg) return fail('Aucun dépôt n’est configuré.');
    const w = await this.store.setLocal(KEYS.syncConfig, { ...cfg, autoSync: enabled });
    return w.ok ? ok({ ...cfg, autoSync: enabled }) : fail(w.error);
  }
  /** Supprime uniquement le jeton de cet appareil. */
  async clearToken(): Promise<void> { await this.store.removeLocal(KEYS.secret); }
  /** Oublie le dépôt (configuration, état, base de fusion). Les données locales sont conservées ; le jeton aussi (voir clearToken). */
  async disconnect(): Promise<void> {
    await this.store.removeLocal(KEYS.syncConfig, KEYS.syncState, KEYS.conflict);
    await this.store.setBase(null);
  }

  // ---------- vérification des paramètres (sans rien enregistrer) ----------
  async testAccess(input: Partial<SyncConfig>, tokenInput?: string): Promise<AccessCheck[]> {
    const checks: AccessCheck[] = [];
    const cfg = validateSyncConfig(input);
    if (!cfg.ok) return [{ label: 'Paramètres', ok: false, detail: cfg.error }];
    checks.push({ label: 'Paramètres', ok: true, detail: `${cfg.value.owner}/${cfg.value.repo} • ${cfg.value.branch} • ${cfg.value.path}` });
    const token = tokenInput ? tokenInput.trim() : await this.getToken();
    if (!token) return [...checks, { label: 'Jeton', ok: false, detail: 'Aucun jeton enregistré.' }];
    const tv = validateToken(token);
    if (!tv.ok) return [...checks, { label: 'Jeton', ok: false, detail: tv.error }];
    checks.push({ label: 'Jeton', ok: true, detail: 'Format fine-grained valide.' });
    if (!this.isOnline()) return [...checks, { label: 'Réseau', ok: false, detail: 'Hors ligne : impossible de tester.' }];
    const client = this.createClient(token);
    try {
      const repo = await client.getRepo(cfg.value.owner, cfg.value.repo);
      checks.push({ label: 'Dépôt', ok: true, detail: `${repo.fullName} accessible.` });
      checks.push(repo.private
        ? { label: 'Confidentialité', ok: true, detail: 'Le dépôt est privé.' }
        : { label: 'Confidentialité', ok: false, detail: 'Ce dépôt est PUBLIC : vos données seraient visibles par tous. Utilisez un dépôt privé.' });
      if (!repo.private) return checks;
      if (repo.canPush === false) { checks.push({ label: 'Écriture', ok: false, detail: 'Le jeton n’a pas la permission d’écrire (Contents : Read and write).' }); return checks; }
      const file = await client.getFile(cfg.value);
      if (file === null) checks.push({ label: 'Fichier', ok: true, detail: 'Le fichier n’existe pas encore : il sera créé à la première synchronisation.' });
      else if (!file.notModified) {
        const parsed = parseRemoteDocument(file.content);
        if (!parsed.ok) checks.push({ label: 'Fichier', ok: false, detail: parsed.error });
        else { const c = countDocument(parsed.value); checks.push({ label: 'Fichier', ok: true, detail: `Données DinoStart valides : ${c.favorites} favoris, ${c.projects} projets, ${c.notes} notes, ${c.tasks} tâches.` }); }
      }
    } catch (e) {
      checks.push({ label: 'GitHub', ok: false, detail: this.describe(e, token) });
    }
    return checks;
  }

  private describe(e: unknown, token: string | null): string {
    if (e instanceof GithubError || e instanceof SyncFailure) return redact(e.message, token);
    return redact(e instanceof Error ? `Erreur inattendue : ${e.message}` : 'Erreur inattendue.', token);
  }

  // ---------- exécution protégée ----------
  private async guarded(job: (client: GithubClient, cfg: SyncConfig, token: string, state: SyncState) => Promise<SyncOutcome>): Promise<SyncOutcome> {
    if (this.running) return this.running;
    const p = (async (): Promise<SyncOutcome> => {
      const cfg = await this.getConfig();
      if (!cfg) return { status: 'unconfigured', message: 'Aucun dépôt n’est configuré.' };
      const token = await this.getToken();
      if (!token) return this.record({ status: 'error', message: 'Aucun jeton GitHub n’est enregistré sur cet appareil.' }, 'no-token');
      const state = await this.getState();
      if (state.rateLimitedUntil && Date.parse(state.rateLimitedUntil) > this.now()) {
        return { status: 'rate-limited', message: `GitHub limite temporairement les requêtes. Nouvelle tentative possible vers ${new Date(state.rateLimitedUntil).toLocaleTimeString('fr-FR')}.` };
      }
      if (!this.isOnline()) {
        await this.patchState({ status: 'offline' });
        return { status: 'offline', message: 'Vous êtes hors ligne. Vos modifications sont enregistrées localement et seront envoyées au retour du réseau.' };
      }
      await this.patchState({ status: 'syncing', lastAttemptAt: lastLocalIso(this.now()) });
      try {
        return await job(this.createClient(token), cfg, token, state);
      } catch (e) {
        return this.failWith(e, token);
      }
    })();
    this.running = p.finally(() => { this.running = null; });
    return this.running;
  }

  private async record(outcome: SyncOutcome, kind: string): Promise<SyncOutcome> {
    await this.patchState({ status: outcome.status, lastError: { kind, message: outcome.message, at: lastLocalIso(this.now()) } });
    return outcome;
  }

  private async failWith(e: unknown, token: string): Promise<SyncOutcome> {
    const message = this.describe(e, token);
    if (e instanceof GithubError) {
      if (e.kind === 'network') {
        await this.patchState({ status: 'offline', lastError: { kind: e.kind, message, at: lastLocalIso(this.now()) } });
        return { status: 'offline', message: `${message} Vos données locales sont intactes ; la synchronisation est en attente.` };
      }
      if (e.kind === 'rate-limit') {
        const until = lastLocalIso(this.now() + (e.retryAfterMs ?? 60_000));
        await this.patchState({ status: 'rate-limited', rateLimitedUntil: until, lastError: { kind: e.kind, message, at: lastLocalIso(this.now()) } });
        return { status: 'rate-limited', message: `${message} Nouvelle tentative possible vers ${new Date(until).toLocaleTimeString('fr-FR')}.` };
      }
      return this.record({ status: 'error', message }, e.kind);
    }
    if (e instanceof SyncFailure) return this.record({ status: e.status, message }, e.kind);
    return this.record({ status: 'error', message }, 'unknown');
  }

  // ---------- synchronisation ----------
  /** Synchronisation complète : lecture, validation, fusion, envoi si nécessaire. */
  sync(opts: { resolutions?: Record<string, Resolution> } = {}): Promise<SyncOutcome> {
    return this.guarded(async (client, cfg, _token, state0) => {
      let state = state0;
      if (!state.verifiedPrivate) {
        const repo = await client.getRepo(cfg.owner, cfg.repo);
        if (!repo.private) throw new SyncFailure('repo-public', 'Ce dépôt est public : la synchronisation est refusée pour protéger vos données. Utilisez un dépôt privé.');
        await this.patchState({ verifiedPrivate: true });
        state = { ...state, verifiedPrivate: true };
      }
      const resolutions = opts.resolutions ?? {};
      for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        const local = this.store.getDoc();
        const base = this.store.getBase();
        const canUseEtag = attempt === 1 && Boolean(state.lastEtag && state.lastRemoteSha && base);
        const got = await client.getFile(cfg, canUseEtag ? state.lastEtag : null);

        let remoteDoc: DinoDocument | null = null;
        let remoteSha: string | undefined;
        let remoteEtag: string | null = null;
        if (got === null) {
          remoteDoc = null;
        } else if (got.notModified) {
          remoteDoc = base; remoteSha = state.lastRemoteSha ?? undefined; remoteEtag = state.lastEtag;
        } else {
          const parsed = parseRemoteDocument(got.content);
          if (!parsed.ok) throw new SyncFailure('remote-invalid', parsed.error);
          remoteDoc = parsed.value; remoteSha = got.sha; remoteEtag = got.etag;
        }

        let merged = local;
        if (remoteDoc) {
          const result = mergeDocuments(base, local, remoteDoc, this.store.ctx(), resolutions);
          if (result.conflicts.length) return this.reportConflicts(result.conflicts);
          merged = result.merged;
        }

        if (!docEquals(local, merged)) {
          const b = await this.store.createBackup('Avant synchronisation : fusion avec le dépôt');
          if (!b.ok) throw new SyncFailure('local-save-failed', `Synchronisation interrompue : ${b.error}`);
        }

        if (remoteDoc && remoteSha && docEquals(merged, remoteDoc)) {
          await this.finish(local, merged, remoteSha, remoteEtag);
          return { status: this.store.dirty ? 'pending' : 'idle', message: docEquals(local, merged) ? 'Déjà à jour.' : 'Données distantes fusionnées avec les données locales.' };
        }

        try {
          const put = await client.putFile(cfg, serializeDocument(merged), remoteSha, `DinoStart : synchronisation ${lastLocalIso(this.now())}`);
          await this.finish(local, merged, put.sha, null);
          return { status: this.store.dirty ? 'pending' : 'idle', message: 'Synchronisation réussie.' };
        } catch (e) {
          if (e instanceof GithubError && e.kind === 'conflict') { state = { ...state, lastEtag: null }; continue; } // SHA périmé : relire et refusionner
          throw e;
        }
      }
      throw new SyncFailure('concurrent-writes', `Le fichier distant a été modifié ${MAX_ATTEMPTS} fois pendant la synchronisation (autre appareil en cours d’écriture ?). Rien n’a été perdu : réessayez dans un instant.`, 'conflict');
    });
  }

  /** Applique localement le résultat, mémorise l'état de référence et ne déclare le succès qu'à ce stade. */
  private async finish(startLocal: DinoDocument, merged: DinoDocument, sha: string, etag: string | null): Promise<void> {
    const base = await this.store.setBase(merged);
    if (!base.ok) throw new SyncFailure('local-save-failed', base.error);
    const applied = await this.store.mutate((cur, ctx) => {
      if (docEquals(cur, merged)) return ok(cur);
      if (docEquals(cur, startLocal)) return ok(merged);
      // Modifié par l'utilisateur pendant la synchronisation : ses changements récents sont conservés.
      const first = mergeDocuments(startLocal, cur, merged, ctx);
      const res = first.conflicts.length ? mergeDocuments(startLocal, cur, merged, ctx, Object.fromEntries(first.conflicts.map((c) => [c.key, 'local' as const]))) : first;
      return ok(res.merged);
    });
    if (!applied.ok) throw new SyncFailure('local-save-failed', `Les données distantes n’ont pas pu être enregistrées localement : ${applied.error}`);
    await this.store.removeLocal(KEYS.conflict);
    await this.patchState({ status: 'idle', lastSyncAt: lastLocalIso(this.now()), lastError: null, rateLimitedUntil: null, lastRemoteSha: sha, lastEtag: etag });
  }

  private async reportConflicts(conflicts: Conflict[]): Promise<SyncOutcome> {
    const previous = await this.getConflictState();
    const sig = (cs: Conflict[]) => cs.map((c) => c.key).sort().join('|');
    if (!previous || sig(previous.conflicts) !== sig(conflicts)) {
      const b = await this.store.createBackup('Copie locale avant résolution d’un conflit de synchronisation');
      if (!b.ok) throw new SyncFailure('local-save-failed', b.error);
    }
    await this.store.setLocal(KEYS.conflict, { at: lastLocalIso(this.now()), conflicts } satisfies ConflictState);
    const message = `${conflicts.length} élément${conflicts.length > 1 ? 's ont' : ' a'} été modifié${conflicts.length > 1 ? 's' : ''} différemment sur deux appareils. Choisissez la version à garder : rien n’a été écrasé.`;
    await this.patchState({ status: 'conflict', lastError: { kind: 'conflict', message, at: lastLocalIso(this.now()) } });
    return { status: 'conflict', message, conflicts };
  }

  // ---------- opérations explicites à sens unique ----------
  /** Lit le dépôt sans rien modifier (pour afficher ce qui serait remplacé). */
  async inspectRemote(): Promise<Result<RemoteInspection>> {
    const cfg = await this.getConfig(); const token = await this.getToken();
    if (!cfg || !token) return fail('Dépôt ou jeton non configuré.');
    if (!this.isOnline()) return fail('Vous êtes hors ligne.');
    try {
      const got = await this.createClient(token).getFile(cfg);
      if (got === null) return ok({ exists: false, counts: null, doc: null });
      if (got.notModified) return fail('Réponse inattendue du dépôt.');
      const parsed = parseRemoteDocument(got.content);
      return parsed.ok ? ok({ exists: true, counts: countDocument(parsed.value), doc: parsed.value }) : fail(parsed.error);
    } catch (e) { return fail(this.describe(e, token)); }
  }

  /** Remplace les données locales par celles du dépôt (après sauvegarde locale automatique). À n'utiliser qu'après confirmation. */
  pullReplace(): Promise<SyncOutcome> {
    return this.guarded(async (client, cfg) => {
      const got = await client.getFile(cfg);
      if (got === null) throw new SyncFailure('remote-missing', 'Aucun fichier de données n’existe encore dans le dépôt.');
      if (got.notModified) throw new SyncFailure('invalid-response', 'Réponse inattendue du dépôt.');
      const parsed = parseRemoteDocument(got.content);
      if (!parsed.ok) throw new SyncFailure('remote-invalid', parsed.error);
      const r = await this.store.replaceDocument(parsed.value, 'Avant remplacement par les données du dépôt GitHub');
      if (!r.ok) throw new SyncFailure('local-save-failed', r.error);
      const b = await this.store.setBase(parsed.value);
      if (!b.ok) throw new SyncFailure('local-save-failed', b.error);
      await this.store.removeLocal(KEYS.conflict);
      await this.patchState({ status: 'idle', lastSyncAt: lastLocalIso(this.now()), lastError: null, rateLimitedUntil: null, lastRemoteSha: got.sha, lastEtag: got.etag });
      return { status: 'idle', message: 'Données distantes téléchargées : les données locales ont été remplacées (une sauvegarde locale a été créée avant).' };
    });
  }

  /** Remplace le fichier distant par les données locales. L'ancienne version reste dans l'historique Git du dépôt. */
  pushReplace(): Promise<SyncOutcome> {
    return this.guarded(async (client, cfg) => {
      for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        const got = await client.getFile(cfg);
        if (got && got.notModified) throw new SyncFailure('invalid-response', 'Réponse inattendue du dépôt.');
        const local = this.store.getDoc();
        try {
          const put = await client.putFile(cfg, serializeDocument(local), got ? got.sha : undefined, `DinoStart : envoi des données locales ${lastLocalIso(this.now())}`);
          const b = await this.store.setBase(local);
          if (!b.ok) throw new SyncFailure('local-save-failed', b.error);
          await this.store.removeLocal(KEYS.conflict);
          await this.patchState({ status: 'idle', lastSyncAt: lastLocalIso(this.now()), lastError: null, rateLimitedUntil: null, lastRemoteSha: put.sha, lastEtag: null });
          return { status: 'idle', message: 'Données locales envoyées. L’ancienne version reste consultable dans l’historique Git du dépôt.' };
        } catch (e) {
          if (e instanceof GithubError && e.kind === 'conflict') continue;
          throw e;
        }
      }
      throw new SyncFailure('concurrent-writes', 'Le fichier distant change en permanence : envoi abandonné. Réessayez.', 'conflict');
    });
  }
}

export { DEFAULT_SYNC_CONFIG };
