import { useRef, useState } from 'react';
import { Download, History, RotateCcw, ShieldCheck, Trash2, Upload } from 'lucide-react';
import { createBackupFile, importBackup, parseBackup, type ImportMode, type ImportPolicy, type ParsedBackup } from '../../backup/importExport';
import { countDocument, type DocCounts } from '../../core/docutil';
import type { Backup } from '../../storage/store';
import { Button, EmptyState, formatDateTime } from '../common';
import { useApp } from '../context';
import { useEffect } from 'react';

function download(filename: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.rel = 'noopener';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

const Counts = ({ c }: { c: DocCounts }) => (
  <dl className="counts">
    <div><dt>Favoris</dt><dd>{c.favorites}</dd></div><div><dt>Catégories</dt><dd>{c.categories}</dd></div><div><dt>Projets</dt><dd>{c.projects}</dd></div>
    <div><dt>Notes</dt><dd>{c.notes}</dd></div><div><dt>Tâches</dt><dd>{c.tasks}</dd></div>
  </dl>
);

export function BackupView() {
  const { doc, store, act, confirm, toast, dirty } = useApp();
  const fileRef = useRef<HTMLInputElement>(null);
  const [parsed, setParsed] = useState<{ name: string; data: ParsedBackup } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<ImportMode>('merge');
  const [policy, setPolicy] = useState<ImportPolicy>('keep-local');
  const [backups, setBackups] = useState<Backup[]>([]);
  const refresh = () => void store.listBackups().then(setBackups);
  useEffect(refresh, [store]);

  const exportNow = () => { const f = createBackupFile(doc); download(f.filename, f.json); toast(`Sauvegarde exportée : ${f.filename}`, 'success'); };
  const onFile = async (file: File | undefined) => {
    setParsed(null); setError(null);
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) { setError('Fichier trop volumineux (10 Mo maximum).'); return; }
    const r = parseBackup(await file.text());
    if (!r.ok) setError(r.error); else setParsed({ name: file.name, data: r.value });
    if (fileRef.current) fileRef.current.value = '';
  };
  const runImport = async () => {
    if (!parsed) return;
    const ok = await confirm({
      title: mode === 'replace' ? 'Remplacer toutes vos données ?' : 'Fusionner ce fichier avec vos données ?',
      message: mode === 'replace' ? 'Vos données actuelles seront remplacées par celles du fichier. Une sauvegarde locale est créée juste avant, et vous pourrez la restaurer.' : 'Les éléments du fichier sont ajoutés à vos données. Une sauvegarde locale est créée juste avant.',
      confirmLabel: mode === 'replace' ? 'Remplacer' : 'Fusionner', danger: mode === 'replace',
    });
    if (!ok) return;
    const r = await act(importBackup(store, parsed.data, mode, policy));
    if (r.ok) { toast(mode === 'replace' ? 'Données restaurées.' : `Fusion terminée${r.value.conflictsResolved ? ` (${r.value.conflictsResolved} désaccord${r.value.conflictsResolved > 1 ? 's' : ''} tranché${r.value.conflictsResolved > 1 ? 's' : ''})` : ''}.`, 'success'); setParsed(null); refresh(); }
  };
  const restore = async (b: Backup) => {
    if (await confirm({ title: 'Restaurer cette sauvegarde ?', message: `Vos données actuelles seront remplacées par celles du ${formatDateTime(b.createdAt)}. Une nouvelle sauvegarde de l’état actuel est créée avant.`, confirmLabel: 'Restaurer', danger: true })) {
      const r = await act(store.restoreBackup(b.id), 'Sauvegarde restaurée'); if (r.ok) refresh();
    }
  };
  const createNow = async () => { const r = await act(store.createBackup('Sauvegarde manuelle'), 'Sauvegarde locale créée'); if (r.ok) refresh(); };
  const removeBackup = async (b: Backup) => { if (await confirm({ title: 'Supprimer cette sauvegarde locale ?', message: formatDateTime(b.createdAt), confirmLabel: 'Supprimer', danger: true })) { await act(store.deleteBackup(b.id)); refresh(); } };

  return (
    <div className="stack">
      <section className="panel">
        <h2><Download size={18} />Exporter</h2>
        <p className="muted">Un fichier JSON contenant vos favoris, projets, notes, tâches et réglages. Il ne contient jamais votre jeton GitHub ni l’image de fond (propre à cet appareil).</p>
        <Counts c={countDocument(doc)} />
        <Button variant="primary" icon={<Download size={16} />} onClick={exportNow}>Exporter en JSON</Button>
        {dirty && <p className="muted small">Des modifications locales n’ont pas encore été synchronisées avec GitHub.</p>}
      </section>

      <section className="panel">
        <h2><Upload size={18} />Importer</h2>
        <p className="muted">Le fichier est vérifié (format, version du schéma, adresses) avant toute modification. Un fichier invalide est rejeté sans toucher à vos données.</p>
        <input ref={fileRef} type="file" accept="application/json,.json" aria-label="Choisir un fichier de sauvegarde" onChange={(e) => void onFile(e.target.files?.[0])} />
        {error && <p className="field-error" role="alert">{error}</p>}
        {parsed && (
          <div className="import-preview">
            <p><ShieldCheck size={16} /> <strong>{parsed.name}</strong> est valide{parsed.data.exportedAt ? ` (exporté le ${formatDateTime(parsed.data.exportedAt)})` : ''}. Schéma version {parsed.data.fromVersion}{parsed.data.migrated ? ', converti vers la version actuelle' : ''}.</p>
            <div className="two-col"><div><h3>Dans le fichier</h3><Counts c={parsed.data.counts} /></div><div><h3>Actuellement</h3><Counts c={countDocument(doc)} /></div></div>
            <fieldset className="field"><legend className="field-label">Mode d’import</legend>
              <label className="check"><input type="radio" name="mode" checked={mode === 'merge'} onChange={() => setMode('merge')} />Fusionner avec mes données actuelles</label>
              <label className="check"><input type="radio" name="mode" checked={mode === 'replace'} onChange={() => setMode('replace')} />Remplacer toutes mes données</label></fieldset>
            {mode === 'merge' && <fieldset className="field"><legend className="field-label">Si un élément existe des deux côtés avec des différences</legend>
              <label className="check"><input type="radio" name="policy" checked={policy === 'keep-local'} onChange={() => setPolicy('keep-local')} />Garder ma version actuelle</label>
              <label className="check"><input type="radio" name="policy" checked={policy === 'prefer-import'} onChange={() => setPolicy('prefer-import')} />Préférer la version du fichier</label></fieldset>}
            <div className="row-end"><Button variant="ghost" onClick={() => setParsed(null)}>Annuler</Button><Button variant={mode === 'replace' ? 'danger' : 'primary'} onClick={() => void runImport()}>{mode === 'replace' ? 'Remplacer mes données…' : 'Fusionner…'}</Button></div>
          </div>
        )}
      </section>

      <section className="panel">
        <h2><History size={18} />Sauvegardes locales</h2>
        <p className="muted">Créées automatiquement avant toute restauration, fusion ou changement venu de GitHub. Les {8} plus récentes sont conservées sur cet appareil.</p>
        <Button variant="secondary" icon={<History size={16} />} onClick={() => void createNow()}>Créer une sauvegarde maintenant</Button>
        {!backups.length ? <EmptyState icon={<History size={22} />} title="Aucune sauvegarde locale" /> : (
          <ul className="rows">{backups.map((b) => (
            <li key={b.id} className="row-card">
              <div className="row-text"><span className="row-title">{formatDateTime(b.createdAt)}</span><span className="muted small">{b.reason} · {b.counts.favorites} favoris, {b.counts.projects} projets, {b.counts.notes} notes, {b.counts.tasks} tâches</span></div>
              <div className="row-actions">
                <Button variant="ghost" icon={<RotateCcw size={16} />} onClick={() => void restore(b)}>Restaurer</Button>
                <Button variant="ghost" icon={<Download size={16} />} onClick={() => { const f = createBackupFile(b.doc, new Date(b.createdAt)); download(f.filename, f.json); }}>Exporter</Button>
                <Button variant="ghost" icon={<Trash2 size={16} />} aria-label="Supprimer la sauvegarde" onClick={() => void removeBackup(b)} />
              </div>
            </li>))}</ul>
        )}
      </section>
    </div>
  );
}
