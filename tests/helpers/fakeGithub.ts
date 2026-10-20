// Faux serveur GitHub (API contents) pour les tests automatisés UNIQUEMENT.
// Il applique les règles réelles qui comptent : authentification, SHA obligatoire pour modifier, 404/409/422, ETag, limites de débit.
export const TEST_TOKEN = 'github_pat_11TESTTOKEN0123456789_abcdefghijklmnopqrstuvwxyz';

interface FileEntry { content: string; sha: string }
export interface RecordedRequest { method: string; url: string; headers: Record<string, string>; body: unknown }

export class FakeGithub {
  isPrivate = true;
  canPush = true;
  branches = new Set(['main']);
  repoExists = true;
  files = new Map<string, FileEntry>(); // clé : branche:chemin
  requests: RecordedRequest[] = [];
  expectedToken = TEST_TOKEN;
  offline = false;
  /** Réponses forcées, consommées dans l'ordre pour les prochaines requêtes. */
  forced: Array<(req: RecordedRequest) => Response | null> = [];
  /** Appelé juste avant le traitement d'un PUT (simule un autre appareil qui écrit entre-temps). */
  beforePut: ((req: RecordedRequest) => void) | null = null;
  private counter = 0;
  readonly owner: string;
  readonly repo: string;

  constructor(owner = 'moi', repo = 'dinostart-data') { this.owner = owner; this.repo = repo; }

  private nextSha() { return `sha${(++this.counter).toString().padStart(6, '0')}`; }
  private json(status: number, body: unknown, headers: Record<string, string> = {}) {
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
  }
  fileKey(branch: string, path: string) { return `${branch}:${path}`; }
  getFileContent(path = 'dinostart/data.json', branch = 'main'): string | undefined { return this.files.get(this.fileKey(branch, path))?.content; }
  setFile(content: string, path = 'dinostart/data.json', branch = 'main') { this.files.set(this.fileKey(branch, path), { content, sha: this.nextSha() }); }
  putCount() { return this.requests.filter((r) => r.method === 'PUT').length; }
  getCount() { return this.requests.filter((r) => r.method === 'GET').length; }

  fetch: typeof fetch = async (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    const headers: Record<string, string> = {};
    new Headers(init?.headers).forEach((v, k) => { headers[k.toLowerCase()] = v; });
    const method = (init?.method ?? 'GET').toUpperCase();
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
    const req: RecordedRequest = { method, url: url.href, headers, body };
    this.requests.push(req);
    if (this.offline) throw new TypeError('Failed to fetch');
    if (url.host !== 'api.github.com') throw new Error(`Requête vers un domaine non autorisé : ${url.host}`);
    const forcedFn = this.forced.shift();
    if (forcedFn) { const r = forcedFn(req); if (r) return r; }

    if (headers.authorization !== `Bearer ${this.expectedToken}`) return this.json(401, { message: 'Bad credentials' });
    const m = url.pathname.match(/^\/repos\/([^/]+)\/([^/]+)(?:\/contents\/(.+))?$/);
    if (!m) return this.json(404, { message: 'Not Found' });
    const [, owner, repo, rawPath] = m;
    if (!this.repoExists || owner !== this.owner || repo !== this.repo) return this.json(404, { message: 'Not Found' });
    if (rawPath === undefined) {
      return this.json(200, { private: this.isPrivate, full_name: `${owner}/${repo}`, default_branch: 'main', permissions: { push: this.canPush } });
    }
    const path = rawPath.split('/').map(decodeURIComponent).join('/');
    const branch = method === 'GET' ? url.searchParams.get('ref') ?? 'main' : String((body as { branch?: string } | undefined)?.branch ?? 'main');
    if (!this.branches.has(branch)) return this.json(404, { message: `No commit found for the ref ${branch}` });
    const key = this.fileKey(branch, path);

    if (method === 'GET') {
      const f = this.files.get(key);
      if (!f) return this.json(404, { message: 'Not Found' });
      const etag = `"etag-${f.sha}"`;
      if (headers['if-none-match'] === etag) return new Response(null, { status: 304, headers: { etag } });
      const buf = Buffer.from(f.content, 'utf8');
      if (headers.accept?.includes('raw')) return new Response(f.content, { status: 200, headers: { etag } });
      return this.json(200, { type: 'file', sha: f.sha, size: buf.length, encoding: 'base64', content: buf.toString('base64').replace(/(.{60})/g, '$1\n') }, { etag });
    }
    if (method === 'PUT') {
      this.beforePut?.(req);
      const b = body as { content: string; sha?: string; message: string };
      if (!b || typeof b.content !== 'string' || typeof b.message !== 'string') return this.json(422, { message: 'Invalid request.' });
      const existing = this.files.get(key);
      if (existing && !b.sha) return this.json(422, { message: "Invalid request. \"sha\" wasn't supplied." });
      if (existing && b.sha !== existing.sha) return this.json(409, { message: `${path} does not match ${existing.sha}` });
      if (!existing && b.sha) return this.json(422, { message: 'sha does not match a file' });
      const sha = this.nextSha();
      this.files.set(key, { content: Buffer.from(b.content, 'base64').toString('utf8'), sha });
      return this.json(existing ? 200 : 201, { content: { sha }, commit: { sha: `commit${sha}` } });
    }
    return this.json(405, { message: 'Method not allowed' });
  };
}

export const rateLimited = (status: 403 | 429, headers: Record<string, string>) => (): Response =>
  new Response(JSON.stringify({ message: 'API rate limit exceeded' }), { status, headers: { 'content-type': 'application/json', ...headers } });
