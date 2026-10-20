import { useEffect, useId, useRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { Check, CircleAlert, Info, X } from 'lucide-react';

export interface ToastItem { id: number; message: string; kind: 'info' | 'success' | 'error' }
export interface ConfirmOptions { title: string; message: ReactNode; confirmLabel?: string; danger?: boolean }

export function Toasts({ items, onDismiss }: { items: ToastItem[]; onDismiss: (id: number) => void }) {
  return (
    <div className="toasts" role="status" aria-live="polite">
      {items.map((t) => (
        <div key={t.id} className={`toast toast-${t.kind}`}>
          {t.kind === 'error' ? <CircleAlert size={18} /> : t.kind === 'success' ? <Check size={18} /> : <Info size={18} />}
          <span>{t.message}</span>
          <button className="icon-btn" aria-label="Fermer la notification" onClick={() => onDismiss(t.id)}><X size={16} /></button>
        </div>
      ))}
    </div>
  );
}

type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'ghost' | 'danger'; icon?: ReactNode };
export function Button({ variant = 'secondary', icon, children, className = '', type = 'button', ...rest }: BtnProps) {
  return <button type={type} className={`btn btn-${variant} ${className}`} {...rest}>{icon}{children}</button>;
}
export function IconButton({ label, children, className = '', type = 'button', ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return <button type={type} className={`icon-btn ${className}`} aria-label={label} title={label} {...rest}>{children}</button>;
}

/** Boîte de dialogue native <dialog> : piège le focus, se ferme avec Échap. */
export function Modal({ title, onClose, children, wide = false, footer }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean; footer?: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) { if (typeof d.showModal === 'function') d.showModal(); else d.setAttribute('open', ''); }
  }, []);
  return (
    <dialog ref={ref} className={`modal ${wide ? 'modal-wide' : ''}`} aria-labelledby={titleId} onCancel={(e) => { e.preventDefault(); onClose(); }} onClick={(e) => { if (e.target === ref.current) onClose(); }}>
      <div className="modal-head">
        <h2 id={titleId}>{title}</h2>
        <IconButton label="Fermer" onClick={onClose}><X size={18} /></IconButton>
      </div>
      <div className="modal-body">{children}</div>
      {footer && <div className="modal-foot">{footer}</div>}
    </dialog>
  );
}

export function ConfirmDialog({ title, message, confirmLabel = 'Confirmer', danger = false, onResult }: ConfirmOptions & { onResult: (v: boolean) => void }) {
  return (
    <Modal title={title} onClose={() => onResult(false)} footer={<>
      <Button variant="ghost" onClick={() => onResult(false)}>Annuler</Button>
      <Button variant={danger ? 'danger' : 'primary'} onClick={() => onResult(true)} autoFocus>{confirmLabel}</Button>
    </>}>
      <div className="confirm-msg">{message}</div>
    </Modal>
  );
}

export function EmptyState({ icon, title, children, action }: { icon: ReactNode; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty">
      <div className="empty-icon" aria-hidden="true">{icon}</div>
      <p className="empty-title">{title}</p>
      {children && <p className="empty-text">{children}</p>}
      {action}
    </div>
  );
}

export function Field({ label, hint, error, children }: { label: string; hint?: string; error?: string | null; children: ReactNode }) {
  return (
    <div className="field">
      <label className="field-wrap">
        <span className="field-label">{label}</span>
        {children}
      </label>
      {hint && !error && <span className="field-hint">{hint}</span>}
      {error && <span className="field-error" role="alert">{error}</span>}
    </div>
  );
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className="toggle">
      <input type="checkbox" role="switch" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="toggle-track" aria-hidden="true"><span className="toggle-thumb" /></span>
      <span>{label}</span>
    </label>
  );
}

export const formatDate = (iso: string, opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short', year: 'numeric' }) =>
  new Date(iso).toLocaleDateString('fr-FR', opts);
export const formatDateTime = (iso: string) => new Date(iso).toLocaleString('fr-FR', { dateStyle: 'medium', timeStyle: 'short' });
export const todayIso = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

/** Choix unique sous forme de boutons segmentés (accessibles : aria-pressed). */
export function Seg<T extends string | number>({ value, options, onChange, label }: { value: T; options: readonly (readonly [T, string])[]; onChange: (v: T) => void; label: string }) {
  return (
    <div className="seg" role="group" aria-label={label}>
      {options.map(([k, l]) => <button type="button" key={String(k)} className={value === k ? 'on' : ''} aria-pressed={value === k} onClick={() => onChange(k)}>{l}</button>)}
    </div>
  );
}
