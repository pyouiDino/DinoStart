import { describe, expect, it } from 'vitest';
import { GithubClient, GithubError, decodeBase64Utf8, encodeBase64Utf8 } from '../../src/sync/githubClient';
import { validateSyncConfig, validateToken, redact } from '../../src/sync/config';
import { FakeGithub, TEST_TOKEN, rateLimited } from '../helpers/fakeGithub';

const cfg = { owner: 'moi', repo: 'dinostart-data', branch: 'main', path: 'dinostart/data.json', autoSync: false };
const mk = (gh: FakeGithub, token = TEST_TOKEN, now = () => 1_700_000_000_000) => new GithubClient({ token, fetchImpl: gh.fetch, now });
const kindOf = async (p: Promise<unknown>) => { try { await p; return 'ok'; } catch (e) { return e instanceof GithubError ? e.kind : `autre:${String(e)}`; } };

describe('client GitHub : lecture', () => {
  it('lit un fichier existant (UTF-8 accentué compris) et renvoie son SHA', async () => {
    const gh = new FakeGithub(); gh.setFile('{"titre":"Équipe ☀ é à ñ 日本"}\n');
    const f = await mk(gh).getFile(cfg);
    expect(f).toMatchObject({ notModified: false, content: '{"titre":"Équipe ☀ é à ñ 日本"}\n' });
    expect(f && !f.notModified && f.sha).toMatch(/^sha/);
    expect(gh.requests[0]!.headers.authorization).toBe(`Bearer ${TEST_TOKEN}`);
    expect(gh.requests[0]!.url).toContain('https://api.github.com/repos/moi/dinostart-data/contents/dinostart/data.json?ref=main');
  });
  it('renvoie null si le fichier n’existe pas encore (dépôt accessible)', async () => {
    expect(await mk(new FakeGithub()).getFile(cfg)).toBeNull();
  });
  it('304 : non modifié avec ETag', async () => {
    const gh = new FakeGithub(); gh.setFile('{}');
    const first = await mk(gh).getFile(cfg);
    const etag = first && !first.notModified ? first.etag : null;
    expect(etag).toBeTruthy();
    expect(await mk(gh).getFile(cfg, etag)).toEqual({ notModified: true });
  });
  it('401 jeton invalide', async () => expect(await kindOf(mk(new FakeGithub(), 'github_pat_MAUVAIS000000000000000').getFile(cfg))).toBe('unauthorized'));
  it('404 dépôt introuvable ou inaccessible', async () => {
    const gh = new FakeGithub(); gh.repoExists = false;
    expect(await kindOf(mk(gh).getFile(cfg))).toBe('repo-not-found');
  });
  it('404 branche inexistante', async () => expect(await kindOf(mk(new FakeGithub()).getFile({ ...cfg, branch: 'inconnue' }))).toBe('branch-not-found'));
  it('403 permission insuffisante', async () => {
    const gh = new FakeGithub();
    gh.forced.push(() => new Response(JSON.stringify({ message: 'Resource not accessible by personal access token' }), { status: 403 }));
    expect(await kindOf(mk(gh).getFile(cfg))).toBe('forbidden');
  });
  it('403 avec quota épuisé = limitation de débit avec délai issu de x-ratelimit-reset', async () => {
    const gh = new FakeGithub();
    gh.forced.push(rateLimited(403, { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String(1_700_000_000 + 120) }));
    try { await mk(gh).getFile(cfg); throw new Error('aurait dû échouer'); } catch (e) {
      expect(e).toBeInstanceOf(GithubError);
      expect((e as GithubError).kind).toBe('rate-limit');
      expect((e as GithubError).retryAfterMs).toBe(120_000);
    }
  });
  it('429 avec retry-after', async () => {
    const gh = new FakeGithub(); gh.forced.push(rateLimited(429, { 'retry-after': '45' }));
    try { await mk(gh).getFile(cfg); } catch (e) { expect((e as GithubError).kind).toBe('rate-limit'); expect((e as GithubError).retryAfterMs).toBe(45_000); }
  });
  it('erreur réseau et délai dépassé', async () => {
    const gh = new FakeGithub(); gh.offline = true;
    expect(await kindOf(mk(gh).getFile(cfg))).toBe('network');
  });
  it('5xx = serveur indisponible ; réponse illisible = invalid-response', async () => {
    const gh = new FakeGithub(); gh.forced.push(() => new Response('oups', { status: 503 }));
    expect(await kindOf(mk(gh).getFile(cfg))).toBe('server');
    gh.setFile('{}'); gh.forced.push(() => new Response('pas du json', { status: 200 }));
    expect(await kindOf(mk(gh).getFile(cfg))).toBe('invalid-response');
  });
  it('ne contacte que api.github.com avec le jeton', async () => {
    const gh = new FakeGithub(); gh.setFile('{}');
    await mk(gh).getFile(cfg);
    for (const r of gh.requests) expect(new URL(r.url).host).toBe('api.github.com');
  });
});

describe('client GitHub : écriture', () => {
  it('crée un fichier (201) puis le met à jour avec le SHA (200)', async () => {
    const gh = new FakeGithub(); const c = mk(gh);
    const created = await c.putFile(cfg, '{"v":1}', undefined, 'msg');
    expect(created.sha).toMatch(/^sha/);
    expect(gh.getFileContent()).toBe('{"v":1}');
    const updated = await c.putFile(cfg, '{"v":2}', created.sha, 'msg2');
    expect(updated.sha).not.toBe(created.sha);
    expect(gh.getFileContent()).toBe('{"v":2}');
    const body = gh.requests.at(-1)!.body as { sha: string; branch: string; content: string };
    expect(body).toMatchObject({ sha: created.sha, branch: 'main' });
    expect(decodeBase64Utf8(body.content)).toBe('{"v":2}');
  });
  it('409 : SHA périmé = conflit', async () => {
    const gh = new FakeGithub(); gh.setFile('{}');
    expect(await kindOf(mk(gh).putFile(cfg, '{"x":1}', 'sha-perime', 'm'))).toBe('conflict');
  });
  it('422 : SHA manquant sur fichier existant = conflit ; autre 422 = validation', async () => {
    const gh = new FakeGithub(); gh.setFile('{}');
    expect(await kindOf(mk(gh).putFile(cfg, '{}', undefined, 'm'))).toBe('conflict');
    gh.forced.push(() => new Response(JSON.stringify({ message: 'Invalid request: content is too large' }), { status: 422 }));
    expect(await kindOf(mk(gh).putFile(cfg, '{}', 'x', 'm'))).toBe('validation');
  });
  it('401, 403 limite, 404, réseau sur PUT', async () => {
    expect(await kindOf(mk(new FakeGithub(), 'github_pat_MAUVAIS000000000000000').putFile(cfg, '{}', undefined, 'm'))).toBe('unauthorized');
    const gh = new FakeGithub(); gh.forced.push(rateLimited(429, { 'retry-after': '10' }));
    expect(await kindOf(mk(gh).putFile(cfg, '{}', undefined, 'm'))).toBe('rate-limit');
    const gh2 = new FakeGithub(); gh2.repoExists = false;
    expect(await kindOf(mk(gh2).putFile(cfg, '{}', undefined, 'm'))).toBe('repo-not-found');
    const gh3 = new FakeGithub(); gh3.offline = true;
    expect(await kindOf(mk(gh3).putFile(cfg, '{}', undefined, 'm'))).toBe('network');
  });
  it('ne déclare PAS le succès si la réponse 200 ne confirme pas l’enregistrement', async () => {
    const gh = new FakeGithub();
    gh.forced.push(() => new Response(JSON.stringify({ ok: true }), { status: 200 }));
    expect(await kindOf(mk(gh).putFile(cfg, '{}', undefined, 'm'))).toBe('invalid-response');
    gh.forced.push(() => new Response(null, { status: 204 }));
    expect(await kindOf(mk(gh).putFile(cfg, '{}', undefined, 'm'))).toBe('invalid-response');
  });
  it('encode/décode le base64 UTF-8 sur de gros contenus', () => {
    const big = 'é☀日本'.repeat(50_000);
    expect(decodeBase64Utf8(encodeBase64Utf8(big))).toBe(big);
  });
  it('vérifie les informations du dépôt', async () => {
    const gh = new FakeGithub(); gh.isPrivate = false;
    expect(await mk(gh).getRepo('moi', 'dinostart-data')).toMatchObject({ private: false, canPush: true });
  });
});

describe('configuration et jeton', () => {
  it('valide la configuration', () => {
    expect(validateSyncConfig({ owner: 'moi', repo: 'dinostart-data', branch: 'main', path: 'dinostart/data.json' }).ok).toBe(true);
    for (const bad of [
      { owner: '', repo: 'r', branch: 'main', path: 'a.json' }, { owner: 'a b', repo: 'r', branch: 'main', path: 'a.json' },
      { owner: 'o', repo: '..', branch: 'main', path: 'a.json' }, { owner: 'o', repo: 'r', branch: 'a..b', path: 'a.json' },
      { owner: 'o', repo: 'r', branch: 'main', path: '../secret.json' }, { owner: 'o', repo: 'r', branch: 'main', path: '/abs.json' },
      { owner: 'o', repo: 'r', branch: 'main', path: 'data.txt' }, { owner: 'o', repo: 'r', branch: 'main', path: 'a/../../b.json' },
    ]) expect(validateSyncConfig(bad).ok).toBe(false);
  });
  it('n’accepte que les jetons fine-grained', () => {
    expect(validateToken(TEST_TOKEN).ok).toBe(true);
    expect(validateToken('ghp_abcdefghijklmnopqrstuvwxyz0123456789').ok).toBe(false);
    expect(validateToken('').ok).toBe(false);
    expect(validateToken('github_pat_ avec espace 12345678901234567890').ok).toBe(false);
  });
  it('masque les jetons dans les messages', () => {
    expect(redact(`Erreur avec ${TEST_TOKEN} ici`, TEST_TOKEN)).not.toContain('TESTTOKEN');
    expect(redact('x github_pat_ABCDEFGHIJKLMNOPQRSTUVWXYZ y')).toBe('x [jeton masqué] y');
  });
});
