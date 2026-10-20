import { useEffect, useState, type ReactNode } from 'react';
import { ArrowRight, Bookmark, FolderKanban, ListChecks, Plus, StickyNote, Star, Link2, Trash2 } from 'lucide-react';
import { live, addNote, addTask, toggleTask, deleteCategory, groupIntoNewFolder, moveFavorite, updateCategory } from '../../core/ops';
import { isSafeNavigationUrl, hostOf } from '../../core/url';
import { ok, type Widget, type WidgetConfigs, type Favorite, type WidgetType } from '../../core/types';
import { Button, EmptyState, IconButton, Modal, formatDate, todayIso } from '../common';
import { FavIcon } from '../icons';
import { useApp } from '../context';
import { SearchWidget } from './SearchWidget';

const STATUS = { active: 'Actif', paused: 'En pause', done: 'Terminé' } as const;
export { STATUS as STATUS_LABELS };

export const WIDGET_TITLES: Record<WidgetType, string> = {
  clock: 'Horloge', date: 'Date', search: 'Recherche', favorites: 'Favoris', projects: 'Projets récents', tasks: 'Tâches', quickNotes: 'Notes rapides', quickLinks: 'Liens rapides',
};

export function Card({ title, icon, action, children, className = '' }: { title?: string; icon?: ReactNode; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`card ${className}`} aria-label={title}>
      {title && <header className="card-head"><h2>{icon}{title}</h2>{action}</header>}
      {children}
    </section>
  );
}

/** Lien de navigation : n'est rendu cliquable que si l'URL passe la validation (http/https). */
export function SafeLink({ url, children, className = '', title }: { url: string; children: ReactNode; className?: string; title?: string }) {
  if (!isSafeNavigationUrl(url)) return <span className={className} title="Lien non autorisé">{children}</span>;
  return <a href={url} className={className} title={title ?? url} rel="noopener noreferrer">{children}</a>;
}

// ---------- horloge / date ----------
function useNow(everyMs: number) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => { const t = setInterval(() => setNow(new Date()), everyMs); return () => clearInterval(t); }, [everyMs]);
  return now;
}

export function ClockWidget({ config }: { config: WidgetConfigs['clock'] }) {
  const now = useNow(config.seconds ? 1000 : 5000);
  const text = now.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', second: config.seconds ? '2-digit' : undefined, hour12: config.hour12 });
  return (
    <Card className="card-clock">
      <time className="clock" dateTime={now.toISOString()} style={{ ['--em' as string]: 2.8 + (config.seconds ? 1.6 : 0) + (config.hour12 ? 1.9 : 0) }}>{text}</time>
    </Card>
  );
}

export function DateWidget({ config }: { config: WidgetConfigs['date'] }) {
  const { doc } = useApp();
  const now = useNow(60_000);
  const h = now.getHours();
  const greeting = h < 5 ? 'Bonne nuit' : h < 12 ? 'Bonjour' : h < 18 ? 'Bon après-midi' : 'Bonsoir';
  const main = now.toLocaleDateString('fr-FR', config.style === 'long' ? { weekday: 'long', day: 'numeric', month: 'long' } : { day: '2-digit', month: '2-digit', year: 'numeric' });
  return (
    <Card className="card-date">
      <p className="date-main">{main}</p>
      <p className="date-sub">{config.style === 'long' ? now.getFullYear() : now.toLocaleDateString('fr-FR', { weekday: 'long' })}{doc.settings.show.greeting ? ` — ${greeting}` : ''}</p>
    </Card>
  );
}

export function SearchCard({ config }: { config: WidgetConfigs['search'] }) {
  return <Card className="card-search"><SearchWidget placeholder={config.placeholder} /></Card>;
}

// ---------- favoris ----------
function FavTile({ fav, color, showTitle, dnd }: { fav: Favorite; color: string; showTitle: boolean; dnd?: TileDnd }) {
  return (
    <SafeLink url={fav.url} className={`tile ${dnd?.over === fav.id ? 'tile-over' : ''}`} title={`${fav.title} — ${hostOf(fav.url)}`}>
      <FavIcon fav={fav} color={color} />
      {showTitle && <span className="tile-title">{fav.title}</span>}
    </SafeLink>
  );
}

interface TileDnd { over: string | null }

const PALETTE = ['#5194f5', '#f97316', '#fbbf24', '#22c55e', '#06b6d4', '#8b5cf6', '#ec4899', '#ef4444'];

function FolderPopup({ catId, onClose }: { catId: string; onClose: () => void }) {
  const { doc, store, act, confirm } = useApp();
  const cat = live(doc.categories).find((c) => c.id === catId);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(cat?.name ?? '');
  if (!cat) return null;
  const items = live(doc.favorites).filter((f) => f.categoryId === cat.id).sort((a, b) => a.order - b.order);
  const rename = async () => { const r = await act(store.mutate((d, c) => updateCategory(d, c, cat.id, { name })), 'Dossier renommé'); if (r.ok) setEditing(false); };
  const remove = async () => {
    if (await confirm({ title: `Supprimer le dossier « ${cat.name} » ?`, message: items.length ? `Ses ${items.length} favori${items.length > 1 ? 's' : ''} ne sont pas supprimés : ils repassent à l’accueil, hors dossier.` : 'Ce dossier est vide.', confirmLabel: 'Supprimer le dossier', danger: true })) {
      await act(store.mutate((d, c) => deleteCategory(d, c, cat.id)), 'Dossier supprimé'); onClose();
    }
  };
  return (
    <Modal title={cat.name} onClose={onClose} footer={<>
      <Button variant="ghost" onClick={() => setEditing((v) => !v)} aria-pressed={editing}>{editing ? 'Terminer' : 'Modifier le dossier'}</Button>
      <span className="spacer" /><Button variant="primary" onClick={onClose}>Fermer</Button></>}>
      {editing && (
        <div className="form-grid folder-edit">
          <form className="inline-add" onSubmit={(e) => { e.preventDefault(); void rename(); }}>
            <input value={name} onChange={(e) => setName(e.target.value)} aria-label="Nom du dossier" maxLength={100} />
            <Button variant="secondary" type="submit">Renommer</Button>
          </form>
          <div className="swatches" role="group" aria-label="Couleur du dossier">{PALETTE.map((p) => <button type="button" key={p} className={cat.color === p ? 'sel' : ''} style={{ background: p }} aria-label={`Couleur ${p}`} aria-pressed={cat.color === p} onClick={() => void act(store.mutate((d, c) => updateCategory(d, c, cat.id, { color: p })))} />)}</div>
          <div><Button variant="danger" icon={<Trash2 size={16} />} onClick={() => void remove()}>Supprimer le dossier</Button></div>
        </div>
      )}
      {!items.length ? <p className="muted center pad-sm">Ce dossier est vide. Glissez-y un favori depuis l’accueil.</p> : (
        <div className="tiles folder-tiles">
          {items.map((f) => (
            <div key={f.id} className="folder-item">
              <FavTile fav={f} color={cat.color} showTitle />
              {editing && <button className="btn btn-ghost btn-sm" onClick={() => void act(store.mutate((d, c) => moveFavorite(d, c, f.id, null, 9999)), 'Sorti du dossier')}>Retirer du dossier</button>}
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}

export function FavoritesWidget({ config }: { config: WidgetConfigs['favorites'] }) {
  const { doc, go, store, act } = useApp();
  const [openFolder, setOpenFolder] = useState<string | null>(null);
  const [drag, setDrag] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const cats = live(doc.categories).sort((a, b) => a.order - b.order);
  const favs = live(doc.favorites).sort((a, b) => a.order - b.order);
  const showTitle = doc.settings.show.favoriteTitles;
  const action = <IconButton label="Gérer les favoris" onClick={() => go('favorites')}><ArrowRight size={16} /></IconButton>;
  const empty = (
    <EmptyState icon={<Bookmark size={22} />} title="Aucun favori pour l’instant" action={<button className="btn btn-primary" onClick={() => go('favorites')}><Plus size={16} />Ajouter un favori</button>} />
  );

  if (config.layout === 'folders' && !config.categoryId) {
    const loose = favs.filter((f) => f.categoryId === null);
    const dropOnFolder = (catId: string) => { if (drag) void act(store.mutate((d, c) => moveFavorite(d, c, drag, catId, 9999)), 'Ajouté au dossier'); setDrag(null); setOver(null); };
    const dropOnFav = (targetId: string) => { if (drag && drag !== targetId) void act(store.mutate((d, c) => { const r = groupIntoNewFolder(d, c, targetId, drag); return r.ok ? ok(r.value.doc) : r; }), 'Dossier créé : renommez-le avec « Modifier le dossier »'); setDrag(null); setOver(null); };
    return (
      <Card title="Favoris" icon={<Bookmark size={16} />} action={action}>
        {!cats.length && !loose.length ? empty : (
          <>
            <div className="tiles">
              {cats.map((c) => {
                const items = favs.filter((f) => f.categoryId === c.id);
                return (
                  <button key={c.id} className={`tile folder ${over === `f-${c.id}` ? 'tile-over' : ''}`} onClick={() => setOpenFolder(c.id)} aria-label={`Dossier ${c.name}, ${items.length} favori${items.length > 1 ? 's' : ''}`} title={c.name}
                    onDragOver={(e) => { if (drag) { e.preventDefault(); setOver(`f-${c.id}`); } }} onDragLeave={() => setOver(null)} onDrop={() => dropOnFolder(c.id)}>
                    <span className="folder-icon" style={{ ['--cat' as string]: c.color }} aria-hidden="true">
                      {items.slice(0, 4).map((f) => <FavIcon key={f.id} fav={f} color={c.color} size={20} />)}
                    </span>
                    {showTitle && <span className="tile-title">{c.name}</span>}
                  </button>
                );
              })}
              {loose.map((f) => (
                <div key={f.id} className="tile-wrap" draggable onDragStart={() => setDrag(f.id)} onDragEnd={() => { setDrag(null); setOver(null); }}
                  onDragOver={(e) => { if (drag && drag !== f.id) { e.preventDefault(); setOver(f.id); } }} onDragLeave={() => setOver(null)} onDrop={() => dropOnFav(f.id)}>
                  <FavTile fav={f} color={doc.settings.appearance.accent} showTitle={showTitle} dnd={{ over }} />
                </div>
              ))}
            </div>
            {(loose.length > 0 || cats.length > 0) && <p className="muted small hint-dnd">Astuce : glissez un favori sur un dossier pour l’y ranger, ou sur un autre favori pour créer un dossier.</p>}
          </>
        )}
        {openFolder && <FolderPopup catId={openFolder} onClose={() => setOpenFolder(null)} />}
      </Card>
    );
  }

  const groups = [
    ...cats.map((c) => ({ id: c.id, name: c.name, color: c.color, items: favs.filter((f) => f.categoryId === c.id) })),
    { id: 'none', name: 'Non classés', color: doc.settings.appearance.accent, items: favs.filter((f) => f.categoryId === null) },
  ].filter((g) => (config.categoryId ? g.id === config.categoryId : true) && g.items.length);
  return (
    <Card title="Favoris" icon={<Bookmark size={16} />} action={action}>
      {!groups.length ? empty : groups.map((g) => (
        <div key={g.id} className="fav-group">
          <h3 style={{ ['--cat' as string]: g.color }}><span className="dot" aria-hidden="true" />{g.name}</h3>
          <div className="tiles">{g.items.map((f) => <FavTile key={f.id} fav={f} color={g.color} showTitle={showTitle} />)}</div>
        </div>
      ))}
    </Card>
  );
}

export function QuickLinksWidget() {
  const { doc, go } = useApp();
  const quick = live(doc.favorites).filter((f) => f.quick).sort((a, b) => a.order - b.order);
  const catColor = (f: Favorite) => live(doc.categories).find((c) => c.id === f.categoryId)?.color ?? doc.settings.appearance.accent;
  return (
    <Card title="Liens rapides" icon={<Link2 size={16} />}>
      {!quick.length ? (
        <EmptyState icon={<Star size={22} />} title="Aucun lien rapide">Marquez un favori avec l’étoile pour l’afficher ici.<br /><button className="btn btn-ghost" onClick={() => go('favorites')}>Ouvrir les favoris</button></EmptyState>
      ) : <div className="tiles tiles-compact">{quick.map((f) => <FavTile key={f.id} fav={f} color={catColor(f)} showTitle />)}</div>}
    </Card>
  );
}

// ---------- projets ----------
export function ProjectsWidget({ config }: { config: WidgetConfigs['projects'] }) {
  const { doc, go } = useApp();
  const showStatus = doc.settings.show.projectStatus;
  const list = live(doc.projects).filter((p) => config.status === 'all' || p.status === config.status).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, config.limit);
  return (
    <Card title="Projets récents" icon={<FolderKanban size={16} />} action={<IconButton label="Tous les projets" onClick={() => go('projects')}><ArrowRight size={16} /></IconButton>}>
      {!list.length ? (
        <EmptyState icon={<FolderKanban size={22} />} title="Aucun projet" action={<button className="btn btn-primary" onClick={() => go('projects')}><Plus size={16} />Créer un projet</button>} />
      ) : (
        <ul className="list">
          {list.map((p) => (
            <li key={p.id}>
              <button className="list-row" onClick={() => go({ view: 'projects', focusId: p.id })}>
                <span className="swatch" style={{ background: p.color }} aria-hidden="true" />
                <span className="row-main">{p.name}</span>
                {showStatus && <span className={`chip chip-status-${p.status}`}>{STATUS[p.status]}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

// ---------- tâches ----------
export function TasksWidget({ config }: { config: WidgetConfigs['tasks'] }) {
  const { doc, store, act, go } = useApp();
  const [title, setTitle] = useState('');
  const today = todayIso();
  const showDue = doc.settings.show.taskDueDates;
  const tasks = live(doc.tasks).filter((t) => !config.hideDone || !t.done)
    .sort((a, b) => Number(a.done) - Number(b.done) || (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999') || a.createdAt.localeCompare(b.createdAt)).slice(0, config.limit);
  const add = async () => {
    if (!title.trim()) return;
    const r = await act(store.mutateAdd((d, c) => addTask(d, c, { title })));
    if (r.ok) setTitle('');
  };
  return (
    <Card title="Tâches" icon={<ListChecks size={16} />} action={<IconButton label="Toutes les tâches" onClick={() => go('tasks')}><ArrowRight size={16} /></IconButton>}>
      <form className="inline-add" onSubmit={(e) => { e.preventDefault(); void add(); }}>
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Nouvelle tâche…" aria-label="Nouvelle tâche" maxLength={200} />
        <IconButton label="Ajouter la tâche" type="submit"><Plus size={16} /></IconButton>
      </form>
      {!tasks.length ? <p className="muted pad-sm">Rien à faire pour le moment.</p> : (
        <ul className="list">
          {tasks.map((t) => (
            <li key={t.id} className="task-row">
              <input type="checkbox" checked={t.done} aria-label={`Terminer : ${t.title}`} onChange={() => void act(store.mutate((d, c) => toggleTask(d, c, t.id)))} />
              <button className={`row-main linklike ${t.done ? 'done' : ''}`} onClick={() => go({ view: 'tasks', focusId: t.id })}>{t.title}</button>
              {showDue && t.dueDate && <span className={`due ${!t.done && t.dueDate < today ? 'overdue' : ''}`}>{formatDate(t.dueDate, { day: 'numeric', month: 'short' })}</span>}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

// ---------- notes rapides ----------
export function QuickNotesWidget({ config }: { config: WidgetConfigs['quickNotes'] }) {
  const { doc, store, act, go } = useApp();
  const [text, setText] = useState('');
  const notes = live(doc.notes).sort((a, b) => Number(b.starred) - Number(a.starred) || b.updatedAt.localeCompare(a.updatedAt)).slice(0, config.limit);
  const save = async () => {
    if (!text.trim()) return;
    const r = await act(store.mutateAdd((d, c) => addNote(d, c, { content: text })), 'Note enregistrée');
    if (r.ok) setText('');
  };
  return (
    <Card title="Notes rapides" icon={<StickyNote size={16} />} action={<IconButton label="Toutes les notes" onClick={() => go('notes')}><ArrowRight size={16} /></IconButton>}>
      <textarea value={text} onChange={(e) => setText(e.target.value)} placeholder="Noter une idée… (Ctrl+Entrée pour enregistrer)" aria-label="Nouvelle note rapide" rows={2} maxLength={50000}
        onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); void save(); } }} />
      <div className="row-end"><button className="btn btn-secondary btn-sm" onClick={() => void save()} disabled={!text.trim()}>Enregistrer</button></div>
      {notes.length > 0 && (
        <ul className="list">
          {notes.map((n) => (
            <li key={n.id}>
              <button className="list-row" onClick={() => go({ view: 'notes', focusId: n.id })}>
                {n.starred && <Star size={14} className="star-on" aria-label="Note favorite" />}
                <span className="row-main">{n.title || n.content.split('\n')[0]}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

export function renderWidget(w: Widget) {
  switch (w.type) {
    case 'clock': return <ClockWidget config={w.config as WidgetConfigs['clock']} />;
    case 'date': return <DateWidget config={w.config as WidgetConfigs['date']} />;
    case 'search': return <SearchCard config={w.config as WidgetConfigs['search']} />;
    case 'favorites': return <FavoritesWidget config={w.config as WidgetConfigs['favorites']} />;
    case 'quickLinks': return <QuickLinksWidget />;
    case 'projects': return <ProjectsWidget config={w.config as WidgetConfigs['projects']} />;
    case 'tasks': return <TasksWidget config={w.config as WidgetConfigs['tasks']} />;
    case 'quickNotes': return <QuickNotesWidget config={w.config as WidgetConfigs['quickNotes']} />;
  }
}
