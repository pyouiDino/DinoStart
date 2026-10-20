// Modèles de données DinoStart. Un seul document JSON versionné, synchronisable tel quel.

export const SCHEMA_VERSION = 5;
export const EPOCH = '1970-01-01T00:00:00.000Z';

/** Métadonnées communes : identifiant stable, dates, suppression logique et appareil d'origine. */
export interface EntityMeta {
  id: string;
  createdAt: string;
  updatedAt: string;
  /** Suppression logique : évite la réapparition d'un élément supprimé sur un autre PC. */
  deletedAt: string | null;
  /** Identifiant de l'appareil ayant fait la dernière modification. */
  origin: string;
}

export interface Category extends EntityMeta {
  name: string;
  color: string;
  order: number;
}

export const ICON_NAMES = [
  'globe', 'code', 'mail', 'calendar', 'book', 'music', 'video', 'image', 'shopping',
  'wallet', 'cloud', 'terminal', 'github', 'chat', 'map', 'gamepad', 'newspaper', 'wrench',
] as const;
export type IconName = (typeof ICON_NAMES)[number];

/** auto = icône du site fournie localement par Chrome ; initial = lettre colorée ; icon = icône choisie. */
export type FavoriteIcon = { kind: 'auto' } | { kind: 'initial' } | { kind: 'icon'; name: IconName };

export interface Favorite extends EntityMeta {
  title: string;
  url: string;
  categoryId: string | null;
  icon: FavoriteIcon;
  order: number;
  /** Affiché dans le widget « Liens rapides ». */
  quick: boolean;
}

export const PROJECT_STATUSES = ['active', 'paused', 'done'] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

export interface ProjectLink {
  id: string;
  label: string;
  /** URL http(s) pour `url`, texte libre (chemin consultable/copiable) pour `path`. */
  target: string;
  kind: 'url' | 'path';
}

export interface Project extends EntityMeta {
  name: string;
  description: string;
  status: ProjectStatus;
  color: string;
  links: ProjectLink[];
}

export interface Note extends EntityMeta {
  title: string;
  content: string;
  projectId: string | null;
  starred: boolean;
}

export interface Task extends EntityMeta {
  title: string;
  description: string;
  done: boolean;
  projectId: string | null;
  /** Format AAAA-MM-JJ. */
  dueDate: string | null;
}

export const WIDGET_TYPES = [
  'clock', 'date', 'search', 'favorites', 'projects', 'tasks', 'quickNotes', 'quickLinks',
] as const;
export type WidgetType = (typeof WIDGET_TYPES)[number];

/** Largeurs prédéfinies proposées dans le panneau Personnaliser (en colonnes). */
export const WIDTH_PRESETS = [3, 4, 6, 8, 12] as const;

export interface WidgetConfigs {
  clock: { hour12: boolean; seconds: boolean };
  date: { style: 'long' | 'short' };
  search: { placeholder: string };
  /** folders : dossiers façon téléphone ; sections : listes par catégorie. */
  favorites: { categoryId: string | null; layout: 'folders' | 'sections' };
  projects: { limit: number; status: 'all' | ProjectStatus };
  tasks: { limit: number; hideDone: boolean };
  quickNotes: { limit: number };
  quickLinks: Record<string, never>;
}

/** L'identifiant d'un widget est son type : il n'existe qu'une instance de chaque. */
export interface Widget<T extends WidgetType = WidgetType> extends EntityMeta {
  type: T;
  enabled: boolean;
  /** Position et taille sur la grille de 12 colonnes (x, y = coin haut-gauche ; w, h = colonnes et lignes). */
  x: number;
  y: number;
  w: number;
  h: number;
  config: WidgetConfigs[T];
}

export const SEARCH_ENGINES = ['google', 'duckduckgo', 'bing', 'brave', 'qwant', 'ecosia', 'custom'] as const;
export type SearchEngineId = (typeof SEARCH_ENGINES)[number];

export const SHORTCUT_ICONS = [
  'sparkles', 'bot', 'brain', 'globe', 'search', 'mask', 'history', 'star', 'heart', 'bookmark', 'home', 'mail', 'calendar', 'code', 'terminal',
  'git', 'music', 'video', 'image', 'book', 'newspaper', 'shopping', 'wallet', 'cloud', 'map', 'chat', 'gamepad', 'wrench', 'camera', 'rocket',
  'lock', 'languages', 'calculator', 'folder', 'download', 'link',
] as const;
export type ShortcutIconName = (typeof SHORTCUT_ICONS)[number];
/** auto = icône du site (fournie par Chrome, pour les raccourcis qui ont une adresse). */
export type ShortcutIcon = { kind: 'auto' } | { kind: 'icon'; name: ShortcutIconName };

/**
 * Bouton affiché sous la barre de recherche.
 * link : ouvre `url` (ou `queryUrl` avec {query} quand une recherche est saisie) ;
 * private : ouvre une fenêtre privée (sur `url` si fourni, sinon sur la recherche saisie ou l'accueil du moteur) ;
 * history : ouvre l'historique de Chrome.
 */
export interface Shortcut { id: string; label: string; kind: 'link' | 'private' | 'history'; icon: ShortcutIcon; url: string | null; queryUrl: string | null; enabled: boolean }

export interface Settings {
  updatedAt: string;
  origin: string;
  appearance: {
    mode: 'dark' | 'light' | 'system';
    primary: string;
    accent: string;
    /** Couleur de fond personnalisée ; null = fond du thème. */
    background: string | null;
    /** L'image elle-même reste sur l'appareil (non synchronisée). */
    useBackgroundImage: boolean;
    cardOpacity: number;
    cardSize: 'compact' | 'medium' | 'large';
    gap: number;
    density: 'compact' | 'comfortable' | 'spacious';
  };
  search: {
    engine: SearchEngineId;
    customUrl: string;
    /** Suggestions Google en direct (Google voit ce que vous tapez). */
    googleSuggestions: boolean;
    /** Mémorise vos recherches sur cet appareil (jamais synchronisées). */
    rememberSearches: boolean;
    showLens: boolean;
    shortcuts: Shortcut[];
  };
  general: { onboardingDone: boolean };
  show: {
    syncIndicator: boolean;
    favoriteTitles: boolean;
    projectStatus: boolean;
    taskDueDates: boolean;
    greeting: boolean;
  };
}

export interface DinoDocument {
  schemaVersion: number;
  updatedAt: string;
  categories: Category[];
  favorites: Favorite[];
  projects: Project[];
  notes: Note[];
  tasks: Task[];
  widgets: Widget[];
  settings: Settings;
}

export type CollectionKey = 'categories' | 'favorites' | 'projects' | 'notes' | 'tasks' | 'widgets';
export const COLLECTION_KEYS: readonly CollectionKey[] = [
  'categories', 'favorites', 'projects', 'notes', 'tasks', 'widgets',
];

export type EntityOf<K extends CollectionKey> = DinoDocument[K][number];

export type Result<T> = { ok: true; value: T } | { ok: false; error: string };
export const ok = <T>(value: T): Result<T> => ({ ok: true, value });
export const fail = <T = never>(error: string): Result<T> => ({ ok: false, error });
