import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { SCHEDULE_KINDS, type ScheduleKind } from '@eapq/contracts';
import { projectPermissions } from '@eapq/domain';
import { Breadcrumbs, PageHeader } from '../../app/shell';
import { useAction } from '../../components/ui/actions';
import { Button } from '../../components/ui/button';
import { EmptyState, ErrorState, Loading, Notice } from '../../components/ui/feedback';
import { SelectField, TextField } from '../../components/ui/field';
import { SidePanel } from '../../components/ui/panel';
import { api, errorMessage } from '../../lib/api';
import { fmtDateTime } from '../../lib/format';
import { useSession } from '../auth/session';
import { useProject } from '../projects/api';
import { STATUS_TONE } from '../sheets/api';
import { KIND_LABEL, SCHEDULE_STATUS_LABEL, scheduleKeys, useScheduleSources, useSchedules } from './api';

export function SchedulesPage() {
  const { projectId = '' } = useParams();
  const { me } = useSession();
  const project = useProject(projectId);
  const [archived, setArchived] = useState(false);
  const list = useSchedules(projectId, archived);
  const [creating, setCreating] = useState(false);
  if (project.isPending || list.isPending) return <Loading />;
  if (project.isError) return <ErrorState message={errorMessage(project.error)} />;
  if (list.isError) return <ErrorState message={errorMessage(list.error)} onRetry={() => list.refetch()} />;
  const p = project.data;
  const canEdit = projectPermissions(me!.orgRole, p.myProjectRole).has('project.content.edit') && p.status === 'ACTIVE';
  return (
    <>
      <Breadcrumbs items={[{ label: 'Empreendimentos', to: '/empreendimentos' }, { label: p.name, to: `/empreendimentos/${p.id}` }, { label: 'Quadros de componentes' }]} />
      <PageHeader title="Quadros de componentes e materiais" actions={canEdit && <Button variant="primary" onClick={() => setCreating(true)}>Novo quadro</Button>}>
        Esquadrias, louças e metais, materiais de instalações: cada item com sua quantidade por destino (ex.: casa tipo × unidades). O lançamento soma por serviço e destino — o quadro de resumo vira quantitativos com memória.
      </PageHeader>
      <label className="mb-3 flex items-center gap-2 text-[13.5px]"><input type="checkbox" checked={archived} onChange={(e) => setArchived(e.target.checked)} /> Mostrar arquivados</label>
      {list.data.length === 0 ? (
        <EmptyState title="Nenhum quadro" action={canEdit && <Button variant="primary" onClick={() => setCreating(true)}>Novo quadro</Button>}>Comece em branco ou a partir de um quadro de outro empreendimento (lista padrão).</EmptyState>
      ) : (
        <div className="overflow-x-auto border border-line bg-sheet">
          <table className="w-full min-w-[720px] text-left text-[13.5px]">
            <thead className="bg-paper text-[12px] text-muted"><tr><th className="px-3 py-1.5 font-normal">Quadro</th><th className="px-3 py-1.5 font-normal">Tipo</th><th className="px-3 py-1.5 text-right font-normal">Itens</th><th className="px-3 py-1.5 text-right font-normal">Destinos</th><th className="px-3 py-1.5 font-normal">Situação</th><th className="px-3 py-1.5 font-normal">Atualizado</th></tr></thead>
            <tbody>{list.data.map((s) => (
              <tr key={s.id} className={`border-t border-line ${s.archivedAt ? 'text-graphite-400' : ''}`}>
                <td className="px-3 py-2"><Link className="font-medium text-cyan-ink hover:underline" to={`/empreendimentos/${p.id}/quadros/${s.id}`}>{s.title}</Link></td>
                <td className="px-3 py-2">{KIND_LABEL[s.kind]}</td>
                <td className="px-3 py-2 text-right font-mono">{s.rowCount}</td>
                <td className="px-3 py-2 text-right font-mono">{s.columnCount}</td>
                <td className="px-3 py-2">{s.archivedAt ? 'arquivado' : <span className={`rounded-md px-1.5 py-0.5 text-[12px] ${STATUS_TONE[s.status]}`}>{SCHEDULE_STATUS_LABEL[s.status]}</span>}
                  {s.measurementCount > 0 && <span className="block text-[12px] text-muted">{s.measurementCount} quantitativo(s)</span>}</td>
                <td className="px-3 py-2 text-[12.5px] text-muted">{fmtDateTime(s.updatedAt)}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
      <SidePanel open={creating} title="Novo quadro" onClose={() => setCreating(false)}>
        {creating && <NewSchedule projectId={p.id} />}
      </SidePanel>
    </>
  );
}

function NewSchedule({ projectId }: { projectId: string }) {
  const navigate = useNavigate();
  const sources = useScheduleSources();
  const [kind, setKind] = useState<ScheduleKind>('ESQUADRIAS');
  const [title, setTitle] = useState('Quadro de esquadrias');
  const [copyFromId, setCopyFrom] = useState('');
  const act = useAction([scheduleKeys.all(projectId), scheduleKeys.sources]);
  const options = (sources.data ?? []).filter((s) => s.kind === kind);
  return (
    <form className="flex flex-col gap-4" onSubmit={async (e) => {
      e.preventDefault();
      const r = await act.run(() => api<{ id: string; droppedServices: number }>('POST', `/projects/${projectId}/schedules`, { body: { kind, title, copyFromId: copyFromId || null } }));
      if (r && r !== true) navigate(`/empreendimentos/${projectId}/quadros/${r.id}${r.droppedServices ? `?descartados=${r.droppedServices}` : ''}`);
    }}>
      {act.error && <Notice tone="danger">{act.error}</Notice>}
      <SelectField label="Tipo" value={kind} onChange={(e) => { const k = e.target.value as ScheduleKind; setKind(k); setTitle(`Quadro de ${KIND_LABEL[k].toLowerCase()}`); setCopyFrom(''); }}>
        {SCHEDULE_KINDS.map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
      </SelectField>
      <TextField label="Título" value={title} onChange={(e) => setTitle(e.target.value)} error={act.fieldErrors.title} />
      <SelectField label="Começar a partir de" value={copyFromId} onChange={(e) => setCopyFrom(e.target.value)} hint="Copia os itens e serviços (sem destinos e sem quantidades) de um quadro existente da organização.">
        <option value="">Quadro em branco</option>
        {options.map((s) => <option key={s.id} value={s.id}>{s.title} — {s.project} ({s.rowCount} itens)</option>)}
      </SelectField>
      <div><Button type="submit" variant="primary" busy={act.pending} disabled={!title.trim()}>Criar e abrir</Button></div>
    </form>
  );
}
