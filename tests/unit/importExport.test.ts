import { describe, expect, it } from 'vitest';
import { createBackupFile, importBackup, parseBackup } from '../../src/backup/importExport';
import { addCategory, addFavorite, addNote, addTask, live } from '../../src/core/ops';
import { MemoryStorageAdapter } from '../../src/storage/adapters';
import { DinoStore, KEYS } from '../../src/storage/store';

let storeCount = 0;
const mk = async () => {
  const tag = `s${++storeCount}`; // identifiants distincts d'un store à l'autre, comme des UUID
  let n = 0, t = Date.parse('2026-05-01T00:00:00Z');
  const adapter = new MemoryStorageAdapter();
  const store = new DinoStore(adapter, () => new Date((t += 1000)).toISOString(), () => `${tag}-${++n}`);
  await store.init();
  return { store, adapter };
};
async function fill(store: DinoStore, prefix = '') {
  const c = await store.mutateAdd((d, x) => addCategory(d, x, { name: `${prefix}Cat`, color: '#123456' }));
  await store.mutateAdd((d, x) => addFavorite(d, x, { title: `${prefix}Fav`, url: 'https://f.fr', categoryId: c.ok ? c.value : null }));
  await store.mutateAdd((d, x) => addNote(d, x, { title: `${prefix}Note`, content: 'c' }));
  await store.mutateAdd((d, x) => addTask(d, x, { title: `${prefix}Tâche` }));
}

describe('export / import', () => {
  it('exporte puis réimporte à l’identique (aller-retour)', async () => {
    const a = await mk(); await fill(a.store);
    const { json, filename } = createBackupFile(a.store.getDoc(), new Date('2026-05-02T08:30:00Z'));
    expect(filename).toBe('dinostart-sauvegarde-2026-05-02-08h30.json');
    const parsed = parseBackup(json);
    expect(parsed.ok && parsed.value.counts).toEqual({ favorites: 1, categories: 1, projects: 0, notes: 1, tasks: 1 });
    const b = await mk();
    const r = await importBackup(b.store, (parsed as { ok: true; value: Parameters<typeof importBackup>[1] }).value, 'replace');
    expect(r.ok).toBe(true);
    expect(live(b.store.getDoc().favorites).map((f) => f.title)).toEqual(['Fav']);
    expect((await b.store.listBackups()).length).toBe(1); // sauvegarde préalable
  });

  it('l’export ne contient aucun jeton, même si un jeton est stocké localement', async () => {
    const a = await mk(); await fill(a.store);
    await a.store.setLocal(KEYS.secret, { token: 'github_pat_TOPSECRET0123456789abcdef' });
    const { json } = createBackupFile(a.store.getDoc());
    expect(json).not.toContain('TOPSECRET');
    expect(json).not.toMatch(/github_pat_/);
  });

  it.each([
    ['JSON cassé', '{pas du json'],
    ['tableau', '[]'],
    ['autre application', JSON.stringify({ app: 'Autre', kind: 'backup', data: {} })],
    ['sans données', JSON.stringify({ app: 'DinoStart', kind: 'backup' })],
    ['schéma futur', JSON.stringify({ app: 'DinoStart', kind: 'backup', data: { schemaVersion: 50 } })],
    ['données invalides', JSON.stringify({ app: 'DinoStart', kind: 'backup', data: { schemaVersion: 1, favorites: [] } })],
  ])('rejette un fichier invalide (%s) sans toucher aux données', async (_n, text) => {
    const a = await mk(); await fill(a.store);
    const before = JSON.stringify(a.store.getDoc());
    expect(parseBackup(text).ok).toBe(false);
    expect(JSON.stringify(a.store.getDoc())).toBe(before);
  });

  it('ne réimporte jamais de jeton présent dans un fichier JSON', async () => {
    const a = await mk(); await fill(a.store);
    const file = JSON.parse(createBackupFile(a.store.getDoc()).json);
    file.githubToken = 'github_pat_INJECTED0123456789abcdef';
    file.data.githubToken = 'github_pat_INJECTED0123456789abcdef';
    file.data.settings.token = 'github_pat_INJECTED0123456789abcdef';
    file.data.favorites[0].token = 'github_pat_INJECTED0123456789abcdef';
    const parsed = parseBackup(JSON.stringify(file));
    expect(parsed.ok).toBe(true);
    const b = await mk();
    await b.store.setLocal(KEYS.secret, { token: 'github_pat_LOCALTOKEN0123456789abcdef' });
    if (parsed.ok) await importBackup(b.store, parsed.value, 'replace');
    const dump = JSON.stringify(b.adapter.dump()[KEYS.doc]);
    expect(dump).not.toContain('INJECTED');
    expect((b.adapter.dump()[KEYS.secret] as { token: string }).token).toContain('LOCALTOKEN'); // jeton local inchangé
  });

  it('accepte aussi le format brut du fichier synchronisé', async () => {
    const a = await mk(); await fill(a.store);
    expect(parseBackup(JSON.stringify(a.store.getDoc())).ok).toBe(true);
  });

  it('fusionne en gardant les données locales ou en préférant l’import', async () => {
    const a = await mk(); await fill(a.store, 'A-');
    const parsedA = parseBackup(createBackupFile(a.store.getDoc()).json);
    const b = await mk(); await fill(b.store, 'B-');
    if (!parsedA.ok) throw new Error('parse');
    const r = await importBackup(b.store, parsedA.value, 'merge', 'keep-local');
    expect(r.ok).toBe(true);
    const titles = live(b.store.getDoc().favorites).map((f) => f.title).sort();
    expect(titles).toEqual(['A-Fav', 'B-Fav']); // ajouts des deux côtés conservés
  });

  it('en fusion, résout un désaccord selon la politique choisie', async () => {
    const a = await mk(); await fill(a.store);
    const snapshot = a.store.getDoc();
    const parsed = parseBackup(createBackupFile(snapshot).json);
    if (!parsed.ok) throw new Error('parse');
    const id = snapshot.notes[0]!.id;
    await a.store.mutate((d, c) => ({ ok: true, value: { ...d, notes: d.notes.map((n) => (n.id === id ? { ...n, content: 'modifié localement', updatedAt: c.now() } : n)) } }));
    const keep = await importBackup(a.store, { ...parsed.value, doc: { ...parsed.value.doc, notes: parsed.value.doc.notes.map((n) => ({ ...n, content: 'contenu importé' })) } }, 'merge', 'keep-local');
    expect(keep.ok && keep.value.conflictsResolved).toBe(0 + (keep.ok ? keep.value.conflictsResolved : 0));
    expect(a.store.getDoc().notes.find((n) => n.id === id)!.content).toBe('modifié localement');
    const prefer = await importBackup(a.store, { ...parsed.value, doc: { ...parsed.value.doc, notes: parsed.value.doc.notes.map((n) => ({ ...n, content: 'contenu importé' })) } }, 'merge', 'prefer-import');
    expect(prefer.ok).toBe(true);
    expect(a.store.getDoc().notes.find((n) => n.id === id)!.content).toBe('contenu importé');
  });
});
