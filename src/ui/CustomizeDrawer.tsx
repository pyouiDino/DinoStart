import { Link2, RotateCcw, X } from 'lucide-react';
import { useState } from 'react';
import { ShortcutsManager } from './ShortcutsManager';
import { placeWidget, resetWidgets, updateWidget } from '../core/ops';
import { WIDTH_PRESETS } from '../core/types';
import { Button, Field, IconButton, Modal, Seg, Toggle } from './common';
import { useApp } from './context';
import { ThemeAndPalette, useAppearance } from './AppearanceQuick';
import { SPAN_LABELS } from './widgets/WidgetConfigForm';
import { WIDGET_TITLES } from './widgets/widgets';

/** Panneau « Personnaliser » : tout se règle en direct, sans quitter l'accueil. */
export function CustomizeDrawer({ onClose }: { onClose: () => void }) {
  const { doc, store, act, confirm, go } = useApp();
  const { ap, set } = useAppearance();
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const sorted = [...doc.widgets].sort((a, b) => a.y - b.y || a.x - b.x);
  const reset = async () => {
    if (await confirm({ title: 'Restaurer la disposition ?', message: 'L’ordre, la taille, l’activation et la configuration de tous les widgets reviennent à leur état initial. Vos données (favoris, notes…) ne sont pas touchées.', confirmLabel: 'Restaurer', danger: true })) {
      await act(store.mutate((d, c) => resetWidgets(d, c)), 'Disposition restaurée');
    }
  };
  return (
    <aside className="drawer" aria-label="Personnaliser l’accueil">
      <header className="drawer-head"><h2>Personnaliser</h2><IconButton label="Fermer le panneau" onClick={onClose}><X size={18} /></IconButton></header>
      <div className="drawer-body">
        <p className="muted small">Les changements s’appliquent tout de suite. Sur la page, glissez les cartes pour les déplacer.</p>
        <section><h3>Thème et couleurs</h3><ThemeAndPalette />
          <div className="three-col pickers">
            <Field label="Principale"><input type="color" value={ap.primary} onChange={(e) => set({ primary: e.target.value })} /></Field>
            <Field label="Accent"><input type="color" value={ap.accent} onChange={(e) => set({ accent: e.target.value })} /></Field>
            <Field label="Fond"><input type="color" value={ap.background ?? '#0b1020'} onChange={(e) => set({ background: e.target.value })} /></Field>
          </div>
          {ap.background && <Button variant="ghost" onClick={() => set({ background: null })}>Revenir au fond du thème</Button>}
        </section>
        <section><h3>Taille et espacement</h3>
          <div className="form-grid">
            <div className="field"><span className="field-label">Taille des cartes</span><Seg label="Taille des cartes" value={ap.cardSize} onChange={(cardSize) => set({ cardSize })} options={[['compact', 'Petite'], ['medium', 'Moyenne'], ['large', 'Grande']] as const} /></div>
            <div className="field"><span className="field-label">Espace entre les cartes</span><Seg label="Espace entre les cartes" value={ap.gap} onChange={(gap) => set({ gap })} options={[[8, 'Serré'], [16, 'Normal'], [28, 'Large']] as const} /></div>
            <div className="field"><span className="field-label">Densité</span><Seg label="Densité" value={ap.density} onChange={(density) => set({ density })} options={[['compact', 'Compacte'], ['comfortable', 'Confortable'], ['spacious', 'Aérée']] as const} /></div>
          </div>
        </section>
        <section><h3>Éléments de la page</h3>
          <p className="muted small">Sur la page : saisissez une carte par sa barre pour la déplacer, tirez le coin en bas à droite pour la redimensionner. Ici : activez ou masquez, et choisissez une largeur rapide.</p>
          <ul className="widget-list">
            {sorted.map((w) => (
              <li key={w.type} className={w.enabled ? '' : 'off'}>
                <Toggle label={WIDGET_TITLES[w.type]} checked={w.enabled} onChange={(v) => void act(store.mutate((d, c) => updateWidget(d, c, w.type, { enabled: v })))} />
                <span className="widget-tools">
                  <select aria-label={`Largeur de ${WIDGET_TITLES[w.type]}`} value={WIDTH_PRESETS.includes(w.w as never) ? w.w : ''} disabled={!w.enabled}
                    onChange={(e) => void act(store.mutate((d, c) => placeWidget(d, c, w.type, { x: w.x, y: w.y, w: Number(e.target.value), h: w.h })))}>
                    {!WIDTH_PRESETS.includes(w.w as never) && <option value="">Sur mesure ({w.w}/12)</option>}
                    {WIDTH_PRESETS.map((s) => <option key={s} value={s}>{SPAN_LABELS[s]}</option>)}
                  </select>
                </span>
              </li>
            ))}
          </ul>
        </section>
        <section><h3>Raccourcis sous la recherche</h3>
          <Button variant="secondary" icon={<Link2 size={16} />} onClick={() => setShortcutsOpen(true)}>Gérer les boutons (privé, historique, IA…)</Button>
        </section>
        <section><h3>Plus de réglages</h3>
          <div className="row-gap"><Button variant="ghost" onClick={() => { onClose(); go({ view: 'settings', settingsTab: 'search' }); }}>Moteur et suggestions</Button>
            <Button variant="ghost" onClick={() => { onClose(); go({ view: 'settings', settingsTab: 'appearance' }); }}>Image de fond…</Button></div></section>
      </div>
      <footer className="drawer-foot"><Button variant="ghost" icon={<RotateCcw size={16} />} onClick={() => void reset()}>Tout restaurer</Button><Button variant="primary" onClick={onClose}>Terminer</Button></footer>
      {shortcutsOpen && <Modal wide title="Raccourcis sous la barre de recherche" onClose={() => setShortcutsOpen(false)} footer={<Button variant="primary" onClick={() => setShortcutsOpen(false)}>Terminer</Button>}><ShortcutsManager /></Modal>}
    </aside>
  );
}
