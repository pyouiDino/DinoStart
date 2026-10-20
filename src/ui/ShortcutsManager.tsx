import { useState } from 'react';
import { ArrowDown, ArrowUp, Pencil, Plus, RotateCcw, Trash2 } from 'lucide-react';
import { DEFAULT_SHORTCUTS } from '../core/defaults';
import { updateSettings } from '../core/ops';
import { SHORTCUT_ICONS, type Shortcut, type ShortcutIcon } from '../core/types';
import { validateSearchTemplate, validateUrl } from '../core/url';
import { Button, Field, IconButton, Modal, Toggle } from './common';
import { useApp } from './context';
import { ShortcutGlyph, SHORTCUT_ICON_LABELS, SHORTCUT_ICON_MAP } from './shortcutIcons';

const KIND_LABEL = { link: 'Lien', private: 'Navigation privée', history: 'Historique de Chrome' } as const;

function ShortcutEditor({ initial, onSave, onClose }: { initial: Shortcut | null; onSave: (s: Shortcut) => void; onClose: () => void }) {
  const [label, setLabel] = useState(initial?.label ?? '');
  const [kind, setKind] = useState<Shortcut['kind']>(initial?.kind ?? 'link');
  const [url, setUrl] = useState(initial?.url ?? '');
  const [queryUrl, setQueryUrl] = useState(initial?.queryUrl ?? '');
  const [icon, setIcon] = useState<ShortcutIcon>(initial?.icon ?? { kind: 'icon', name: 'star' });
  const [touched, setTouched] = useState(false);

  const urlNeeded = kind === 'link';
  const urlCheck = url.trim() ? validateUrl(url) : null;
  const urlError = !touched ? null : urlNeeded && !url.trim() ? 'Une adresse est nécessaire pour un lien.' : urlCheck && !urlCheck.ok ? urlCheck.error : null;
  const qCheck = kind === 'link' && queryUrl.trim() ? validateSearchTemplate(queryUrl) : null;
  const qError = touched && qCheck && !qCheck.ok ? qCheck.error : null;
  const labelError = touched && !label.trim() ? 'Le nom est obligatoire.' : null;
  const previewUrl = urlCheck?.ok ? urlCheck.value : null;

  const save = () => {
    setTouched(true);
    if (!label.trim() || (urlNeeded && !urlCheck?.ok) || (urlCheck && !urlCheck.ok) || (qCheck && !qCheck.ok)) return;
    onSave({
      id: initial?.id ?? crypto.randomUUID(), label: label.trim(), kind, icon,
      url: kind === 'history' ? null : previewUrl, queryUrl: kind === 'link' && qCheck?.ok ? qCheck.value : null, enabled: initial?.enabled ?? true,
    });
  };
  return (
    <Modal wide title={initial ? 'Modifier le raccourci' : 'Nouveau raccourci'} onClose={onClose} footer={<><Button variant="ghost" onClick={onClose}>Annuler</Button><Button variant="primary" onClick={save}>{initial ? 'Enregistrer' : 'Ajouter'}</Button></>}>
      <form className="form-grid" onSubmit={(e) => { e.preventDefault(); save(); }}>
        <div className="two-col">
          <Field label="Nom affiché" error={labelError}><input value={label} onChange={(e) => setLabel(e.target.value)} maxLength={40} autoFocus /></Field>
          <Field label="Type"><select value={kind} onChange={(e) => setKind(e.target.value as Shortcut['kind'])}>
            <option value="link">Lien vers un site</option><option value="private">Navigation privée</option><option value="history">Historique de Chrome</option></select></Field>
        </div>
        {kind !== 'history' && (
          <Field label={kind === 'link' ? 'Adresse du site' : 'Adresse à ouvrir en privé (facultatif)'} error={urlError}
            hint={kind === 'private' ? 'Vide : ouvre la recherche que vous avez tapée, ou la page d’accueil de votre moteur.' : urlCheck?.ok && urlCheck.value !== url.trim() ? `Sera enregistrée : ${urlCheck.value}` : 'http ou https.'}>
            <input value={url} onChange={(e) => setUrl(e.target.value)} spellCheck={false} placeholder="exemple.fr" inputMode="url" /></Field>
        )}
        {kind === 'link' && (
          <Field label="Adresse avec la question (facultatif)" error={qError} hint="Doit contenir {query}, par exemple https://exemple.fr/?q={query}. Sert à envoyer ce que vous avez tapé dans la barre ; selon le site, la question peut ne pas être pré-remplie.">
            <input value={queryUrl} onChange={(e) => setQueryUrl(e.target.value)} spellCheck={false} /></Field>
        )}
        <fieldset className="field"><legend className="field-label">Icône</legend>
          <div className="icon-picker">
            <button type="button" className={`wide ${icon.kind === 'auto' ? 'sel' : ''}`} aria-pressed={icon.kind === 'auto'} onClick={() => setIcon({ kind: 'auto' })} title="Icône du site, fournie par Chrome (sites déjà visités)">Icône du site</button>
            {SHORTCUT_ICONS.map((n) => { const I = SHORTCUT_ICON_MAP[n]; const on = icon.kind === 'icon' && icon.name === n; return (
              <button type="button" key={n} className={on ? 'sel' : ''} aria-pressed={on} aria-label={SHORTCUT_ICON_LABELS[n]} title={SHORTCUT_ICON_LABELS[n]} onClick={() => setIcon({ kind: 'icon', name: n })}><I size={18} /></button>
            ); })}
          </div>
          <p className="muted small">Aperçu : <span className="pill pill-demo"><ShortcutGlyph shortcut={{ icon, url: previewUrl, kind }} />{label.trim() || 'Nom'}</span></p>
        </fieldset>
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}

/** Gestion complète des boutons sous la barre de recherche : créer, modifier, réordonner, masquer, supprimer. */
export function ShortcutsManager() {
  const { doc, store, act, confirm } = useApp();
  const list = doc.settings.search.shortcuts;
  const [editing, setEditing] = useState<Shortcut | 'new' | null>(null);
  const commit = (fn: (l: Shortcut[]) => Shortcut[], ok?: string) =>
    act(store.mutate((d, c) => updateSettings(d, c, (x) => ({ ...x, search: { ...x.search, shortcuts: fn(x.search.shortcuts) } }))), ok);
  const move = (i: number, delta: number) => void commit((l) => { const n = [...l]; const j = i + delta; if (j < 0 || j >= n.length) return l; [n[i], n[j]] = [n[j]!, n[i]!]; return n; });
  const save = async (sc: Shortcut) => {
    const exists = list.some((x) => x.id === sc.id);
    const r = await commit((l) => (exists ? l.map((x) => (x.id === sc.id ? sc : x)) : [...l, sc]), exists ? 'Raccourci modifié' : 'Raccourci ajouté');
    if (r.ok) setEditing(null);
  };
  const remove = async (sc: Shortcut) => { if (await confirm({ title: `Supprimer « ${sc.label} » ?`, message: 'Ce raccourci disparaît de la barre de recherche. Vous pourrez le recréer ou restaurer ceux par défaut.', confirmLabel: 'Supprimer', danger: true })) await commit((l) => l.filter((x) => x.id !== sc.id), 'Raccourci supprimé'); };
  const reset = async () => { if (await confirm({ title: 'Restaurer les raccourcis par défaut ?', message: 'Votre liste de raccourcis est remplacée par celle d’origine (navigation privée, historique, assistants IA). Les raccourcis que vous avez créés sont supprimés.', confirmLabel: 'Restaurer', danger: true })) await commit(() => structuredClone(DEFAULT_SHORTCUTS), 'Raccourcis restaurés'); };

  return (
    <div className="form-grid">
      <p className="muted small">Boutons affichés sous la barre de recherche : renommez-les, changez leur icône, réordonnez-les, ajoutez les vôtres (sites, navigation privée, historique) ou masquez ceux qui ne vous servent pas.</p>
      {!list.length && <p className="muted">Aucun raccourci. Ajoutez-en un ci-dessous.</p>}
      <ul className="widget-list shortcut-list">
        {list.map((sc, i) => (
          <li key={sc.id} className={sc.enabled ? '' : 'off'}>
            <span className="sc-glyph"><ShortcutGlyph shortcut={sc} size={18} /></span>
            <span className="sc-main"><strong>{sc.label}</strong><span className="muted small ellipsis">{KIND_LABEL[sc.kind]}{sc.url ? ` · ${sc.url}` : ''}</span></span>
            <span className="widget-tools">
              <Toggle label={`Afficher ${sc.label}`} checked={sc.enabled} onChange={(v) => void commit((l) => l.map((x) => (x.id === sc.id ? { ...x, enabled: v } : x)))} />
              <IconButton label={`Monter ${sc.label}`} disabled={i === 0} onClick={() => move(i, -1)}><ArrowUp size={15} /></IconButton>
              <IconButton label={`Descendre ${sc.label}`} disabled={i === list.length - 1} onClick={() => move(i, 1)}><ArrowDown size={15} /></IconButton>
              <IconButton label={`Modifier ${sc.label}`} onClick={() => setEditing(sc)}><Pencil size={15} /></IconButton>
              <IconButton label={`Supprimer ${sc.label}`} onClick={() => void remove(sc)}><Trash2 size={15} /></IconButton>
            </span>
          </li>
        ))}
      </ul>
      <div className="row-gap">
        <Button variant="secondary" icon={<Plus size={16} />} onClick={() => setEditing('new')} disabled={list.length >= 24}>Ajouter un raccourci</Button>
        <Button variant="ghost" icon={<RotateCcw size={16} />} onClick={() => void reset()}>Restaurer ceux par défaut</Button>
      </div>
      {editing && <ShortcutEditor initial={editing === 'new' ? null : editing} onSave={(sc) => void save(sc)} onClose={() => setEditing(null)} />}
    </div>
  );
}
