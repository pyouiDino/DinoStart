import { useEffect, useState } from 'react';
import { CircleAlert, CircleCheck, CloudDownload, CloudUpload, KeyRound, RefreshCw, ShieldCheck, Unplug } from 'lucide-react';
import { DEFAULT_SYNC_CONFIG, type SyncConfig } from '../../sync/config';
import type { AccessCheck, ConflictState } from '../../sync/syncEngine';
import type { Conflict, Resolution } from '../../core/merge';
import { Button, Field, Toggle, formatDateTime } from '../common';
import { useApp } from '../context';

const TOKEN_HELP = 'https://docs.github.com/fr/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens';

function ConflictResolver({ state, onDone }: { state: ConflictState; onDone: () => void }) {
  const { engine, toast } = useApp();
  const [choices, setChoices] = useState<Record<string, Resolution>>({});
  const [busy, setBusy] = useState(false);
  const all = state.conflicts.every((c) => choices[c.key]);
  const preview = (v: unknown, c: Conflict): string => {
    if (v === null || v === undefined) return '—';
    const o = v as Record<string, unknown>;
    if (c.kind === 'delete-edit' && o.deletedAt) return `Supprimé le ${formatDateTime(String(o.deletedAt))}`;
    if (c.kind === 'fields') return c.fields.map((f) => `${f} : ${JSON.stringify(f.split('.').reduce<unknown>((acc, k) => (acc as Record<string, unknown> | undefined)?.[k], o))}`).join('\n');
    return `${String(o.title ?? o.name ?? '')}\nModifié le ${formatDateTime(String(o.updatedAt))}`;
  };
  const apply = async () => {
    setBusy(true);
    const r = await engine.sync({ resolutions: choices });
    setBusy(false);
    toast(r.message, r.status === 'idle' || r.status === 'pending' ? 'success' : r.status === 'conflict' ? 'info' : 'error');
    onDone();
  };
  return (
    <div className="conflicts" role="region" aria-label="Conflits de synchronisation">
      <h3><CircleAlert size={18} />Conflits à résoudre ({state.conflicts.length})</h3>
      <p className="muted">Ces éléments ont été modifiés différemment sur deux appareils. Rien n’a été écrasé et une copie locale est dans vos sauvegardes. Choisissez la version à conserver pour chacun.</p>
      {state.conflicts.map((c) => (
        <fieldset key={c.key} className="conflict">
          <legend>{c.label || c.id} <span className="chip">{c.kind === 'delete-edit' ? 'suppression / modification' : `champ : ${c.fields.join(', ')}`}</span></legend>
          <div className="two-col">
            <label className={`choice ${choices[c.key] === 'local' ? 'on' : ''}`}><input type="radio" name={c.key} checked={choices[c.key] === 'local'} onChange={() => setChoices((x) => ({ ...x, [c.key]: 'local' }))} /><strong>Cet appareil</strong><pre>{preview(c.local, c)}</pre></label>
            <label className={`choice ${choices[c.key] === 'remote' ? 'on' : ''}`}><input type="radio" name={c.key} checked={choices[c.key] === 'remote'} onChange={() => setChoices((x) => ({ ...x, [c.key]: 'remote' }))} /><strong>GitHub (autre appareil)</strong><pre>{preview(c.remote, c)}</pre></label>
          </div>
        </fieldset>
      ))}
      <div className="row-end">
        <Button variant="ghost" onClick={() => setChoices(Object.fromEntries(state.conflicts.map((c) => [c.key, 'local'])))}>Tout garder ici</Button>
        <Button variant="ghost" onClick={() => setChoices(Object.fromEntries(state.conflicts.map((c) => [c.key, 'remote'])))}>Tout prendre de GitHub</Button>
        <Button variant="primary" disabled={!all || busy} onClick={() => void apply()}>{busy ? 'Application…' : 'Appliquer mes choix et synchroniser'}</Button>
      </div>
    </div>
  );
}

export function SyncPanel() {
  const { engine, syncState, syncRunning, syncNow, toast, confirm, store, dirty } = useApp();
  const [cfg, setCfg] = useState<SyncConfig>(DEFAULT_SYNC_CONFIG);
  const [saved, setSaved] = useState<SyncConfig | null>(null);
  const [token, setToken] = useState('');
  const [hasToken, setHasToken] = useState(false);
  const [checks, setChecks] = useState<AccessCheck[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [conflict, setConflict] = useState<ConflictState | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const reload = async () => {
    const c = await engine.getConfig();
    setSaved(c); if (c) setCfg(c);
    setHasToken(await engine.hasToken());
    setConflict(await engine.getConflictState());
  };
  useEffect(() => { void reload(); }, [syncState.status, syncState.lastSyncAt]); // eslint-disable-line react-hooks/exhaustive-deps

  const set = <K extends keyof SyncConfig>(k: K, v: SyncConfig[K]) => { setCfg((c) => ({ ...c, [k]: v })); setChecks(null); };
  const save = async () => {
    setFormError(null);
    const r = await engine.saveConfig(cfg, token || undefined);
    if (!r.ok) { setFormError(r.error); return false; }
    setToken(''); toast('Configuration enregistrée', 'success'); await reload(); return true;
  };
  const test = async () => { setBusy('test'); setChecks(await engine.testAccess(cfg, token || undefined)); setBusy(null); };
  const connectAndSync = async () => { if (await save()) await syncNow(); };

  const pull = async () => {
    setBusy('pull');
    const insp = await engine.inspectRemote();
    setBusy(null);
    if (!insp.ok) { toast(insp.error, 'error'); return; }
    if (!insp.value.exists) { toast('Aucun fichier de données n’existe encore dans le dépôt.', 'error'); return; }
    const c = insp.value.counts!;
    if (!(await confirm({ title: 'Remplacer les données locales ?', message: <>Le dépôt contient {c.favorites} favoris, {c.projects} projets, {c.notes} notes et {c.tasks} tâches. <strong>Vos données locales seront remplacées</strong> (une sauvegarde locale est créée avant). Pour garder les deux, utilisez plutôt « Synchroniser maintenant ».</>, confirmLabel: 'Télécharger et remplacer', danger: true }))) return;
    setBusy('pull'); const r = await engine.pullReplace(); setBusy(null); toast(r.message, r.status === 'idle' ? 'success' : 'error');
  };
  const push = async () => {
    setBusy('push');
    const insp = await engine.inspectRemote();
    setBusy(null);
    if (!insp.ok) { toast(insp.error, 'error'); return; }
    const remote = insp.value.counts ? `Le dépôt contient actuellement ${insp.value.counts.favorites} favoris, ${insp.value.counts.projects} projets, ${insp.value.counts.notes} notes et ${insp.value.counts.tasks} tâches.` : 'Le fichier n’existe pas encore dans le dépôt.';
    if (!(await confirm({ title: 'Remplacer les données du dépôt ?', message: <>{remote} <strong>Elles seront remplacées par vos données locales</strong> sans fusion. L’ancienne version reste dans l’historique Git. Pour fusionner, utilisez « Synchroniser maintenant ».</>, confirmLabel: 'Envoyer et remplacer', danger: true }))) return;
    setBusy('push'); const r = await engine.pushReplace(); setBusy(null); toast(r.message, r.status === 'idle' ? 'success' : 'error');
  };
  const disconnect = async () => { if (await confirm({ title: 'Déconnecter le dépôt ?', message: 'La configuration et l’état de synchronisation sont oubliés sur cet appareil. Vos données locales et le dépôt GitHub ne sont pas modifiés. Le jeton reste enregistré tant que vous ne le supprimez pas.', confirmLabel: 'Déconnecter', danger: true })) { await engine.disconnect(); setCfg(DEFAULT_SYNC_CONFIG); setChecks(null); await reload(); toast('Dépôt déconnecté', 'success'); } };
  const clearToken = async () => { if (await confirm({ title: 'Supprimer le jeton de cet appareil ?', message: 'La synchronisation s’arrêtera jusqu’à ce que vous saisissiez un nouveau jeton. Pour l’invalider aussi côté GitHub, révoquez-le dans vos paramètres GitHub (voir le README).', confirmLabel: 'Supprimer le jeton', danger: true })) { await engine.clearToken(); await reload(); toast('Jeton supprimé de cet appareil', 'success'); } };

  const status = syncRunning ? 'syncing' : syncState.status === 'idle' && dirty ? 'pending' : syncState.status;
  const label: Record<string, string> = { unconfigured: 'Non configurée', idle: 'À jour', pending: 'Modifications en attente', syncing: 'Synchronisation en cours…', offline: 'Hors ligne — en attente', error: 'Erreur', conflict: 'Conflit à résoudre', 'rate-limited': 'Limite GitHub atteinte' };
  const ready = Boolean(saved) && hasToken;

  return (
    <div className="stack">
      <section className="panel">
        <h2>État</h2>
        <p className={`sync-status s-${status}`}>{status === 'idle' ? <CircleCheck size={18} /> : status === 'error' || status === 'conflict' ? <CircleAlert size={18} /> : <RefreshCw size={18} />}<strong>{label[status]}</strong></p>
        <dl className="kv">
          <dt>Dernière synchronisation réussie</dt><dd>{syncState.lastSyncAt ? formatDateTime(syncState.lastSyncAt) : 'Jamais'}</dd>
          <dt>Dernière tentative</dt><dd>{syncState.lastAttemptAt ? formatDateTime(syncState.lastAttemptAt) : '—'}</dd>
          {syncState.rateLimitedUntil && Date.parse(syncState.rateLimitedUntil) > Date.now() && (<><dt>Nouvelle tentative possible à</dt><dd>{new Date(syncState.rateLimitedUntil).toLocaleTimeString('fr-FR')}</dd></>)}
        </dl>
        {syncState.lastError && status !== 'idle' && <p className="field-error" role="alert">{syncState.lastError.message}</p>}
        <div className="row-gap">
          <Button variant="primary" icon={<RefreshCw size={16} />} disabled={!ready || syncRunning} onClick={() => void syncNow()}>{syncState.status === 'error' || syncState.status === 'offline' ? 'Réessayer' : 'Synchroniser maintenant'}</Button>
          <Button variant="secondary" icon={<CloudDownload size={16} />} disabled={!ready || syncRunning || busy !== null} onClick={() => void pull()}>Télécharger les données distantes</Button>
          <Button variant="secondary" icon={<CloudUpload size={16} />} disabled={!ready || syncRunning || busy !== null} onClick={() => void push()}>Envoyer les données locales</Button>
        </div>
        <Toggle label="Synchronisation automatique (regroupe les modifications, jamais à chaque frappe)" checked={Boolean(saved?.autoSync)} onChange={(v) => void engine.setAutoSync(v).then((r) => { if (!r.ok) toast(r.error, 'error'); void reload(); })} />
        <p className="muted small">La synchronisation automatique s’exécute tant qu’un nouvel onglet DinoStart est ouvert : après l’ouverture, puis 20 secondes après votre dernière modification.</p>
      </section>

      {conflict && conflict.conflicts.length > 0 && syncState.status === 'conflict' && <ConflictResolver state={conflict} onDone={() => void reload()} />}
      {syncState.status === 'conflict' && !(conflict && conflict.conflicts.length) && <p className="field-error" role="alert">Le fichier distant change trop souvent pour être fusionné. Réessayez dans un instant ; vos données locales sont intactes.</p>}

      <section className="panel">
        <h2><KeyRound size={18} />Dépôt GitHub privé</h2>
        <form className="form-grid" onSubmit={(e) => { e.preventDefault(); void connectAndSync(); }}>
          <div className="two-col">
            <Field label="Propriétaire du dépôt"><input value={cfg.owner} onChange={(e) => set('owner', e.target.value)} autoComplete="off" spellCheck={false} placeholder="votre-pseudo" /></Field>
            <Field label="Nom du dépôt"><input value={cfg.repo} onChange={(e) => set('repo', e.target.value)} autoComplete="off" spellCheck={false} placeholder="dinostart-data" /></Field>
          </div>
          <div className="two-col">
            <Field label="Branche"><input value={cfg.branch} onChange={(e) => set('branch', e.target.value)} autoComplete="off" spellCheck={false} /></Field>
            <Field label="Chemin du fichier de données"><input value={cfg.path} onChange={(e) => set('path', e.target.value)} autoComplete="off" spellCheck={false} /></Field>
          </div>
          <Field label="Jeton d’accès fine-grained" hint={hasToken ? 'Un jeton est enregistré sur cet appareil. Laissez vide pour le conserver.' : 'Commence par github_pat_. Limité à ce seul dépôt, permission « Contents : Read and write ».'}>
            <input type="password" value={token} onChange={(e) => { setToken(e.target.value); setChecks(null); }} autoComplete="off" spellCheck={false} placeholder={hasToken ? '••••••••••••••••' : 'github_pat_…'} />
          </Field>
          <p className="notice"><ShieldCheck size={16} /><span>Le jeton est conservé dans le stockage local de l’extension, <strong>sans chiffrement de type coffre-fort</strong>. Il n’est jamais exporté, synchronisé ni envoyé ailleurs qu’à api.github.com. Utilisez un jeton limité à un seul dépôt et révoquez-le sur GitHub si cet ordinateur est perdu. <a href={TOKEN_HELP} target="_blank" rel="noopener noreferrer">Aide GitHub</a></span></p>
          {formError && <p className="field-error" role="alert">{formError}</p>}
          <div className="row-gap">
            <Button variant="secondary" disabled={busy !== null} onClick={() => void test()}>{busy === 'test' ? 'Vérification…' : 'Vérifier les paramètres'}</Button>
            <Button variant="secondary" onClick={() => void save()}>Enregistrer</Button>
            <Button variant="primary" type="submit" disabled={syncRunning}>Enregistrer et synchroniser</Button>
          </div>
        </form>
        {checks && (
          <ul className="checks" aria-label="Résultat de la vérification">{checks.map((c) => <li key={c.label} className={c.ok ? 'ok' : 'ko'}>{c.ok ? <CircleCheck size={16} /> : <CircleAlert size={16} />}<strong>{c.label}</strong><span>{c.detail}</span></li>)}</ul>
        )}
        <div className="row-gap danger-zone">
          <Button variant="ghost" icon={<Unplug size={16} />} disabled={!saved} onClick={() => void disconnect()}>Déconnecter le dépôt</Button>
          <Button variant="ghost" disabled={!hasToken} onClick={() => void clearToken()}>Supprimer le jeton de cet appareil</Button>
          <span className="muted small">{store.getDeviceId() && `Identifiant de cet appareil : ${store.getDeviceId().slice(0, 8)}`}</span>
        </div>
      </section>
    </div>
  );
}
