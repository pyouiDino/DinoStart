import { useEffect, useState } from 'react';
import { Copy, ExternalLink, FolderKanban, Link2, Pencil, Plus, Search, Trash2, X } from 'lucide-react';
import { addNote, addProject, addTask, deleteProject, live, toggleTask, updateProject } from '../../core/ops';
import { normalize } from '../../core/search';
import { PROJECT_STATUSES, type Project, type ProjectLink, type ProjectStatus } from '../../core/types';
import { Button, EmptyState, Field, IconButton, Modal, formatDate } from '../common';
import { useApp } from '../context';
import { SafeLink, STATUS_LABELS } from '../widgets/widgets';

const COLORS = ['#5194f5', '#f97316', '#fbbf24', '#22c55e', '#06b6d4', '#8b5cf6', '#ec4899', '#ef4444'];

function ProjectForm({ project, onClose }: { project?: Project; onClose: () => void }) {
  const { store, act, doc, go, toast } = useApp();
  const [name, setName] = useState(project?.name ?? '');
  const [description, setDescription] = useState(project?.description ?? '');
  const [status, setStatus] = useState<ProjectStatus>(project?.status ?? 'active');
  const [color, setColor] = useState(project?.color ?? COLORS[0]!);
  const [links, setLinks] = useState<ProjectLink[]>(project?.links ?? []);
  const [noteText, setNoteText] = useState('');
  const [taskText, setTaskText] = useState('');
  const notes = project ? live(doc.notes).filter((n) => n.projectId === project.id) : [];
  const tasks = project ? live(doc.tasks).filter((t) => t.projectId === project.id) : [];

  const submit = async () => {
    const input = { name, description, status, color, links };
    const r = project ? await act(store.mutate((d, c) => updateProject(d, c, project.id, input)), 'Projet enregistré') : await act(store.mutateAdd((d, c) => addProject(d, c, input)), 'Projet créé');
    if (r.ok) onClose();
  };
  const setLink = (i: number, patch: Partial<ProjectLink>) => setLinks((ls) => ls.map((l, k) => (k === i ? { ...l, ...patch } : l)));
  return (
    <Modal wide title={project ? 'Projet' : 'Nouveau projet'} onClose={onClose} footer={<><Button variant="ghost" onClick={onClose}>Fermer</Button><Button variant="primary" onClick={() => void submit()}>{project ? 'Enregistrer' : 'Créer le projet'}</Button></>}>
      <div className="form-grid">
        <Field label="Nom"><input value={name} onChange={(e) => setName(e.target.value)} maxLength={100} autoFocus /></Field>
        <Field label="Description"><textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} maxLength={2000} /></Field>
        <div className="two-col">
          <Field label="Statut"><select value={status} onChange={(e) => setStatus(e.target.value as ProjectStatus)}>{PROJECT_STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}</select></Field>
          <div className="field"><span className="field-label">Couleur</span><div className="swatches">{COLORS.map((p) => <button type="button" key={p} className={color === p ? 'sel' : ''} style={{ background: p }} aria-label={`Couleur ${p}`} aria-pressed={color === p} onClick={() => setColor(p)} />)}<input type="color" value={color} onChange={(e) => setColor(e.target.value)} aria-label="Couleur personnalisée" /></div></div>
        </div>
        <fieldset className="field">
          <legend className="field-label">Liens et chemins</legend>
          <p className="field-hint">Les chemins locaux sont de simples informations que vous pouvez copier : DinoStart n’ouvre pas vos dossiers.</p>
          {links.map((l, i) => (
            <div className="link-row" key={l.id || i}>
              <select aria-label="Type" value={l.kind} onChange={(e) => setLink(i, { kind: e.target.value as 'url' | 'path' })}><option value="url">Lien web</option><option value="path">Chemin</option></select>
              <input aria-label="Libellé" placeholder="Libellé" value={l.label} onChange={(e) => setLink(i, { label: e.target.value })} maxLength={100} />
              <input aria-label="Adresse ou chemin" placeholder={l.kind === 'url' ? 'https://…' : 'C:\\Projets\\mon-projet'} value={l.target} onChange={(e) => setLink(i, { target: e.target.value })} spellCheck={false} />
              <IconButton label="Retirer ce lien" onClick={() => setLinks((ls) => ls.filter((_, k) => k !== i))}><X size={16} /></IconButton>
            </div>
          ))}
          <Button variant="ghost" icon={<Plus size={16} />} onClick={() => setLinks((ls) => [...ls, { id: crypto.randomUUID(), label: '', target: '', kind: 'url' }])}>Ajouter un lien</Button>
        </fieldset>
        {project && (
          <div className="two-col">
            <div className="field"><span className="field-label">Tâches ({tasks.length})</span>
              <ul className="list">{tasks.map((t) => <li key={t.id} className="task-row"><input type="checkbox" checked={t.done} aria-label={`Terminer : ${t.title}`} onChange={() => void act(store.mutate((d, c) => toggleTask(d, c, t.id)))} /><span className={t.done ? 'done' : ''}>{t.title}</span></li>)}</ul>
              <form className="inline-add" onSubmit={(e) => { e.preventDefault(); if (taskText.trim()) void act(store.mutateAdd((d, c) => addTask(d, c, { title: taskText, projectId: project.id }))).then((r) => r.ok && setTaskText('')); }}>
                <input value={taskText} onChange={(e) => setTaskText(e.target.value)} placeholder="Nouvelle tâche" aria-label="Nouvelle tâche du projet" /><IconButton label="Ajouter la tâche" type="submit"><Plus size={16} /></IconButton></form></div>
            <div className="field"><span className="field-label">Notes ({notes.length})</span>
              <ul className="list">{notes.map((n) => <li key={n.id}><button className="list-row" onClick={() => { onClose(); go({ view: 'notes', focusId: n.id }); }}><span className="row-main">{n.title || n.content.split('\n')[0]}</span></button></li>)}</ul>
              <form className="inline-add" onSubmit={(e) => { e.preventDefault(); if (noteText.trim()) void act(store.mutateAdd((d, c) => addNote(d, c, { content: noteText, projectId: project.id }))).then((r) => r.ok && (setNoteText(''), toast('Note ajoutée', 'success'))); }}>
                <input value={noteText} onChange={(e) => setNoteText(e.target.value)} placeholder="Nouvelle note" aria-label="Nouvelle note du projet" /><IconButton label="Ajouter la note" type="submit"><Plus size={16} /></IconButton></form></div>
          </div>
        )}
      </div>
    </Modal>
  );
}

type Sort = 'recent' | 'name' | 'status';
export function ProjectsView() {
  const { doc, store, act, confirm, nav, toast } = useApp();
  const [q, setQ] = useState('');
  const [status, setStatus] = useState<'all' | ProjectStatus>('all');
  const [sort, setSort] = useState<Sort>('recent');
  const [editing, setEditing] = useState<Project | 'new' | null>(null);
  useEffect(() => { if (nav.focusId) { const p = live(doc.projects).find((x) => x.id === nav.focusId); if (p) setEditing(p); } }, [nav.focusId]); // eslint-disable-line react-hooks/exhaustive-deps

  const nq = normalize(q.trim());
  const rank = { active: 0, paused: 1, done: 2 } as const;
  const list = live(doc.projects).filter((p) => (status === 'all' || p.status === status) && (!nq || normalize(p.name).includes(nq)))
    .sort((a, b) => sort === 'name' ? a.name.localeCompare(b.name, 'fr') : sort === 'status' ? rank[a.status] - rank[b.status] || a.name.localeCompare(b.name, 'fr') : b.updatedAt.localeCompare(a.updatedAt));
  const remove = async (p: Project) => { if (await confirm({ title: `Supprimer « ${p.name} » ?`, message: 'Ses notes et tâches sont conservées mais ne seront plus rattachées à ce projet.', confirmLabel: 'Supprimer le projet', danger: true })) await act(store.mutate((d, c) => deleteProject(d, c, p.id)), 'Projet supprimé'); };
  const copy = async (text: string) => { try { await navigator.clipboard.writeText(text); toast('Chemin copié', 'success'); } catch { toast('Copie impossible : sélectionnez le texte manuellement.', 'error'); } };

  return (
    <div className="main-col">
      <div className="toolbar">
        <div className="input-icon"><Search size={16} aria-hidden="true" /><input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Rechercher un projet" aria-label="Rechercher un projet" /></div>
        <select aria-label="Filtrer par statut" value={status} onChange={(e) => setStatus(e.target.value as 'all')}><option value="all">Tous les statuts</option>{PROJECT_STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}</select>
        <select aria-label="Trier" value={sort} onChange={(e) => setSort(e.target.value as Sort)}><option value="recent">Récents d’abord</option><option value="name">Nom</option><option value="status">Statut</option></select>
        <Button variant="primary" icon={<Plus size={16} />} onClick={() => setEditing('new')}>Nouveau projet</Button>
      </div>
      {!list.length ? (
        <EmptyState icon={<FolderKanban size={24} />} title={doc.projects.some((p) => !p.deletedAt) ? 'Aucun projet ne correspond' : 'Aucun projet pour l’instant'} action={!doc.projects.some((p) => !p.deletedAt) ? <Button variant="primary" icon={<Plus size={16} />} onClick={() => setEditing('new')}>Créer un projet</Button> : undefined}>Un projet regroupe des liens, des notes et des tâches.</EmptyState>
      ) : (
        <ul className="cards-grid">
          {list.map((p) => {
            const nT = live(doc.tasks).filter((t) => t.projectId === p.id && !t.done).length;
            const nN = live(doc.notes).filter((n) => n.projectId === p.id).length;
            return (
              <li key={p.id} className="project-card" style={{ ['--pc' as string]: p.color }}>
                <header><h3>{p.name}</h3><span className={`chip chip-status-${p.status}`}>{STATUS_LABELS[p.status]}</span></header>
                {p.description && <p className="muted clamp">{p.description}</p>}
                <ul className="links">
                  {p.links.map((l) => <li key={l.id}>{l.kind === 'url' ? <SafeLink url={l.target} className="link-chip"><ExternalLink size={13} />{l.label || l.target}</SafeLink> : <button className="link-chip" onClick={() => void copy(l.target)} title={`Copier : ${l.target}`}><Copy size={13} />{l.label || l.target}</button>}</li>)}
                </ul>
                <footer><span className="muted small"><Link2 size={12} /> {nT} tâche{nT > 1 ? 's' : ''} · {nN} note{nN > 1 ? 's' : ''} · modifié le {formatDate(p.updatedAt)}</span>
                  <span><IconButton label={`Ouvrir « ${p.name} »`} onClick={() => setEditing(p)}><Pencil size={16} /></IconButton><IconButton label={`Supprimer « ${p.name} »`} onClick={() => void remove(p)}><Trash2 size={16} /></IconButton></span></footer>
              </li>
            );
          })}
        </ul>
      )}
      {editing && <ProjectForm project={editing === 'new' ? undefined : editing} onClose={() => setEditing(null)} />}
    </div>
  );
}
