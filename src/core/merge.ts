// Fusion à 3 voies : base (dernier état synchronisé) / local / distant.
//  - Les modifications indépendantes (éléments ou champs différents) sont fusionnées automatiquement.
//  - Une même valeur modifiée différemment des deux côtés, ou une suppression face à une modification,
//    est un CONFLIT : rien n'est écrasé tant que l'utilisateur n'a pas choisi.
import { canonical, deepEqual, sortCanonical, stripMeta } from './docutil';
import { createDefaultDocument } from './defaults';
import { repairReferences, type OpCtx } from './ops';
import { COLLECTION_KEYS, type CollectionKey, type DinoDocument, type EntityMeta } from './types';

export type Resolution = 'local' | 'remote';
export type ConflictCollection = CollectionKey | 'settings';

export interface Conflict {
  key: string; // « collection:id »
  collection: ConflictCollection;
  id: string;
  kind: 'fields' | 'delete-edit';
  /** Chemins des champs en désaccord (vide pour delete-edit). */
  fields: string[];
  label: string;
  local: unknown;
  remote: unknown;
  base: unknown;
}

export interface MergeResult { merged: DinoDocument; conflicts: Conflict[] }

type Obj = Record<string, unknown>;
const isPlain = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);

function mergeValue(b: unknown, l: unknown, r: unknown, path: string, conflicts: string[]): unknown {
  if (deepEqual(l, r)) return l;
  if (deepEqual(l, b)) return r;
  if (deepEqual(r, b)) return l;
  if (isPlain(l) && isPlain(r)) {
    const bb = isPlain(b) ? b : {};
    const out: Obj = {};
    for (const k of new Set([...Object.keys(l), ...Object.keys(r), ...Object.keys(bb)])) {
      const v = mergeValue(bb[k], l[k], r[k], path ? `${path}.${k}` : k, conflicts);
      if (v !== undefined) out[k] = v;
    }
    return out;
  }
  conflicts.push(path || '(élément)');
  return l;
}

type Meta = { updatedAt: string; origin: string };
const later = <T extends Meta>(a: T, b: T): T => (a.updatedAt >= b.updatedAt ? a : b);
const labelOf = (e: Obj): string => String(e.title ?? e.name ?? e.type ?? 'Paramètres');

interface EntityOutcome<T> { value: T; conflict?: Omit<Conflict, 'key' | 'collection' | 'id'> }

function mergeEntity<T extends Meta>(b: T | undefined, l: T, r: T): EntityOutcome<T> {
  const lc = stripMeta(l), rc = stripMeta(r), bc = b ? stripMeta(b) : undefined;
  if (canonical(lc) === canonical(rc)) return { value: later(l, r) };
  if (bc && canonical(lc) === canonical(bc)) return { value: r };
  if (bc && canonical(rc) === canonical(bc)) return { value: l };

  // Les deux côtés ont modifié l'élément.
  const lo = l as unknown as EntityMeta, ro = r as unknown as EntityMeta;
  if ('deletedAt' in lo) {
    const lDel = lo.deletedAt != null, rDel = ro.deletedAt != null;
    if (lDel && rDel) return { value: later(l, r) };
    if (lDel !== rDel) {
      return { value: l, conflict: { kind: 'delete-edit', fields: [], label: labelOf(l as unknown as Obj), local: l, remote: r, base: b ?? null } };
    }
  }
  const fields: string[] = [];
  const merged = mergeValue(bc ?? {}, lc, rc, '', fields) as Obj;
  const winner = later(l, r);
  const value = { ...merged, updatedAt: winner.updatedAt, origin: winner.origin } as unknown as T;
  if (fields.length) {
    return { value: l, conflict: { kind: 'fields', fields, label: labelOf(l as unknown as Obj), local: l, remote: r, base: b ?? null } };
  }
  return { value };
}

function mergeList<T extends EntityMeta>(collection: ConflictCollection, base: T[], local: T[], remote: T[], resolutions: Record<string, Resolution>, conflicts: Conflict[]): T[] {
  const bm = new Map(base.map((e) => [e.id, e])), lm = new Map(local.map((e) => [e.id, e])), rm = new Map(remote.map((e) => [e.id, e]));
  const out: T[] = [];
  for (const id of new Set([...lm.keys(), ...rm.keys()])) {
    const b = bm.get(id), l = lm.get(id), r = rm.get(id);
    if (l && !r) { if (!(b && deepEqual(stripMeta(l), stripMeta(b)))) out.push(l); continue; } // supprimé (purgé) à distance sans modif locale
    if (r && !l) { if (!(b && deepEqual(stripMeta(r), stripMeta(b)))) out.push(r); continue; }
    if (!l || !r) continue;
    const key = `${collection}:${id}`;
    const res = resolutions[key];
    const outcome = mergeEntity(b, l, r);
    if (outcome.conflict) {
      if (res) { out.push(res === 'local' ? l : r); continue; }
      conflicts.push({ key, collection, id, ...outcome.conflict });
    }
    out.push(outcome.value);
  }
  return out;
}

/**
 * Fusionne `local` et `remote` à partir de `base` (null = jamais synchronisé : document vierge).
 * `resolutions` fixe l'issue des conflits déjà tranchés par l'utilisateur.
 */
export function mergeDocuments(base: DinoDocument | null, local: DinoDocument, remote: DinoDocument, ctx: OpCtx, resolutions: Record<string, Resolution> = {}): MergeResult {
  const b = base ?? createDefaultDocument();
  const conflicts: Conflict[] = [];
  const merged = { ...local, updatedAt: local.updatedAt >= remote.updatedAt ? local.updatedAt : remote.updatedAt } as DinoDocument;
  for (const k of COLLECTION_KEYS) {
    (merged as unknown as Record<string, unknown>)[k] = mergeList(k, b[k] as EntityMeta[], local[k] as EntityMeta[], remote[k] as EntityMeta[], resolutions, conflicts);
  }
  // Paramètres : traités comme un élément unique, fusionnés champ par champ.
  const so = mergeEntity(b.settings, local.settings, remote.settings);
  const sres = resolutions['settings:settings'];
  if (so.conflict && !sres) conflicts.push({ key: 'settings:settings', collection: 'settings', id: 'settings', ...so.conflict });
  merged.settings = so.conflict && sres ? (sres === 'local' ? local.settings : remote.settings) : so.value;
  return { merged: conflicts.length ? merged : sortCanonical(repairReferences(merged, ctx)), conflicts };
}
