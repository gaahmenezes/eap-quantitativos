import type { ReactNode } from 'react';

export function Loading({ label = 'Carregando…' }: { label?: string }) {
  return (
    <div role="status" className="flex items-center gap-2 px-1 py-8 text-[14px] text-muted">
      <span className="h-4 w-4 animate-spin rounded-full border-2 border-cyan-ink border-r-transparent" aria-hidden />
      {label}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="flex items-start justify-between gap-4 border-l-4 border-danger bg-danger-wash px-4 py-3 text-[14px]">
      <p>{message}</p>
      {onRetry && (
        <button type="button" onClick={onRetry} className="shrink-0 font-medium text-cyan-ink underline">
          Tentar novamente
        </button>
      )}
    </div>
  );
}

export function EmptyState({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="border border-dashed border-line-strong bg-sheet px-6 py-10">
      <h3 className="font-display text-[18px] font-semibold">{title}</h3>
      {children && <div className="mt-1 max-w-prose text-[14px] text-muted">{children}</div>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Notice({ tone = 'info', children }: { tone?: 'info' | 'ok' | 'warn' | 'danger'; children: ReactNode }) {
  const map = {
    info: 'border-cyan-ink bg-cyan-wash',
    ok: 'border-ok bg-ok-wash',
    warn: 'border-signal bg-warn-wash',
    danger: 'border-danger bg-danger-wash',
  } as const;
  return (
    <div role={tone === 'danger' ? 'alert' : 'status'} className={`border-l-4 px-3 py-2 text-[14px] ${map[tone]}`}>
      {children}
    </div>
  );
}

export function StatusTag({ status }: { status: 'ACTIVE' | 'ARCHIVED' }) {
  return status === 'ACTIVE' ? (
    <span className="inline-flex items-center gap-1.5 text-[13px] text-ok">
      <span className="h-2 w-2 rounded-full bg-ok" aria-hidden />
      Ativo
    </span>
  ) : (
    <span className="inline-flex items-center gap-1.5 text-[13px] text-muted">
      <span className="h-2 w-2 rounded-full border border-graphite-400" aria-hidden />
      Arquivado
    </span>
  );
}
