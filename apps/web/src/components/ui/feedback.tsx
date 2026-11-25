import type { ReactNode } from 'react';
import { AlertTriangle, CheckCircle2, CircleAlert, Info, Inbox, type LucideIcon } from 'lucide-react';

export function Loading({ label = 'Carregando…' }: { label?: string }) {
  return (
    <div role="status" className="flex items-center gap-2.5 px-1 py-8 text-[14px] text-muted">
      <span className="h-4 w-4 animate-spin rounded-full border-2 border-cyan-ink border-r-transparent" aria-hidden />
      {label}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="flex items-start justify-between gap-4 rounded-lg border border-danger/25 bg-danger-wash px-4 py-3 text-[14px]">
      <p className="flex items-start gap-2.5"><CircleAlert className="mt-0.5 h-4 w-4 shrink-0 text-danger" aria-hidden />{message}</p>
      {onRetry && (
        <button type="button" onClick={onRetry} className="shrink-0 font-medium text-cyan-ink hover:underline">
          Tentar novamente
        </button>
      )}
    </div>
  );
}

export function EmptyState({ title, children, action, icon: Icon = Inbox }: { title: string; children?: ReactNode; action?: ReactNode; icon?: LucideIcon }) {
  return (
    <div className="flex flex-col items-center rounded-xl border border-dashed border-line-strong bg-sheet/60 px-6 py-12 text-center">
      <span className="mb-3 grid h-11 w-11 place-items-center rounded-full bg-cyan-wash text-cyan-ink" aria-hidden>
        <Icon className="h-5 w-5" strokeWidth={1.75} />
      </span>
      <h3 className="text-[16px] font-semibold">{title}</h3>
      {children && <div className="mt-1 max-w-prose text-[14px] text-muted">{children}</div>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

const NOTICE = {
  info: { box: 'border-cyan-ink/20 bg-cyan-wash', icon: Info, color: 'text-cyan-ink' },
  ok: { box: 'border-ok/25 bg-ok-wash', icon: CheckCircle2, color: 'text-ok' },
  warn: { box: 'border-warn/25 bg-warn-wash', icon: AlertTriangle, color: 'text-warn' },
  danger: { box: 'border-danger/25 bg-danger-wash', icon: CircleAlert, color: 'text-danger' },
} as const;

export function Notice({ tone = 'info', children }: { tone?: 'info' | 'ok' | 'warn' | 'danger'; children: ReactNode }) {
  const t = NOTICE[tone];
  const Icon = t.icon;
  return (
    <div role={tone === 'danger' ? 'alert' : 'status'} className={`flex items-start gap-2.5 rounded-lg border px-3.5 py-2.5 text-[14px] ${t.box}`}>
      <Icon className={`mt-[3px] h-4 w-4 shrink-0 ${t.color}`} aria-hidden />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

export function StatusTag({ status }: { status: 'ACTIVE' | 'ARCHIVED' }) {
  return status === 'ACTIVE' ? (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-ok-wash px-2 py-0.5 text-[12.5px] font-medium text-ok">
      <span className="h-1.5 w-1.5 rounded-full bg-ok" aria-hidden />
      Ativo
    </span>
  ) : (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-paper px-2 py-0.5 text-[12.5px] font-medium text-muted ring-1 ring-line ring-inset">
      <span className="h-1.5 w-1.5 rounded-full bg-graphite-400" aria-hidden />
      Arquivado
    </span>
  );
}
