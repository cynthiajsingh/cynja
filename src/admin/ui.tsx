import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';

// ---------- toasts ----------
interface Toast { id: number; message: string; kind: 'success' | 'error' }
const ToastContext = createContext<(message: string, kind?: Toast['kind']) => void>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((message: string, kind: Toast['kind'] = 'success') => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, message, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === 'error' ? 8000 : 4000);
  }, []);
  return (
    <ToastContext.Provider value={push}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.kind}`} role={t.kind === 'error' ? 'alert' : undefined}>
            <span>{t.message}</span>
            <button type="button" aria-label="Dismiss" onClick={() => setToasts((x) => x.filter((y) => y.id !== t.id))}>×</button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export const useToast = () => useContext(ToastContext);

// ---------- modal dialog (native <dialog>: focus trap, Esc, inert background) ----------
export function Modal({ open, onClose, title, children, footer, wide = false }: {
  open: boolean; onClose: () => void; title: string; children: ReactNode; footer?: ReactNode; wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog ref={ref} className={`a-dialog${wide ? ' wide' : ''}`} onClose={onClose} aria-labelledby="dialog-title"
      onClick={(e) => { if (e.target === ref.current) onClose(); }}>
      {open && (
        <>
          <div className="dialog-head">
            <h2 id="dialog-title">{title}</h2>
            <button type="button" className="a-btn ghost sm" onClick={onClose} aria-label="Close">✕</button>
          </div>
          <div className="dialog-body">{children}</div>
          {footer && <div className="dialog-foot">{footer}</div>}
        </>
      )}
    </dialog>
  );
}

// ---------- confirm ----------
interface ConfirmOptions { title: string; message: ReactNode; confirmLabel: string; danger?: boolean }

export function useConfirm(): [(o: ConfirmOptions) => Promise<boolean>, ReactNode] {
  const [state, setState] = useState<(ConfirmOptions & { resolve: (v: boolean) => void }) | null>(null);
  const ask = useCallback((o: ConfirmOptions) => new Promise<boolean>((resolve) => setState({ ...o, resolve })), []);
  const done = (v: boolean) => { state?.resolve(v); setState(null); };
  const node = (
    <Modal open={!!state} onClose={() => done(false)} title={state?.title ?? ''}
      footer={<>
        <button type="button" className="a-btn" onClick={() => done(false)}>Cancel</button>
        <button type="button" className={`a-btn ${state?.danger ? 'danger' : 'primary'}`} onClick={() => done(true)} autoFocus>
          {state?.confirmLabel}
        </button>
      </>}>
      <p style={{ lineHeight: 1.6 }}>{state?.message}</p>
    </Modal>
  );
  return [ask, node];
}

export function StatusBadge({ status, isLive, pending }: { status: string; isLive: boolean; pending?: boolean }) {
  const label = isLive ? 'Published' : status === 'scheduled' ? 'Scheduled' : 'Draft';
  const cls = isLive ? 'published' : status === 'scheduled' ? 'scheduled' : 'draft';
  return (
    <>
      <span className={`badge ${cls}`}>{label}</span>
      {pending && <> <span className="badge pending" title="Edits not yet visible to readers">Unpublished changes</span></>}
    </>
  );
}
