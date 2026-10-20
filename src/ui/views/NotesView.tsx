import { useEffect, useRef, useState } from 'react';
import { Plus, Search, Star, StickyNote, Trash2 } from 'lucide-react';
import { addNote, deleteNote, live, updateNote } from '../../core/ops';
import { normalize } from '../../core/search';
import type { Note } from '../../core/types';
import { Button, EmptyState, Field, IconButton, Modal, formatDate, formatDateTime } from '../common';
import { useApp } from '../context';

/** Éditeur à enregistrement automatique : le texte est écrit localement quelques instants après chaque saisie. */
function NoteEditor({ noteId, onClose }: { noteId: string | null; onClose: () => void }) {
  const { doc, store, act, confirm } = useApp();
  const existing = noteId ? live(doc.notes).find((n) => n.id === noteId) : undefined;
  const [id, setId] = useState<string | null>(noteId);
  const [title, setTitle] = useState(existing?.title ?? '');
  const [content, setContent] = useState(existing?.content ?? '');
  const [projectId, setProjectId] = useState<string | null>(existing?.projectId ?? null);
  const [saved, setSaved] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const dirty = useRef(false);
  const latest = useRef({ title, content, projectId });
  latest.current = { title, content, projectId };
  const idRef = useRef(id);
  idRef.current = id;
  const live_ = live(doc.notes).find((n) => n.id === id);
  const projects = live(doc.projects).sort((a, b) => a.name.localeCompare(b.name, 'fr'));

  const flush = async () => {
    if (!dirty.current) return;
    const { title: t, content: c, projectId: p } = latest.current;
    if (!t.trim() && !c.trim()) return; // une note vide n'est pas enregistrée
    dirty.current = false;
    setSaved('saving');
    const cur = idRef.current;
    const r = cur ? await store.mutate((d, ctx) => updateNote(d, ctx, cur, { title: t, content: c, projectId: p })) : await store.mutateAdd((d, ctx) => addNote(d, ctx, { title: t, content: c, projectId: p }));
    if (r.ok) { if (!cur && typeof r.value === 'string') { idRef.current = r.value; setId(r.value); } setSaved('saved'); } else { dirty.current = true; setSaved('error'); }
  };
  const touch = () => { dirty.current = true; setSaved('idle'); };
  useEffect(() => { if (!dirty.current) return; const t = setTimeout(() => void flush(), 500); return () => clearTimeout(t); }, [title, content, projectId]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { const onHide = () => void flush(); window.addEventListener('pagehide', onHide); window.addEventListener('beforeunload', onHide); return () => { window.removeEventListener('pagehide', onHide); window.removeEventListener('beforeunload', onHide); }; }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const close = async () => { await flush(); onClose(); };
  const remove = async () => {
    if (!id) return onClose();
    if (await confirm({ title: 'Supprimer cette note ?', message: 'Elle sera aussi supprimée de vos autres appareils après synchronisation.', confirmLabel: 'Supprimer', danger: true })) { dirty.current = false; await act(store.mutate((d, c) => deleteNote(d, c, id)), 'Note supprimée'); onClose(); }
  };
  return (
    <Modal wide title={id ? 'Note' : 'Nouvelle note'} onClose={() => void close()} footer={<>
      <span className="muted small autosave" aria-live="polite">{saved === 'saving' ? 'Enregistrement…' : saved === 'saved' ? 'Enregistré' : saved === 'error' ? 'Échec de l’enregistrement' : id ? `Modifiée le ${formatDateTime(live_?.updatedAt ?? '')}` : 'Enregistrement automatique'}</span>
      <span className="spacer" />
      {id && <Button variant="ghost" icon={<Trash2 size={16} />} onClick={() => void remove()}>Supprimer</Button>}
      <Button variant="primary" onClick={() => void close()}>Terminer</Button></>}>
      <div className="form-grid">
        <Field label="Titre (facultatif)"><input value={title} onChange={(e) => { setTitle(e.target.value); touch(); }} maxLength={200} /></Field>
        <Field label="Contenu"><textarea value={content} onChange={(e) => { setContent(e.target.value); touch(); }} rows={12} maxLength={50000} autoFocus /></Field>
        <div className="two-col">
          <Field label="Projet associé"><select value={projectId ?? ''} onChange={(e) => { setProjectId(e.target.value || null); touch(); }}><option value="">Aucun</option>{projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>
          {id && <div className="field"><span className="field-label">Favori</span><Button variant="secondary" icon={<Star size={16} className={live_?.starred ? 'star-on' : ''} />} onClick={() => void act(store.mutate((d, c) => updateNote(d, c, id, { starred: !live_?.starred })))} aria-pressed={live_?.starred}>{live_?.starred ? 'Retirer des favoris' : 'Mettre en favori'}</Button></div>}
        </div>
      </div>
    </Modal>
  );
}

type Sort = 'modified' | 'created' | 'title';
export function NotesView() {
  const { doc, store, act, nav } = useApp();
  const [q, setQ] = useState('');
  const [onlyStar, setOnlyStar] = useState(false);
  const [projectFilter, setProjectFilter] = useState('');
  const [sort, setSort] = useState<Sort>('modified');
  const [editing, setEditing] = useState<string | 'new' | null>(null);
  useEffect(() => { if (nav.focusId && live(doc.notes).some((n) => n.id === nav.focusId)) setEditing(nav.focusId); }, [nav.focusId]); // eslint-disable-line react-hooks/exhaustive-deps

  const projName = new Map(live(doc.projects).map((p) => [p.id, p.name]));
  const nq = normalize(q.trim());
  const list = live(doc.notes).filter((n) => (!onlyStar || n.starred) && (!projectFilter || (projectFilter === 'none' ? n.projectId === null : n.projectId === projectFilter)) && (!nq || normalize(`${n.title} ${n.content}`).includes(nq)))
    .sort((a, b) => sort === 'title' ? (a.title || a.content).localeCompare(b.title || b.content, 'fr') : sort === 'created' ? b.createdAt.localeCompare(a.createdAt) : Number(b.starred) - Number(a.starred) || b.updatedAt.localeCompare(a.updatedAt));
  const any = live(doc.notes).length > 0;
  return (
    <div className="main-col">
      <div className="toolbar">
        <div className="input-icon"><Search size={16} aria-hidden="true" /><input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Rechercher dans les notes" aria-label="Rechercher dans les notes" /></div>
        <label className="check"><input type="checkbox" checked={onlyStar} onChange={(e) => setOnlyStar(e.target.checked)} />Favoris seulement</label>
        <select aria-label="Filtrer par projet" value={projectFilter} onChange={(e) => setProjectFilter(e.target.value)}><option value="">Tous les projets</option><option value="none">Sans projet</option>{[...projName].map(([id, n]) => <option key={id} value={id}>{n}</option>)}</select>
        <select aria-label="Trier" value={sort} onChange={(e) => setSort(e.target.value as Sort)}><option value="modified">Dernière modification</option><option value="created">Date de création</option><option value="title">Titre</option></select>
        <Button variant="primary" icon={<Plus size={16} />} onClick={() => setEditing('new')}>Nouvelle note</Button>
      </div>
      {!list.length ? <EmptyState icon={<StickyNote size={24} />} title={any ? 'Aucune note ne correspond' : 'Aucune note pour l’instant'} action={!any ? <Button variant="primary" icon={<Plus size={16} />} onClick={() => setEditing('new')}>Écrire une note</Button> : undefined} /> : (
        <ul className="cards-grid">
          {list.map((n: Note) => (
            <li key={n.id} className="note-card">
              <button className="note-open" onClick={() => setEditing(n.id)}>
                <h3>{n.title || <span className="muted">Sans titre</span>}</h3>
                <p className="clamp">{n.content}</p>
              </button>
              <footer><span className="muted small">{n.projectId ? `${projName.get(n.projectId) ?? ''} · ` : ''}{formatDate(n.updatedAt)}</span>
                <IconButton label={n.starred ? 'Retirer des favoris' : 'Mettre en favori'} aria-pressed={n.starred} onClick={() => void act(store.mutate((d, c) => updateNote(d, c, n.id, { starred: !n.starred })))}><Star size={16} className={n.starred ? 'star-on' : ''} /></IconButton></footer>
            </li>
          ))}
        </ul>
      )}
      {editing && <NoteEditor key={editing} noteId={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </div>
  );
}
