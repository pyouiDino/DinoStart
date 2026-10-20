import { fail, ok, type Result } from '../core/types';
import { hasWhitespaceOrControl } from '../core/url';

export interface SyncConfig { owner: string; repo: string; branch: string; path: string; autoSync: boolean }

export type SyncStatus = 'unconfigured' | 'idle' | 'syncing' | 'pending' | 'offline' | 'error' | 'conflict' | 'rate-limited';

export interface SyncErrorInfo { kind: string; message: string; at: string }

export interface SyncState {
  status: SyncStatus;
  lastSyncAt: string | null;
  lastAttemptAt: string | null;
  lastError: SyncErrorInfo | null;
  rateLimitedUntil: string | null;
  /** SHA du fichier distant tel que connu après la dernière synchronisation réussie. */
  lastRemoteSha: string | null;
  lastEtag: string | null;
  /** Le dépôt a été vérifié comme privé pour cette configuration. */
  verifiedPrivate: boolean;
}

export const EMPTY_SYNC_STATE: SyncState = {
  status: 'unconfigured', lastSyncAt: null, lastAttemptAt: null, lastError: null, rateLimitedUntil: null, lastRemoteSha: null, lastEtag: null, verifiedPrivate: false,
};

export const DEFAULT_SYNC_CONFIG: SyncConfig = { owner: '', repo: '', branch: 'main', path: 'dinostart/data.json', autoSync: false };

export function validateSyncConfig(input: Partial<SyncConfig>): Result<SyncConfig> {
  const owner = (input.owner ?? '').trim();
  const repo = (input.repo ?? '').trim();
  const branch = (input.branch ?? '').trim();
  const path = (input.path ?? '').trim();
  if (!/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/.test(owner)) return fail('Propriétaire invalide : lettres, chiffres et tirets uniquement (39 caractères maximum).');
  if (!/^[A-Za-z0-9._-]{1,100}$/.test(repo) || repo === '.' || repo === '..') return fail('Nom de dépôt invalide : lettres, chiffres, « . », « - » et « _ » uniquement.');
  if (!branch || branch.length > 250 || /[\s~^:?*[\\]|\.\.|^\/|\/$|\/\/|\.lock$|@\{/.test(branch)) return fail('Nom de branche invalide.');
  if (!path || path.length > 200 || path.startsWith('/') || path.endsWith('/') || /(^|\/)\.\.?(\/|$)/.test(path) || /[\\?#]/.test(path) || hasWhitespaceOrControl(path)) {
    return fail('Chemin du fichier invalide : utilisez un chemin relatif comme dinostart/data.json.');
  }
  if (!path.toLowerCase().endsWith('.json')) return fail('Le fichier de données doit se terminer par .json.');
  return ok({ owner, repo, branch, path, autoSync: Boolean(input.autoSync) });
}

/** Seuls les jetons fine-grained (github_pat_…) sont acceptés : ils peuvent être limités à un seul dépôt. */
export function validateToken(input: string): Result<string> {
  const t = (input ?? '').trim();
  if (!t) return fail('Le jeton est vide.');
  if (/\s/.test(t)) return fail('Le jeton ne doit pas contenir d’espaces.');
  if (!t.startsWith('github_pat_')) return fail('Utilisez un jeton fine-grained (il commence par « github_pat_ »). Les jetons classiques donnent trop d’accès et sont refusés.');
  if (!/^[A-Za-z0-9_]{20,255}$/.test(t)) return fail('Le format du jeton est invalide.');
  return ok(t);
}

/** Retire toute occurrence du jeton d'un texte (messages d'erreur, journaux). */
export function redact(text: string, token?: string | null): string {
  let out = text;
  if (token) out = out.split(token).join('[jeton masqué]');
  return out.replace(/github_pat_[A-Za-z0-9_]+/g, '[jeton masqué]').replace(/gh[pousr]_[A-Za-z0-9]{20,}/g, '[jeton masqué]');
}
