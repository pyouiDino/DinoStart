import { useEffect, useState } from 'react';
import { ListChecks, Pencil, Plus, Search, Trash2 } from 'lucide-react';
import { addTask, deleteTask, live, toggleTask, updateTask } from '../../core/ops';
import { normalize } from '../../core/search';
import type { Task } from '../../core/types';
import { Button, EmptyState, Field, IconButton, Modal, formatDate, todayIso } from '../common';
import { useApp } from '../context';

function TaskForm({ task, onClose }: { task: Task; onClose: () => void }) {
  const { doc, store, act } = useApp();
  const [title, setTitle] = useState(task.title);
  const [description, setDescription] = useState(task.description);
  const [dueDate, setDueDate] = useState(task.dueDate ?? '');
  const [projectId, setProjectId] = useState(task.projectId ?? '');
  const save = async () => { const r = await act(store.mutate((d, c) => updateTask(d, c, task.id, { title, description, dueDate: dueDate || null, projectId: projectId || null })), 'Tâche enregistrée'); if (r.ok) onClose(); };
  return (
    <Modal title="Modifier la tâche" onClose={onClose} footer={<><Button variant="ghost" onClick={onClose}>Annuler</Button><Button variant="primary" onClick={() => void save()}>Enregistrer</Button></>}>
      <form className="form-grid" onSubmit={(e) => { e.preventDefault(); void save(); }}>
        <Field label="Titre"><input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} autoFocus /></Field>
        <Field label="Description (facultative)"><textarea rows={4} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={2000} /></Field>
        <div className="two-col">
          <Field label="Échéance"><input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} /></Field>
          <Field label="Projet"><select value={projectId} onChange={(e) => setProjectId(e.target.value)}><option value="">Aucun</option>{live(doc.projects).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>
        </div>
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}

type StateFilter = 'open' | 'late' | 'done' | 'all';
type Sort = 'due' | 'created' | 'title';
export function TasksView() {
  const { doc, store, act, confirm, nav } = useApp();
  const [title, setTitle] = useState('');
  const [due, setDue] = useState('');
  const [projectId, setProjectId] = useState('');
  const [q, setQ] = useState('');
  const [state, setState] = useState<StateFilter>('open');
  const [projectFilter, setProjectFilter] = useState('');
  const [sort, setSort] = useState<Sort>('due');
  const [editing, setEditing] = useState<Task | null>(null);
  const today = todayIso();
  useEffect(() => { if (nav.focusId) { const t = live(doc.tasks).find((x) => x.id === nav.focusId); if (t) { setState('all'); setEditing(t); } } }, [nav.focusId]); // eslint-disable-line react-hooks/exhaustive-deps

  const projName = new Map(live(doc.projects).map((p) => [p.id, p.name]));
  const nq = normalize(q.trim());
  const list = live(doc.tasks)
    .filter((t) => (state === 'all' ? true : state === 'done' ? t.done : state === 'late' ? !t.done && !!t.dueDate && t.dueDate < today : !t.done))
    .filter((t) => !projectFilter || (projectFilter === 'none' ? t.projectId === null : t.projectId === projectFilter))
    .filter((t) => !nq || normalize(`${t.title} ${t.description}`).includes(nq))
    .sort((a, b) => sort === 'title' ? a.title.localeCompare(b.title, 'fr') : sort === 'created' ? b.createdAt.localeCompare(a.createdAt) : (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999') || a.createdAt.localeCompare(b.createdAt));
  const add = async () => { const r = await act(store.mutateAdd((d, c) => addTask(d, c, { title, dueDate: due || null, projectId: projectId || null }))); if (r.ok) { setTitle(''); setDue(''); } };
  const remove = async (t: Task) => { if (await confirm({ title: 'Supprimer cette tâche ?', message: `« ${t.title} »`, confirmLabel: 'Supprimer', danger: true })) await act(store.mutate((d, c) => deleteTask(d, c, t.id)), 'Tâche supprimée'); };
  const counts = { open: live(doc.tasks).filter((t) => !t.done).length, done: live(doc.tasks).filter((t) => t.done).length };

  return (
    <div className="main-col">
      <form className="toolbar add-bar" onSubmit={(e) => { e.preventDefault(); void add(); }}>
        <input className="grow" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Nouvelle tâche…" aria-label="Titre de la nouvelle tâche" maxLength={200} />
        <input type="date" value={due} onChange={(e) => setDue(e.target.value)} aria-label="Échéance" />
        <select value={projectId} onChange={(e) => setProjectId(e.target.value)} aria-label="Projet"><option value="">Sans projet</option>{[...projName].map(([id, n]) => <option key={id} value={id}>{n}</option>)}</select>
        <Button variant="primary" type="submit" icon={<Plus size={16} />} disabled={!title.trim()}>Ajouter</Button>
      </form>
      <div className="toolbar">
        <div className="seg" role="group" aria-label="Filtrer les tâches">
          {([['open', `À faire (${counts.open})`], ['late', 'En retard'], ['done', `Terminées (${counts.done})`], ['all', 'Toutes']] as const).map(([k, l]) => <button key={k} className={state === k ? 'on' : ''} aria-pressed={state === k} onClick={() => setState(k)}>{l}</button>)}
        </div>
        <div className="input-icon"><Search size={16} aria-hidden="true" /><input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Rechercher" aria-label="Rechercher dans les tâches" /></div>
        <select aria-label="Filtrer par projet" value={projectFilter} onChange={(e) => setProjectFilter(e.target.value)}><option value="">Tous les projets</option><option value="none">Sans projet</option>{[...projName].map(([id, n]) => <option key={id} value={id}>{n}</option>)}</select>
        <select aria-label="Trier" value={sort} onChange={(e) => setSort(e.target.value as Sort)}><option value="due">Échéance</option><option value="created">Plus récentes</option><option value="title">Titre</option></select>
      </div>
      {!list.length ? <EmptyState icon={<ListChecks size={24} />} title={state === 'open' && !q && !counts.open ? 'Aucune tâche à faire' : 'Aucune tâche ne correspond'}>{state === 'open' && !counts.open ? 'Ajoutez une tâche avec le champ ci-dessus.' : 'Changez de filtre pour en voir davantage.'}</EmptyState> : (
        <ul className="rows">
          {list.map((t) => (
            <li key={t.id} className={`row-card ${nav.focusId === t.id ? 'focus' : ''}`}>
              <input type="checkbox" checked={t.done} aria-label={`Terminer : ${t.title}`} onChange={() => void act(store.mutate((d, c) => toggleTask(d, c, t.id)))} />
              <div className="row-text"><span className={`row-title ${t.done ? 'done' : ''}`}>{t.title}</span>
                <span className="muted small">{t.description && `${t.description.slice(0, 80)} · `}{t.projectId ? `${projName.get(t.projectId) ?? ''}` : ''}</span></div>
              {t.dueDate && <span className={`due ${!t.done && t.dueDate < today ? 'overdue' : ''}`}>{formatDate(t.dueDate)}</span>}
              <div className="row-actions"><IconButton label={`Modifier « ${t.title} »`} onClick={() => setEditing(t)}><Pencil size={16} /></IconButton><IconButton label={`Supprimer « ${t.title} »`} onClick={() => void remove(t)}><Trash2 size={16} /></IconButton></div>
            </li>
          ))}
        </ul>
      )}
      {editing && <TaskForm task={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}
