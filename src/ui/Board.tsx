import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent as RPointerEvent, type ReactNode } from 'react';
import { EyeOff, GripVertical, Settings2 } from 'lucide-react';
import { clampRect, COLS, layoutRows, MIN_SIZE, resolveLayout, sameRect, snapMove, snapResize, type Rect } from '../core/layout';
import type { WidgetType } from '../core/types';
import { IconButton } from './common';

export const ROW_H = 40;
const STACK_BELOW = 720; // en dessous (px), les cartes s'empilent : pas de placement libre sur un écran étroit

export interface BoardItem { type: WidgetType; rect: Rect; title: string; node: ReactNode }
interface Drag { type: WidgetType; mode: 'move' | 'resize'; sx: number; sy: number; origin: Rect; dx: number; dy: number; target: Rect }

/**
 * Tableau de cartes à placement libre sur une grille de 12 colonnes.
 * Mode édition : on déplace une carte en la saisissant par sa barre, on la redimensionne avec la poignée
 * du coin en bas à droite ; les autres cartes se poussent en direct pour lui faire de la place.
 * Au clavier : flèches sur la poignée de déplacement (Maj + flèches pour redimensionner).
 */
export function Board({ items, editing, gap, onPlace, onConfigure, onHide }: {
  items: BoardItem[]; editing: boolean; gap: number;
  onPlace: (type: WidgetType, rect: Rect) => void; onConfigure: (type: WidgetType) => void; onHide: (type: WidgetType) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [measured, setMeasured] = useState(0);
  const [drag, setDrag] = useState<Drag | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setMeasured(el.clientWidth);
    measure();
    if (typeof ResizeObserver !== 'undefined') { const ro = new ResizeObserver(measure); ro.observe(el); return () => ro.disconnect(); }
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, []);

  const width = measured || 1200; // sans mesure (tests), largeur de bureau
  const stacked = width < STACK_BELOW;
  const colW = (width - gap * (COLS - 1)) / COLS;
  const unitX = colW + gap, unitY = ROW_H + gap;
  const layout = useMemo(() => Object.fromEntries(items.map((i) => [i.type, i.rect])) as Record<string, Rect>, [items]);
  const preview = drag ? resolveLayout(layout, drag.type, drag.target) : layout;
  const rows = layoutRows(preview) + (editing ? 4 : 0);

  const px = (r: Rect) => ({ left: r.x * unitX, top: r.y * unitY, width: r.w * unitX - gap, height: r.h * unitY - gap });
  const minPx = (t: WidgetType) => ({ w: MIN_SIZE[t].w * unitX - gap, h: MIN_SIZE[t].h * unitY - gap });

  const begin = (e: RPointerEvent<HTMLElement>, type: WidgetType, mode: Drag['mode']) => {
    if (e.button !== 0 || stacked) return;
    if (mode === 'move' && (e.target as HTMLElement).closest('button:not(.drag-grip)')) return; // les boutons de la barre restent cliquables
    e.preventDefault();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    const origin = layout[type]!;
    setDrag({ type, mode, sx: e.clientX, sy: e.clientY, origin, dx: 0, dy: 0, target: origin });
  };
  const move = (e: RPointerEvent<HTMLElement>) => {
    if (!drag) return;
    const dx = e.clientX - drag.sx, dy = e.clientY - drag.sy;
    const min = MIN_SIZE[drag.type];
    const target = drag.mode === 'move' ? snapMove(drag.origin, dx, dy, unitX, unitY, min) : snapResize(drag.origin, dx, dy, unitX, unitY, gap, min);
    setDrag({ ...drag, dx, dy, target });
  };
  const end = (commit: boolean) => {
    if (drag && commit && !sameRect(drag.target, drag.origin)) onPlace(drag.type, drag.target);
    setDrag(null);
  };
  const keys = (e: KeyboardEvent<HTMLElement>, type: WidgetType, forceResize = false) => {
    const d = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
    if (!d || stacked) return;
    e.preventDefault();
    const r = layout[type]!;
    const next = e.shiftKey || forceResize ? { ...r, w: r.w + d[0]!, h: r.h + d[1]! } : { ...r, x: r.x + d[0]!, y: r.y + d[1]! };
    const clamped = clampRect(next, MIN_SIZE[type]);
    if (!sameRect(clamped, r)) onPlace(type, clamped);
  };

  const order = [...items].sort((a, b) => a.rect.y - b.rect.y || a.rect.x - b.rect.x);
  const ghost = drag ? px(preview[drag.type]!) : null;

  return (
    <div ref={ref} className={`board ${stacked ? 'board-stacked' : ''} ${editing ? 'board-editing' : ''} ${drag ? 'board-dragging' : ''}`}
      style={stacked ? undefined : { height: Math.max(0, rows * unitY - gap), ['--unit-x' as string]: `${unitX}px`, ['--unit-y' as string]: `${unitY}px` }}>
      {ghost && <div className="ghost" style={ghost} aria-hidden="true" />}
      {order.map((it) => {
        const r = preview[it.type]!;
        const dragged = drag?.type === it.type;
        let style: Record<string, number | string> = stacked ? { marginBottom: gap } : { ...px(r) };
        if (dragged && drag && !stacked) {
          if (drag.mode === 'move') style = { ...px(drag.origin), left: drag.origin.x * unitX + drag.dx, top: drag.origin.y * unitY + drag.dy };
          else { const m = minPx(it.type); style = { ...px(drag.origin), width: Math.max(m.w, drag.origin.w * unitX - gap + drag.dx), height: Math.max(m.h, drag.origin.h * unitY - gap + drag.dy) }; }
        }
        return (
          <div key={it.type} className={`cell cell-${it.type} ${dragged ? 'cell-dragging' : ''}`} style={style} data-widget={it.type}>
            <div className={editing ? 'cell-inert' : 'cell-fill'} {...(editing ? ({ inert: '' } as object) : {})}>{it.node}</div>
            {editing && (
              <>
                <div className="cell-bar" role="toolbar" aria-label={`Disposition de ${it.title}`} onPointerDown={(e) => begin(e, it.type, 'move')} onPointerMove={move} onPointerUp={() => end(true)} onPointerCancel={() => end(false)}>
                  <button type="button" className="drag-grip" aria-label={`Déplacer ${it.title} : flèches du clavier ; Maj + flèches pour redimensionner`} title="Glisser pour déplacer" onKeyDown={(e) => keys(e, it.type)}><GripVertical size={16} /></button>
                  <strong className="cell-title">{it.title}</strong>
                  <span className="spacer" />
                  <IconButton label={`Configurer ${it.title}`} onClick={() => onConfigure(it.type)}><Settings2 size={16} /></IconButton>
                  <IconButton label="Masquer" onClick={() => onHide(it.type)}><EyeOff size={16} /></IconButton>
                </div>
                {!stacked && (
                  <button type="button" className="resize-handle" aria-label={`Redimensionner ${it.title} : flèches du clavier`} title="Tirer pour redimensionner"
                    onPointerDown={(e) => begin(e, it.type, 'resize')} onPointerMove={move} onPointerUp={() => end(true)} onPointerCancel={() => end(false)} onKeyDown={(e) => keys(e, it.type, true)}>
                    <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="M14 6L6 14M14 10l-4 4M14 2L2 14" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" fill="none" /></svg>
                  </button>
                )}
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}
