import { fail, ok, type Result } from './types';

const MAX_URL_LENGTH = 2048;
const DANGEROUS_SCHEME = /^(javascript|data|vbscript|file|blob|about|chrome|chrome-extension|view-source|filesystem):/i;
const OTHER_SCHEME = /^[a-z][a-z0-9+.-]*:\/\//i;

/** Vrai si le texte contient un espace ou un caractère de contrôle (codes 0–32 et 127). */
export function hasWhitespaceOrControl(text: string): boolean {
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c <= 32 || c === 127 || (c >= 0x80 && c <= 0x9f) || c === 0x2028 || c === 0x2029 || c === 0xa0) return true;
  }
  return false;
}

/**
 * Valide et normalise une URL de navigation. Seuls http et https sont acceptés.
 * « exemple.fr » devient « https://exemple.fr/ » ; « javascript:… » et « data:… » sont refusés.
 */
export function validateUrl(input: string): Result<string> {
  const raw = (input ?? '').trim();
  if (!raw) return fail('L’adresse est obligatoire.');
  if (raw.length > MAX_URL_LENGTH) return fail('L’adresse est trop longue.');
  if (hasWhitespaceOrControl(raw)) return fail('L’adresse ne doit pas contenir d’espaces ni de caractères de contrôle.');
  if (DANGEROUS_SCHEME.test(raw)) return fail('Ce type de lien n’est pas autorisé (seuls http et https le sont).');

  let candidate = raw;
  if (OTHER_SCHEME.test(raw)) {
    if (!/^https?:\/\//i.test(raw)) return fail('Seuls les liens http et https sont autorisés.');
  } else if (/^[a-z][a-z0-9+.-]*:/i.test(raw) && !/^[^/:]+:\d+(\/|$|\?|#)/.test(raw)) {
    // « mailto: », « tel: »… ; « localhost:3000 » reste accepté ci-dessous.
    return fail('Seuls les liens http et https sont autorisés.');
  } else {
    candidate = `https://${raw}`;
  }

  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    return fail('Cette adresse n’est pas valide.');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return fail('Seuls les liens http et https sont autorisés.');
  if (!parsed.hostname) return fail('L’adresse doit contenir un nom de domaine.');
  if (parsed.username || parsed.password) return fail('Les identifiants dans l’adresse ne sont pas autorisés.');
  return ok(parsed.href);
}

export const isSafeNavigationUrl = (url: string): boolean => {
  const r = validateUrl(url);
  return r.ok && r.value === url;
};

/** Valide un modèle de moteur de recherche personnalisé (https obligatoire, `{query}` requis). */
export function validateSearchTemplate(template: string): Result<string> {
  const t = (template ?? '').trim();
  if (!t.includes('{query}')) return fail('Le modèle doit contenir {query}, par exemple https://exemple.fr/?q={query}.');
  if (t.split('{query}').length > 2) return fail('{query} ne doit apparaître qu’une seule fois.');
  if (!/^https:\/\//i.test(t)) return fail('Le modèle doit commencer par https://.');
  const probe = validateUrl(t.replace('{query}', 'test'));
  if (!probe.ok) return probe;
  return ok(t);
}

export function buildSearchUrl(template: string, query: string): Result<string> {
  const valid = validateSearchTemplate(template);
  if (!valid.ok) return valid;
  const q = query.trim();
  if (!q) return fail('La recherche est vide.');
  return ok(valid.value.replace('{query}', encodeURIComponent(q)));
}

export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}
