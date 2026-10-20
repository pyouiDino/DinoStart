// Actions du navigateur : navigation privée, historique, icônes de sites fournies localement par Chrome.
import { fail, ok, type Result } from '../core/types';

const hasChrome = () => typeof chrome !== 'undefined';

/**
 * Icône du site fournie par Chrome (API _favicon, permission « favicon ») : aucune requête vers le site ni vers un tiers.
 * Seuls les sites déjà visités ont une vraie icône ; sinon Chrome renvoie une icône générique.
 */
export function faviconUrl(pageUrl: string, size = 32): string | null {
  if (!hasChrome() || !chrome.runtime?.getURL) return null;
  try {
    const u = new URL(chrome.runtime.getURL('/_favicon/'));
    u.searchParams.set('pageUrl', pageUrl);
    u.searchParams.set('size', String(size));
    return u.toString();
  } catch {
    return null;
  }
}

/** Ouvre une fenêtre de navigation privée. Chrome peut la refuser (stratégie de l'organisation, mode désactivé). */
export async function openPrivateWindow(url: string): Promise<Result<true>> {
  if (!hasChrome() || !chrome.windows?.create) return fail('Navigation privée indisponible ici. Utilisez Ctrl+Maj+N.');
  try {
    await chrome.windows.create({ incognito: true, url });
    return ok(true as const);
  } catch {
    return fail('Chrome n’a pas ouvert la fenêtre privée. Utilisez Ctrl+Maj+N.');
  }
}

/** Numéro de version de l'extension (celui de chrome://extensions). */
export function getVersion(): string {
  try { return chrome.runtime.getManifest().version; } catch { return '—'; }
}

export type OpenMode = 'newtab' | 'page';
/** newtab : DinoStart remplace le nouvel onglet ; page : version « page d'accueil » (ouverte par bouton, raccourci ou page d'accueil). */
export function getOpenMode(): OpenMode {
  try { return chrome.runtime.getManifest().chrome_url_overrides?.newtab ? 'newtab' : 'page'; } catch { return 'newtab'; }
}
/** Adresse de DinoStart, à coller comme page d'accueil ou page de démarrage de Chrome. */
export function dinoStartPageUrl(): string | null {
  try { return chrome.runtime.getURL('newtab.html'); } catch { return null; }
}

/** Pages de réglages de Chrome que DinoStart peut ouvrir (liste fermée : aucune adresse arbitraire). */
export const CHROME_PAGES = {
  appearance: 'chrome://settings/appearance',
  startup: 'chrome://settings/onStartup',
  shortcuts: 'chrome://extensions/shortcuts',
} as const;
export async function openChromePage(key: keyof typeof CHROME_PAGES): Promise<Result<true>> {
  if (!hasChrome() || !chrome.tabs?.create) return fail(`Ouverture impossible ici. Tapez ${CHROME_PAGES[key]} dans la barre d’adresse.`);
  try { await chrome.tabs.create({ url: CHROME_PAGES[key] }); return ok(true as const); } catch { return fail(`Chrome n’a pas ouvert la page. Tapez ${CHROME_PAGES[key]} dans la barre d’adresse.`); }
}

/** Ouvre la page d'historique de Chrome dans un nouvel onglet. */
export async function openChromeHistory(): Promise<Result<true>> {
  if (!hasChrome() || !chrome.tabs?.create) return fail('Ouverture impossible ici. Utilisez Ctrl+H.');
  try {
    await chrome.tabs.create({ url: 'chrome://history' });
    return ok(true as const);
  } catch {
    return fail('Chrome n’a pas ouvert l’historique. Utilisez Ctrl+H.');
  }
}
