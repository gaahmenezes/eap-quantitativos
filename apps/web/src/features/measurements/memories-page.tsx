import { useState } from 'react';
import { useParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import type { RevisionListItemDto } from '@eapq/contracts';
import { Breadcrumbs } from '../../app/shell';
import { Button } from '../../components/ui/button';
import { EmptyState, ErrorState, Loading } from '../../components/ui/feedback';
import { api, errorMessage } from '../../lib/api';
import { fmtDateTime, fmtQty } from '../../lib/format';
import { useProject } from '../projects/api';
import { mKeys } from './api';
import { ExportButton } from '../../components/export-button';
import { MemoryView } from './memory-view';

const PAGE = 50;

export function MemoriesPage() {
  const { projectId = '' } = useParams();
  const project = useProject(projectId);
  const [q, setQ] = useState('');
  const [page, setPage] = useState(0);
  const [open, setOpen] = useState<string | null>(null);
  const list = useQuery({
    queryKey: [...mKeys.revisions(projectId), q, page],
    queryFn: () => api<{ total: number; items: RevisionListItemDto[] }>('GET', `/projects/${projectId}/measurements/revisions?limit=${PAGE}&offset=${page * PAGE}${q.trim() ? `&q=${encodeURIComponent(q.trim())}` : ''}`),
    placeholderData: (prev) => prev,
  });
  if (project.isPending) return <Loading />;
  if (project.isError) return <ErrorState message={errorMessage(project.error)} onRetry={() => project.refetch()} />;
  const p = project.data;
  return (
    <>
      <Breadcrumbs items={[{ label: 'Empreendimentos', to: '/empreendimentos' }, { label: p.name, to: `/empreendimentos/${p.id}` }, { label: 'Memórias de cálculo' }]} />
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3 border-b border-line pb-4">
        <div>
          <h1 className="font-display text-[28px] font-semibold leading-tight tracking-tight">Memórias de cálculo</h1>
          <p className="mt-1 text-[14px] text-muted">Todas as revisões de medição, da mais recente para a mais antiga. Nenhuma é apagada ou alterada.</p>
        </div>
        <ExportButton path={`/projects/${p.id}/exports`} body={{ report: 'memories' }} />
      </div>
      <input type="search" aria-label="Buscar memórias" placeholder="Serviço, item da EAP ou documento de origem" value={q} onChange={(e) => { setQ(e.target.value); setPage(0); }} className="mb-3 h-8 w-80 max-w-full rounded-md border border-line-strong bg-sheet px-2 text-[13.5px]" />
      {list.isPending ? <Loading /> : list.isError ? <ErrorState message={errorMessage(list.error)} onRetry={() => list.refetch()} /> : list.data.total === 0 ? (
        <EmptyState title={q ? 'Nada encontrado' : 'Nenhuma medição lançada'}>{q ? 'Ajuste a busca.' : 'As memórias aparecem aqui assim que houver medições em Quantitativos.'}</EmptyState>
      ) : (
        <>
          <ul className="border border-line bg-sheet">
            {list.data.items.map((r) => (
              <li key={r.id} className="border-b border-line last:border-0">
                <button type="button" aria-expanded={open === r.id} onClick={() => setOpen(open === r.id ? null : r.id)} className="grid w-full grid-cols-[minmax(0,1fr)_auto] gap-2 px-3 py-2 text-left hover:bg-paper">
                  <span className="min-w-0">
                    <span className="block truncate text-[13.5px]"><span className="font-mono text-muted">{r.wbsCode}</span> {r.wbsTitle} · <span className="font-mono">{r.serviceCode}</span> {r.serviceDescription}</span>
                    <span className="block truncate text-[12.5px] text-muted">{r.anchorLabel} · R{r.number} · {r.createdBy} · {fmtDateTime(r.createdAt)}{r.reason && ` · ${r.reason}`}</span>
                  </span>
                  <span className="font-mono text-[14px]">{fmtQty(r.quantity)} {r.unit}</span>
                </button>
                {open === r.id && (
                  <div className="border-t border-line bg-paper px-3 py-3">
                    {r.sourceReference && <p className="mb-2 text-[13px]"><span className="text-muted">Documento de origem:</span> {r.sourceReference}</p>}
                    {r.notes && <p className="mb-2 whitespace-pre-line text-[13px]">{r.notes}</p>}
                    <MemoryView memory={r.memory} />
                  </div>
                )}
              </li>
            ))}
          </ul>
          <div className="mt-3 flex items-center gap-3 text-[13.5px]">
            <Button disabled={page === 0} onClick={() => setPage(page - 1)}>Anterior</Button>
            <span className="text-muted">{page * PAGE + 1}–{Math.min((page + 1) * PAGE, list.data.total)} de {list.data.total}</span>
            <Button disabled={(page + 1) * PAGE >= list.data.total} onClick={() => setPage(page + 1)}>Próxima</Button>
          </div>
        </>
      )}
    </>
  );
}
