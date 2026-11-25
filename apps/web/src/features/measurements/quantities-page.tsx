import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import type { MeasurementDto, ServiceDto, WbsDto, WbsNodeDto } from '@eapq/contracts';
import { projectPermissions } from '@eapq/domain';
import { Breadcrumbs } from '../../app/shell';
import { ArchiveButton, useAction } from '../../components/ui/actions';
import { Button } from '../../components/ui/button';
import { EmptyState, ErrorState, Loading, Notice } from '../../components/ui/feedback';
import { SidePanel } from '../../components/ui/panel';
import { api, errorMessage } from '../../lib/api';
import { fmtDateTime, fmtQty } from '../../lib/format';
import { useSession } from '../auth/session';
import { useProject } from '../projects/api';
import { mKeys, useMeasurement, useMeasurements, useOutdated, useSummary } from './api';
import { MeasurementForm } from './measurement-form';
import { MemoryView } from './memory-view';
import { ExportButton } from '../../components/export-button';
import { EntityHistory } from '../../components/entity-history';

const ANCHOR_KIND: Record<string, string> = { STRUCTURE_NODE: 'Cadastro', TYPOLOGY_ELEMENT: 'Tipologia', NETWORK_SEGMENT: 'Trecho', NETWORK_NODE: 'Dispositivo', PHYSICAL_ELEMENT: 'Elemento' };

export function QuantitiesPage() {
  const { projectId = '' } = useParams();
  const project = useProject(projectId);
  const wbs = useQuery({ queryKey: ['project', projectId, 'wbs'], queryFn: () => api<WbsDto>('GET', `/projects/${projectId}/wbs`) });
  const summary = useSummary(projectId);
  const outdated = useOutdated(projectId);
  const { me } = useSession();
  const [q, setQ] = useState('');
  const [onlyMeasured, setOnlyMeasured] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const items = useMemo(() => {
    const nodes = (wbs.data?.nodes ?? []).filter((n) => !n.archivedAt);
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const pathOf = (n: WbsNodeDto) => { const t: string[] = []; let c = n.parentId ? byId.get(n.parentId) : undefined; while (c) { t.unshift(c.title); c = c.parentId ? byId.get(c.parentId) : undefined; } return t.join(' › '); };
    return nodes.filter((n) => n.nodeType === 'ITEM').sort((a, b) => a.code.localeCompare(b.code, 'pt-BR', { numeric: true })).map((n) => ({ ...n, context: pathOf(n) }));
  }, [wbs.data]);

  if (project.isPending || wbs.isPending || summary.isPending) return <Loading />;
  if (project.isError) return <ErrorState message={errorMessage(project.error)} onRetry={() => project.refetch()} />;
  if (wbs.isError) return <ErrorState message={errorMessage(wbs.error)} onRetry={() => wbs.refetch()} />;
  if (summary.isError) return <ErrorState message={errorMessage(summary.error)} onRetry={() => summary.refetch()} />;
  const p = project.data;
  const canEdit = projectPermissions(me!.orgRole, p.myProjectRole).has('project.content.edit') && p.status === 'ACTIVE';
  const countByNode = new Map<string, number>();
  for (const s of summary.data.items) countByNode.set(s.wbsNodeId, (countByNode.get(s.wbsNodeId) ?? 0) + s.count);
  const measuredItems = items.filter((i) => countByNode.has(i.id)).length;
  const needle = q.trim().toLowerCase();
  const shown = items.filter((i) => (!onlyMeasured || countByNode.has(i.id)) && (!needle || `${i.code} ${i.title} ${i.context}`.toLowerCase().includes(needle)));
  const selected = items.find((i) => i.id === selectedId);

  return (
    <>
      <Breadcrumbs items={[{ label: 'Empreendimentos', to: '/empreendimentos' }, { label: p.name, to: `/empreendimentos/${p.id}` }, { label: 'Quantitativos' }]} />
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3 border-b border-line pb-4">
        <div>
          <h1 className="font-display text-[28px] font-semibold leading-tight tracking-tight">Quantitativos</h1>
          <p className="mt-1 text-[14px] text-muted"><span className="font-mono text-ink">{p.code}</span> {p.name}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <ExportButton path={`/projects/${p.id}/exports`} body={{ report: 'measurements' }} />
          {canEdit && <Link to={`/empreendimentos/${p.id}/importacoes`} className="inline-flex h-9 items-center rounded-[3px] border border-line-strong bg-sheet px-3.5 text-[14px] hover:bg-paper">Importar medições</Link>}
        </div>
      </div>
      {p.status === 'ARCHIVED' && <div className="mb-4"><Notice tone="warn">Empreendimento arquivado: quantitativos disponíveis apenas para consulta.</Notice></div>}
      {items.length === 0 ? (
        <EmptyState title="Sem itens quantificáveis" action={<Link className="text-cyan-ink hover:underline" to={`/empreendimentos/${p.id}/eap`}>Ir para a EAP</Link>}>
          Os quantitativos são levantados nos itens da EAP. Gere a EAP do empreendimento primeiro.
        </EmptyState>
      ) : (
        <>
          <dl className="mb-4 flex flex-wrap border border-line bg-sheet">
            <Stat label="Itens com medição" value={`${measuredItems} de ${items.length} (${Math.round((measuredItems / items.length) * 100)}%)`} />
            <Stat label="Medições" value={summary.data.items.reduce((a, s) => a + s.count, 0)} />
            <Stat label="Com fórmula desatualizada" value={outdated.data?.length ?? '…'} />
          </dl>
          {(outdated.data?.length ?? 0) > 0 && (
            <div className="mb-4"><Notice tone="warn">
              {outdated.data!.length} medição(ões) usam uma versão antiga de fórmula. Nada é recalculado automaticamente; abra a medição e use "Recalcular".
              <ul className="mt-1 list-disc pl-5">{outdated.data!.slice(0, 5).map((m) => <li key={m.id}><button type="button" className="text-cyan-ink hover:underline" onClick={() => setSelectedId(m.wbsNodeId)}>{m.wbsCode} {m.wbsTitle}</button> — {m.serviceCode}, {m.anchor.label}</li>)}</ul>
            </Notice></div>
          )}
          <div className="grid gap-4 lg:grid-cols-[340px_minmax(0,1fr)]">
            <section aria-label="Itens da EAP" className="min-w-0 self-start border border-line bg-sheet">
              <div className="flex flex-col gap-2 border-b border-line p-2">
                <input type="search" aria-label="Buscar item da EAP" placeholder="Buscar por código, título ou local" value={q} onChange={(e) => setQ(e.target.value)} className="h-8 rounded-[3px] border border-line-strong bg-sheet px-2 text-[13.5px]" />
                <label className="flex items-center gap-1.5 text-[13px]"><input type="checkbox" checked={onlyMeasured} onChange={(e) => setOnlyMeasured(e.target.checked)} /> Somente itens com medição</label>
              </div>
              <ul className="max-h-[min(70vh,720px)] overflow-auto">
                {shown.slice(0, 400).map((i) => (
                  <li key={i.id}>
                    <button type="button" onClick={() => setSelectedId(i.id)} aria-current={i.id === selectedId ? 'true' : undefined}
                      className={`block w-full border-b border-line/60 border-l-[3px] px-3 py-1.5 text-left ${i.id === selectedId ? 'border-l-signal bg-cyan-wash' : 'border-l-transparent hover:bg-paper'}`}>
                      <span className="flex items-baseline gap-2">
                        <span className="shrink-0 font-mono text-[12px] text-muted">{i.code}</span>
                        <span className="min-w-0 flex-1 truncate text-[13.5px]">{i.title}</span>
                        {countByNode.has(i.id) && <span className="shrink-0 font-mono text-[12px] text-cyan-ink">{countByNode.get(i.id)} med.</span>}
                      </span>
                      <span className="block truncate text-[12px] text-muted">{i.context}</span>
                    </button>
                  </li>
                ))}
                {shown.length === 0 && <li className="p-3 text-[13.5px] text-muted">Nenhum item encontrado.</li>}
                {shown.length > 400 && <li className="p-3 text-[13px] text-muted">Mostrando 400 de {shown.length}. Refine a busca.</li>}
              </ul>
            </section>
            <div className="min-w-0">
              {selected ? <ItemView key={selected.id} projectId={p.id} item={selected} canEdit={canEdit} /> : (
                <div className="border border-line bg-sheet p-6 text-[14px] text-muted">Selecione um item da EAP para ver e lançar medições.</div>
              )}
            </div>
          </div>
        </>
      )}
    </>
  );
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return <div className="min-w-[160px] flex-1 border-r border-line px-3 py-2 last:border-r-0"><dt className="text-[12px] text-muted">{label}</dt><dd className="font-mono text-[18px]">{value}</dd></div>;
}

function ItemView({ projectId, item, canEdit }: { projectId: string; item: WbsNodeDto & { context: string }; canEdit: boolean }) {
  const services = useQuery({ queryKey: ['project', projectId, 'services', 'all'], queryFn: () => api<{ items: ServiceDto[] }>('GET', `/projects/${projectId}/services?limit=200`) });
  const ms = useMeasurements(projectId, item.id);
  const summary = useSummary(projectId);
  const [form, setForm] = useState<{ service: ServiceDto; existing?: MeasurementDto; recalc?: string } | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  if (services.isPending || ms.isPending) return <Loading />;
  if (ms.isError) return <ErrorState message={errorMessage(ms.error)} onRetry={() => ms.refetch()} />;
  const svcs = item.serviceIds.map((id) => services.data?.items.find((s) => s.id === id)).filter((s): s is ServiceDto => !!s);
  return (
    <section aria-label={`Item ${item.code}`} className="flex flex-col gap-4">
      <header className="border border-line bg-sheet p-3">
        <p className="text-[12.5px] text-muted">{item.context}</p>
        <h2 className="font-display text-[20px] font-semibold"><span className="font-mono text-[15px] text-muted">{item.code}</span> {item.title}</h2>
      </header>
      {svcs.length === 0 && <Notice tone="info">Este item ainda não tem serviços vinculados. Vincule serviços na tela da EAP para poder medir.</Notice>}
      {svcs.map((s) => {
        const rows = (ms.data ?? []).filter((m) => m.serviceId === s.id);
        const total = summary.data?.items.find((x) => x.wbsNodeId === item.id && x.serviceId === s.id)?.total ?? '0';
        return (
          <section key={s.id} aria-label={`Serviço ${s.code}`} className="border border-line bg-sheet">
            <header className="flex flex-wrap items-baseline justify-between gap-2 border-b border-line px-3 py-2">
              <h3 className="text-[14.5px] font-medium"><span className="font-mono">{s.code}</span> {s.description}</h3>
              <div className="flex items-baseline gap-3">
                <span className="text-[13px] text-muted">Total efetivo <strong className="font-mono text-[15px] text-ink">{fmtQty(total)} {s.unitSymbol}</strong></span>
                {canEdit && <Button onClick={() => setForm({ service: s })}>Nova medição</Button>}
              </div>
            </header>
            {rows.length === 0 ? <p className="px-3 py-3 text-[13.5px] text-muted">Sem medições.</p> : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[640px] text-left text-[13.5px]">
                  <thead className="text-[12px] text-muted"><tr><th className="px-3 py-1 font-normal">Âncora</th><th className="px-3 py-1 font-normal">Método</th><th className="px-3 py-1 text-right font-normal">Quantidade</th><th className="px-3 py-1 text-right font-normal">Unidades</th><th className="px-3 py-1 text-right font-normal">Total</th><th className="px-3 py-1 font-normal">Rev.</th></tr></thead>
                  <tbody>
                    {rows.map((m) => (
                      <tr key={m.id} className="cursor-pointer border-t border-line hover:bg-paper" onClick={() => setDetailId(m.id)}>
                        <td className="px-3 py-1.5">
                          <button type="button" className="text-left text-cyan-ink hover:underline" onClick={(e) => { e.stopPropagation(); setDetailId(m.id); }}>{m.anchor.label}</button>
                          <span className="ml-1 text-[11.5px] text-muted">{ANCHOR_KIND[m.anchor.kind]}</span>
                          {m.anchor.archived && <span className="ml-1 rounded-[3px] bg-warn-wash px-1 text-[11.5px] text-warn">âncora arquivada</span>}
                          {m.warnings.map((w, i) => <span key={i} className="block text-[12px] text-warn">{w}</span>)}
                        </td>
                        <td className="px-3 py-1.5">{m.current.method === 'FORMULA' ? <span className="font-mono text-[12.5px]">{m.current.memory.formula?.code} R{m.current.memory.formula?.versionNumber}</span> : m.sheet ? <span title={m.sheet.title}>ficha</span> : m.schedule ? <span title={m.schedule.title}>quadro</span> : m.current.method === 'IMPORTED' ? 'importada' : 'manual'}
                          {m.formulaOutdated && <span className="ml-1 rounded-[3px] bg-warn-wash px-1 text-[11.5px] text-warn">desatualizada</span>}</td>
                        <td className="px-3 py-1.5 text-right font-mono">{fmtQty(m.quantity)}</td>
                        <td className="px-3 py-1.5 text-right font-mono">{m.anchor.kind === 'TYPOLOGY_ELEMENT' && !m.anchor.unitId ? `× ${m.multiplier}` : '1'}</td>
                        <td className="px-3 py-1.5 text-right font-mono">{fmtQty(m.effectiveTotal)}</td>
                        <td className="px-3 py-1.5 font-mono">R{m.current.number}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        );
      })}
      <SidePanel open={!!form} title={form?.existing ? (form.recalc ? 'Recalcular medição' : 'Revisar medição') : 'Nova medição'} onClose={() => setForm(null)}>
        {form && <MeasurementForm projectId={projectId} wbsNodeId={item.id} service={form.service} existing={form.existing} recalcVersionId={form.recalc} onDone={() => { setForm(null); setDetailId(null); }} />}
      </SidePanel>
      <SidePanel open={!!detailId && !form} title="Medição" onClose={() => setDetailId(null)}>
        {detailId && !form && <MeasurementDetail projectId={projectId} id={detailId} canEdit={canEdit}
          onRevise={(m, recalc) => setForm({ service: svcs.find((s) => s.id === m.serviceId)!, existing: m, recalc })} />}
      </SidePanel>
    </section>
  );
}

export function MeasurementDetail({ projectId, id, canEdit, onRevise }: { projectId: string; id: string; canEdit: boolean; onRevise: (m: MeasurementDto, recalcVersionId?: string) => void }) {
  const d = useMeasurement(projectId, id);
  const act = useAction([mKeys.all(projectId)]);
  if (d.isPending) return <Loading />;
  if (d.isError) return <ErrorState message={errorMessage(d.error)} onRetry={() => d.refetch()} />;
  const m = d.data;
  return (
    <div className="flex flex-col gap-4 text-[13.5px]">
      <div>
        <p className="text-muted">{m.wbsCode} {m.wbsTitle} · <span className="font-mono">{m.serviceCode}</span></p>
        <p className="font-medium">{m.anchor.label}</p>
        <p className="mt-1 font-mono text-[17px]">{fmtQty(m.quantity)} {m.unit}{m.anchor.kind === 'TYPOLOGY_ELEMENT' && !m.anchor.unitId && <span className="text-[14px] text-muted"> × {m.multiplier} un. = {fmtQty(m.effectiveTotal)} {m.unit}</span>}</p>
        {m.replacedUnits > 0 && <p className="text-muted">{m.replacedUnits} unidade(s) têm medição própria, que substitui esta.</p>}
      </div>
      {m.archivedAt && <Notice tone="info">Arquivada em {fmtDateTime(m.archivedAt)}{m.archiveReason && `: ${m.archiveReason}`}.</Notice>}
      {m.formulaOutdated && <Notice tone="warn">A fórmula tem a versão R{m.formulaOutdated.latestNumber}. Esta medição continua com o valor da versão usada até ser recalculada.</Notice>}
      {m.sheet && (
        <Notice tone="info">
          Lançada pela ficha <Link className="text-cyan-ink hover:underline" to={`/empreendimentos/${projectId}/fichas/${m.sheet.id}`}>{m.sheet.title}</Link>. Para alterar, edite a ficha e lance de novo.
        </Notice>
      )}
      {m.schedule && (
        <Notice tone="info">
          Lançada pelo quadro <Link className="text-cyan-ink hover:underline" to={`/empreendimentos/${projectId}/quadros/${m.schedule.id}`}>{m.schedule.title}</Link>. Para alterar, edite o quadro e lance de novo.
        </Notice>
      )}
      {act.error && <Notice tone="danger">{act.error}</Notice>}
      {canEdit && !m.sheet && !m.schedule && (
        <div className="flex flex-wrap gap-2">
          {!m.archivedAt && <Button onClick={() => onRevise(m)}>Revisar</Button>}
          {!m.archivedAt && m.formulaOutdated && <Button variant="primary" onClick={() => onRevise(m, m.formulaOutdated!.latestVersionId)}>Recalcular com R{m.formulaOutdated.latestNumber}</Button>}
          {!m.archivedAt && <ArchiveButton what="medição" onConfirm={(reason) => act.run(() => api('POST', `/projects/${projectId}/measurements/${m.id}/archive`, { body: { reason }, version: m.version }))} />}
          {m.archivedAt && <Button onClick={() => act.run(() => api('POST', `/projects/${projectId}/measurements/${m.id}/unarchive`, { body: {}, version: m.version }))}>Restaurar</Button>}
        </div>
      )}
      <section aria-label="Memória de cálculo" className="flex flex-col gap-3">
        <h3 className="font-medium">Memória de cálculo</h3>
        {m.revisions.map((r) => (
          <article key={r.id} className={`border border-line p-3 ${r.number === m.current.number ? 'bg-sheet' : 'bg-paper text-muted'}`}>
            <header className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
              <span className="font-mono">R{r.number}{r.number === m.current.number && <span className="ml-1 font-sans text-[12px] text-cyan-ink">vigente</span>}</span>
              <span className="text-[12px] text-muted">{r.createdBy} · {fmtDateTime(r.createdAt)}</span>
            </header>
            {r.reason && <p className="mb-1"><span className="text-muted">Motivo:</span> {r.reason}</p>}
            {r.sourceReference && <p className="mb-1"><span className="text-muted">Documento de origem:</span> {r.sourceReference}</p>}
            {r.document && <p className="mb-1"><span className="text-muted">Arquivo:</span> <a className="text-cyan-ink hover:underline" href={`/api/projects/${projectId}/documents/${r.document.id}`}>{r.document.fileName}</a> <span className="text-muted">({Math.ceil(r.document.size / 1024)} KB)</span></p>}
            {r.notes && <p className="mb-1 whitespace-pre-line">{r.notes}</p>}
            <MemoryView memory={r.memory} />
          </article>
        ))}
      </section>
      <EntityHistory projectId={projectId} entityId={m.id} />
    </div>
  );
}
