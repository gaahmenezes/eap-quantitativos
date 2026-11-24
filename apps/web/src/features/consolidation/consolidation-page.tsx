import { useState } from 'react';
import { useParams, useSearchParams } from 'react-router';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import type { ConsolidationDimensionKey, ConsolidationFiltersInput, ConsolidationLinesDto, ConsolidationResultDto, FrozenMeasurementDto } from '@eapq/contracts';
import { CONSOLIDATION_DIMENSIONS, DIMENSION_LABELS } from '@eapq/domain';
import { Breadcrumbs } from '../../app/shell';
import { Button } from '../../components/ui/button';
import { EmptyState, ErrorState, Loading, Notice } from '../../components/ui/feedback';
import { SelectField } from '../../components/ui/field';
import { SidePanel } from '../../components/ui/panel';
import { api, errorMessage } from '../../lib/api';
import { fmtQty } from '../../lib/format';
import { useProject } from '../projects/api';
import { MeasurementDetail } from '../measurements/quantities-page';
import { MemoryView } from '../measurements/memory-view';
import { useRevisions } from '../revisions/api';
import { ExportButton } from '../../components/export-button';
import { fmtDateTime } from '../../lib/format';

type Dim = ConsolidationDimensionKey;
type Row = ConsolidationResultDto['rows'][number];

const PRESETS: { label: string; groupBy: Dim[] }[] = [
  { label: 'Por serviço', groupBy: ['service'] },
  { label: 'Por item da EAP e serviço', groupBy: ['wbsItem', 'service'] },
  { label: 'Por tipologia e serviço', groupBy: ['typology', 'service'] },
  { label: 'Por torre e pavimento', groupBy: ['TOWER', 'FLOOR', 'service'] },
  { label: 'Por quadra e lote', groupBy: ['BLOCK_QUADRA', 'LOT', 'service'] },
  { label: 'Por sistema e rede', groupBy: ['system', 'network', 'service'] },
];
const key = (p: string) => ['project', p, 'measurements', 'consolidation'] as const;

function useConsolidation(projectId: string, groupBy: Dim[], filters: ConsolidationFiltersInput, revisionId: string | null, enabled = true) {
  return useQuery({
    queryKey: [...key(projectId), revisionId ?? 'atual', groupBy, filters],
    enabled,
    queryFn: () => api<ConsolidationResultDto>('POST', `/projects/${projectId}/consolidation`, { body: { groupBy, filters, ...(revisionId && { revisionId }) } }),
    placeholderData: keepPreviousData,
  });
}

export function ConsolidationPage() {
  const { projectId = '' } = useParams();
  const project = useProject(projectId);
  const [groupBy, setGroupBy] = useState<Dim[]>(['service']);
  const [filters, setFilters] = useState<ConsolidationFiltersInput>({});
  const [drill, setDrill] = useState<Row | null>(null);
  const [params, setParams] = useSearchParams();
  const revisions = useRevisions(projectId);
  const revisionId = params.get('base') || null;
  const q = useConsolidation(projectId, groupBy, filters, revisionId);
  const baseRev = revisions.data?.find((r) => r.id === revisionId);
  if (project.isPending) return <Loading />;
  if (project.isError) return <ErrorState message={errorMessage(project.error)} onRetry={() => project.refetch()} />;
  const p = project.data;
  const setDim = (i: number, d: Dim | '') => setGroupBy((g) => (d ? (i < g.length ? g.map((x, k) => (k === i ? d : x)) : [...g, d]) : g.filter((_, k) => k !== i)));
  const activeFilters = Object.entries(filters).filter(([, v]) => v?.length) as [Dim, string[]][];

  return (
    <>
      <Breadcrumbs items={[{ label: 'Empreendimentos', to: '/empreendimentos' }, { label: p.name, to: `/empreendimentos/${p.id}` }, { label: 'Consolidações' }]} />
      <div className="mb-4 border-b border-line pb-4">
        <h1 className="font-display text-[28px] font-semibold leading-tight tracking-tight">Consolidações</h1>
        <p className="mt-1 text-[14px] text-muted">
          <span className="font-mono text-ink">{p.code}</span> {p.name} · somas das medições vigentes, com a replicação por tipologia aplicada e sem dupla contagem. Quantidades de unidades diferentes nunca são somadas.
        </p>
      </div>

      <section aria-label="Configuração" className="mb-4 flex flex-col gap-3 border border-line bg-sheet p-3">
        <div className="max-w-sm">
          <SelectField label="Base" value={revisionId ?? ''} onChange={(e) => { setParams(e.target.value ? { base: e.target.value } : {}, { replace: true }); setFilters({}); }}
            hint={baseRev ? `Fotografia emitida em ${fmtDateTime(baseRev.issuedAt)}; não muda com alterações posteriores.` : 'Medições vigentes agora.'}>
            <option value="">Estado atual</option>
            {(revisions.data ?? []).map((r) => <option key={r.id} value={r.id}>{r.code} — {r.title}</option>)}
          </SelectField>
        </div>
        <div className="flex flex-wrap gap-2">
          {PRESETS.map((x) => (
            <Button key={x.label} variant={JSON.stringify(x.groupBy) === JSON.stringify(groupBy) ? 'primary' : 'secondary'} onClick={() => setGroupBy(x.groupBy)}>{x.label}</Button>
          ))}
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {[0, 1, 2, 3].map((i) => i <= groupBy.length && (
            <SelectField key={i} label={`Agrupar por ${i + 1}`} value={groupBy[i] ?? ''} onChange={(e) => setDim(i, e.target.value as Dim | '')}>
              <option value="">{i === 0 ? 'Total geral' : '—'}</option>
              {CONSOLIDATION_DIMENSIONS.filter((d) => d === groupBy[i] || !groupBy.includes(d)).map((d) => <option key={d} value={d}>{DIMENSION_LABELS[d]}</option>)}
            </SelectField>
          ))}
        </div>
        <FilterEditor projectId={p.id} revisionId={revisionId} filters={filters} onChange={setFilters} />
        {activeFilters.length > 0 && (
          <p className="flex flex-wrap items-center gap-2 text-[13px]">
            <span className="text-muted">Filtros:</span>
            {activeFilters.map(([d, v]) => (
              <span key={d} className="inline-flex items-center gap-1 rounded-[3px] bg-cyan-wash px-2 py-0.5">
                {DIMENSION_LABELS[d]} ({v.length})
                <button type="button" aria-label={`Remover filtro ${DIMENSION_LABELS[d]}`} className="text-cyan-ink" onClick={() => setFilters((f) => ({ ...f, [d]: [] }))}>×</button>
              </span>
            ))}
            <button type="button" className="text-cyan-ink hover:underline" onClick={() => setFilters({})}>Limpar filtros</button>
          </p>
        )}
      </section>

      {q.isPending ? <Loading /> : q.isError ? <ErrorState message={errorMessage(q.error)} onRetry={() => q.refetch()} /> : q.data.rows.length === 0 ? (
        <EmptyState title="Nada a consolidar">Não há medições vigentes {activeFilters.length ? 'com esses filtros' : 'neste empreendimento'}.</EmptyState>
      ) : (
        <>
          <div className="mb-2 flex justify-end"><ExportButton path={`/projects/${p.id}/exports`} body={{ report: 'consolidation', groupBy, filters, ...(revisionId && { revisionId }) }} /></div>
          <ResultTable result={q.data} onDrill={setDrill} />
        </>
      )}
      <SidePanel open={!!drill} title="Detalhamento" onClose={() => setDrill(null)}>
        {drill && q.data && <Drill projectId={p.id} revisionId={revisionId} row={drill} groupBy={q.data.groupBy} filters={filters} />}
      </SidePanel>
    </>
  );
}

function ResultTable({ result: r, onDrill }: { result: ConsolidationResultDto; onDrill: (row: Row) => void }) {
  return (
    <section aria-label="Resultado">
      {r.truncated && <div className="mb-2"><Notice tone="warn">Resultado com mais de 5.000 grupos: mostrando os primeiros. Os totais gerais consideram tudo.</Notice></div>}
      <div className="overflow-x-auto border border-line bg-sheet">
        <table className="w-full min-w-[560px] text-left text-[13.5px]">
          <thead className="bg-paper text-[12px] text-muted">
            <tr>
              {r.groupBy.map((d) => <th key={d} className="px-3 py-1.5 font-normal">{DIMENSION_LABELS[d]}</th>)}
              <th className="px-3 py-1.5 text-right font-normal">Quantidade</th>
              <th className="px-3 py-1.5 font-normal">Un.</th>
              <th className="px-3 py-1.5 text-right font-normal">Linhas</th>
              <th className="px-3 py-1.5 text-right font-normal">Medições</th>
            </tr>
          </thead>
          <tbody>
            {r.rows.map((row, i) => (
              <tr key={i} className="border-t border-line hover:bg-paper">
                {r.groupBy.map((d, k) => (
                  <td key={d} className="px-3 py-1.5">
                    {k === 0 ? (
                      <button type="button" className="text-left text-cyan-ink hover:underline" onClick={() => onDrill(row)}>{row.key[d]?.label ?? <span className="text-muted">(sem {DIMENSION_LABELS[d].toLowerCase()})</span>}</button>
                    ) : row.key[d]?.label ?? <span className="text-muted">(sem {DIMENSION_LABELS[d].toLowerCase()})</span>}
                  </td>
                ))}
                <td className="px-3 py-1.5 text-right font-mono">
                  {r.groupBy.length === 0 ? <button type="button" className="text-cyan-ink hover:underline" onClick={() => onDrill(row)}>{fmtQty(row.total)}</button> : fmtQty(row.total)}
                </td>
                <td className="px-3 py-1.5 font-mono">{row.unit}</td>
                <td className="px-3 py-1.5 text-right font-mono text-muted">{row.lines}</td>
                <td className="px-3 py-1.5 text-right font-mono text-muted">{row.measurements}</td>
              </tr>
            ))}
          </tbody>
          {r.groupBy.length > 0 && (
            <tfoot className="border-t-2 border-line-strong bg-paper">
              {r.totals.map((t) => (
                <tr key={t.unit}>
                  <th scope="row" colSpan={r.groupBy.length} className="px-3 py-1.5 text-right font-medium">Total geral</th>
                  <td className="px-3 py-1.5 text-right font-mono font-semibold">{fmtQty(t.total)}</td>
                  <td className="px-3 py-1.5 font-mono">{t.unit}</td>
                  <td colSpan={2} />
                </tr>
              ))}
            </tfoot>
          )}
        </table>
      </div>
      <p className="mt-1 text-right text-[12px] text-muted">Consulta em {r.elapsedMs} ms</p>
    </section>
  );
}

function FilterEditor({ projectId, revisionId, filters, onChange }: { projectId: string; revisionId: string | null; filters: ConsolidationFiltersInput; onChange: (f: ConsolidationFiltersInput) => void }) {
  const [dim, setDim] = useState<Dim | ''>('');
  const opts = useConsolidation(projectId, dim ? [dim] : [], {}, revisionId, !!dim);
  const selected = new Set(dim ? filters[dim] ?? [] : []);
  const toggle = (v: string) => {
    if (!dim) return;
    const next = new Set(selected);
    if (next.has(v)) next.delete(v); else next.add(v);
    onChange({ ...filters, [dim]: [...next] });
  };
  const values = dim && opts.data ? [...new Map(opts.data.rows.map((r) => [r.key[dim]?.id ?? 'none', r.key[dim]?.label ?? '(sem valor)'])).entries()] : [];
  return (
    <div className="flex flex-col gap-2">
      <div className="max-w-xs">
        <SelectField label="Filtrar por" value={dim} onChange={(e) => setDim(e.target.value as Dim | '')}>
          <option value="">Escolha uma dimensão</option>
          {CONSOLIDATION_DIMENSIONS.map((d) => <option key={d} value={d}>{DIMENSION_LABELS[d]}{filters[d]?.length ? ` (${filters[d]!.length})` : ''}</option>)}
        </SelectField>
      </div>
      {dim && (opts.isPending ? <Loading /> : (
        <fieldset className="max-h-48 overflow-auto border border-line p-2">
          <legend className="sr-only">Valores de {DIMENSION_LABELS[dim]}</legend>
          {values.length === 0 && <p className="text-[13px] text-muted">Nenhum valor com medições.</p>}
          {values.map(([id, label]) => (
            <label key={id} className="flex items-center gap-2 text-[13.5px]"><input type="checkbox" checked={selected.has(id)} onChange={() => toggle(id)} /> {label}</label>
          ))}
        </fieldset>
      ))}
    </div>
  );
}

function Drill({ projectId, revisionId, row, groupBy, filters }: { projectId: string; revisionId: string | null; row: Row; groupBy: Dim[]; filters: ConsolidationFiltersInput }) {
  const [open, setOpen] = useState<string | null>(null);
  const f: ConsolidationFiltersInput = { ...filters };
  for (const d of groupBy) f[d] = [row.key[d]?.id ?? 'none'];
  const q = useQuery({ queryKey: [...key(projectId), revisionId ?? 'atual', 'lines', f], queryFn: () => api<ConsolidationLinesDto>('POST', `/projects/${projectId}/consolidation/lines`, { body: { filters: f, limit: 200, ...(revisionId && { revisionId }) } }) });
  if (open) return (
    <div className="flex flex-col gap-3">
      <div><Button variant="ghost" onClick={() => setOpen(null)}>← Voltar ao detalhamento</Button></div>
      {revisionId ? <FrozenView projectId={projectId} revisionId={revisionId} measurementId={open} /> : <MeasurementDetail projectId={projectId} id={open} canEdit={false} onRevise={() => undefined} />}
    </div>
  );
  return (
    <div className="flex flex-col gap-3 text-[13.5px]">
      <p>
        {groupBy.map((d) => <span key={d} className="mr-3"><span className="text-muted">{DIMENSION_LABELS[d]}:</span> {row.key[d]?.label ?? '(sem valor)'}</span>)}
      </p>
      <p className="font-mono text-[17px]">{fmtQty(row.total)} {row.unit}</p>
      {q.isPending ? <Loading /> : q.isError ? <ErrorState message={errorMessage(q.error)} /> : (
        <>
          <p className="text-muted">{q.data.total} linha(s) efetiva(s){q.data.total > q.data.lines.length && `, mostrando ${q.data.lines.length}`}. Abra uma linha para ver a memória de cálculo.</p>
          <ul className="border border-line">
            {q.data.lines.filter((l) => l.unit === row.unit).map((l, i) => (
              <li key={`${l.measurementId}-${i}`} className="border-b border-line last:border-0">
                <button type="button" className="grid w-full grid-cols-[minmax(0,1fr)_auto] gap-2 px-2 py-1.5 text-left hover:bg-cyan-wash" onClick={() => setOpen(l.measurementId)}>
                  <span className="min-w-0">
                    <span className="block truncate"><span className="font-mono text-muted">{l.wbsCode}</span> {l.wbsTitle} · <span className="font-mono">{l.serviceCode}</span></span>
                    <span className="block truncate text-[12.5px] text-muted">{l.anchorLabel}{l.unitLabel && ` · ${l.unitLabel}`}</span>
                  </span>
                  <span className="font-mono">{fmtQty(l.quantity)} {l.unit}</span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

function FrozenView({ projectId, revisionId, measurementId }: { projectId: string; revisionId: string; measurementId: string }) {
  const q = useQuery({ queryKey: ['project', projectId, 'revisions', revisionId, 'measurement', measurementId], queryFn: () => api<FrozenMeasurementDto>('GET', `/projects/${projectId}/revisions/${revisionId}/measurements/${measurementId}`) });
  if (q.isPending) return <Loading />;
  if (q.isError) return <ErrorState message={errorMessage(q.error)} />;
  const m = q.data;
  const r = m.revision;
  return (
    <div className="flex flex-col gap-3 text-[13.5px]">
      <Notice tone="info">Medição como estava na {m.revisionCode}.</Notice>
      <div>
        <p className="text-muted">{m.wbsCode} {m.wbsTitle} · <span className="font-mono">{m.serviceCode}</span></p>
        <p className="font-medium">{m.anchorLabel}</p>
        <p className="font-mono text-[17px]">{fmtQty(r.quantity)} {r.unit}{m.multiplier > 1 && <span className="text-[14px] text-muted"> × {m.multiplier} un. = {fmtQty(m.effectiveTotal)} {r.unit}</span>}</p>
      </div>
      <section aria-label="Memória de cálculo" className="border border-line p-3">
        <header className="mb-2 flex flex-wrap justify-between gap-2"><span className="font-mono">R{r.number} da medição</span><span className="text-[12px] text-muted">{r.createdBy} · {fmtDateTime(r.createdAt)}</span></header>
        {r.reason && <p className="mb-1"><span className="text-muted">Motivo:</span> {r.reason}</p>}
        {r.sourceReference && <p className="mb-1"><span className="text-muted">Documento de origem:</span> {r.sourceReference}</p>}
        <MemoryView memory={r.memory} />
      </section>
    </div>
  );
}
