import { updateSettings } from '../core/ops';
import type { Settings } from '../core/types';
import { Seg } from './common';
import { useApp } from './context';
import { COLOR_PRESETS } from './presets';

type Ap = Settings['appearance'];

/** Réglages d'apparence les plus courants : thème et palette (utilisés par l'assistant et le panneau Personnaliser). */
export function useAppearance() {
  const { doc, store, act } = useApp();
  const set = (patch: Partial<Ap>) => void act(store.mutate((d, c) => updateSettings(d, c, (s) => ({ ...s, appearance: { ...s.appearance, ...patch } }))));
  return { ap: doc.settings.appearance, set };
}

export function ThemeAndPalette() {
  const { ap, set } = useAppearance();
  return (
    <div className="form-grid">
      <div className="field"><span className="field-label">Thème</span>
        <Seg label="Thème" value={ap.mode} onChange={(mode) => set({ mode })} options={[['dark', 'Sombre'], ['light', 'Clair'], ['system', 'Système']] as const} /></div>
      <div className="field"><span className="field-label">Couleurs</span>
        <div className="presets" role="group" aria-label="Palettes de couleurs">
          {COLOR_PRESETS.map((p) => {
            const on = ap.primary === p.primary && ap.accent === p.accent;
            return (
              <button type="button" key={p.id} className={`preset ${on ? 'sel' : ''}`} aria-pressed={on} onClick={() => set({ primary: p.primary, accent: p.accent })} title={p.label}>
                <span className="preset-dot" style={{ background: `linear-gradient(135deg, ${p.primary} 50%, ${p.accent} 50%)` }} /><span>{p.label}</span>
              </button>
            );
          })}
        </div></div>
    </div>
  );
}
