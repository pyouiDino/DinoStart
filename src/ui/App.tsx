import { Bookmark, Cloud, CloudOff, FolderKanban, House, ListChecks, RefreshCw, Settings as SettingsIcon, ShieldAlert, StickyNote, Archive, TriangleAlert, CloudAlert } from 'lucide-react';
import type { ReactNode } from 'react';
import { useApp, type ViewId } from './context';
import { Onboarding } from './Onboarding';
import { BackupView } from './views/BackupView';
import { FavoritesView } from './views/FavoritesView';
import { HomeView } from './views/HomeView';
import { NotesView } from './views/NotesView';
import { ProjectsView } from './views/ProjectsView';
import { SettingsView } from './views/SettingsView';
import { TasksView } from './views/TasksView';

const NAV: { id: ViewId; label: string; icon: ReactNode }[] = [
  { id: 'home', label: 'Accueil', icon: <House size={17} /> },
  { id: 'favorites', label: 'Favoris', icon: <Bookmark size={17} /> },
  { id: 'projects', label: 'Projets', icon: <FolderKanban size={17} /> },
  { id: 'notes', label: 'Notes', icon: <StickyNote size={17} /> },
  { id: 'tasks', label: 'Tâches', icon: <ListChecks size={17} /> },
];

function SyncIndicator() {
  const { syncState, syncRunning, dirty, go, doc } = useApp();
  if (!doc.settings.show.syncIndicator) return null;
  const s = syncRunning ? 'syncing' : syncState.status === 'idle' && dirty ? 'pending' : syncState.status;
  const map: Record<string, { icon: ReactNode; text: string }> = {
    unconfigured: { icon: <CloudOff size={16} />, text: 'Synchro désactivée' },
    idle: { icon: <Cloud size={16} />, text: 'Synchronisé' },
    pending: { icon: <Cloud size={16} />, text: 'En attente' },
    syncing: { icon: <RefreshCw size={16} className="spin" />, text: 'Synchronisation…' },
    offline: { icon: <CloudOff size={16} />, text: 'Hors ligne' },
    error: { icon: <CloudAlert size={16} />, text: 'Erreur de synchro' },
    conflict: { icon: <TriangleAlert size={16} />, text: 'Conflit à résoudre' },
    'rate-limited': { icon: <CloudAlert size={16} />, text: 'Limite GitHub' },
  };
  const m = map[s]!;
  const title = syncState.lastSyncAt ? `Dernière synchronisation : ${new Date(syncState.lastSyncAt).toLocaleString('fr-FR')}` : 'Aucune synchronisation réussie';
  return <button className={`sync-pill s-${s}`} onClick={() => go({ view: 'settings', settingsTab: 'sync' })} title={title} aria-label={`${m.text}. ${title}. Ouvrir les réglages de synchronisation.`}>{m.icon}<span>{m.text}</span></button>;
}

export function App() {
  const { nav, go, loadWarning, doc } = useApp();
  const view = nav.view;
  return (
    <div className="shell">
      {!doc.settings.general.onboardingDone && <Onboarding />}
      <header className="topbar">
        <button className="brand" onClick={() => go('home')} aria-label="DinoStart — Accueil">
          <img className="brand-logo" src="./logo.png" alt="" width="40" height="40" draggable={false} />
          <span>DinoStart</span>
        </button>
        <nav className="nav" aria-label="Navigation principale">
          {NAV.map((n) => <button key={n.id} className={view === n.id ? 'on' : ''} aria-current={view === n.id ? 'page' : undefined} onClick={() => go(n.id)}>{n.icon}<span>{n.label}</span></button>)}
        </nav>
        <div className="top-right">
          <SyncIndicator />
          <button className={`nav-btn ${view === 'backup' ? 'on' : ''}`} onClick={() => go('backup')} aria-label="Sauvegardes" title="Sauvegardes"><Archive size={18} /></button>
          <button className={`nav-btn ${view === 'settings' ? 'on' : ''}`} onClick={() => go('settings')} aria-label="Paramètres" title="Paramètres"><SettingsIcon size={18} /></button>
        </div>
      </header>
      {loadWarning && <div className="banner" role="alert"><ShieldAlert size={18} />{loadWarning}</div>}
      <main className="page" id="main">
        {view !== 'home' && <h1 className="page-title">{view === 'backup' ? 'Sauvegardes' : view === 'settings' ? 'Paramètres' : NAV.find((n) => n.id === view)?.label}</h1>}
        {view === 'home' && <HomeView />}
        {view === 'favorites' && <FavoritesView />}
        {view === 'projects' && <ProjectsView />}
        {view === 'notes' && <NotesView />}
        {view === 'tasks' && <TasksView />}
        {view === 'backup' && <BackupView />}
        {view === 'settings' && <SettingsView />}
      </main>
    </div>
  );
}
