import { useEffect, useRef, type ReactNode } from 'react';

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
      className="m-0 ml-auto h-dvh max-h-dvh w-full max-w-[520px] border-l border-line bg-sheet p-0 text-ink backdrop:bg-graphite-950/40"
    >
      {open && (
        <div className="flex h-full flex-col">
          <header className="flex items-center justify-between border-b border-line px-5 py-3.5">
            <h2 className="font-display text-[19px] font-semibold">{title}</h2>
            <button type="button" onClick={onClose} className="rounded px-2 py-1 text-[14px] text-muted hover:bg-paper" aria-label="Fechar painel">
              Fechar
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
    <dialog ref={ref} onClose={onClose} aria-label={title} className="m-auto w-[min(480px,calc(100vw-32px))] border border-line bg-sheet p-0 text-ink backdrop:bg-graphite-950/40">
      {open && (
        <div>
          <h2 className="border-b border-line px-5 py-3.5 font-display text-[19px] font-semibold">{title}</h2>
          <div className="px-5 py-4 text-[14px]">{children}</div>
          <div className="flex justify-end gap-2 border-t border-line px-5 py-3">{footer}</div>
        </div>
      )}
    </dialog>
  );
}
