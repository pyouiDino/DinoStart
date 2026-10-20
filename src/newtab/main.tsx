import '@fontsource-variable/bricolage-grotesque';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createDefaultAdapter } from '../storage/adapters';
import { DinoStore } from '../storage/store';
import { SyncEngine } from '../sync/syncEngine';
import { SyncScheduler } from '../sync/scheduler';
import { App } from '../ui/App';
import { AppProvider } from '../ui/context';
import '../styles/app.css';

const rootEl = document.getElementById('root')!;
const root = createRoot(rootEl);

async function boot() {
  const store = new DinoStore(createDefaultAdapter());
  await store.init(); // lecture locale uniquement : aucune requête réseau au démarrage
  const engine = new SyncEngine({ store });
  root.render(<StrictMode><AppProvider store={store} engine={engine}><App /></AppProvider></StrictMode>);
  // Synchronisation automatique facultative : lancée après le premier rendu, jamais bloquante.
  const scheduler = new SyncScheduler(engine, store, {}, undefined);
  scheduler.start();
  window.addEventListener('pagehide', () => scheduler.stop());
}

boot().catch((e: unknown) => {
  const p = document.createElement('p');
  p.className = 'fatal';
  p.textContent = `DinoStart n’a pas pu démarrer : ${e instanceof Error ? e.message : 'erreur inconnue'}. Vos données ne sont pas modifiées.`;
  rootEl.replaceChildren(p);
});
