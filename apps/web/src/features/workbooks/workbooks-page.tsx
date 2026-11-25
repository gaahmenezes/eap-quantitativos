import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import type { WorkbookImportDto } from '@eapq/contracts';
import { projectPermissions } from '@eapq/domain';
import { Breadcrumbs, PageHeader } from '../../app/shell';
import { useAction } from '../../components/ui/actions';
import { Button } from '../../components/ui/button';
import { EmptyState, ErrorState, Loading, Notice } from '../../components/ui/feedback';
import { errorMessage, uploadFile } from '../../lib/api';
import { fmtDateTime } from '../../lib/format';
import { useSession } from '../auth/session';
import { useProject } from '../projects/api';
import { STATUS, useWorkbookImports, wbKeys } from './api';

export function WorkbooksPage() {
  const { projectId = '' } = useParams();
  const { me } = useSession();
  const navigate = useNavigate();
  const project = useProject(projectId);
  const list = useWorkbookImports(projectId);
  const [file, setFile] = useState<File | null>(null);
  const act = useAction([wbKeys.all(projectId)]);
  if (project.isPending || list.isPending) return <Loading />;
  if (project.isError) return <ErrorState message={errorMessage(project.error)} />;
  if (list.isError) return <ErrorState message={errorMessage(list.error)} onRetry={() => list.refetch()} />;
  const p = project.data;
  const canEdit = projectPermissions(me!.orgRole, p.myProjectRole).has('project.content.edit') && p.status === 'ACTIVE';
  return (
    <>
      <Breadcrumbs items={[{ label: 'Empreendimentos', to: '/empreendimentos' }, { label: p.name, to: `/empreendimentos/${p.id}` }, { label: 'Migração de planilhas' }]} />
      <PageHeader title="Migração de planilhas">
        Envie a planilha de levantamento do empreendimento: cada aba vira uma ficha ou um quadro, com conferência dos totais recalculados contra os valores da planilha. Nada é lançado em quantitativos até você revisar.
      </PageHeader>
      {canEdit && (
        <form className="mb-5 flex flex-wrap items-end gap-3 border border-line bg-sheet p-4" onSubmit={async (e) => {
          e.preventDefault();
          if (!file) return;
          const r = await act.run(() => uploadFile<WorkbookImportDto>(`/projects/${p.id}/workbook-imports`, file));
          if (r && r !== true) navigate(`/empreendimentos/${p.id}/migracao/${r.id}`);
        }}>
          <div>
            <label htmlFor="wb-file" className="mb-1 block text-[13px] font-medium text-graphite-800">Planilha (XLSX)</label>
            <input id="wb-file" type="file" accept=".xlsx" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="text-[13px]" />
            <p className="mt-0.5 text-[12px] text-muted">Até 20 MB e 200 abas. Fórmulas não são executadas: usamos os valores gravados na planilha.</p>
          </div>
          <Button type="submit" variant="primary" busy={act.pending} disabled={!file}>Ler planilha</Button>
          {act.error && <div className="w-full"><Notice tone="danger">{act.error}</Notice></div>}
        </form>
      )}
      {list.data.length === 0 ? <EmptyState title="Nenhuma migração">Envie uma planilha para começar.</EmptyState> : (
        <div className="overflow-x-auto border border-line bg-sheet">
          <table className="w-full min-w-[640px] text-left text-[13.5px]">
            <thead className="bg-paper text-[12px] text-muted"><tr><th className="px-3 py-1.5 font-normal">Arquivo</th><th className="px-3 py-1.5 text-right font-normal">Abas</th><th className="px-3 py-1.5 text-right font-normal">Com destino</th><th className="px-3 py-1.5 font-normal">Situação</th><th className="px-3 py-1.5 font-normal">Enviada</th></tr></thead>
            <tbody>{list.data.map((w) => (
              <tr key={w.id} className="border-t border-line">
                <td className="px-3 py-2"><Link className="font-medium text-cyan-ink hover:underline" to={`/empreendimentos/${p.id}/migracao/${w.id}`}>{w.fileName}</Link></td>
                <td className="px-3 py-2 text-right font-mono">{w.sheetCount}</td>
                <td className="px-3 py-2 text-right font-mono">{w.planned}</td>
                <td className="px-3 py-2">{STATUS[w.status]}</td>
                <td className="px-3 py-2 text-[12.5px] text-muted">{w.createdBy} · {fmtDateTime(w.createdAt)}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
    </>
  );
}
