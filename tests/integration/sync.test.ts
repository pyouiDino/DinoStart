import { beforeEach, describe, expect, it } from 'vitest';
import { live, updateNote, updateFavorite, deleteFavorite } from '../../src/core/ops';
import { docEquals } from '../../src/core/docutil';
import { KEYS } from '../../src/storage/store';
import { parseRemoteDocument } from '../../src/sync/syncEngine';
import { FakeGithub, TEST_TOKEN, rateLimited } from '../helpers/fakeGithub';
import { CONFIG, addFav, addNoteTo, addTaskTo, makeClock, makeDevice, mustOk, type Device } from '../helpers/device';

let gh: FakeGithub;
let clock: () => string;
let A: Device, B: Device;
beforeEach(async () => {
  gh = new FakeGithub();
  clock = makeClock();
  A = await makeDevice('A', gh, clock);
  B = await makeDevice('B', gh, clock);
});
const titles = (d: Device) => live(d.store.getDoc().favorites).map((f) => f.title).sort();

describe('création et mise à jour du fichier distant', () => {
  it('crée le fichier distant lors de la première synchronisation (sans SHA)', async () => {
    await addFav(A, 'Un');
    const r = await A.engine.sync();
    expect(r.status).toBe('idle');
    const put = gh.requests.find((q) => q.method === 'PUT')!;
    expect((put.body as { sha?: string }).sha).toBeUndefined();
    const remote = parseRemoteDocument(gh.getFileContent()!);
    expect(remote.ok && live(remote.value.favorites).map((f) => f.title)).toEqual(['Un']);
    const st = await A.engine.getState();
    expect(st).toMatchObject({ status: 'idle', lastError: null });
    expect(st.lastSyncAt).not.toBeNull();
    expect(st.lastRemoteSha).toMatch(/^sha/);
  });

  it('met à jour avec le SHA courant et ne recommit pas si rien n’a changé', async () => {
    await addFav(A, 'Un'); await A.engine.sync();
    const sha1 = (await A.engine.getState()).lastRemoteSha;
    await addFav(A, 'Deux'); await A.engine.sync();
    const puts = gh.requests.filter((q) => q.method === 'PUT');
    expect(puts).toHaveLength(2);
    expect((puts[1]!.body as { sha: string }).sha).toBe(sha1);
    const before = gh.putCount();
    const r = await A.engine.sync();
    expect(gh.putCount()).toBe(before);
    expect(r.message).toMatch(/à jour/);
  });

  it('une synchronisation sans changement utilise l’ETag (304) au lieu de retélécharger', async () => {
    await addFav(A, 'Un'); await A.engine.sync();
    await A.engine.sync(); // lit et mémorise l'ETag
    await A.engine.sync();
    const gets = gh.requests.filter((q) => q.method === 'GET' && q.url.includes('/contents/'));
    expect(gets.at(-1)!.headers['if-none-match']).toBeTruthy();
    expect(gh.putCount()).toBe(1);
  });

  it('le fichier envoyé ne contient jamais le jeton ; seul api.github.com est contacté avec le jeton', async () => {
    await addFav(A, 'Un'); await A.engine.sync();
    expect(gh.getFileContent()).not.toContain('github_pat_');
    for (const r of gh.requests) { expect(new URL(r.url).host).toBe('api.github.com'); expect(JSON.stringify(r.body ?? {})).not.toContain(TEST_TOKEN); }
  });
});

describe('deux appareils', () => {
  it('le 2e PC récupère les données du 1er (installation sur un deuxième PC)', async () => {
    await addFav(A, 'Depuis A'); await addNoteTo(A, 'Note A', 'x'); await A.engine.sync();
    const r = await B.engine.sync();
    expect(r.status).toBe('idle');
    expect(titles(B)).toEqual(['Depuis A']);
    expect(live(B.store.getDoc().notes)[0]!.title).toBe('Note A');
    expect(docEquals(A.store.getDoc(), B.store.getDoc())).toBe(true);
  });

  it('fusionne des modifications indépendantes des deux PC sans rien perdre', async () => {
    await addFav(A, 'Base'); await A.engine.sync(); await B.engine.sync();
    await addFav(A, 'Ajout A'); await addNoteTo(B, 'Note B', 'contenu');
    await A.engine.sync();            // A pousse
    const rb = await B.engine.sync(); // B fusionne puis pousse
    expect(rb.status).toBe('idle');
    await A.engine.sync();
    expect(titles(A)).toEqual(['Ajout A', 'Base']);
    expect(titles(B)).toEqual(['Ajout A', 'Base']);
    expect(live(A.store.getDoc().notes).map((n) => n.title)).toEqual(['Note B']);
    expect(docEquals(A.store.getDoc(), B.store.getDoc())).toBe(true);
    expect(await B.store.listBackups()).not.toHaveLength(0); // copie locale avant application de changements distants
  });

  it('modifications de champs différents du même favori : fusion automatique', async () => {
    const id = await addFav(A, 'Titre', 'https://a.fr'); await A.engine.sync(); await B.engine.sync();
    await A.store.mutate((d, c) => updateFavorite(d, c, id, { title: 'Titre A' }));
    await B.store.mutate((d, c) => updateFavorite(d, c, id, { url: 'https://b.fr' }));
    await A.engine.sync(); await B.engine.sync(); await A.engine.sync();
    for (const d of [A, B]) expect(d.store.getDoc().favorites[0]).toMatchObject({ title: 'Titre A', url: 'https://b.fr/' });
  });

  it('une suppression sur A disparaît sur B et ne réapparaît jamais', async () => {
    const id = await addFav(A, 'À supprimer'); await addFav(A, 'Reste');
    await A.engine.sync(); await B.engine.sync();
    expect(titles(B)).toEqual(['Reste', 'À supprimer']);
    await A.store.mutate((d, c) => deleteFavorite(d, c, id));
    await A.engine.sync(); await B.engine.sync();
    expect(titles(B)).toEqual(['Reste']);
    await addFav(B, 'Autre'); await B.engine.sync(); await A.engine.sync();
    expect(titles(A)).toEqual(['Autre', 'Reste']);
    expect(titles(B)).toEqual(['Autre', 'Reste']);
  });

  it('suppression sur A + modification sur B : conflit explicite, rien n’est écrasé', async () => {
    const id = await addFav(A, 'Cible'); await A.engine.sync(); await B.engine.sync();
    await A.store.mutate((d, c) => deleteFavorite(d, c, id));
    await B.store.mutate((d, c) => updateFavorite(d, c, id, { title: 'Cible modifiée' }));
    await A.engine.sync();
    const remoteBefore = gh.getFileContent();
    const r = await B.engine.sync();
    expect(r.status).toBe('conflict');
    expect(r.conflicts?.[0]).toMatchObject({ kind: 'delete-edit' });
    expect(gh.getFileContent()).toBe(remoteBefore);             // distant intact
    expect(titles(B)).toEqual(['Cible modifiée']);              // local intact
    const res = await B.engine.sync({ resolutions: { [`favorites:${id}`]: 'local' } });
    expect(res.status).toBe('idle');
    await A.engine.sync();
    expect(titles(A)).toEqual(['Cible modifiée']);
  });
});

describe('conflits sur un même élément', () => {
  async function setupConflict() {
    const id = await addNoteTo(A, 'Note', 'départ'); await A.engine.sync(); await B.engine.sync();
    await A.store.mutate((d, c) => updateNote(d, c, id, { content: 'version de A' }));
    await B.store.mutate((d, c) => updateNote(d, c, id, { content: 'version de B' }));
    await A.engine.sync();
    return id;
  }
  it('est détecté, sans écriture, avec copie locale conservée et état persistant', async () => {
    const id = await setupConflict();
    const putsBefore = gh.putCount();
    const r = await B.engine.sync();
    expect(r.status).toBe('conflict');
    expect(r.conflicts).toHaveLength(1);
    expect(gh.putCount()).toBe(putsBefore);
    expect(live(B.store.getDoc().notes)[0]!.content).toBe('version de B');
    const saved = await B.engine.getConflictState();
    expect(saved?.conflicts[0]).toMatchObject({ key: `notes:${id}` });
    const backups = await B.store.listBackups();
    expect(backups.some((b) => b.reason.includes('conflit') && live(b.doc.notes)[0]!.content === 'version de B')).toBe(true);
    expect((await B.engine.getState()).status).toBe('conflict');
  });
  it('résolu en gardant la version locale : propagé à l’autre PC', async () => {
    const id = await setupConflict();
    await B.engine.sync();
    const r = await B.engine.sync({ resolutions: { [`notes:${id}`]: 'local' } });
    expect(r.status).toBe('idle');
    expect(await B.engine.getConflictState()).toBeNull();
    await A.engine.sync();
    expect(live(A.store.getDoc().notes)[0]!.content).toBe('version de B');
  });
  it('résolu en gardant la version distante', async () => {
    const id = await setupConflict();
    await B.engine.sync();
    await B.engine.sync({ resolutions: { [`notes:${id}`]: 'remote' } });
    expect(live(B.store.getDoc().notes)[0]!.content).toBe('version de A');
  });
});

describe('modifications concurrentes (SHA périmé)', () => {
  it('relit, refusionne et réessaie quand un autre appareil écrit entre la lecture et l’écriture', async () => {
    await addFav(A, 'Base'); await A.engine.sync(); await B.engine.sync();
    await addFav(B, 'De B');
    let injected = false;
    gh.beforePut = async () => undefined;
    gh.beforePut = () => {
      if (injected) return; injected = true;
      // A écrit « en même temps » : on simule en modifiant directement le fichier distant.
      const cur = parseRemoteDocument(gh.getFileContent()!); if (!cur.ok) throw new Error('x');
      const concurrent = { ...cur.value, favorites: [...cur.value.favorites, { ...cur.value.favorites[0]!, id: 'concurrent-1', title: 'Écrit par A pendant ce temps', createdAt: clock(), updatedAt: clock(), origin: 'A-x' }] };
      gh.setFile(JSON.stringify(concurrent, null, 2));
    };
    const r = await B.engine.sync();
    expect(r.status).toBe('idle');
    expect(gh.putCount()).toBe(2 + 1);
    expect(titles(B)).toEqual(['Base', 'De B', 'Écrit par A pendant ce temps']);
    const remote = parseRemoteDocument(gh.getFileContent()!);
    expect(remote.ok && live(remote.value.favorites).map((f) => f.title).sort()).toEqual(['Base', 'De B', 'Écrit par A pendant ce temps']);
  });

  it('ne boucle jamais : abandon après 3 tentatives, données intactes, état de conflit', async () => {
    await addFav(A, 'Base'); await A.engine.sync();
    await addFav(A, 'Local en attente');
    gh.beforePut = () => { gh.setFile(gh.getFileContent()!); }; // le SHA change à chaque tentative
    const before = gh.requests.length;
    const r = await A.engine.sync();
    expect(r.status).toBe('conflict');
    expect(r.message).toMatch(/modifié 3 fois/);
    expect(gh.requests.filter((q) => q.method === 'PUT').length - 1).toBe(3);
    expect(gh.requests.length - before).toBeLessThanOrEqual(8);
    expect(titles(A)).toEqual(['Base', 'Local en attente']);
  });
});

describe('erreurs et limites', () => {
  it('hors ligne (navigateur) : aucune requête, données conservées, état en attente', async () => {
    await addFav(A, 'Hors ligne');
    A.online.value = false;
    const n = gh.requests.length;
    const r = await A.engine.sync();
    expect(r.status).toBe('offline');
    expect(gh.requests.length).toBe(n);
    expect(titles(A)).toEqual(['Hors ligne']);
    expect(A.store.dirty).toBe(true);
    A.online.value = true;
    expect((await A.engine.sync()).status).toBe('idle');
    expect(gh.getFileContent()).toContain('Hors ligne');
  });

  it('erreur réseau pendant l’envoi : données locales intactes, nouvelle tentative possible', async () => {
    await addFav(A, 'Important');
    gh.offline = true;
    const r = await A.engine.sync();
    expect(r.status).toBe('offline');
    expect((await A.engine.getState()).lastSyncAt).toBeNull();     // pas de faux succès
    expect(titles(A)).toEqual(['Important']);
    gh.offline = false;
    expect((await A.engine.sync()).status).toBe('idle');
    expect((await A.engine.getState()).lastSyncAt).not.toBeNull();
  });

  it('401 : message clair, aucune donnée perdue, état d’erreur', async () => {
    await addFav(A, 'X');
    gh.expectedToken = 'github_pat_AUTRE00000000000000000000';
    const r = await A.engine.sync();
    expect(r).toMatchObject({ status: 'error' });
    expect(r.message).toMatch(/401/);
    expect((await A.engine.getState()).lastError?.kind).toBe('unauthorized');
    expect(titles(A)).toEqual(['X']);
  });

  it('403 de permission, 404 dépôt, branche inconnue', async () => {
    await addFav(A, 'X');
    gh.forced.push(() => new Response(JSON.stringify({ message: 'Resource not accessible' }), { status: 403 }));
    expect((await A.engine.sync()).message).toMatch(/403/);
    gh.repoExists = false;
    const r2 = await A.engine.sync();
    expect(r2.status).toBe('error'); expect(r2.message).toMatch(/404|introuvable/);
    gh.repoExists = true;
    await A.engine.saveConfig({ ...CONFIG, branch: 'inconnue' });
    const r3 = await A.engine.sync();
    expect(r3.message).toMatch(/branche/);
  });

  it('429/403 de limitation : respecte le délai, aucune boucle de réessai, aucune requête tant que le délai court', async () => {
    await addFav(A, 'X');
    gh.forced.push(rateLimited(429, { 'retry-after': '120' }));
    const r = await A.engine.sync();
    expect(r.status).toBe('rate-limited');
    const n = gh.requests.length;
    expect(n).toBeLessThanOrEqual(2);
    const again = await A.engine.sync();
    expect(again.status).toBe('rate-limited');
    expect(gh.requests.length).toBe(n);                    // aucune requête pendant l'attente
    expect((await A.engine.getState()).rateLimitedUntil).not.toBeNull();
    expect(titles(A)).toEqual(['X']);
  });

  it('reprend après la fin de la limitation', async () => {
    await addFav(A, 'X');
    gh.forced.push(rateLimited(403, { 'x-ratelimit-remaining': '0', 'retry-after': '1' }));
    await A.engine.sync();
    for (let i = 0; i < 5; i++) clock();                   // l'horloge avance de plusieurs secondes
    expect((await A.engine.sync()).status).toBe('idle');
  });

  it('refuse un fichier distant invalide ou plus récent sans rien écrire ni modifier le local', async () => {
    await addFav(A, 'Local');
    for (const bad of ['pas du json', '{"schemaVersion":1,"favorites":"x"}', '[]', JSON.stringify({ schemaVersion: 99 })]) {
      gh.setFile(bad);
      const r = await A.engine.sync();
      expect(r.status).toBe('error');
      expect(r.message).toMatch(/distant/);
      expect(gh.getFileContent()).toBe(bad);               // le distant n'est pas écrasé
      expect(titles(A)).toEqual(['Local']);                // le local non plus
    }
    expect(gh.putCount()).toBe(0);
  });

  it('refuse de synchroniser vers un dépôt public', async () => {
    await addFav(A, 'Privé');
    gh.isPrivate = false;
    const r = await A.engine.sync();
    expect(r.status).toBe('error'); expect(r.message).toMatch(/public/);
    expect(gh.putCount()).toBe(0);
  });

  it('une réponse de succès non confirmée n’est pas un succès', async () => {
    await addFav(A, 'X');
    await A.engine.sync();                                  // crée
    await addFav(A, 'Y');
    const orig = gh.fetch;
    gh.fetch = async (i, init) => { const res = await orig(i, init); return (init?.method === 'PUT') ? new Response('{}', { status: 200 }) : res; };
    const r = await A.engine.sync();
    expect(r.status).toBe('error');
    expect(A.store.dirty).toBe(true);
    expect((await A.engine.getState()).lastError?.kind).toBe('invalid-response');
  });

  it('ne fuit jamais le jeton dans les messages d’erreur ni l’état', async () => {
    await addFav(A, 'X');
    gh.forced.push(() => new Response(JSON.stringify({ message: `Mauvais ${TEST_TOKEN} !` }), { status: 403 }));
    const r = await A.engine.sync();
    expect(r.message).not.toContain('TESTTOKEN');
    expect(JSON.stringify(A.adapter.dump()[KEYS.syncState])).not.toContain('TESTTOKEN');
    expect(JSON.stringify(A.adapter.dump()[KEYS.doc])).not.toContain('TESTTOKEN');
  });

  it('modifications faites pendant la synchronisation : conservées localement et marquées en attente', async () => {
    await addFav(A, 'Avant'); await A.engine.sync();
    await addFav(A, 'Pendant sync');
    let once = true;
    gh.beforePut = () => { if (once) { once = false; void addTaskTo(A, 'Tâche ajoutée pendant l’envoi'); } };
    const r = await A.engine.sync();
    await new Promise((res) => setTimeout(res, 20));
    expect(r.status === 'idle' || r.status === 'pending').toBe(true);
    expect(live(A.store.getDoc().tasks).map((t) => t.title)).toEqual(['Tâche ajoutée pendant l’envoi']);
    await A.engine.sync();
    expect(gh.getFileContent()).toContain('Tâche ajoutée pendant l’envoi');
  });
});

describe('vérification, opérations manuelles et déconnexion', () => {
  it('« Tester l’accès » détaille chaque étape sans rien enregistrer', async () => {
    const checks = await A.engine.testAccess(CONFIG, TEST_TOKEN);
    expect(checks.every((c) => c.ok)).toBe(true);
    expect(checks.map((c) => c.label)).toEqual(['Paramètres', 'Jeton', 'Dépôt', 'Confidentialité', 'Fichier']);
    gh.isPrivate = false;
    const pub = await A.engine.testAccess(CONFIG, TEST_TOKEN);
    expect(pub.find((c) => c.label === 'Confidentialité')?.ok).toBe(false);
    gh.isPrivate = true; gh.expectedToken = 'x';
    const bad = await A.engine.testAccess(CONFIG, TEST_TOKEN);
    expect(bad.at(-1)).toMatchObject({ ok: false });
    expect((await A.engine.testAccess({ ...CONFIG, owner: '' }, TEST_TOKEN))[0]).toMatchObject({ ok: false });
    expect(gh.putCount()).toBe(0);
  });

  it('télécharger les distantes remplace le local après sauvegarde automatique', async () => {
    await addFav(A, 'Sur GitHub'); await A.engine.sync();
    await addFav(B, 'Local B seulement');
    const insp = await B.engine.inspectRemote();
    expect(insp.ok && insp.value.counts?.favorites).toBe(1);
    const r = await B.engine.pullReplace();
    expect(r.status).toBe('idle');
    expect(titles(B)).toEqual(['Sur GitHub']);
    expect((await B.store.listBackups()).some((b) => live(b.doc.favorites).some((f) => f.title === 'Local B seulement'))).toBe(true);
  });

  it('envoyer les locales remplace le distant (l’historique Git conserve l’ancien)', async () => {
    await addFav(A, 'Ancien'); await A.engine.sync();
    await addFav(B, 'Nouveau B');
    const r = await B.engine.pushReplace();
    expect(r.status).toBe('idle');
    const remote = parseRemoteDocument(gh.getFileContent()!);
    expect(remote.ok && live(remote.value.favorites).map((f) => f.title)).toEqual(['Nouveau B']);
  });

  it('déconnecter oublie le dépôt mais garde les données ; supprimer le jeton le retire', async () => {
    await addFav(A, 'Garde'); await A.engine.sync();
    expect(await A.engine.hasToken()).toBe(true);
    await A.engine.disconnect();
    expect(await A.engine.getConfig()).toBeNull();
    expect((await A.engine.getState()).status).toBe('unconfigured');
    expect(titles(A)).toEqual(['Garde']);
    expect((await A.engine.sync()).status).toBe('unconfigured');
    await A.engine.clearToken();
    expect(await A.engine.hasToken()).toBe(false);
    expect(JSON.stringify(A.adapter.dump())).not.toContain('TESTTOKEN');
  });

  it('refuse un jeton classique et une configuration invalide', async () => {
    expect((await A.engine.saveConfig(CONFIG, 'ghp_abcdefghijklmnopqrstuvwxyz0123456789')).ok).toBe(false);
    expect((await A.engine.saveConfig({ ...CONFIG, path: '../x.json' })).ok).toBe(false);
    expect(mustOk(await A.engine.saveConfig({ ...CONFIG, autoSync: true })).autoSync).toBe(true);
    expect(mustOk(await A.engine.setAutoSync(false)).autoSync).toBe(false);
  });
});
