import { SCHEMA_VERSION, type DinoDocument, type Result, fail, ok } from './types';
import { validateDocument } from './validation';

type Raw = Record<string, unknown>;
/** migrations[n] transforme un document de version n en version n+1. */
export type MigrationTable = Record<number, (doc: Raw) => Raw>;

/**
 * 1 → 2 : icônes de favoris « automatiques » (icône du site), nouveaux réglages de recherche
 * (suggestions, boutons, raccourcis IA), assistant de démarrage, widget Favoris en dossiers.
 * La migration est déterministe : deux appareils qui migrent le même document obtiennent le même résultat.
 */
/** Raccourcis IA de la version 2, figés ici : une migration ne doit pas dépendre de valeurs par défaut qui évoluent. */
const V2_AI_LINKS = [
  { id: 'chatgpt', label: 'ChatGPT', url: 'https://chatgpt.com/', queryUrl: 'https://chatgpt.com/?q={query}', enabled: true },
  { id: 'gemini', label: 'Gemini', url: 'https://gemini.google.com/app', queryUrl: null, enabled: true },
  { id: 'claude', label: 'Claude', url: 'https://claude.ai/new', queryUrl: 'https://claude.ai/new?q={query}', enabled: true },
  { id: 'copilot', label: 'Copilot', url: 'https://copilot.microsoft.com/', queryUrl: null, enabled: true },
  { id: 'perplexity', label: 'Perplexity', url: 'https://www.perplexity.ai/', queryUrl: 'https://www.perplexity.ai/search?q={query}', enabled: false },
];

export const MIGRATIONS: MigrationTable = {
  1: (d) => {
    const settings = (d.settings ?? {}) as Record<string, unknown>;
    const search = (settings.search ?? {}) as Record<string, unknown>;
    return {
      ...d,
      favorites: Array.isArray(d.favorites)
        ? d.favorites.map((f: unknown) => {
            const fav = f as Record<string, unknown>;
            const icon = fav.icon as { kind?: string } | undefined;
            return icon?.kind === 'initial' ? { ...fav, icon: { kind: 'auto' } } : fav;
          })
        : d.favorites,
      settings: {
        ...settings,
        search: {
          googleSuggestions: true, rememberSearches: true, showPrivateButton: true, showHistoryButton: true, showLens: true,
          aiLinks: structuredClone(V2_AI_LINKS), ...search,
        },
        general: { onboardingDone: false },
      },
    };
  },
};

/** Dispositions en dur : une migration ne doit jamais dépendre de valeurs par défaut susceptibles d'évoluer. */
const V3_HEIGHTS: Record<string, number> = { clock: 4, date: 4, search: 4, favorites: 9, quickLinks: 4, tasks: 5, projects: 6, quickNotes: 6 };

/**
 * 2 → 3 : placement libre des cartes. Les anciennes « largeur » (colSpan) et « ordre » deviennent une position
 * (x, y) et une taille (w, h) : les cartes sont rangées ligne par ligne dans l'ordre d'avant. Déterministe.
 */
MIGRATIONS[2] = (d) => {
  const list = Array.isArray(d.widgets) ? (d.widgets as Record<string, unknown>[]) : [];
  const sorted = [...list].sort((a, b) => Number(a.order ?? 0) - Number(b.order ?? 0) || String(a.id).localeCompare(String(b.id)));
  let x = 0, y = 0, rowH = 0;
  const placed = new Map<string, { x: number; y: number; w: number; h: number }>();
  for (const w of sorted.filter((i) => i.enabled !== false)) {
    const width = Math.min(12, Math.max(1, Number(w.colSpan) || 6));
    const h = V3_HEIGHTS[String(w.type)] ?? 6;
    if (x + width > 12) { x = 0; y += rowH; rowH = 0; }
    placed.set(String(w.id), { x, y, w: width, h });
    x += width; rowH = Math.max(rowH, h);
  }
  const bottom = y + rowH;
  const widgets = list.map((w) => {
    const { order: _o, colSpan, ...rest } = w;
    void _o;
    const width = Math.min(12, Math.max(1, Number(colSpan) || 6));
    return { ...rest, ...(placed.get(String(w.id)) ?? { x: 0, y: bottom, w: width, h: V3_HEIGHTS[String(w.type)] ?? 6 }) };
  });
  return { ...d, widgets };
};

export interface MigrationResult { doc: DinoDocument; fromVersion: number; migrated: boolean }

/**
 * Migre un document brut vers la version courante puis le valide.
 * Refuse les documents plus récents que l'extension (pour ne jamais les corrompre).
 */
export function migrateDocument(
  raw: unknown,
  table: MigrationTable = MIGRATIONS,
  target: number = SCHEMA_VERSION,
  validate: (d: unknown) => Result<DinoDocument> = validateDocument,
): Result<MigrationResult> {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return fail('Le document n’est pas un objet JSON.');
  let current = structuredClone(raw) as Raw;
  const v = current.schemaVersion;
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 1) return fail('Le document n’indique pas de version de schéma valide.');
  if (v > target) return fail(`Ce document utilise le schéma ${v}, plus récent que celui de cette extension (${target}). Mettez DinoStart à jour avant de continuer.`);
  const fromVersion = v;
  for (let n = v; n < target; n++) {
    const step = table[n];
    if (!step) return fail(`Aucune migration disponible de la version ${n} vers ${n + 1}.`);
    try {
      current = step(current);
    } catch (e) {
      return fail(`Échec de la migration ${n} → ${n + 1} : ${e instanceof Error ? e.message : 'erreur inconnue'}`);
    }
    current.schemaVersion = n + 1;
  }
  const valid = validate(current);
  if (!valid.ok) return valid;
  return ok({ doc: valid.value, fromVersion, migrated: fromVersion !== target });
}

/**
 * 3 → 4 : les boutons « Navigation privée », « Historique » et les raccourcis IA deviennent une seule liste de
 * raccourcis modifiables (nom, type, adresse, icône, activation). L'état d'activation d'avant est conservé.
 */
MIGRATIONS[3] = (d) => {
  const settings = (d.settings ?? {}) as Record<string, unknown>;
  const { showPrivateButton, showHistoryButton, aiLinks, ...search } = (settings.search ?? {}) as Record<string, unknown>;
  const ai = Array.isArray(aiLinks) ? (aiLinks as Record<string, unknown>[]) : [];
  const shortcuts = [
    { id: 'private', label: 'Navigation privée', kind: 'private', icon: { kind: 'icon', name: 'mask' }, url: null, queryUrl: null, enabled: showPrivateButton !== false },
    { id: 'history', label: 'Historique', kind: 'history', icon: { kind: 'icon', name: 'history' }, url: null, queryUrl: null, enabled: showHistoryButton !== false },
    ...ai.map((a) => ({ id: a.id, label: a.label, kind: 'link', icon: { kind: 'icon', name: 'sparkles' }, url: a.url ?? null, queryUrl: a.queryUrl ?? null, enabled: a.enabled !== false })),
  ];
  return { ...d, settings: { ...settings, search: { ...search, shortcuts } } };
};

/**
 * 4 → 5 : nouvelle identité (dino bleu). Seuls les réglages restés aux anciennes couleurs d'origine (orange, sans fond
 * personnalisé) passent au bleu du logo ; une couleur choisie par l'utilisateur n'est jamais modifiée.
 */
MIGRATIONS[4] = (d) => {
  const settings = (d.settings ?? {}) as Record<string, unknown>;
  const ap = (settings.appearance ?? {}) as Record<string, unknown>;
  const untouched = ap.primary === '#f97316' && ap.accent === '#fbbf24' && (ap.background === null || ap.background === undefined);
  if (!untouched) return d;
  return { ...d, settings: { ...settings, appearance: { ...ap, primary: '#5194f5', accent: '#fdc096' } } };
};

