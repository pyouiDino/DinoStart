// Export/import JSON. Le fichier ne contient jamais de jeton : seul le document de données est exporté,
// et l'import reconstruit chaque élément à partir de champs connus (tout champ inattendu, tel un jeton, est ignoré).
import { countDocument, type DocCounts } from '../core/docutil';
import { mergeDocuments, type Resolution } from '../core/merge';
import { migrateDocument } from '../core/migrations';
import { fail, ok, SCHEMA_VERSION, type DinoDocument, type Result } from '../core/types';
import type { DinoStore } from '../storage/store';

export const BACKUP_APP = 'DinoStart';
export const MAX_IMPORT_BYTES = 10 * 1024 * 1024;

export interface BackupFile { app: typeof BACKUP_APP; kind: 'backup'; schemaVersion: number; exportedAt: string; data: DinoDocument }

export interface ParsedBackup {
  doc: DinoDocument;
  counts: DocCounts;
  fromVersion: number;
  migrated: boolean;
  exportedAt: string | null;
}

export function createBackupFile(doc: DinoDocument, now: Date = new Date()): { filename: string; json: string } {
  const file: BackupFile = { app: BACKUP_APP, kind: 'backup', schemaVersion: SCHEMA_VERSION, exportedAt: now.toISOString(), data: doc };
  const stamp = now.toISOString().slice(0, 16).replace('T', '-').replace(':', 'h');
  return { filename: `dinostart-sauvegarde-${stamp}.json`, json: `${JSON.stringify(file, null, 2)}\n` };
}

/** Lit et valide un fichier de sauvegarde sans rien modifier. Accepte aussi le format brut du fichier synchronisé. */
export function parseBackup(text: string): Result<ParsedBackup> {
  if (text.length > MAX_IMPORT_BYTES) return fail('Fichier trop volumineux (10 Mo maximum).');
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { return fail('Ce fichier n’est pas un JSON valide.'); }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return fail('Ce fichier n’est pas une sauvegarde DinoStart.');
  const o = raw as Record<string, unknown>;
  let payload: unknown;
  let exportedAt: string | null = null;
  if (o.app !== undefined || o.kind !== undefined) {
    if (o.app !== BACKUP_APP || o.kind !== 'backup') return fail('Ce fichier n’est pas une sauvegarde DinoStart.');
    payload = o.data;
    exportedAt = typeof o.exportedAt === 'string' ? o.exportedAt : null;
  } else payload = raw;
  const m = migrateDocument(payload);
  if (!m.ok) return fail(m.error);
  return ok({ doc: m.value.doc, counts: countDocument(m.value.doc), fromVersion: m.value.fromVersion, migrated: m.value.migrated, exportedAt });
}

export type ImportMode = 'replace' | 'merge';
/** En fusion : comment trancher les éléments modifiés des deux côtés. */
export type ImportPolicy = 'keep-local' | 'prefer-import';

export interface ImportReport { mode: ImportMode; backupCreated: boolean; conflictsResolved: number; counts: DocCounts }

/**
 * Importe une sauvegarde déjà validée. Une sauvegarde locale est créée avant toute modification ;
 * si elle échoue, rien n'est importé.
 */
export async function importBackup(store: DinoStore, parsed: ParsedBackup, mode: ImportMode, policy: ImportPolicy = 'keep-local'): Promise<Result<ImportReport>> {
  if (mode === 'replace') {
    const r = await store.replaceDocument(parsed.doc, 'Avant la restauration d’un fichier de sauvegarde');
    return r.ok ? ok({ mode, backupCreated: true, conflictsResolved: 0, counts: countDocument(r.value) }) : fail(r.error);
  }
  const backup = await store.createBackup('Avant la fusion d’un fichier de sauvegarde');
  if (!backup.ok) return fail(`Fusion annulée : ${backup.error}`);
  let resolved = 0;
  const r = await store.mutate((cur, ctx) => {
    const first = mergeDocuments(null, cur, parsed.doc, ctx);
    if (!first.conflicts.length) return ok(first.merged);
    const choice: Resolution = policy === 'keep-local' ? 'local' : 'remote';
    resolved = first.conflicts.length;
    return ok(mergeDocuments(null, cur, parsed.doc, ctx, Object.fromEntries(first.conflicts.map((c) => [c.key, choice]))).merged);
  });
  return r.ok ? ok({ mode, backupCreated: true, conflictsResolved: resolved, counts: countDocument(r.value) }) : fail(r.error);
}
