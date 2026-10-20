// Client minimal de l'API REST GitHub (contenu d'un fichier). Seul domaine contacté : api.github.com.
import { redact, type SyncConfig } from './config';

export const GITHUB_API = 'https://api.github.com';

export type GithubErrorKind =
  | 'network' | 'unauthorized' | 'forbidden' | 'rate-limit' | 'repo-not-found' | 'branch-not-found'
  | 'conflict' | 'validation' | 'server' | 'invalid-response';

export class GithubError extends Error {
  constructor(readonly kind: GithubErrorKind, message: string, readonly status?: number, readonly retryAfterMs?: number) {
    super(message);
    this.name = 'GithubError';
  }
}

export interface RemoteFile { sha: string; content: string; etag: string | null }
export type GetFileResult = { notModified: true } | ({ notModified: false } & RemoteFile) | null;
export interface PutResult { sha: string; commitSha: string }
export interface RepoInfo { private: boolean; fullName: string; defaultBranch: string; canPush: boolean | null }

type FetchLike = typeof fetch;
export interface GithubClientOptions { token: string; fetchImpl?: FetchLike; now?: () => number; timeoutMs?: number }

const utf8 = new TextDecoder('utf-8', { fatal: true });
export function decodeBase64Utf8(b64: string): string {
  const bin = atob(b64.replace(/\s/g, ''));
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return utf8.decode(bytes);
}
export function encodeBase64Utf8(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

const encodePath = (p: string) => p.split('/').map(encodeURIComponent).join('/');

export class GithubClient {
  private readonly token: string;
  private readonly fetchImpl: FetchLike;
  private readonly now: () => number;
  private readonly timeoutMs: number;

  constructor(opts: GithubClientOptions) {
    this.token = opts.token;
    this.fetchImpl = opts.fetchImpl ?? ((...a) => fetch(...a));
    this.now = opts.now ?? Date.now;
    this.timeoutMs = opts.timeoutMs ?? 20_000;
  }

  private async request(method: string, path: string, init: { body?: unknown; accept?: string; etag?: string | null } = {}): Promise<Response> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.token}`,
      Accept: init.accept ?? 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    };
    if (init.body !== undefined) headers['Content-Type'] = 'application/json';
    if (init.etag) headers['If-None-Match'] = init.etag;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.timeoutMs);
    try {
      // L'URL est toujours construite à partir de GITHUB_API : le jeton ne part jamais ailleurs.
      return await this.fetchImpl(`${GITHUB_API}${path}`, {
        method, headers, signal: ctrl.signal, cache: 'no-store', credentials: 'omit', redirect: 'error',
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
      });
    } catch (e) {
      const aborted = e instanceof DOMException && e.name === 'AbortError';
      throw new GithubError('network', aborted ? 'GitHub ne répond pas (délai dépassé).' : 'Connexion à GitHub impossible (réseau indisponible ?).');
    } finally {
      clearTimeout(timer);
    }
  }

  private async errorFrom(res: Response): Promise<GithubError> {
    let message = '';
    try { const j = (await res.json()) as { message?: unknown }; if (typeof j.message === 'string') message = redact(j.message.slice(0, 300), this.token); } catch { /* corps non JSON */ }
    const status = res.status;
    const retryAfter = res.headers.get('retry-after');
    const remaining = res.headers.get('x-ratelimit-remaining');
    const reset = res.headers.get('x-ratelimit-reset');
    const limited = status === 429 || (status === 403 && (retryAfter !== null || remaining === '0' || /rate limit|abuse|secondary/i.test(message)));
    if (limited) {
      let wait = 60_000;
      if (retryAfter && Number.isFinite(Number(retryAfter))) wait = Number(retryAfter) * 1000;
      else if (reset && Number.isFinite(Number(reset))) wait = Math.max(1000, Number(reset) * 1000 - this.now());
      return new GithubError('rate-limit', 'GitHub limite temporairement les requêtes.', status, Math.min(wait, 3_600_000));
    }
    if (status === 401) return new GithubError('unauthorized', 'Jeton refusé ou expiré (401).', status);
    if (status === 403) return new GithubError('forbidden', `Accès refusé (403)${message ? ` : ${message}` : ''}. Vérifiez la permission « Contents » du jeton.`, status);
    if (status === 409) return new GithubError('conflict', 'Le fichier a changé pendant l’envoi (409).', status);
    if (status === 422) {
      const shaIssue = /sha/i.test(message);
      return new GithubError(shaIssue ? 'conflict' : 'validation', shaIssue ? 'Le fichier distant a été modifié (SHA obsolète, 422).' : `Requête refusée par GitHub (422)${message ? ` : ${message}` : ''}.`, status);
    }
    if (status >= 500) return new GithubError('server', `GitHub est indisponible (${status}).`, status);
    return new GithubError('invalid-response', `Réponse inattendue de GitHub (${status}).`, status);
  }

  /** Vérifie l'accès au dépôt et renvoie ses informations. */
  async getRepo(owner: string, repo: string): Promise<RepoInfo> {
    const res = await this.request('GET', `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`);
    if (res.status === 404) throw new GithubError('repo-not-found', 'Dépôt introuvable, ou jeton sans accès à ce dépôt (404).', 404);
    if (!res.ok) throw await this.errorFrom(res);
    const j = (await res.json().catch(() => null)) as { private?: unknown; full_name?: unknown; default_branch?: unknown; permissions?: { push?: unknown } } | null;
    if (!j || typeof j.private !== 'boolean' || typeof j.full_name !== 'string') throw new GithubError('invalid-response', 'Réponse GitHub illisible pour ce dépôt.');
    return { private: j.private, fullName: j.full_name, defaultBranch: typeof j.default_branch === 'string' ? j.default_branch : 'main', canPush: typeof j.permissions?.push === 'boolean' ? j.permissions.push : null };
  }

  /** Lit le fichier ; `null` s'il n'existe pas encore. `notModified` si l'ETag fourni est toujours valable. */
  async getFile(cfg: SyncConfig, etag?: string | null): Promise<GetFileResult> {
    const base = `/repos/${encodeURIComponent(cfg.owner)}/${encodeURIComponent(cfg.repo)}/contents/${encodePath(cfg.path)}`;
    const q = `?ref=${encodeURIComponent(cfg.branch)}`;
    const res = await this.request('GET', base + q, { etag });
    if (res.status === 304) return { notModified: true };
    if (res.status === 404) {
      const j = (await res.json().catch(() => ({}))) as { message?: unknown };
      if (typeof j.message === 'string' && /no commit found for the ref|branch not found/i.test(j.message)) {
        throw new GithubError('branch-not-found', `La branche « ${cfg.branch} » n’existe pas dans ce dépôt.`, 404);
      }
      await this.getRepo(cfg.owner, cfg.repo); // lève repo-not-found si le dépôt est inaccessible
      return null;
    }
    if (!res.ok) throw await this.errorFrom(res);
    const j = (await res.json().catch(() => null)) as { type?: unknown; sha?: unknown; content?: unknown; encoding?: unknown; size?: unknown } | null;
    if (!j || Array.isArray(j) || j.type !== 'file' || typeof j.sha !== 'string') throw new GithubError('invalid-response', 'Le chemin indiqué n’est pas un fichier.');
    const responseEtag = res.headers.get('etag');
    let content: string;
    if (j.encoding === 'base64' && typeof j.content === 'string' && (j.content.length > 0 || j.size === 0)) {
      try { content = decodeBase64Utf8(j.content); } catch { throw new GithubError('invalid-response', 'Le contenu du fichier distant n’est pas du texte UTF-8 valide.'); }
    } else {
      // Fichier de plus de 1 Mo : l'API renvoie le contenu brut avec ce type de média.
      const raw = await this.request('GET', base + q, { accept: 'application/vnd.github.raw+json' });
      if (!raw.ok) throw await this.errorFrom(raw);
      content = await raw.text();
    }
    return { notModified: false, sha: j.sha, content, etag: responseEtag };
  }

  /** Crée (sans sha) ou met à jour (avec sha) le fichier. La réussite n'est affirmée qu'après vérification de la réponse. */
  async putFile(cfg: SyncConfig, content: string, sha: string | undefined, message: string): Promise<PutResult> {
    const path = `/repos/${encodeURIComponent(cfg.owner)}/${encodeURIComponent(cfg.repo)}/contents/${encodePath(cfg.path)}`;
    const body: Record<string, unknown> = { message, content: encodeBase64Utf8(content), branch: cfg.branch };
    if (sha) body.sha = sha;
    const res = await this.request('PUT', path, { body });
    if (res.status === 404) {
      const j = (await res.json().catch(() => ({}))) as { message?: unknown };
      if (typeof j.message === 'string' && /branch/i.test(j.message)) throw new GithubError('branch-not-found', `La branche « ${cfg.branch} » n’existe pas dans ce dépôt.`, 404);
      throw new GithubError('repo-not-found', 'Dépôt introuvable, ou jeton sans permission d’écriture sur le contenu (404).', 404);
    }
    if (res.status !== 200 && res.status !== 201) throw await this.errorFrom(res);
    const j = (await res.json().catch(() => null)) as { content?: { sha?: unknown }; commit?: { sha?: unknown } } | null;
    const newSha = j?.content?.sha, commitSha = j?.commit?.sha;
    if (typeof newSha !== 'string' || typeof commitSha !== 'string') {
      throw new GithubError('invalid-response', 'GitHub a répondu sans confirmer l’enregistrement : l’envoi n’est pas considéré comme réussi.');
    }
    return { sha: newSha, commitSha };
  }
}
