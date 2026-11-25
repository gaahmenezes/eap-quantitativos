import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { PROJECT_CLASSIFICATIONS, PROJECT_CLASSIFICATION_LABELS, type ListProjectsQuery } from '@eapq/contracts';
import { Breadcrumbs, PageHeader } from '../../app/shell';
import { Button } from '../../components/ui/button';
import { EmptyState, ErrorState, Loading, StatusTag } from '../../components/ui/feedback';
import { SidePanel } from '../../components/ui/panel';
import { errorMessage } from '../../lib/api';
import { fmtDateTime } from '../../lib/format';
import { useSession } from '../auth/session';
import { useCreateProject, useProjects } from './api';
import { ProjectForm } from './project-form';

export function ProjectsPage() {
  const { can } = useSession();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [creating, setCreating] = useState(false);
  const q = params.get('q') ?? '';
  const status = (params.get('situacao') as ListProjectsQuery['status'] | null) ?? 'ACTIVE';
  const classification = (params.get('classificacao') ?? '') as ListProjectsQuery['classification'] | '';
  const list = useProjects({ q: q || undefined, status, classification: classification || undefined });
  const create = useCreateProject();

  const setParam = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  };

  const filtered = !!q || status !== 'ACTIVE' || !!classification;

  return (
    <>
      <Breadcrumbs items={[{ label: 'Empreendimentos' }]} />
      <PageHeader
        title="Empreendimentos"
        actions={can('project.create') && <Button variant="primary" onClick={() => setCreating(true)}>Novo empreendimento</Button>}
      >
        {list.data ? `${list.data.length} ${list.data.length === 1 ? 'empreendimento' : 'empreendimentos'}` : ' '}
      </PageHeader>

      <div role="search" className="mb-4 flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-[13px] font-medium text-graphite-800">
          Buscar
          <input
            type="search"
            aria-label="Buscar empreendimentos"
            defaultValue={q}
            placeholder="Nome ou código"
            onChange={(e) => setParam('q', e.target.value)}
            className="h-9 w-64 rounded-md border border-line-strong bg-sheet px-2.5 text-[14px] font-normal"
          />
        </label>
        <label className="flex flex-col gap-1 text-[13px] font-medium text-graphite-800">
          Classificação
          <select aria-label="Filtrar por classificação" value={classification} onChange={(e) => setParam('classificacao', e.target.value)} className="h-9 rounded-md border border-line-strong bg-sheet px-2 text-[14px] font-normal">
            <option value="">Todas</option>
            {PROJECT_CLASSIFICATIONS.map((c) => <option key={c} value={c}>{PROJECT_CLASSIFICATION_LABELS[c]}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-[13px] font-medium text-graphite-800">
          Situação
          <select aria-label="Filtrar por situação" value={status} onChange={(e) => setParam('situacao', e.target.value === 'ACTIVE' ? '' : e.target.value)} className="h-9 rounded-md border border-line-strong bg-sheet px-2 text-[14px] font-normal">
            <option value="ACTIVE">Ativos</option>
            <option value="ARCHIVED">Arquivados</option>
            <option value="ALL">Todos</option>
          </select>
        </label>
      </div>

      {list.isPending ? (
        <Loading />
      ) : list.isError ? (
        <ErrorState message={errorMessage(list.error)} onRetry={() => list.refetch()} />
      ) : list.data.length === 0 ? (
        filtered ? (
          <EmptyState title="Nenhum empreendimento encontrado">Ajuste a busca ou os filtros.</EmptyState>
        ) : (
          <EmptyState
            title="Nenhum empreendimento cadastrado"
            action={can('project.create') && <Button variant="primary" onClick={() => setCreating(true)}>Cadastrar o primeiro empreendimento</Button>}
          >
            {can('project.create')
              ? 'Cadastre um empreendimento para organizar seu cadastro físico, EAP e quantitativos.'
              : 'Você ainda não foi vinculado a nenhum empreendimento. Peça acesso a um coordenador.'}
          </EmptyState>
        )
      ) : (
        <div className="overflow-x-auto border border-line bg-sheet">
          <table className="w-full border-collapse text-left text-[14px]">
            <thead className="border-b border-line-strong text-[13px] text-muted">
              <tr>
                <th scope="col" className="px-3 py-2 font-medium">Código</th>
                <th scope="col" className="px-3 py-2 font-medium">Nome</th>
                <th scope="col" className="px-3 py-2 font-medium">Classificação</th>
                <th scope="col" className="px-3 py-2 font-medium">Situação</th>
                <th scope="col" className="px-3 py-2 text-right font-medium">Atualizado em</th>
              </tr>
            </thead>
            <tbody>
              {list.data.map((p) => (
                <tr key={p.id} className="border-b border-line last:border-0 hover:bg-cyan-wash">
                  <td className="whitespace-nowrap px-3 py-2 font-mono text-[13px]">{p.code}</td>
                  <td className="px-3 py-2">
                    <Link to={`/empreendimentos/${p.id}`} className="font-medium text-cyan-ink hover:underline">{p.name}</Link>
                  </td>
                  <td className="whitespace-nowrap px-3 py-2">{PROJECT_CLASSIFICATION_LABELS[p.classification]}</td>
                  <td className="whitespace-nowrap px-3 py-2"><StatusTag status={p.status} /></td>
                  <td className="whitespace-nowrap px-3 py-2 text-right text-muted">{fmtDateTime(p.updatedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <SidePanel open={creating} title="Novo empreendimento" onClose={() => setCreating(false)}>
        <ProjectForm
          submitLabel="Cadastrar empreendimento"
          onCancel={() => setCreating(false)}
          onSubmit={async ({ reason: _r, ...values }) => {
            const p = await create.mutateAsync(values);
            setCreating(false);
            navigate(`/empreendimentos/${p.id}`);
          }}
        />
      </SidePanel>
    </>
  );
}
