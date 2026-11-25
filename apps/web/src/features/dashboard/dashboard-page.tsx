import { Link } from 'react-router';
import { PROJECT_CLASSIFICATION_LABELS, PROJECT_CLASSIFICATIONS } from '@eapq/contracts';
import { PageHeader } from '../../app/shell';
import { EmptyState, ErrorState, Loading } from '../../components/ui/feedback';
import { errorMessage } from '../../lib/api';
import { fmtDateTime } from '../../lib/format';
import { useSession } from '../auth/session';
import { useProjects } from '../projects/api';
import { MyTasks } from '../operations/my-tasks';

/** Painel com dados reais: carteira ativa por classificação e últimas alterações. */
export function DashboardPage() {
  const { me, can } = useSession();
  const projects = useProjects({ status: 'ACTIVE' });
  return (
    <>
      <PageHeader title={`Olá, ${me?.user.name.split(' ')[0] ?? ''}`}>{me?.organization.name}</PageHeader>
      <MyTasks />
      {projects.isPending ? (
        <Loading />
      ) : projects.isError ? (
        <ErrorState message={errorMessage(projects.error)} onRetry={() => projects.refetch()} />
      ) : projects.data.length === 0 ? (
        <EmptyState
          title="Nenhum empreendimento ativo"
          action={can('project.create') && (
            <Link to="/empreendimentos" className="inline-flex h-9 items-center rounded-[3px] bg-cyan-ink px-3.5 text-[14px] font-medium text-white hover:bg-cyan-ink-dark">
              Cadastrar empreendimento
            </Link>
          )}
        >
          Os empreendimentos ativos e as últimas alterações aparecem aqui.
        </EmptyState>
      ) : (
        <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
          <section aria-labelledby="carteira">
            <h2 id="carteira" className="mb-2 font-display text-[18px] font-semibold">Carteira ativa</h2>
            <table className="w-full border border-line bg-sheet text-[14px]">
              <tbody>
                {PROJECT_CLASSIFICATIONS.map((c) => (
                  <tr key={c} className="border-b border-line">
                    <th scope="row" className="px-3 py-2 text-left font-normal">{PROJECT_CLASSIFICATION_LABELS[c]}</th>
                    <td className="px-3 py-2 text-right font-mono">{projects.data.filter((p) => p.classification === c).length}</td>
                  </tr>
                ))}
                <tr>
                  <th scope="row" className="px-3 py-2 text-left font-medium">Total</th>
                  <td className="px-3 py-2 text-right font-mono font-medium">{projects.data.length}</td>
                </tr>
              </tbody>
            </table>
          </section>
          <section aria-labelledby="recentes">
            <h2 id="recentes" className="mb-2 font-display text-[18px] font-semibold">Alterados recentemente</h2>
            <ul className="border border-line bg-sheet">
              {[...projects.data]
                .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
                .slice(0, 8)
                .map((p) => (
                  <li key={p.id} className="flex items-baseline justify-between gap-3 border-b border-line px-3 py-2 last:border-0">
                    <Link to={`/empreendimentos/${p.id}`} className="min-w-0 truncate text-cyan-ink hover:underline">
                      <span className="mr-2 font-mono text-[13px] text-ink">{p.code}</span>
                      {p.name}
                    </Link>
                    <span className="shrink-0 text-[13px] text-muted">{fmtDateTime(p.updatedAt)}</span>
                  </li>
                ))}
            </ul>
          </section>
        </div>
      )}
    </>
  );
}
