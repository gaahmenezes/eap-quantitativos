import { useEffect, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';

/** Painel lateral modal (dialog nativo: foco preso, Esc fecha). */
export function SidePanel({
  open,
  title,
  onClose,
  children,
  footer,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      onClose={onClose}
      aria-label={title}
      data-side="right"
      className="m-0 ml-auto h-dvh max-h-dvh w-full max-w-[540px] border-l border-line bg-sheet p-0 text-ink backdrop:bg-graphite-950/35"
    >
      {open && (
        <div className="flex h-full flex-col">
          <header className="flex items-center justify-between gap-3 border-b border-line px-5 py-4">
            <h2 className="text-[17px] font-semibold tracking-tight">{title}</h2>
            <button type="button" onClick={onClose} className="grid h-8 w-8 place-items-center rounded-md text-muted transition-colors hover:bg-paper hover:text-ink" aria-label="Fechar painel">
              <X className="h-[18px] w-[18px]" aria-hidden />
            </button>
          </header>
          <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
          {footer && <footer className="flex justify-end gap-2 border-t border-line px-5 py-3">{footer}</footer>}
        </div>
      )}
    </dialog>
  );
}

export function ConfirmDialog({
  open,
  title,
  children,
  onClose,
  footer,
}: {
  open: boolean;
  title: string;
  children: ReactNode;
  onClose: () => void;
  footer: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog ref={ref} onClose={onClose} aria-label={title} className="m-auto w-[min(480px,calc(100vw-32px))] border border-line bg-sheet p-0 text-ink backdrop:bg-graphite-950/35">
      {open && (
        <div>
          <h2 className="px-5 pt-5 text-[17px] font-semibold tracking-tight">{title}</h2>
          <div className="px-5 py-3 text-[14px] text-ink/85">{children}</div>
          <div className="flex justify-end gap-2 rounded-b-xl border-t border-line bg-paper/60 px-5 py-3">{footer}</div>
        </div>
      )}
    </dialog>
  );
}
