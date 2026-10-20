import type { Settings } from '../core/types';

const hexToRgb = (hex: string): [number, number, number] => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];
/** Luminance relative WCAG. */
export function luminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map((v) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
export const contrastRatio = (a: string, b: string): number => {
  const [l1, l2] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (l1 + 0.05) / (l2 + 0.05);
};
/** Texte lisible (noir ou blanc) sur une couleur donnée. */
export const readableOn = (hex: string): string => (contrastRatio(hex, '#ffffff') >= contrastRatio(hex, '#14100c') ? '#ffffff' : '#14100c');

const toHex = (rgb: number[]) => `#${rgb.map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0')).join('')}`;
const mix = (a: string, b: string, t: number) => { const x = hexToRgb(a), y = hexToRgb(b); return toHex(x.map((v, i) => v + (y[i]! - v) * t)); };

/**
 * Rapproche une couleur de texte/icône du noir (fond clair) ou du blanc (fond sombre) juste assez pour atteindre le
 * contraste demandé : un accent pâle reste lisible en thème clair, un accent sombre en thème sombre.
 * Si le contraste est déjà suffisant, la couleur n'est pas modifiée.
 */
export function ensureContrast(color: string, background: string, min = 3.2): string {
  if (contrastRatio(color, background) >= min) return color;
  const target = luminance(background) > 0.4 ? '#0b1020' : '#ffffff';
  for (let t = 0.06; t <= 1.0001; t += 0.06) { const c = mix(color, target, t); if (contrastRatio(c, background) >= min) return c; }
  return target;
}

export const CARD_MIN = { compact: '220px', medium: '280px', large: '340px' } as const;
export const DENSITY = { compact: '10px', comfortable: '16px', spacious: '24px' } as const;

export interface ThemeResult { effectiveMode: 'dark' | 'light'; vars: Record<string, string> }

export function computeTheme(s: Settings, systemDark: boolean): ThemeResult {
  const a = s.appearance;
  let effectiveMode: 'dark' | 'light' = a.mode === 'system' ? (systemDark ? 'dark' : 'light') : a.mode;
  if (a.background) effectiveMode = luminance(a.background) < 0.4 ? 'dark' : 'light'; // le texte suit le fond choisi
  const vars: Record<string, string> = {
    '--primary': a.primary,
    '--on-primary': readableOn(a.primary),
    '--accent': a.accent,
    '--card-opacity': `${Math.round(a.cardOpacity * 100)}%`,
    '--gap': `${a.gap}px`,
    '--card-min': CARD_MIN[a.cardSize],
    '--pad': DENSITY[a.density],
  };
  if (a.background) vars['--bg'] = a.background;
  // Surface des cartes (approximation de celle du CSS) pour garantir la lisibilité de l'accent utilisé comme texte.
  const base = a.background ?? (effectiveMode === 'dark' ? '#0b1020' : '#eef3fb');
  const surface = effectiveMode === 'dark' ? mix(base, '#b9ccff', 0.09) : mix(base, '#ffffff', 0.65);
  vars['--accent-ink'] = ensureContrast(a.accent, surface);
  return { effectiveMode, vars };
}

const ALL_VARS = ['--accent-ink', '--primary', '--on-primary', '--accent', '--card-opacity', '--gap', '--card-min', '--pad', '--bg'];

export function applyTheme(s: Settings, systemDark: boolean, bgImage: string | null): void {
  const { effectiveMode, vars } = computeTheme(s, systemDark);
  const root = document.documentElement;
  root.setAttribute('data-theme', effectiveMode);
  for (const k of ALL_VARS) root.style.removeProperty(k);
  for (const [k, v] of Object.entries(vars)) root.style.setProperty(k, v);
  if (s.appearance.useBackgroundImage && bgImage) {
    root.style.setProperty('--bg-image', `url("${bgImage}")`);
    root.setAttribute('data-bgimage', 'true');
  } else {
    root.style.removeProperty('--bg-image');
    root.removeAttribute('data-bgimage');
  }
  try { localStorage.setItem('dinostart:themeCache', JSON.stringify({ mode: effectiveMode, vars })); } catch { /* cache facultatif */ }
}

/** Réduit une image locale (taille et poids) avant de la stocker sur l'appareil. */
export async function prepareBackgroundImage(file: File): Promise<{ ok: true; dataUrl: string } | { ok: false; error: string }> {
  if (!/^image\/(png|jpe?g|webp|gif|avif)$/.test(file.type)) return { ok: false, error: 'Format non pris en charge (PNG, JPEG, WebP, GIF ou AVIF).' };
  if (file.size > 20 * 1024 * 1024) return { ok: false, error: 'Image trop volumineuse (20 Mo maximum).' };
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, 1920 / Math.max(bmp.width, bmp.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bmp.width * scale));
    canvas.height = Math.max(1, Math.round(bmp.height * scale));
    const ctx = canvas.getContext('2d');
    if (!ctx) return { ok: false, error: 'Traitement de l’image impossible.' };
    ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    bmp.close();
    const dataUrl = canvas.toDataURL('image/jpeg', 0.82);
    if (dataUrl.length > 4_000_000) return { ok: false, error: 'Image trop lourde même après réduction.' };
    return { ok: true, dataUrl };
  } catch {
    return { ok: false, error: 'Impossible de lire cette image.' };
  }
}
