import { COLLECTION_KEYS, type DinoDocument } from './types';
import { live } from './ops';

/** Sérialisation canonique (clés triées) pour comparer des valeurs JSON de façon fiable. */
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    const o = value as Record<string, unknown>;
    return `{${Object.keys(o).filter((k) => o[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}
export const deepEqual = (a: unknown, b: unknown): boolean => canonical(a) === canonical(b);

/** Retire les champs purement informatifs (dates de modification, appareil) pour comparer le contenu. */
export function stripMeta<T extends object>(e: T): Omit<T, 'updatedAt' | 'origin'> {
  const { updatedAt: _u, origin: _o, ...rest } = e as T & { updatedAt?: string; origin?: string };
  void _u; void _o;
  return rest as Omit<T, 'updatedAt' | 'origin'>;
}

/** Deux documents ont-ils le même contenu ? (ordre des listes et métadonnées de modification ignorés) */
export function docEquals(a: DinoDocument, b: DinoDocument): boolean {
  if (a.schemaVersion !== b.schemaVersion) return false;
  for (const k of COLLECTION_KEYS) {
    const ma = [...a[k]].sort((x, y) => x.id.localeCompare(y.id)).map((e) => stripMeta(e));
    const mb = [...b[k]].sort((x, y) => x.id.localeCompare(y.id)).map((e) => stripMeta(e));
    if (canonical(ma) !== canonical(mb)) return false;
  }
  return canonical(stripMeta(a.settings)) === canonical(stripMeta(b.settings));
}

export interface DocCounts { favorites: number; categories: number; projects: number; notes: number; tasks: number }
export function countDocument(doc: DinoDocument): DocCounts {
  return {
    favorites: live(doc.favorites).length, categories: live(doc.categories).length, projects: live(doc.projects).length,
    notes: live(doc.notes).length, tasks: live(doc.tasks).length,
  };
}
export const sortCanonical = (doc: DinoDocument): DinoDocument => ({
  ...doc,
  categories: [...doc.categories].sort((a, b) => a.id.localeCompare(b.id)),
  favorites: [...doc.favorites].sort((a, b) => a.id.localeCompare(b.id)),
  projects: [...doc.projects].sort((a, b) => a.id.localeCompare(b.id)),
  notes: [...doc.notes].sort((a, b) => a.id.localeCompare(b.id)),
  tasks: [...doc.tasks].sort((a, b) => a.id.localeCompare(b.id)),
  widgets: [...doc.widgets].sort((a, b) => a.id.localeCompare(b.id)),
});
