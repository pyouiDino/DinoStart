import { DEFAULT_RECTS } from './layout';
import {
  EPOCH, SCHEMA_VERSION, WIDGET_TYPES,
  type Shortcut, type DinoDocument, type Settings, type Widget, type WidgetConfigs, type WidgetType,
} from './types';

export const DEFAULT_ORIGIN = 'default';

export const SEARCH_ENGINE_URLS = {
  google: { label: 'Google', url: 'https://www.google.com/search?q={query}' },
  duckduckgo: { label: 'DuckDuckGo', url: 'https://duckduckgo.com/?q={query}' },
  bing: { label: 'Bing', url: 'https://www.bing.com/search?q={query}' },
  brave: { label: 'Brave Search', url: 'https://search.brave.com/search?q={query}' },
  qwant: { label: 'Qwant', url: 'https://www.qwant.com/?q={query}' },
  ecosia: { label: 'Ecosia', url: 'https://www.ecosia.org/search?q={query}' },
} as const;

const ai = (id: string, label: string, url: string, queryUrl: string | null, enabled = true): Shortcut =>
  ({ id, label, kind: 'link', icon: { kind: 'icon', name: 'sparkles' }, url, queryUrl, enabled });

export const DEFAULT_SHORTCUTS: Shortcut[] = [
  { id: 'private', label: 'Navigation privée', kind: 'private', icon: { kind: 'icon', name: 'mask' }, url: null, queryUrl: null, enabled: true },
  { id: 'history', label: 'Historique', kind: 'history', icon: { kind: 'icon', name: 'history' }, url: null, queryUrl: null, enabled: true },
  ai('chatgpt', 'ChatGPT', 'https://chatgpt.com/', 'https://chatgpt.com/?q={query}'),
  ai('gemini', 'Gemini', 'https://gemini.google.com/app', null),
  ai('claude', 'Claude', 'https://claude.ai/new', 'https://claude.ai/new?q={query}'),
  ai('copilot', 'Copilot', 'https://copilot.microsoft.com/', null),
  ai('perplexity', 'Perplexity', 'https://www.perplexity.ai/', 'https://www.perplexity.ai/search?q={query}', false),
];

export function defaultWidgetConfig<T extends WidgetType>(type: T): WidgetConfigs[T] {
  const configs: WidgetConfigs = {
    clock: { hour12: false, seconds: false },
    date: { style: 'long' },
    search: { placeholder: 'Rechercher dans DinoStart ou sur le Web' },
    favorites: { categoryId: null, layout: 'folders' },
    projects: { limit: 5, status: 'all' },
    tasks: { limit: 8, hideDone: true },
    quickNotes: { limit: 4 },
    quickLinks: {},
  };
  return structuredClone(configs[type]);
}

export function defaultWidgets(now: string = EPOCH, origin: string = DEFAULT_ORIGIN): Widget[] {
  return WIDGET_TYPES.map((type) => ({
    id: type,
    type,
    enabled: true,
    ...DEFAULT_RECTS[type],
    config: defaultWidgetConfig(type),
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    origin,
  })) as Widget[];
}

export function defaultSettings(now: string = EPOCH, origin: string = DEFAULT_ORIGIN): Settings {
  return {
    updatedAt: now,
    origin,
    appearance: {
      mode: 'dark',
      primary: '#5194f5', // bleu du logo
      accent: '#fdc096', // pêche du ventre du dino
      background: null,
      useBackgroundImage: false,
      cardOpacity: 0.92,
      cardSize: 'medium',
      gap: 16,
      density: 'comfortable',
    },
    search: {
      engine: 'google', customUrl: '', googleSuggestions: true, rememberSearches: true,
      showLens: true, shortcuts: structuredClone(DEFAULT_SHORTCUTS),
    },
    general: { onboardingDone: false },
    show: { syncIndicator: true, favoriteTitles: true, projectStatus: true, taskDueDates: true, greeting: true },
  };
}

/**
 * Document vierge et déterministe (dates à l'époque). Il sert aussi de « base » de fusion
 * lorsqu'un appareil n'a jamais synchronisé : un widget non modifié ne crée alors aucun conflit.
 */
export function createDefaultDocument(): DinoDocument {
  return {
    schemaVersion: SCHEMA_VERSION,
    updatedAt: EPOCH,
    categories: [],
    favorites: [],
    projects: [],
    notes: [],
    tasks: [],
    widgets: defaultWidgets(),
    settings: defaultSettings(),
  };
}
