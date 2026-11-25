import { useState } from 'react';
import { Link, useParams } from 'react-router';
import type { OperationsDto, PendingItemDto } from '@eapq/contracts';
import { projectPermissions } from '@eapq/domain';
import { Breadcrumbs, PageHeader } from '../../app/shell';
import { ErrorState, Loading } from '../../components/ui/feedback';
import { errorMessage } from '../../lib/api';
import { fmtDateTime } from '../../lib/format';
import { useSession } from '../auth/session';
import { useProject } from '../projects/api';
import { STATUS_LABEL, useOperations } from './api';
import { TasksBoard, type TaskDraft } from './tasks-board';

const ACTION: Record<string, string> = { CREATE: 'cadastrou', UPDATE: 'alterou', ARCHIVE: 'arquivou', UNARCHIVE: 'restaurou', LAUNCH: 'lançou', TRANSITION: 'moveu', PUBLISH: 'publicou', ISSUE: 'emitiu', APPLY: 'aplicou', CANCEL: 'cancelou', DELETE: 'excluiu' };
const ENTITY: Record<string, string> = { Sheet: 'ficha', Schedule: 'quadro', Measurement: 'medição', WorkTask: 'tarefa', WorkbookImport: 'migração', WbsNode: 'item da EAP', ProjectRevision: 'revisão', StructureNode: 'cadastro', Document: 'arquivo', Project: 'empreendimento', WbsGenerationRun: 'a EAP', StructureWizard: 'o cadastro físico (assistente)', DwellingTypology: 'tipologia', Formula: 'fórmula', TypologyRevision: 'revisão de tipologia' };
const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 0);

export function OperationsPage() {
  const { projectId = '' } = useParams();
  const { me } = useSession();
  const project = useProject(projectId);
  const ops = useOperations(projectId);
  const [draft, setDraft] = useState<TaskDraft | null>(null);
  if (project.isPending || ops.isPending) return <Loading />;
  if (project.isError) return <ErrorState message={errorMessage(project.error)} />;
  if (ops.isError) return <ErrorState message={errorMessage(ops.error)} onRetry={() => ops.refetch()} />;
  const p = project.data;
  const o = ops.data;
  const canEdit = projectPermissions(me!.orgRole, p.myProjectRole).has('project.content.edit') && p.status === 'ACTIVE';
  return (
    <>
      <Breadcrumbs items={[{ label: 'Empreendimentos', to: '/empreendimentos' }, { label: p.name, to: `/empreendimentos/${p.id}` }, { label: 'Centro operacional' }]} />
      <PageHeader title="Centro operacional"><span className="font-mono">{p.code}</span> {p.name} — o que falta levantar, lançar e revisar.</PageHeader>
      <section aria-label="Indicadores" className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <Kpi label="Cobertura da EAP" value={`${pct(o.coverage.measured, o.coverage.items)}%`} detail={`${o.coverage.measured} de ${o.coverage.items} itens com medição`} />
        <Kpi label="Fichas a lançar" value={String(o.counts.sheets.draft + o.counts.sheets.pending)} detail={`${o.counts.sheets.launched} de ${o.counts.sheets.total} lançadas`} to={`/empreendimentos/${p.id}/fichas`} />
        <Kpi label="Quadros a lançar" value={String(o.counts.schedules.draft + o.counts.schedules.pending)} detail={`${o.counts.schedules.launched} de ${o.counts.schedules.total} lançados`} to={`/empreendimentos/${p.id}/quadros`} />
        <Kpi label="Tarefas abertas" value={String(o.tasks.byStatus.TODO + o.tasks.byStatus.DOING + o.tasks.byStatus.REVIEW)} detail={`${o.tasks.byStatus.REVIEW} em revisão · ${o.tasks.overdue} atrasada(s)`} tone={o.tasks.overdue ? 'warn' : undefined} />
        <Kpi label={o.revision.last ? `Desde a ${o.revision.last.code}` : 'Revisões'} value={o.revision.last ? String(o.revision.since.created + o.revision.since.revised + o.revision.since.archived) : '—'}
          detail={o.revision.last ? `${o.revision.since.created} nova(s), ${o.revision.since.revised} revisada(s), ${o.revision.since.archived} arquivada(s)` : 'nenhuma revisão emitida'} to={`/empreendimentos/${p.id}/revisoes`} />
      </section>
      <div className="grid gap-5 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Pending projectId={p.id} items={o.pending} counts={o.counts} canEdit={canEdit} onTask={setDraft} />
        <Coverage o={o} />
      </div>
      <div className="mt-6"><TasksBoard projectId={p.id} canEdit={canEdit} draft={draft} onDraftUsed={() => setDraft(null)} /></div>
      <section aria-label="Atividade recente" className="mt-6 border border-line bg-sheet">
        <h2 className="px-3 py-2 font-medium">Atividade recente</h2>
        <ul className="text-[13px]">{o.activity.map((a) => (
          <li key={a.id} className="flex flex-wrap gap-x-2 border-t border-line px-3 py-1.5">
            <span className="text-muted">{fmtDateTime(a.at)}</span>
            <span>{a.actor?.name ?? 'sistema'} {ACTION[a.action] ?? a.action.toLowerCase()} {ENTITY[a.entityType] ?? a.entityType}
              {a.action === 'TRANSITION' && (a.after as { status?: keyof typeof STATUS_LABEL } | null)?.status && ` para ${STATUS_LABEL[(a.after as { status: keyof typeof STATUS_LABEL }).status].toLowerCase()}`}</span>
            {a.reason && <span className="text-muted">— {a.reason}</span>}
          </li>
        ))}</ul>
      </section>
    </>
  );
}

function Kpi({ label, value, detail, to, tone }: { label: string; value: string; detail: string; to?: string; tone?: 'warn' }) {
  const body = (<><p className="text-[12.5px] text-muted">{label}</p><p className={`font-mono text-[24px] ${tone === 'warn' ? 'text-warn' : ''}`}>{value}</p><p className="text-[12px] text-muted">{detail}</p></>);
  return to ? <Link to={to} className="block border border-line bg-sheet px-3 py-2 hover:border-line-strong">{body}</Link> : <div className="border border-line bg-sheet px-3 py-2">{body}</div>;
}

function Pending({ projectId, items, counts, canEdit, onTask }: { projectId: string; items: PendingItemDto[]; counts: OperationsDto['counts']; canEdit: boolean; onTask: (d: TaskDraft) => void }) {
  const path = (x: PendingItemDto) => `/empreendimentos/${projectId}/${x.kind === 'SHEET' ? 'fichas' : x.kind === 'SCHEDULE' ? 'quadros' : 'migracao'}/${x.id}`;
  const label = { SHEET: 'Ficha', SCHEDULE: 'Quadro', WORKBOOK_IMPORT: 'Migração' } as const;
  return (
    <section aria-label="Pendências" className="border border-line bg-sheet">
      <h2 className="px-3 py-2 font-medium">Pendências <span className="font-mono text-muted">{items.length}</span></h2>
      {items.length === 0 ? <p className="px-3 pb-3 text-[13px] text-muted">Nenhuma ficha, quadro ou migração pendente.</p> : (
        <ul>{items.map((x) => (
          <li key={x.id} className="flex flex-wrap items-start justify-between gap-2 border-t border-line px-3 py-2 text-[13.5px]">
            <div>
              <p><span className="text-muted">{label[x.kind]}: </span><Link className="font-medium text-cyan-ink hover:underline" to={path(x)}>{x.title}</Link></p>
              <p className="mt-0.5 flex flex-wrap gap-1">{x.reasons.map((r) => <span key={r} className={`rounded-md px-1.5 py-0.5 text-[12px] ${/pronta|pronto/.test(r) ? 'bg-ok-wash text-ok' : 'bg-warn-wash text-warn'}`}>{r}</span>)}</p>
            </div>
            {canEdit && <button type="button" className="text-[12.5px] text-cyan-ink hover:underline" onClick={() => onTask({ title: `${x.kind === 'WORKBOOK_IMPORT' ? 'Concluir migração' : 'Concluir e lançar'}: ${x.title}`.slice(0, 160), link: { kind: x.kind, id: x.id } })}>Criar tarefa</button>}
          </li>
        ))}</ul>
      )}
      <p className="border-t border-line px-3 py-2 text-[12.5px] text-muted">
        {counts.unmeasuredLinks} serviço(s) vinculado(s) a itens da EAP ainda sem medição
        {counts.outdatedFormulas > 0 && <> · <Link className="text-cyan-ink hover:underline" to={`/empreendimentos/${projectId}/quantitativos`}>{counts.outdatedFormulas} medição(ões) com fórmula desatualizada</Link></>}
      </p>
    </section>
  );
}

function Coverage({ o }: { o: OperationsDto }) {
  return (
    <section aria-label="Cobertura da EAP" className="border border-line bg-sheet">
      <h2 className="px-3 py-2 font-medium">Cobertura da EAP <span className="font-normal text-muted">— itens quantificáveis com medição</span></h2>
      {o.coverage.groups.length === 0 ? <p className="px-3 pb-3 text-[13px] text-muted">A EAP ainda não foi gerada.</p> : (
        <ul className="px-3 pb-3">{o.coverage.groups.map((g) => (
          <li key={g.wbsNodeId} className="py-1.5 text-[13px]">
            <div className="flex justify-between gap-2"><span><span className="font-mono text-[12px] text-muted">{g.code}</span> {g.title}</span><span className="font-mono">{g.measured}/{g.items}</span></div>
            <div className="mt-1 h-1.5 bg-paper" role="progressbar" aria-label={`Cobertura de ${g.title}`} aria-valuenow={pct(g.measured, g.items)} aria-valuemin={0} aria-valuemax={100}>
              <div className="h-1.5 bg-cyan-ink" style={{ width: `${pct(g.measured, g.items)}%` }} />
            </div>
          </li>
        ))}</ul>
      )}
    </section>
  );
}
