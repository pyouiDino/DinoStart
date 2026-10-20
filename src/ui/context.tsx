import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import type { DinoDocument, Result } from '../core/types';
import type { DinoStore } from '../storage/store';
import { KEYS } from '../storage/store';
import { EMPTY_SYNC_STATE, type SyncState } from '../sync/config';
import type { SyncEngine } from '../sync/syncEngine';
import { applyTheme } from './theme';
import { ConfirmDialog, Toasts, type ConfirmOptions, type ToastItem } from './common';

export type ViewId = 'home' | 'favorites' | 'projects' | 'notes' | 'tasks' | 'backup' | 'settings';
export type SettingsTab = 'appearance' | 'widgets' | 'search' | 'sync' | 'open' | 'help';

export interface Nav { view: ViewId; focusId?: string; settingsTab?: SettingsTab; categoryId?: string | null }

export interface AppApi {
  doc: DinoDocument;
  store: DinoStore;
  engine: SyncEngine;
  syncState: SyncState;
  syncRunning: boolean;
  dirty: boolean;
  loadWarning: string | null;
  nav: Nav;
  go: (n: Nav | ViewId) => void;
  /** Exécute une opération de stockage ; affiche une erreur claire si elle échoue. */
  act: <T>(p: Promise<Result<T>>, successMessage?: string) => Promise<Result<T>>;
  toast: (message: string, kind?: ToastItem['kind']) => void;
  confirm: (o: ConfirmOptions) => Promise<boolean>;
  syncNow: () => Promise<void>;
  bgImage: string | null;
  setBgImage: (dataUrl: string | null) => Promise<Result<true>>;
}

const Ctx = createContext<AppApi | null>(null);
export const useApp = (): AppApi => {
  const v = useContext(Ctx);
  if (!v) throw new Error('useApp hors du fournisseur');
  return v;
};

export function AppProvider({ store, engine, children }: { store: DinoStore; engine: SyncEngine; children: ReactNode }) {
  useSyncExternalStore(store.subscribe, store.getVersion);
  const doc = store.getDoc();
  const [nav, setNav] = useState<Nav>({ view: 'home' });
  const [syncState, setSyncState] = useState<SyncState>(EMPTY_SYNC_STATE);
  const [syncRunning, setSyncRunning] = useState(false);
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [confirmState, setConfirmState] = useState<{ opts: ConfirmOptions; resolve: (v: boolean) => void } | null>(null);
  const [bgImage, setBgImageState] = useState<string | null>(null);
  const toastId = useRef(0);
  const version = store.getVersion();
  const dirty = store.dirty;

  useEffect(() => { void engine.getState().then(setSyncState); }, [engine, version]);
  useEffect(() => { void store.getLocal<string>(KEYS.bgImage).then((v) => setBgImageState(typeof v === 'string' ? v : null)); }, [store, version]);

  // Thème : appliqué à chaque changement de paramètres et de préférence système.
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => applyTheme(doc.settings, mq.matches, bgImage);
    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, [doc.settings, bgImage]);

  const toast = useCallback((message: string, kind: ToastItem['kind'] = 'info') => {
    const id = ++toastId.current;
    setToasts((t) => [...t.slice(-3), { id, message, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === 'error' ? 8000 : 3500);
  }, []);

  const act = useCallback(async <T,>(p: Promise<Result<T>>, successMessage?: string) => {
    const r = await p;
    if (!r.ok) toast(r.error, 'error'); else if (successMessage) toast(successMessage, 'success');
    return r;
  }, [toast]);

  const confirm = useCallback((opts: ConfirmOptions) => new Promise<boolean>((resolve) => setConfirmState({ opts, resolve })), []);

  const syncNow = useCallback(async () => {
    setSyncRunning(true);
    try {
      const r = await engine.sync();
      toast(r.message, r.status === 'idle' || r.status === 'pending' ? 'success' : r.status === 'conflict' ? 'info' : 'error');
    } finally {
      setSyncRunning(false);
      setSyncState(await engine.getState());
    }
  }, [engine, toast]);

  const setBgImage = useCallback(async (dataUrl: string | null): Promise<Result<true>> => {
    if (dataUrl === null) { await store.removeLocal(KEYS.bgImage); return { ok: true, value: true }; }
    return store.setLocal(KEYS.bgImage, dataUrl);
  }, [store]);

  const api = useMemo<AppApi>(() => ({
    doc, store, engine, syncState, syncRunning, dirty, loadWarning: store.loadWarning, nav,
    go: (n) => setNav(typeof n === 'string' ? { view: n } : n),
    act, toast, confirm, syncNow, bgImage, setBgImage,
  }), [doc, store, engine, syncState, syncRunning, nav, act, toast, confirm, syncNow, bgImage, setBgImage, dirty]);

  return (
    <Ctx.Provider value={api}>
      {children}
      <Toasts items={toasts} onDismiss={(id) => setToasts((t) => t.filter((x) => x.id !== id))} />
      {confirmState && <ConfirmDialog {...confirmState.opts} onResult={(v) => { confirmState.resolve(v); setConfirmState(null); }} />}
    </Ctx.Provider>
  );
}
