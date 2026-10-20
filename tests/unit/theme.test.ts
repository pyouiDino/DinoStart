import { describe, expect, it } from 'vitest';
import { createDefaultDocument } from '../../src/core/defaults';
import { computeTheme, contrastRatio, ensureContrast, readableOn } from '../../src/ui/theme';

describe('thème : lisibilité', () => {
  it('ne modifie pas une couleur déjà assez contrastée', () => {
    expect(ensureContrast('#0b1020', '#fafbff')).toBe('#0b1020');
    expect(ensureContrast('#ffffff', '#141b30')).toBe('#ffffff');
  });
  it('fonce un accent pâle sur fond clair et éclaircit un accent sombre sur fond sombre', () => {
    const pale = ensureContrast('#fdc096', '#fafbff');
    expect(pale).not.toBe('#fdc096');
    expect(contrastRatio(pale, '#fafbff')).toBeGreaterThanOrEqual(3.2);
    const dark = ensureContrast('#1e2d90', '#141b30');
    expect(contrastRatio(dark, '#141b30')).toBeGreaterThanOrEqual(3.2);
  });
  it('garantit le contraste de l’accent par défaut (pêche) en thème sombre ET clair', () => {
    const s = createDefaultDocument().settings;
    for (const mode of ['dark', 'light'] as const) {
      const t = computeTheme({ ...s, appearance: { ...s.appearance, mode } }, false);
      const surface = mode === 'dark' ? '#141b30' : '#fafbff';
      expect(t.effectiveMode).toBe(mode);
      expect(contrastRatio(t.vars['--accent-ink']!, surface)).toBeGreaterThanOrEqual(3);
    }
  });
  it('garantit le contraste pour n’importe quel accent (balayage de teintes)', () => {
    const s = createDefaultDocument().settings;
    for (let h = 0; h < 256; h += 17) for (const mode of ['dark', 'light'] as const) {
      const accent = `#${[h, 255 - h, (h * 7) % 256].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
      const t = computeTheme({ ...s, appearance: { ...s.appearance, mode, accent } }, false);
      const surface = mode === 'dark' ? '#141b30' : '#fafbff';
      expect(contrastRatio(t.vars['--accent-ink']!, surface), accent + mode).toBeGreaterThanOrEqual(3);
    }
  });
  it('le texte des boutons principaux est toujours lisible (noir ou blanc selon la couleur)', () => {
    for (const c of ['#5194f5', '#f97316', '#22c55e', '#8b5cf6', '#111111', '#ffffff']) expect(contrastRatio(readableOn(c), c)).toBeGreaterThanOrEqual(3.5);
  });
  it('un fond personnalisé clair bascule le texte en sombre', () => {
    const s = createDefaultDocument().settings;
    expect(computeTheme({ ...s, appearance: { ...s.appearance, background: '#fff7e6' } }, true).effectiveMode).toBe('light');
    expect(computeTheme({ ...s, appearance: { ...s.appearance, background: '#101820' } }, false).effectiveMode).toBe('dark');
  });
});
