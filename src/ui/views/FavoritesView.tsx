import { useEffect, useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, Bookmark, FolderPlus, GripVertical, Pencil, Plus, Search, Star, Trash2 } from 'lucide-react';
import {
  addCategory, addFavorite, deleteCategory, deleteFavorite, live, moveFavorite, reorderCategories, updateCategory, updateFavorite,
} from '../../core/ops';
import { normalize } from '../../core/search';
import { ICON_NAMES, type Category, type Favorite, type FavoriteIcon, type IconName } from '../../core/types';
import { hostOf, validateUrl } from '../../core/url';
import { Button, EmptyState, Field, IconButton, Modal } from '../common';
import { useApp } from '../context';
import { FavIcon, ICON_LABELS, ICON_MAP } from '../icons';
import { SafeLink } from '../widgets/widgets';

type Filter = 'all' | 'none' | string;
const PALETTE = ['#5194f5', '#f97316', '#fbbf24', '#22c55e', '#06b6d4', '#8b5cf6', '#ec4899', '#ef4444'];

function FavoriteForm({ fav, defaultCategory, onClose }: { fav?: Favorite; defaultCategory: string | null; onClose: () => void }) {
  const { doc, store, act } = useApp();
  const cats = live(doc.categories).sort((a, b) => a.order - b.order);
  const [title, setTitle] = useState(fav?.title ?? '');
  const [url, setUrl] = useState(fav?.url ?? '');
  const [categoryId, setCategoryId] = useState<string | null>(fav ? fav.categoryId : defaultCategory);
  const [icon, setIcon] = useState<FavoriteIcon>(fav?.icon ?? { kind: 'auto' });
  const [quick, setQuick] = useState(fav?.quick ?? false);
  const [touched, setTouched] = useState(false);
  const urlCheck = url.trim() ? validateUrl(url) : null;
  const urlError = !touched ? null : !url.trim() ? 'L’adresse est obligatoire.' : urlCheck && !urlCheck.ok ? urlCheck.error : null;
  const titleError = touched && !title.trim() ? 'Le titre est obligatoire.' : null;
  const color = cats.find((c) => c.id === categoryId)?.color ?? doc.settings.appearance.accent;

  const submit = async () => {
    setTouched(true);
    if (!title.trim() || !urlCheck || !urlCheck.ok) return;
    const input = { title, url, categoryId, icon, quick };
    const r = fav ? await act(store.mutate((d, c) => updateFavorite(d, c, fav.id, input)), 'Favori modifié') : await act(store.mutateAdd((d, c) => addFavorite(d, c, input)), 'Favori ajouté');
    if (r.ok) onClose();
  };
  return (
    <Modal title={fav ? 'Modifier le favori' : 'Ajouter un favori'} onClose={onClose} footer={<><Button variant="ghost" onClick={onClose}>Annuler</Button><Button variant="primary" onClick={() => void submit()}>{fav ? 'Enregistrer' : 'Ajouter'}</Button></>}>
      <form className="form-grid" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
        <Field label="Titre" error={titleError}><input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} autoFocus /></Field>
        <Field label="Adresse" error={urlError} hint={urlCheck?.ok && urlCheck.value !== url.trim() ? `Sera enregistrée : ${urlCheck.value}` : 'Seuls les liens http et https sont acceptés.'}>
          <input value={url} onChange={(e) => setUrl(e.target.value)} inputMode="url" placeholder="exemple.fr" spellCheck={false} />
        </Field>
        <Field label="Catégorie">
          <select value={categoryId ?? ''} onChange={(e) => setCategoryId(e.target.value || null)}>
            <option value="">Non classé</option>{cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </Field>
        <fieldset className="field">
          <legend className="field-label">Icône <span className="muted small">(automatique = icône du site, récupérée localement par Chrome)</span></legend>
          <div className="icon-picker">
            <button type="button" className={`wide ${icon.kind === 'auto' ? 'sel' : ''}`} aria-pressed={icon.kind === 'auto'} onClick={() => setIcon({ kind: 'auto' })} title="Icône du site, fournie par Chrome">Automatique</button>
            <button type="button" className={icon.kind === 'initial' ? 'sel' : ''} aria-pressed={icon.kind === 'initial'} onClick={() => setIcon({ kind: 'initial' })} title="Initiale du titre"><FavIcon fav={{ title: title || 'A', icon: { kind: 'initial' } }} color={color} size={32} /></button>
            {ICON_NAMES.map((n: IconName) => { const I = ICON_MAP[n]; return (
              <button type="button" key={n} className={icon.kind === 'icon' && icon.name === n ? 'sel' : ''} aria-pressed={icon.kind === 'icon' && icon.name === n} title={ICON_LABELS[n]} aria-label={ICON_LABELS[n]} onClick={() => setIcon({ kind: 'icon', name: n })}><I size={18} /></button>
            ); })}
          </div>
        </fieldset>
        <label className="check"><input type="checkbox" checked={quick} onChange={(e) => setQuick(e.target.checked)} />Afficher dans « Liens rapides »</label>
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}

function CategoryForm({ cat, onClose, onCreated }: { cat?: Category; onClose: () => void; onCreated?: (id: string) => void }) {
  const { store, act } = useApp();
  const [name, setName] = useState(cat?.name ?? '');
  const [color, setColor] = useState(cat?.color ?? PALETTE[0]!);
  const submit = async () => {
    if (cat) {
      const r = await act(store.mutate((d, c) => updateCategory(d, c, cat.id, { name, color })), 'Catégorie modifiée');
      if (r.ok) onClose();
    } else {
      const r = await act(store.mutateAdd((d, c) => addCategory(d, c, { name, color })), 'Catégorie créée');
      if (r.ok) { onCreated?.(r.value); onClose(); }
    }
  };
  return (
    <Modal title={cat ? 'Modifier la catégorie' : 'Nouvelle catégorie'} onClose={onClose} footer={<><Button variant="ghost" onClick={onClose}>Annuler</Button><Button variant="primary" onClick={() => void submit()}>{cat ? 'Enregistrer' : 'Créer'}</Button></>}>
      <form className="form-grid" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
        <Field label="Nom"><input value={name} onChange={(e) => setName(e.target.value)} maxLength={100} autoFocus /></Field>
        <div className="field"><span className="field-label">Couleur</span>
          <div className="swatches">{PALETTE.map((p) => <button type="button" key={p} className={color === p ? 'sel' : ''} style={{ background: p }} aria-label={`Couleur ${p}`} aria-pressed={color === p} onClick={() => setColor(p)} />)}
            <input type="color" value={color} onChange={(e) => setColor(e.target.value)} aria-label="Couleur personnalisée" /></div></div>
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}

export function FavoritesView() {
  const { doc, store, act, confirm, nav } = useApp();
  const [filter, setFilter] = useState<Filter>(nav.categoryId === undefined ? 'all' : nav.categoryId ?? 'none');
  const [q, setQ] = useState('');
  const [editFav, setEditFav] = useState<Favorite | 'new' | null>(null);
  const [editCat, setEditCat] = useState<Category | 'new' | null>(null);
  const [drag, setDrag] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  useEffect(() => { if (nav.categoryId !== undefined) setFilter(nav.categoryId ?? 'none'); }, [nav.categoryId]);

  const cats = live(doc.categories).sort((a, b) => a.order - b.order);
  const all = live(doc.favorites);
  const catById = useMemo(() => new Map(cats.map((c) => [c.id, c])), [cats]);
  const nq = normalize(q.trim());
  const shown = all
    .filter((f) => (filter === 'all' ? true : filter === 'none' ? f.categoryId === null : f.categoryId === filter))
    .filter((f) => !nq || normalize(`${f.title} ${f.url}`).includes(nq))
    .sort((a, b) => (filter === 'all' ? (catById.get(a.categoryId ?? '')?.order ?? 1e6) - (catById.get(b.categoryId ?? '')?.order ?? 1e6) : 0) || a.order - b.order);
  const reorderable = filter !== 'all' && !nq;
  const count = (id: Filter) => all.filter((f) => (id === 'all' ? true : id === 'none' ? f.categoryId === null : f.categoryId === id)).length;

  const moveWithin = (f: Favorite, delta: number) => {
    const idx = shown.findIndex((x) => x.id === f.id);
    void act(store.mutate((d, c) => moveFavorite(d, c, f.id, f.categoryId, idx + delta)));
  };
  const removeFav = async (f: Favorite) => { if (await confirm({ title: 'Supprimer ce favori ?', message: <>« {f.title} » sera supprimé de tous vos appareils après synchronisation.</>, confirmLabel: 'Supprimer', danger: true })) await act(store.mutate((d, c) => deleteFavorite(d, c, f.id)), 'Favori supprimé'); };
  const removeCat = async (c: Category) => {
    const n = all.filter((f) => f.categoryId === c.id).length;
    if (await confirm({ title: `Supprimer la catégorie « ${c.name} » ?`, message: n ? `Ses ${n} favori${n > 1 ? 's' : ''} ne seront pas supprimés : ils passeront dans « Non classés ».` : 'Cette catégorie est vide.', confirmLabel: 'Supprimer la catégorie', danger: true })) {
      if (filter === c.id) setFilter('all');
      await act(store.mutate((d, x) => deleteCategory(d, x, c.id)), 'Catégorie supprimée');
    }
  };
  const moveCat = (c: Category, delta: number) => {
    const ids = cats.map((x) => x.id); const i = ids.indexOf(c.id); const j = i + delta;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j]!, ids[i]!];
    void act(store.mutate((d, x) => reorderCategories(d, x, ids)));
  };
  const dropOnFav = (target: Favorite) => {
    if (drag && drag !== target.id) { const idx = shown.findIndex((x) => x.id === target.id); void act(store.mutate((d, c) => moveFavorite(d, c, drag, target.categoryId, idx))); }
    setDrag(null); setOverId(null);
  };
  const dropOnCategory = (id: string | null) => {
    if (drag) { void act(store.mutate((d, c) => moveFavorite(d, c, drag, id, 9999)), 'Favori déplacé'); }
    setDrag(null); setOverId(null);
  };

  return (
    <div className="split">
      <aside className="side" aria-label="Catégories">
        <nav>
          <button className={`side-item ${filter === 'all' ? 'on' : ''}`} onClick={() => setFilter('all')}>Tous<span className="count">{count('all')}</span></button>
          {cats.map((c, i) => (
            <div key={c.id} className={`side-row ${overId === `cat-${c.id}` ? 'drop' : ''}`} onDragOver={(e) => { if (drag) { e.preventDefault(); setOverId(`cat-${c.id}`); } }} onDragLeave={() => setOverId(null)} onDrop={() => dropOnCategory(c.id)}>
              <button className={`side-item ${filter === c.id ? 'on' : ''}`} onClick={() => setFilter(c.id)}><span className="dot" style={{ background: c.color }} aria-hidden="true" />{c.name}<span className="count">{count(c.id)}</span></button>
              <span className="side-actions">
                <IconButton label={`Monter « ${c.name} »`} disabled={i === 0} onClick={() => moveCat(c, -1)}><ArrowUp size={14} /></IconButton>
                <IconButton label={`Descendre « ${c.name} »`} disabled={i === cats.length - 1} onClick={() => moveCat(c, 1)}><ArrowDown size={14} /></IconButton>
                <IconButton label={`Modifier « ${c.name} »`} onClick={() => setEditCat(c)}><Pencil size={14} /></IconButton>
                <IconButton label={`Supprimer « ${c.name} »`} onClick={() => void removeCat(c)}><Trash2 size={14} /></IconButton>
              </span>
            </div>
          ))}
          <div className={`side-row ${overId === 'cat-none' ? 'drop' : ''}`} onDragOver={(e) => { if (drag) { e.preventDefault(); setOverId('cat-none'); } }} onDragLeave={() => setOverId(null)} onDrop={() => dropOnCategory(null)}>
            <button className={`side-item ${filter === 'none' ? 'on' : ''}`} onClick={() => setFilter('none')}>Non classés<span className="count">{count('none')}</span></button>
          </div>
        </nav>
        <Button variant="ghost" icon={<FolderPlus size={16} />} onClick={() => setEditCat('new')}>Nouvelle catégorie</Button>
      </aside>

      <section className="main-col">
        <div className="toolbar">
          <div className="input-icon"><Search size={16} aria-hidden="true" /><input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Rechercher dans les favoris" aria-label="Rechercher dans les favoris" /></div>
          <Button variant="primary" icon={<Plus size={16} />} onClick={() => setEditFav('new')}>Ajouter un favori</Button>
        </div>
        {reorderable && shown.length > 1 && <p className="muted small">Glissez les favoris pour les réordonner, ou déposez-les sur une catégorie pour les y déplacer.</p>}
        {!shown.length ? (
          <EmptyState icon={<Bookmark size={24} />} title={all.length ? 'Aucun favori ne correspond' : 'Vous n’avez pas encore de favori'} action={!all.length ? <Button variant="primary" icon={<Plus size={16} />} onClick={() => setEditFav('new')}>Ajouter mon premier favori</Button> : undefined}>
            {all.length ? 'Essayez un autre mot ou une autre catégorie.' : 'Ajoutez les sites que vous ouvrez tous les jours.'}
          </EmptyState>
        ) : (
          <ul className="rows">
            {shown.map((f, i) => (
              <li key={f.id} className={`row-card ${overId === f.id ? 'drop' : ''}`} draggable={!q} onDragStart={() => setDrag(f.id)} onDragEnd={() => { setDrag(null); setOverId(null); }} onDragOver={(e) => { if (drag && drag !== f.id) { e.preventDefault(); setOverId(f.id); } }} onDrop={() => dropOnFav(f)}>
                {!q && <GripVertical size={16} className="grip" aria-hidden="true" />}
                <FavIcon fav={f} color={catById.get(f.categoryId ?? '')?.color ?? doc.settings.appearance.accent} />
                <div className="row-text"><SafeLink url={f.url} className="row-title">{f.title}</SafeLink><span className="muted small">{hostOf(f.url)}{filter === 'all' && f.categoryId ? ` · ${catById.get(f.categoryId)?.name ?? ''}` : ''}</span></div>
                <div className="row-actions">
                  <IconButton label={f.quick ? 'Retirer des liens rapides' : 'Ajouter aux liens rapides'} aria-pressed={f.quick} onClick={() => void act(store.mutate((d, c) => updateFavorite(d, c, f.id, { quick: !f.quick })))}><Star size={16} className={f.quick ? 'star-on' : ''} /></IconButton>
                  {reorderable && <><IconButton label="Monter" disabled={i === 0} onClick={() => moveWithin(f, -1)}><ArrowUp size={16} /></IconButton><IconButton label="Descendre" disabled={i === shown.length - 1} onClick={() => moveWithin(f, 1)}><ArrowDown size={16} /></IconButton></>}
                  <IconButton label={`Modifier « ${f.title} »`} onClick={() => setEditFav(f)}><Pencil size={16} /></IconButton>
                  <IconButton label={`Supprimer « ${f.title} »`} onClick={() => void removeFav(f)}><Trash2 size={16} /></IconButton>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
      {editFav && <FavoriteForm fav={editFav === 'new' ? undefined : editFav} defaultCategory={filter === 'all' || filter === 'none' ? null : filter} onClose={() => setEditFav(null)} />}
      {editCat && <CategoryForm cat={editCat === 'new' ? undefined : editCat} onClose={() => setEditCat(null)} onCreated={(id) => setFilter(id)} />}
    </div>
  );
}
