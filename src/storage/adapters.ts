/** Abstraction minimale du stockage clé/valeur (chrome.storage.local en production, mémoire en test). */
export interface StorageAdapter {
  get(keys: string[]): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(keys: string[]): Promise<void>;
  /** Notifie les changements faits par un autre onglet/contexte. Renvoie la fonction de désabonnement. */
  subscribe?(cb: (changedKeys: string[]) => void): () => void;
}

export class ChromeStorageAdapter implements StorageAdapter {
  get(keys: string[]) { return chrome.storage.local.get(keys) as Promise<Record<string, unknown>>; }
  set(items: Record<string, unknown>) { return chrome.storage.local.set(items); }
  remove(keys: string[]) { return chrome.storage.local.remove(keys); }
  subscribe(cb: (changedKeys: string[]) => void) {
    const listener = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area === 'local') cb(Object.keys(changes));
    };
    chrome.storage.onChanged.addListener(listener);
    return () => chrome.storage.onChanged.removeListener(listener);
  }
}

/** Stockage en mémoire : utilisé dans les tests automatisés (jamais comme substitut dans l'extension réelle). */
export class MemoryStorageAdapter implements StorageAdapter {
  private data = new Map<string, unknown>();
  private listeners = new Set<(keys: string[]) => void>();
  /** Nombre d'appels `set` à faire échouer (simulation d'une erreur d'écriture). */
  failNextSets = 0;

  async get(keys: string[]) {
    const out: Record<string, unknown> = {};
    for (const k of keys) if (this.data.has(k)) out[k] = structuredClone(this.data.get(k));
    return out;
  }
  async set(items: Record<string, unknown>) {
    if (this.failNextSets > 0) { this.failNextSets--; throw new Error('QUOTA_BYTES quota exceeded (simulé)'); }
    for (const [k, v] of Object.entries(items)) this.data.set(k, structuredClone(v));
    this.listeners.forEach((l) => l(Object.keys(items)));
  }
  async remove(keys: string[]) { keys.forEach((k) => this.data.delete(k)); this.listeners.forEach((l) => l(keys)); }
  subscribe(cb: (keys: string[]) => void) { this.listeners.add(cb); return () => { this.listeners.delete(cb); }; }
  dump(): Record<string, unknown> { return Object.fromEntries(this.data); }
}

export function createDefaultAdapter(): StorageAdapter {
  if (typeof chrome === 'undefined' || !chrome.storage?.local) {
    throw new Error('chrome.storage indisponible : DinoStart doit être exécuté comme extension Chrome.');
  }
  return new ChromeStorageAdapter();
}
