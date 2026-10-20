// Suggestions de recherche Google en direct (facultatif). Google reçoit le texte tapé : l'utilisateur doit l'avoir accepté.
export const GOOGLE_SUGGEST_ENDPOINT = 'https://suggestqueries.google.com/complete/search';
export const MIN_SUGGEST_LENGTH = 2;
export const MAX_SUGGEST_QUERY = 100;

export function suggestionUrl(query: string): string {
  const u = new URL(GOOGLE_SUGGEST_ENDPOINT);
  u.searchParams.set('client', 'firefox');
  u.searchParams.set('hl', 'fr');
  u.searchParams.set('q', query.trim().slice(0, MAX_SUGGEST_QUERY));
  return u.toString();
}

/** Réponse attendue : ["texte", ["suggestion 1", "suggestion 2", …], …]. Tout autre format donne une liste vide. */
export function parseSuggestions(json: unknown, limit = 6): string[] {
  if (!Array.isArray(json) || !Array.isArray(json[1])) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const s of json[1] as unknown[]) {
    if (typeof s !== 'string') continue;
    const t = s.trim();
    if (!t || t.length > 150 || seen.has(t.toLowerCase())) continue;
    seen.add(t.toLowerCase());
    out.push(t);
    if (out.length >= limit) break;
  }
  return out;
}

/** Ne lève jamais d'erreur : hors ligne, bloqué ou format inattendu → aucune suggestion (la recherche reste utilisable). */
export async function fetchSuggestions(query: string, opts: { signal?: AbortSignal; fetchImpl?: typeof fetch } = {}): Promise<string[]> {
  const q = query.trim();
  if (q.length < MIN_SUGGEST_LENGTH) return [];
  try {
    const res = await (opts.fetchImpl ?? fetch)(suggestionUrl(q), { signal: opts.signal, credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'no-store', redirect: 'error' });
    if (!res.ok) return [];
    return parseSuggestions(await res.json());
  } catch {
    return [];
  }
}
