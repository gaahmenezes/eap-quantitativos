import { Link } from 'react-router';
import { ErrorState, Loading } from '../../components/ui/feedback';
import { errorMessage } from '../../lib/api';
import { fmtDay, KIND_LABEL, linkPath, STATUS_LABEL, useMyTasks } from './api';

/** Minhas tarefas abertas e as que aguardam minha revisão, em todos os empreendimentos. */
export function MyTasks() {
  const q = useMyTasks();
  if (q.isPending) return <Loading />;
  if (q.isError) return <ErrorState message={errorMessage(q.error)} onRetry={() => q.refetch()} />;
  return (
    <section aria-label="Minhas tarefas" className="mb-8 border border-line bg-sheet">
      <h2 className="px-3 py-2 font-display text-[18px] font-semibold">Minhas tarefas <span className="font-mono text-[14px] text-muted">{q.data.length}</span></h2>
      {q.data.length === 0 ? <p className="px-3 pb-3 text-[13.5px] text-muted">Nenhuma tarefa aberta para você.</p> : (
        <ul>{q.data.map((t) => {
          const to = linkPath(t.projectId, t.link) ?? `/empreendimentos/${t.projectId}/painel`;
          return (
            <li key={t.id} className="flex flex-wrap items-baseline justify-between gap-2 border-t border-line px-3 py-2 text-[13.5px]">
              <span>
                <Link className="font-medium text-cyan-ink hover:underline" to={to}>{t.title}</Link>
                <span className="ml-2 text-[12.5px] text-muted"><span className="font-mono">{t.projectCode}</span> {t.projectName}{t.link && ` · ${KIND_LABEL[t.link.kind]}`}</span>
              </span>
              <span className="text-[12.5px]">
                {t.role === 'REVIEWER' ? <span className="rounded-md bg-cyan-wash px-1.5 py-0.5 text-cyan-ink">aguarda sua revisão</span> : STATUS_LABEL[t.status]}
                {t.dueDate && <span className={`ml-2 ${t.overdue ? 'font-medium text-danger' : 'text-muted'}`}>prazo {fmtDay(t.dueDate)}</span>}
              </span>
            </li>
          );
        })}</ul>
      )}
    </section>
  );
}
