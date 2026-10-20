import { useMemo, useState } from 'react';
import { SlidersHorizontal } from 'lucide-react';
import { placeWidget, updateWidget } from '../../core/ops';
import type { WidgetType } from '../../core/types';
import { Board, type BoardItem } from '../Board';
import { Button, Modal } from '../common';
import { useApp } from '../context';
import { CustomizeDrawer } from '../CustomizeDrawer';
import { renderWidget, WIDGET_TITLES } from '../widgets/widgets';
import { WidgetConfigForm } from '../widgets/WidgetConfigForm';

export function HomeView() {
  const { doc, store, act } = useApp();
  const [editing, setEditing] = useState(false);
  const [configFor, setConfigFor] = useState<WidgetType | null>(null);

  const items = useMemo<BoardItem[]>(() => doc.widgets.filter((w) => w.enabled).map((w) => ({
    type: w.type, title: WIDGET_TITLES[w.type], rect: { x: w.x, y: w.y, w: w.w, h: w.h }, node: renderWidget(w),
  })), [doc.widgets]);
  const hidden = doc.widgets.filter((w) => !w.enabled);

  return (
    <div className={`home ${editing ? 'with-drawer' : ''}`}>
      {!items.length && <p className="muted center pad">Toutes les cartes sont masquées. Cliquez sur « Personnaliser » pour en réactiver.</p>}
      <Board items={items} editing={editing} gap={doc.settings.appearance.gap}
        onPlace={(type, rect) => void act(store.mutate((d, c) => placeWidget(d, c, type, rect)))}
        onConfigure={setConfigFor}
        onHide={(type) => void act(store.mutate((d, c) => updateWidget(d, c, type, { enabled: false })))} />
      {editing && <CustomizeDrawer onClose={() => setEditing(false)} />}
      {editing && hidden.length > 0 && <p className="muted pad-sm">Cartes masquées : {hidden.map((w) => WIDGET_TITLES[w.type]).join(', ')}. Réactivez-les dans le panneau « Éléments de la page ».</p>}
      <div className="home-foot">
        <Button variant={editing ? 'secondary' : 'primary'} icon={<SlidersHorizontal size={18} />} onClick={() => setEditing((v) => !v)} aria-pressed={editing}>{editing ? 'Terminer' : 'Personnaliser'}</Button>
      </div>
      {configFor && (
        <Modal title={`Configurer : ${WIDGET_TITLES[configFor]}`} onClose={() => setConfigFor(null)} footer={<Button variant="primary" onClick={() => setConfigFor(null)}>Fermer</Button>}>
          <WidgetConfigForm widget={doc.widgets.find((w) => w.type === configFor)!} />
        </Modal>
      )}
    </div>
  );
}
