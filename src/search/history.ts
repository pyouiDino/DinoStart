// Historique des recherches Web faites depuis la barre. Stocké sur l'appareil uniquement (jamais synchronisé ni exporté).
import { normalize } from '../core/search';
import { fail, ok, type Result } from '../core/types';
import { KEYS, type DinoStore } from '../storage/store';

export interface SearchEntry { q: string; at: string }
export const MAX_HISTORY = 100;
export const MAX_QUERY_LENGTH = 200;

/** Ajoute une recherche en tête (sans doublon, insensible à la casse et aux accents) et borne la taille. */
export function addEntry(list: SearchEntry[], query: string, at: string, max = MAX_HISTORY): SearchEntry[] {
  const q = query.trim().replace(/\s+/g, ' ').slice(0, MAX_QUERY_LENGTH);
  if (!q) return list;
  const key = normalize(q);
  return [{ q, at }, ...list.filter((e) => normalize(e.q) !== key)].slice(0, max);
}
export const removeEntry = (list: SearchEntry[], q: string): SearchEntry[] => list.filter((e) => e.q !== q);

/** Recherches passées qui commencent par (ou contiennent) le texte saisi ; toutes les récentes si le champ est vide. */
export function matchEntries(list: SearchEntry[], typed: string, limit = 5): SearchEntry[] {
  const t = normalize(typed.trim());
  if (!t) return list.slice(0, limit);
  const starts = list.filter((e) => normalize(e.q).startsWith(t) && normalize(e.q) !== t);
  const contains = list.filter((e) => !normalize(e.q).startsWith(t) && normalize(e.q).includes(t));
  return [...starts, ...contains].slice(0, limit);
}

function sanitize(raw: unknown): SearchEntry[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((e): e is SearchEntry => !!e && typeof (e as SearchEntry).q === 'string' && typeof (e as SearchEntry).at === 'string' && (e as SearchEntry).q.length <= MAX_QUERY_LENGTH).slice(0, MAX_HISTORY);
}

export class SearchHistory {
  constructor(private readonly store: DinoStore) {}
  async list(): Promise<SearchEntry[]> { return sanitize(await this.store.getLocal<unknown>(KEYS.searchHistory)); }
  async add(query: string): Promise<Result<SearchEntry[]>> {
    const next = addEntry(await this.list(), query, this.store.now());
    const w = await this.store.setLocal(KEYS.searchHistory, next);
    return w.ok ? ok(next) : fail(w.error);
  }
  async remove(q: string): Promise<SearchEntry[]> {
    const next = removeEntry(await this.list(), q);
    await this.store.setLocal(KEYS.searchHistory, next);
    return next;
  }
  async clear(): Promise<void> { await this.store.removeLocal(KEYS.searchHistory); }
}
