import { useEffect, useMemo, useState, type ClipboardEvent, type KeyboardEvent } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import type { AnchorInput, ScheduleDetailDto, ScheduleLaunchResultDto, ScheduleRowDto, ServiceDto, WbsDto } from '@eapq/contracts';
import { computeSchedule, projectPermissions, totalWithMultipliers, type ScheduleService } from '@eapq/domain';
import { Breadcrumbs, PageHeader } from '../../app/shell';
import { EntityHistory } from '../../components/entity-history';
import { ArchiveButton, useAction } from '../../components/ui/actions';
import { Button } from '../../components/ui/button';
import { ErrorState, Loading, Notice } from '../../components/ui/feedback';
import { SelectField, TextField } from '../../components/ui/field';
import { SidePanel } from '../../components/ui/panel';
import { api, errorMessage } from '../../lib/api';
import { fmtDateTime, fmtQty } from '../../lib/format';
import { useSession } from '../auth/session';
import { useServices } from '../library/api';
import { mKeys } from '../measurements/api';
import { AnchorPicker } from '../measurements/measurement-form';
import { useProject } from '../projects/api';
import { STATUS_TONE } from '../sheets/api';
import { KIND_LABEL, SCHEDULE_STATUS_LABEL, scheduleKeys, useSchedule } from './api';

interface Col { key: string; label: string; wbsNodeId: string | null; anchor: AnchorInput | null; wbsLabel: string | null; anchorLabel: string | null; multiplier: number | null }
type Row = ScheduleRowDto;
type SvcInfo = { id: string; code: string; description: string; unit: string };
const newKey = (p: string) => `${p}${Math.random().toString(36).slice(2, 8)}`;
const blankRow = (): Row => ({ key: newKey('r'), code: null, description: '', spec: null, unit: 'un', width: null, height: null, serviceIds: [], cells: {} });
const isBlank = (r: Row) => !r.description.trim() && !r.code?.trim() && !Object.values(r.cells).some((v) => v.trim()) && !r.serviceIds.length;
const normalizePasted = (v: string) => (/^-?\d{1,3}(\.\d{3})+(,\d+)?$/.test(v.trim()) ? v.trim().replace(/\./g, '') : v.trim());
const dot = (v: string | null) => (v ? v.replace(',', '.') : null);

export function ScheduleEditorPage() {
  const { projectId = '', scheduleId = '' } = useParams();
  const [search] = useSearchParams();
  const { me } = useSession();
  const project = useProject(projectId);
  const schedule = useSchedule(projectId, scheduleId);
  const wbs = useQuery({ queryKey: ['project', projectId, 'wbs'], queryFn: () => api<WbsDto>('GET', `/projects/${projectId}/wbs`) });
  const [launched, setLaunched] = useState<ScheduleLaunchResultDto | null>(null);
  if (project.isPending || schedule.isPending || wbs.isPending) return <Loading />;
  if (project.isError) return <ErrorState message={errorMessage(project.error)} />;
  if (schedule.isError) return <ErrorState message={errorMessage(schedule.error)} onRetry={() => schedule.refetch()} />;
  const p = project.data;
  const s = schedule.data;
  const canEdit = projectPermissions(me!.orgRole, p.myProjectRole).has('project.content.edit') && p.status === 'ACTIVE' && !s.archivedAt;
  const dropped = Number(search.get('descartados') ?? 0);
  return (
    <>
      <Breadcrumbs items={[{ label: 'Empreendimentos', to: '/empreendimentos' }, { label: p.name, to: `/empreendimentos/${p.id}` }, { label: 'Quadros de componentes', to: `/empreendimentos/${p.id}/quadros` }, { label: s.title }]} />
      {dropped > 0 && <div className="mb-3"><Notice tone="warn">{dropped} serviço(s) da lista de origem são específicos de outro empreendimento e não foram copiados. Escolha os serviços desses itens.</Notice></div>}
      <Editor key={s.version} projectId={p.id} schedule={s} canEdit={canEdit} wbs={wbs.data ?? null} launched={launched} onLaunched={setLaunched} />
    </>
  );
}

function Editor({ projectId, schedule: s, canEdit, wbs, launched, onLaunched }: { projectId: string; schedule: ScheduleDetailDto; canEdit: boolean; wbs: WbsDto | null; launched: ScheduleLaunchResultDto | null; onLaunched: (r: ScheduleLaunchResultDto | null) => void }) {
  const initial = useMemo(() => ({
    title: s.title, sourceReference: s.sourceReference ?? '',
    columns: s.columns.map<Col>((c) => ({ key: c.key, label: c.label, wbsNodeId: c.wbsNodeId, anchor: c.anchor, wbsLabel: c.wbsCode ? `${c.wbsCode} ${c.wbsTitle}` : null, anchorLabel: c.anchorLabel, multiplier: c.multiplier })),
    rows: s.rows.length ? s.rows.map((r) => ({ ...r, width: r.width?.replace('.', ',') ?? null, height: r.height?.replace('.', ',') ?? null })) : [blankRow(), blankRow(), blankRow()],
  }), [s]);
  const [draft, setDraft] = useState(initial);
  const [svcInfo, setSvcInfo] = useState<Map<string, SvcInfo>>(() => new Map(s.services.map((x) => [x.id, x])));
  const [editingCol, setEditingCol] = useState<Col | null>(null);
  const [showDims, setShowDims] = useState(s.kind === 'ESQUADRIAS' || s.rows.some((r) => r.width || r.height));
  const act = useAction([scheduleKeys.all(projectId), mKeys.all(projectId)]);
  const strip = (d: typeof draft) => JSON.stringify({ ...d, columns: d.columns.map(({ key, label, wbsNodeId, anchor }) => ({ key, label, wbsNodeId, anchor })), rows: d.rows.filter((r) => !isBlank(r)) });
  const dirty = strip(draft) !== strip(initial);
  const unitsF = useMemo(() => s.units, [s.units]);
  const services = useMemo(() => new Map<string, ScheduleService>([...svcInfo.values()].flatMap((x) => { const u = unitsF.find((v) => v.symbol === x.unit); return u ? [[x.id, { id: x.id, code: x.code, unit: u }] as const] : []; })), [svcInfo, unitsF]);
  const filled = draft.rows.filter((r) => !isBlank(r));
  const result = useMemo(() => computeSchedule(draft.columns, filled.map((r) => ({ ...r, width: dot(r.width), height: dot(r.height) })), services, unitsF), [draft.columns, filled, services, unitsF]);
  const resultByKey = new Map(filled.map((r, i) => [r.key, result.rows[i]!]));
  const multOf = (k: string) => draft.columns.find((c) => c.key === k)?.multiplier ?? 1;

  const fields = [...['code', 'description', 'spec', 'unit'], ...(showDims ? ['width', 'height'] : []), ...draft.columns.map((c) => `col:${c.key}`)];
  const setField = (row: Row, f: string, v: string): Row => (f.startsWith('col:') ? { ...row, cells: { ...row.cells, [f.slice(4)]: v } } : { ...row, [f]: f === 'description' || f === 'unit' ? v : v || null });
  const getField = (row: Row, f: string) => (f.startsWith('col:') ? row.cells[f.slice(4)] ?? '' : ((row as unknown as Record<string, string | null>)[f] ?? ''));
  const setRows = (fn: (rows: Row[]) => Row[]) => setDraft((d) => ({ ...d, rows: fn(d.rows) }));
  const focus = (r: number, f: number) => requestAnimationFrame(() => (document.querySelector(`[data-qcell="${r}:${f}"]`) as HTMLInputElement | null)?.focus());

  const body = () => ({
    title: draft.title, sourceReference: draft.sourceReference || null,
    columns: draft.columns.map(({ key, label, wbsNodeId, anchor }) => ({ key, label, wbsNodeId, anchor })),
    rows: filled.map((r) => ({ ...r, cells: Object.fromEntries(Object.entries(r.cells).filter(([, v]) => v.trim())) })),
  });
  const save = () => act.run(() => api('PUT', `/projects/${projectId}/schedules/${s.id}`, { body: body(), version: s.version }));
  const launch = async () => {
    let version = s.version;
    if (dirty) { if (!(await save())) return; version += 1; }
    const r = await act.run(() => api<ScheduleLaunchResultDto>('POST', `/projects/${projectId}/schedules/${s.id}/launch`, { body: {}, version }));
    if (r && r !== true) onLaunched(r);
  };
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => { if ((e.ctrlKey || e.metaKey) && e.key === 's' && canEdit) { e.preventDefault(); if (dirty) void save(); } };
    const onLeave = (e: BeforeUnloadEvent) => { if (dirty) e.preventDefault(); };
    window.addEventListener('keydown', onKey); window.addEventListener('beforeunload', onLeave);
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('beforeunload', onLeave); };
  });
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>, r: number, f: number) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const next = e.shiftKey ? r - 1 : r + 1;
    if (next < 0) return;
    if (next >= draft.rows.length) setRows((rows) => [...rows, blankRow()]);
    focus(next, f);
  };
  /** Colar um bloco da planilha (Id, descrição, especificação, unidade, … quantidades) a partir da célula. */
  const onPaste = (e: ClipboardEvent<HTMLInputElement>, r: number, f: number) => {
    const text = e.clipboardData.getData('text/plain');
    if (!/[\t\n]/.test(text.replace(/\r?\n$/, ''))) return;
    e.preventDefault();
    const matrix = text.replace(/\r/g, '').replace(/\n$/, '').split('\n').map((l) => l.split('\t'));
    setRows((rows) => {
      const out = [...rows];
      matrix.forEach((cells, i) => {
        while (out.length <= r + i) out.push(blankRow());
        let row = out[r + i]!;
        cells.forEach((v, j) => { const field = fields[f + j]; if (field) row = setField(row, field, ['width', 'height'].includes(field) || field.startsWith('col:') ? normalizePasted(v) : v.trim()); });
        out[r + i] = row;
      });
      return out;
    });
  };

  const errorRows = filled.map((r, i) => ({ r, errors: result.rows[i]!.errors })).filter((x) => x.errors.length);
  const usedCols = new Set(result.plans.map((p) => p.columnKey));
  const incompleteCols = draft.columns.filter((c) => usedCols.has(c.key) && (!c.wbsNodeId || !c.anchor));
  const ready = result.plans.length > 0 && errorRows.length === 0 && incompleteCols.length === 0;
  const summary = [...new Set(result.plans.map((p) => p.serviceId))].map((sid) => {
    const ps = result.plans.filter((p) => p.serviceId === sid);
    return { sid, info: svcInfo.get(sid)!, unit: ps[0]!.unit, byCol: new Map(ps.map((p) => [p.columnKey, p.quantity])), total: totalWithMultipliers(ps.map((p) => ({ quantity: p.quantity, multiplier: multOf(p.columnKey) }))) };
  });
  const input = 'h-8 w-full border-0 bg-transparent px-2 text-[13px] focus:bg-cyan-wash focus:outline-2 focus:outline-signal';
  const unitList = s.units.map((u) => u.symbol);

  return (
    <>
      <PageHeader title={s.title} actions={canEdit && (
        <div className="flex flex-wrap items-center gap-2">
          {dirty && <span className="text-[13px] text-warn" role="status">Alterações não salvas</span>}
          <Button disabled={!dirty} busy={act.pending} onClick={() => void save()}>Salvar</Button>
          <Button variant="primary" busy={act.pending} disabled={!ready} onClick={() => void launch()}>{dirty ? 'Salvar e lançar quantitativos' : 'Lançar quantitativos'}</Button>
        </div>
      )}>
        {KIND_LABEL[s.kind]} · <span className={`rounded-[3px] px-1.5 py-0.5 text-[12px] ${s.archivedAt ? 'bg-paper text-muted' : STATUS_TONE[s.status]}`}>{s.archivedAt ? 'arquivado' : SCHEDULE_STATUS_LABEL[s.status]}</span>
        {s.launchedAt && <span> · último lançamento {fmtDateTime(s.launchedAt)}</span>}
      </PageHeader>
      {launched && (
        <div className="mb-3"><Notice tone="ok">
          Quantitativos lançados: {launched.created} criado(s), {launched.revised} revisado(s) com nova memória, {launched.unchanged} sem alteração{launched.archived ? `, ${launched.archived} arquivado(s)` : ''}{launched.linkedServices ? `; ${launched.linkedServices} serviço(s) vinculado(s) à EAP` : ''}.{' '}
          <Link className="text-cyan-ink hover:underline" to={`/empreendimentos/${projectId}/quantitativos`}>Ver quantitativos</Link>
        </Notice></div>
      )}
      {act.error && <div className="mb-3"><Notice tone="danger">{act.error}</Notice></div>}
      {s.archivedAt && <Notice tone="info">Quadro arquivado: somente leitura.</Notice>}

      <section aria-label="Destinos" className="mb-3 flex flex-wrap items-stretch gap-2">
        {draft.columns.map((c) => (
          <div key={c.key} className="min-w-[180px] border border-line bg-sheet px-3 py-2 text-[13px]">
            <p className="font-medium">{c.label} {c.multiplier != null && c.multiplier !== 1 && <span className="font-mono text-cyan-ink">× {c.multiplier}</span>}</p>
            <p className="text-[12px] text-muted">{c.wbsLabel ?? <span className="text-warn">item da EAP não escolhido</span>}</p>
            <p className="text-[12px] text-muted">{c.anchorLabel ?? <span className="text-warn">âncora não escolhida</span>}</p>
            {canEdit && <div className="mt-1 flex gap-3">
              <button type="button" className="text-[12.5px] text-cyan-ink hover:underline" onClick={() => setEditingCol(c)}>Editar destino {c.label}</button>
              <button type="button" className="text-[12.5px] text-danger" aria-label={`Remover destino ${c.label}`} onClick={() => setDraft((d) => ({ ...d, columns: d.columns.filter((x) => x.key !== c.key), rows: d.rows.map((r) => { const { [c.key]: _gone, ...cells } = r.cells; return { ...r, cells }; }) }))}>Remover</button>
            </div>}
          </div>
        ))}
        {canEdit && <Button onClick={() => setEditingCol({ key: newKey('d'), label: `Destino ${draft.columns.length + 1}`, wbsNodeId: null, anchor: null, wbsLabel: null, anchorLabel: null, multiplier: null })}>Adicionar destino</Button>}
      </section>

      <section aria-label="Itens do quadro" className="min-w-0">
        <div className="overflow-x-auto border border-line bg-sheet">
          <table className="w-full border-collapse text-left text-[13px]">
            <thead className="bg-paper text-[12px]">
              <tr>
                <th className="w-8 border-b border-line px-2 py-1 font-normal text-muted">#</th>
                <th className="border-b border-l border-line px-2 py-1 font-medium">Id</th>
                <th className="border-b border-l border-line px-2 py-1 font-medium">Descrição *</th>
                <th className="border-b border-l border-line px-2 py-1 font-medium">Especificação</th>
                <th className="border-b border-l border-line px-2 py-1 font-medium">Unid.</th>
                {showDims && <><th className="border-b border-l border-line px-2 py-1 font-medium">Largura <span className="font-mono font-normal text-muted">m</span></th><th className="border-b border-l border-line px-2 py-1 font-medium">Altura <span className="font-mono font-normal text-muted">m</span></th></>}
                <th className="border-b border-l border-line px-2 py-1 font-medium">Serviço(s)</th>
                {draft.columns.map((c) => <th key={c.key} className="border-b border-l border-line bg-cyan-wash px-2 py-1 text-right font-medium">{c.label}{c.multiplier != null && c.multiplier !== 1 && <span className="block font-mono font-normal text-muted">× {c.multiplier}</span>}</th>)}
                <th className="border-b border-l border-line px-2 py-1 text-right font-medium">Total obra</th>
                {canEdit && <th className="border-b border-l border-line"><span className="sr-only">Ações</span></th>}
              </tr>
            </thead>
            <tbody>
              {draft.rows.map((row, r) => {
                const res = resultByKey.get(row.key);
                const total = draft.columns.reduce((acc, c) => { const v = res?.cells[c.key]?.value; return v ? acc + Number(v) * multOf(c.key) : acc; }, 0);
                return (
                  <tr key={row.key} className={`border-t border-line ${res?.errors.length ? 'bg-danger-wash' : ''}`}>
                    <td className="px-2 font-mono text-[12px] text-muted">{r + 1}</td>
                    {fields.map((f, fi) => {
                      const label = f === 'code' ? 'Id' : f === 'description' ? 'Descrição' : f === 'spec' ? 'Especificação' : f === 'unit' ? 'Unidade' : f === 'width' ? 'Largura' : f === 'height' ? 'Altura' : draft.columns.find((c) => `col:${c.key}` === f)!.label;
                      const numeric = f === 'width' || f === 'height' || f.startsWith('col:');
                      const cellErr = f.startsWith('col:') ? res?.cells[f.slice(4)]?.error : undefined;
                      const el = (
                        <td key={f} className={`border-l border-line p-0 ${f.startsWith('col:') ? 'bg-cyan-wash/30' : ''}`}>
                          <input data-qcell={`${r}:${fi}`} aria-label={`${label}, item ${r + 1}`} disabled={!canEdit} value={getField(row, f)}
                            list={f === 'unit' ? 'schedule-units' : undefined} inputMode={numeric ? 'decimal' : undefined}
                            className={`${input} ${numeric ? 'min-w-[72px] text-right font-mono' : f === 'description' ? 'min-w-[200px]' : f === 'unit' ? 'w-16 font-mono' : 'min-w-[96px]'} ${cellErr ? 'text-danger' : ''}`}
                            title={cellErr} onChange={(e) => setRows((rows) => rows.map((x, i) => (i === r ? setField(x, f, e.target.value) : x)))}
                            onKeyDown={(e) => onKeyDown(e, r, fi)} onPaste={(e) => onPaste(e, r, fi)} />
                        </td>
                      );
                      if (fi === fields.indexOf(showDims ? 'height' : 'unit')) return [el, (
                        <td key="svc" className="border-l border-line px-1 py-0.5">
                          <ServiceCell projectId={projectId} ids={row.serviceIds} info={svcInfo} canEdit={canEdit} rowLabel={`item ${r + 1}`}
                            onChange={(ids, added) => { if (added) setSvcInfo((m) => new Map(m).set(added.id, added)); setRows((rows) => rows.map((x, i) => (i === r ? { ...x, serviceIds: ids } : x))); }} />
                        </td>
                      )];
                      return el;
                    })}
                    <td className="border-l border-line px-2 text-right font-mono">{total ? fmtQty(String(Math.round(total * 1e6) / 1e6)) : ''} <span className="text-muted">{total ? row.unit : ''}</span></td>
                    {canEdit && <td className="whitespace-nowrap border-l border-line px-1">
                      <button type="button" className="px-1 text-muted hover:text-ink" aria-label={`Duplicar item ${r + 1}`} title="Duplicar" onClick={() => setRows((rows) => [...rows.slice(0, r + 1), { ...structuredClone(rows[r]!), key: newKey('r') }, ...rows.slice(r + 1)])}>⧉</button>
                      <button type="button" className="px-1 text-danger" aria-label={`Remover item ${r + 1}`} title="Remover" onClick={() => setRows((rows) => (rows.length > 1 ? rows.filter((_, i) => i !== r) : [blankRow()]))}>×</button>
                    </td>}
                  </tr>
                );
              })}
            </tbody>
          </table>
          <datalist id="schedule-units">{unitList.map((u) => <option key={u} value={u} />)}</datalist>
        </div>
        {canEdit && (
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Button onClick={() => { setRows((rows) => [...rows, blankRow()]); focus(draft.rows.length, 1); }}>Adicionar item</Button>
            <Button variant="ghost" onClick={() => setRows((rows) => [...rows, ...Array.from({ length: 10 }, blankRow)])}>+10 itens</Button>
            <label className="flex items-center gap-1.5 text-[13px]"><input type="checkbox" checked={showDims} onChange={(e) => setShowDims(e.target.checked)} /> Largura × altura (esquadrias)</label>
            <span className="text-[12.5px] text-muted">Enter desce · cole blocos da planilha (Id, descrição, especificação, unidade… quantidades) · Ctrl+S salva</span>
          </div>
        )}
        {(errorRows.length > 0 || incompleteCols.length > 0) && (
          <div className="mt-3"><Notice tone="warn">
            {errorRows.length > 0 && <><p className="font-medium">{errorRows.length} item(ns) com problema — impedem o lançamento:</p>
              <ul className="list-disc pl-5">{errorRows.slice(0, 12).map(({ r, errors }) => <li key={r.key}>{r.code ?? r.description ?? 'Item'}: {errors.join(' ')}</li>)}</ul></>}
            {incompleteCols.map((c) => <p key={c.key}>Destino "{c.label}": escolha o item da EAP e a âncora.</p>)}
          </Notice></div>
        )}
      </section>

      <section aria-label="Quadro de resumo" className="mt-5 border border-line bg-sheet">
        <h2 className="px-3 py-2 font-medium">Quadro de resumo <span className="font-normal text-muted">— o que será lançado (por serviço e destino)</span></h2>
        {summary.length === 0 ? <p className="px-3 pb-3 text-[13px] text-muted">Informe quantidades e serviços dos itens.</p> : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[13.5px]">
              <thead className="bg-paper text-[12px] text-muted"><tr><th className="px-3 py-1 font-normal">Serviço</th>{draft.columns.map((c) => <th key={c.key} className="px-3 py-1 text-right font-normal">{c.label}</th>)}<th className="px-3 py-1 text-right font-normal">Total obra</th></tr></thead>
              <tbody>{summary.map((x) => (
                <tr key={x.sid} className="border-t border-line">
                  <td className="px-3 py-1.5"><span className="font-mono text-[12.5px]">{x.info.code}</span> {x.info.description}</td>
                  {draft.columns.map((c) => <td key={c.key} className="px-3 py-1.5 text-right font-mono">{x.byCol.get(c.key) ? fmtQty(x.byCol.get(c.key)!) : ''}</td>)}
                  <td className="px-3 py-1.5 text-right font-mono font-medium">{fmtQty(x.total)} {x.unit}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </section>

      {canEdit && (
        <section aria-label="Dados do quadro" className="mt-5 grid gap-3 border border-line bg-sheet p-3 md:grid-cols-2">
          <TextField label="Título do quadro" value={draft.title} onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))} />
          <TextField label="Documento de origem" value={draft.sourceReference} onChange={(e) => setDraft((d) => ({ ...d, sourceReference: e.target.value }))} hint="Prancha, memorial ou revisão do projeto" />
          <div><ArchiveButton what="quadro" onConfirm={(reason) => act.run(() => api('POST', `/projects/${projectId}/schedules/${s.id}/archive`, { body: { reason }, version: s.version }))} />
            <p className="text-[12px] text-muted">Arquivar o quadro arquiva também os quantitativos lançados por ele.</p></div>
        </section>
      )}
      {s.archivedAt && <div className="mt-3"><Button onClick={() => act.run(() => api('POST', `/projects/${projectId}/schedules/${s.id}/unarchive`, { body: {}, version: s.version }))}>Restaurar quadro</Button></div>}

      {s.measurements.length > 0 && (
        <section aria-label="Quantitativos lançados" className="mt-5 border border-line bg-sheet">
          <h2 className="px-3 py-2 font-medium">Quantitativos lançados</h2>
          <table className="w-full text-left text-[13.5px]">
            <thead className="bg-paper text-[12px] text-muted"><tr><th className="px-3 py-1 font-normal">Serviço</th><th className="px-3 py-1 font-normal">Destino</th><th className="px-3 py-1 text-right font-normal">Por destino</th><th className="px-3 py-1 font-normal">Rev.</th></tr></thead>
            <tbody>{s.measurements.map((m) => (
              <tr key={m.measurementId} className={`border-t border-line ${m.archived ? 'text-graphite-400' : ''}`}>
                <td className="px-3 py-1.5"><span className="font-mono text-[12.5px]">{m.serviceCode}</span> {m.serviceDescription}{m.archived && ' (arquivado)'}</td>
                <td className="px-3 py-1.5">{s.columns.find((c) => c.key === m.columnKey)?.label ?? m.columnKey}</td>
                <td className="px-3 py-1.5 text-right font-mono">{fmtQty(m.quantity)} {m.unit}</td>
                <td className="px-3 py-1.5 font-mono">R{m.revision}</td>
              </tr>
            ))}</tbody>
          </table>
        </section>
      )}
      <div className="mt-6"><EntityHistory projectId={projectId} entityId={s.id} /></div>

      <SidePanel open={!!editingCol} title="Destino" onClose={() => setEditingCol(null)}>
        {editingCol && <ColumnForm projectId={projectId} wbs={wbs} col={editingCol} onDone={(c) => {
          setDraft((d) => ({ ...d, columns: d.columns.some((x) => x.key === c.key) ? d.columns.map((x) => (x.key === c.key ? c : x)) : [...d.columns, c] }));
          setEditingCol(null);
        }} />}
      </SidePanel>
    </>
  );
}

function ColumnForm({ projectId, wbs, col, onDone }: { projectId: string; wbs: WbsDto | null; col: Col; onDone: (c: Col) => void }) {
  const [c, setC] = useState(col);
  const [filter, setFilter] = useState('');
  const [picking, setPicking] = useState(!col.anchor);
  const items = (wbs?.nodes ?? []).filter((n) => n.nodeType === 'ITEM' && n.status === 'ACTIVE');
  const shown = items.filter((n) => !filter || `${n.code} ${n.title}`.toLowerCase().includes(filter.toLowerCase()) || n.id === c.wbsNodeId).slice(0, 300);
  return (
    <div className="flex flex-col gap-3">
      <TextField label="Nome do destino" value={c.label} onChange={(e) => setC({ ...c, label: e.target.value })} hint="Ex.: Casa tipo A, Apto tipo 2Q, Salão de festas" />
      <TextField label="Filtrar itens da EAP" type="search" value={filter} onChange={(e) => setFilter(e.target.value)} />
      <SelectField label="Item da EAP" value={c.wbsNodeId ?? ''} onChange={(e) => { const n = items.find((x) => x.id === e.target.value); setC({ ...c, wbsNodeId: n?.id ?? null, wbsLabel: n ? `${n.code} ${n.title}` : null }); }}>
        <option value="">Selecione</option>
        {shown.map((n) => <option key={n.id} value={n.id}>{n.code} {n.title}</option>)}
      </SelectField>
      <div>
        <p className="text-[13px] font-medium text-graphite-800">Onde (âncora)</p>
        <p className="text-[13.5px]">{c.anchorLabel ?? <span className="text-muted">não escolhida</span>}</p>
        {!picking && <Button variant="ghost" onClick={() => setPicking(true)}>Alterar âncora</Button>}
      </div>
      {picking && <AnchorPicker projectId={projectId} value={c.anchor} onChange={(a) => setC({ ...c, anchor: a, anchorLabel: a ? 'nova âncora (salve o quadro para confirmar)' : null, multiplier: null })} />}
      <p className="text-[12.5px] text-muted">Elemento de tipologia: as quantidades valem para cada unidade da tipologia (o número aparece depois de salvar).</p>
      <div><Button variant="primary" disabled={!c.label.trim()} onClick={() => onDone(c)}>Aplicar destino</Button></div>
    </div>
  );
}

function ServiceCell({ projectId, ids, info, canEdit, rowLabel, onChange }: { projectId: string; ids: string[]; info: Map<string, SvcInfo>; canEdit: boolean; rowLabel: string; onChange: (ids: string[], added?: SvcInfo) => void }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const found = useServices(projectId, { q, limit: 20 }, open);
  const list = open ? (found.data?.items ?? []).filter((x: ServiceDto) => !x.archivedAt && !ids.includes(x.id)) : [];
  return (
    <div className="relative flex min-w-[160px] flex-wrap items-center gap-1">
      {ids.map((id) => (
        <span key={id} className="inline-flex items-center gap-1 rounded-[3px] bg-paper px-1.5 py-0.5 font-mono text-[12px]" title={info.get(id)?.description}>
          {info.get(id)?.code ?? '?'}<span className="font-sans text-muted">{info.get(id)?.unit}</span>
          {canEdit && <button type="button" className="text-danger" aria-label={`Retirar ${info.get(id)?.code} do ${rowLabel}`} onClick={() => onChange(ids.filter((x) => x !== id))}>×</button>}
        </span>
      ))}
      {canEdit && ids.length < 3 && <button type="button" className="text-[12.5px] text-cyan-ink hover:underline" aria-label={`Escolher serviço do ${rowLabel}`} onClick={() => setOpen((o) => !o)}>+ serviço</button>}
      {open && (
        <div className="absolute left-0 top-full z-20 mt-1 w-80 border border-line-strong bg-sheet p-2 shadow-lg">
          <input autoFocus type="search" aria-label="Buscar serviço" placeholder="Código ou descrição" value={q} onChange={(e) => setQ(e.target.value)} className="mb-1 h-8 w-full rounded-[3px] border border-line-strong px-2 text-[13px]" />
          <ul aria-label="Resultados de serviços" className="max-h-60 overflow-auto text-[13px]">
            {list.map((x: ServiceDto) => (
              <li key={x.id}><button type="button" className="block w-full px-2 py-1 text-left hover:bg-cyan-wash" onClick={() => { onChange([...ids, x.id], { id: x.id, code: x.code, description: x.description, unit: x.unitSymbol }); setOpen(false); setQ(''); }}>
                <span className="font-mono">{x.code}</span> {x.description} <span className="text-muted">({x.unitSymbol})</span>
              </button></li>
            ))}
            {list.length === 0 && <li className="px-2 py-1 text-muted">{found.isPending ? 'Buscando…' : 'Nenhum serviço encontrado. Cadastre na Biblioteca de serviços.'}</li>}
          </ul>
        </div>
      )}
    </div>
  );
}
