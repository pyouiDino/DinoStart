import { live, placeWidget, updateWidget, resetWidget } from '../../core/ops';
import { PROJECT_STATUSES, WIDTH_PRESETS, type Widget, type WidgetConfigs, type WidgetType } from '../../core/types';
import { Button, Field, Toggle } from '../common';
import { useApp } from '../context';
import { STATUS_LABELS, WIDGET_TITLES } from './widgets';

export const SPAN_LABELS: Record<number, string> = { 3: 'Très étroit (¼)', 4: 'Étroit (⅓)', 6: 'Moyen (½)', 8: 'Large (⅔)', 12: 'Pleine largeur' };

/** Formulaire de configuration individuelle d'un widget (utilisé sur l'accueil et dans les paramètres). */
export function WidgetConfigForm({ widget }: { widget: Widget }) {
  const { store, doc, act } = useApp();
  const type = widget.type;
  const patch = (config: Partial<WidgetConfigs[WidgetType]>) => void act(store.mutate((d, c) => updateWidget(d, c, type, { config })));
  const cfg = widget.config as unknown as Record<string, unknown>;
  const cats = live(doc.categories);
  return (
    <div className="form-grid">
      <Field label="Largeur" hint="Vous pouvez aussi redimensionner la carte en tirant son coin, dans « Personnaliser ».">
        <select value={WIDTH_PRESETS.includes(widget.w as never) ? widget.w : ''} onChange={(e) => void act(store.mutate((d, c) => placeWidget(d, c, type, { x: widget.x, y: widget.y, w: Number(e.target.value), h: widget.h })))}>
          {!WIDTH_PRESETS.includes(widget.w as never) && <option value="">Sur mesure ({widget.w}/12)</option>}
          {WIDTH_PRESETS.map((s) => <option key={s} value={s}>{SPAN_LABELS[s]}</option>)}
        </select>
      </Field>
      {type === 'clock' && (<>
        <Toggle label="Format 12 heures" checked={cfg.hour12 === true} onChange={(v) => patch({ hour12: v })} />
        <Toggle label="Afficher les secondes" checked={cfg.seconds === true} onChange={(v) => patch({ seconds: v })} />
      </>)}
      {type === 'date' && (
        <Field label="Format"><select value={String(cfg.style)} onChange={(e) => patch({ style: e.target.value as 'long' | 'short' })}><option value="long">Long (jeudi 15 octobre)</option><option value="short">Court (15/10/2026)</option></select></Field>
      )}
      {type === 'search' && (
        <Field label="Texte d’invite"><input value={String(cfg.placeholder ?? '')} maxLength={80} onChange={(e) => patch({ placeholder: e.target.value })} /></Field>
      )}
      {type === 'favorites' && (<>
        <Field label="Affichage"><select value={String(cfg.layout ?? 'folders')} onChange={(e) => patch({ layout: e.target.value as 'folders' | 'sections' })}>
          <option value="folders">Dossiers (comme sur un téléphone)</option><option value="sections">Sections par catégorie</option></select></Field>
        <Field label="Catégorie affichée"><select value={(cfg.categoryId as string | null) ?? ''} onChange={(e) => patch({ categoryId: e.target.value || null })}>
          <option value="">Toutes les catégories</option>{cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select></Field>
      </>)}
      {type === 'projects' && (<>
        <Field label="Nombre de projets"><input type="number" min={1} max={20} value={Number(cfg.limit)} onChange={(e) => patch({ limit: Math.max(1, Math.min(20, Number(e.target.value) || 1)) })} /></Field>
        <Field label="Statut"><select value={String(cfg.status)} onChange={(e) => patch({ status: e.target.value as 'all' })}><option value="all">Tous</option>{PROJECT_STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}</select></Field>
      </>)}
      {type === 'tasks' && (<>
        <Field label="Nombre de tâches"><input type="number" min={1} max={30} value={Number(cfg.limit)} onChange={(e) => patch({ limit: Math.max(1, Math.min(30, Number(e.target.value) || 1)) })} /></Field>
        <Toggle label="Masquer les tâches terminées" checked={cfg.hideDone === true} onChange={(v) => patch({ hideDone: v })} />
      </>)}
      {type === 'quickNotes' && (
        <Field label="Notes affichées"><input type="number" min={1} max={10} value={Number(cfg.limit)} onChange={(e) => patch({ limit: Math.max(1, Math.min(10, Number(e.target.value) || 1)) })} /></Field>
      )}
      {type === 'quickLinks' && <p className="muted">Affiche les favoris marqués d’une étoile. Aucun réglage supplémentaire.</p>}
      <div><Button variant="ghost" onClick={() => void act(store.mutate((d, c) => resetWidget(d, c, type)), `« ${WIDGET_TITLES[type]} » restauré`)}>Restaurer ce widget</Button></div>
    </div>
  );
}
