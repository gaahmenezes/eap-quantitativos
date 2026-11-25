import { useEffect, useMemo, useState, type ClipboardEvent, type KeyboardEvent } from 'react';
import { Link, useParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import type { AnchorInput, ServiceDto, SheetDetailDto, SheetLaunchResultDto, WbsDto } from '@eapq/contracts';
import { compatibleDimensions, compileSheet, computeSheet, projectPermissions, type SheetDef, type SheetRowInput } from '@eapq/domain';
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
import { mKeys } from '../measurements/api';
import { AnchorPicker } from '../measurements/measurement-form';
import { useProject } from '../projects/api';
import { sheetKeys, STATUS_LABEL, STATUS_TONE, useSheet } from './api';

type Row = SheetDetailDto['rows'][number];
/** Destino próprio da linha guardado junto da linha (chave reservada, não é coluna do modelo). */
const DEST = '__dest';
type Dest = { anchor: AnchorInput; label: string };
const destOf = (r: Row) => (r as unknown as Record<string, Dest | undefined>)[DEST] ?? null;
const withDest = (r: Row, d: Dest | null): Row => { const { [DEST]: _old, ...rest } = r as Record<string, unknown>; return (d ? { ...rest, [DEST]: d } : rest) as Row; };
const plainRow = (r: Row): Row => withDest(r, null);
const blankRows = (n: number): Row[] => Array.from({ length: n }, () => ({}));
/** "1.234,56" colado de planilha em pt-BR vira "1234,56". */
const normalizePasted = (v: string) => (/^-?\d{1,3}(\.\d{3})+(,\d+)?$/.test(v.trim()) ? v.trim().replace(/\./g, '') : v.trim());

export function SheetEditorPage() {
  const { projectId = '', sheetId = '' } = useParams();
  const { me } = useSession();
  const project = useProject(projectId);
  const sheet = useSheet(projectId, sheetId);
  const wbs = useQuery({ queryKey: ['project', projectId, 'wbs'], queryFn: () => api<WbsDto>('GET', `/projects/${projectId}/wbs`) });
  const services = useQuery({ queryKey: ['project', projectId, 'services', 'all'], queryFn: () => api<{ items: ServiceDto[] }>('GET', `/projects/${projectId}/services?limit=200`) });
  const [launched, setLaunched] = useState<SheetLaunchResultDto | null>(null);
  if (project.isPending || sheet.isPending || wbs.isPending || services.isPending) return <Loading />;
  if (project.isError) return <ErrorState message={errorMessage(project.error)} />;
  if (sheet.isError) return <ErrorState message={errorMessage(sheet.error)} onRetry={() => sheet.refetch()} />;
  const p = project.data;
  const s = sheet.data;
  const canEdit = projectPermissions(me!.orgRole, p.myProjectRole).has('project.content.edit') && p.status === 'ACTIVE' && !s.archivedAt;
  return (
    <>
      <Breadcrumbs items={[{ label: 'Empreendimentos', to: '/empreendimentos' }, { label: p.name, to: `/empreendimentos/${p.id}` }, { label: 'Fichas de levantamento', to: `/empreendimentos/${p.id}/fichas` }, { label: s.title }]} />
      <Editor key={s.version} projectId={p.id} sheet={s} canEdit={canEdit} wbs={wbs.data ?? null} services={(services.data?.items ?? []).filter((x) => !x.archivedAt)} launched={launched} onLaunched={setLaunched} />
    </>
  );
}

interface EditorProps {
  projectId: string;
  sheet: SheetDetailDto;
  canEdit: boolean;
  wbs: WbsDto | null;
  services: ServiceDto[];
  launched: SheetLaunchResultDto | null;
  onLaunched: (r: SheetLaunchResultDto | null) => void;
}

function Editor({ projectId, sheet: s, canEdit, wbs, services, launched, onLaunched }: EditorProps) {
  const def = s.definition as SheetDef;
  const initial = useMemo(() => ({ title: s.title, rows: s.rows.length ? s.rows.map((r, i) => withDest(r, s.rowAnchors[i] ? { anchor: s.rowAnchors[i]!, label: s.rowAnchorLabels[i] ?? '' } : null)) : blankRows(3), params: s.params, outputMap: s.outputMap, wbsNodeId: s.wbsNodeId, anchor: s.anchor, sourceReference: s.sourceReference ?? '' }), [s]);
  const [draft, setDraft] = useState(initial);
  const [anchorLabel, setAnchorLabel] = useState(s.anchorLabel);
  const [pickAnchor, setPickAnchor] = useState(false);
  const [wbsFilter, setWbsFilter] = useState('');
  const act = useAction([sheetKeys.all(projectId), mKeys.all(projectId)]);
  const dirty = JSON.stringify(draft) !== JSON.stringify(initial);
  const compiled = useMemo(() => compileSheet(def, s.units), [def, s.units]);
  const result = useMemo(() => computeSheet(compiled, draft.rows.map(plainRow) as SheetRowInput[], draft.params), [compiled, draft.rows, draft.params]);
  const [destRow, setDestRow] = useState<number | null>(null);
  const inputCols = def.columns.filter((c) => c.kind === 'input');
  const unitDim = new Map(s.units.map((u) => [u.symbol, u.dimension]));
  const items = (wbs?.nodes ?? []).filter((n) => n.nodeType === 'ITEM' && n.status === 'ACTIVE');
  const wbsShown = items.filter((n) => !wbsFilter || `${n.code} ${n.title}`.toLowerCase().includes(wbsFilter.toLowerCase()) || n.id === draft.wbsNodeId).slice(0, 300);

  const setCell = (r: number, key: string, v: string) => setDraft((d) => ({ ...d, rows: d.rows.map((row, i) => (i === r ? { ...row, [key]: { ...row[key], v } } : row)) }));
  const setRows = (f: (rows: Row[]) => Row[]) => setDraft((d) => ({ ...d, rows: f(d.rows) }));
  const focus = (r: number, c: number) => requestAnimationFrame(() => (document.querySelector(`[data-cell="${r}:${c}"]`) as HTMLInputElement | null)?.focus());

  const save = async () => {
    const rowAnchors = draft.rows.map((r) => destOf(r)?.anchor ?? null);
    const body = { title: draft.title, rows: draft.rows.map(plainRow), ...(rowAnchors.some(Boolean) || s.rowAnchors.some(Boolean) ? { rowAnchors } : {}), params: draft.params, outputMap: draft.outputMap, wbsNodeId: draft.wbsNodeId, anchor: draft.anchor, sourceReference: draft.sourceReference || null };
    return act.run(() => api('PATCH', `/projects/${projectId}/sheets/${s.id}`, { body, version: s.version }));
  };
  const launch = async () => {
    let version = s.version;
    if (dirty) { if (!(await save())) return; version += 1; }
    const r = await act.run(() => api<SheetLaunchResultDto>('POST', `/projects/${projectId}/sheets/${s.id}/launch`, { body: {}, version }));
    if (r && r !== true) onLaunched(r);
  };

  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => { if ((e.ctrlKey || e.metaKey) && e.key === 's' && canEdit) { e.preventDefault(); if (dirty) void save(); } };
    const onLeave = (e: BeforeUnloadEvent) => { if (dirty) e.preventDefault(); };
    window.addEventListener('keydown', onKey);
    window.addEventListener('beforeunload', onLeave);
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('beforeunload', onLeave); };
  });

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>, r: number, c: number) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const next = e.shiftKey ? r - 1 : r + 1;
      if (next < 0) return;
      if (next >= draft.rows.length) setRows((rows) => [...rows, {}]);
      focus(next, c);
    } else if (e.key === 'ArrowDown' && e.altKey) { e.preventDefault(); focus(Math.min(r + 1, draft.rows.length - 1), c); }
    else if (e.key === 'ArrowUp' && e.altKey) { e.preventDefault(); focus(Math.max(r - 1, 0), c); }
  };
  /** Colar um bloco copiado do Excel/planilha preenche linhas e colunas a partir da célula. */
  const onPaste = (e: ClipboardEvent<HTMLInputElement>, r: number, c: number) => {
    const text = e.clipboardData.getData('text/plain');
    if (!/[\t\n]/.test(text.replace(/\r?\n$/, ''))) return;
    e.preventDefault();
    const matrix = text.replace(/\r/g, '').replace(/\n$/, '').split('\n').map((l) => l.split('\t'));
    setRows((rows) => {
      const out = [...rows];
      matrix.forEach((cells, i) => {
        const ri = r + i;
        while (out.length <= ri) out.push({});
        const row = { ...out[ri] };
        cells.forEach((v, j) => {
          const col = inputCols[c + j];
          if (col) row[col.key] = { ...row[col.key], v: col.type === 'number' ? normalizePasted(v) : v.trim() };
        });
        out[ri] = row;
      });
      return out;
    });
  };

  const errorRows = result.rows.map((r, i) => ({ i, errors: r.errors })).filter((x) => x.errors.length);
  const filled = result.rows.filter((r) => !r.blank).length;
  const ready = !!draft.wbsNodeId && (!!draft.anchor || draft.rows.every((x, i) => result.rows[i]?.blank || !!destOf(x))) && filled > 0 && errorRows.length === 0 && compiled.issues.length === 0 && Object.values(draft.outputMap).some(Boolean);
  const cellBase = 'h-8 w-full min-w-[84px] border-0 bg-transparent px-2 text-[13px] focus:bg-cyan-wash focus:outline-2 focus:outline-signal';

  return (
    <>
      <PageHeader title={s.title} actions={canEdit && (
        <div className="flex flex-wrap items-center gap-2">
          {dirty && <span className="text-[13px] text-warn" role="status">Alterações não salvas</span>}
          <Button disabled={!dirty} busy={act.pending} onClick={() => void save()}>Salvar</Button>
          <Button variant="primary" busy={act.pending} disabled={!ready} onClick={() => void launch()}>{dirty ? 'Salvar e lançar quantitativos' : 'Lançar quantitativos'}</Button>
        </div>
      )}>
        <span className="font-mono">{s.templateCode} R{s.versionNumber}</span> {s.templateName} ·{' '}
        <span className={`rounded-md px-1.5 py-0.5 text-[12px] ${s.archivedAt ? 'bg-paper text-muted' : STATUS_TONE[s.status]}`}>{s.archivedAt ? 'arquivada' : STATUS_LABEL[s.status]}</span>
        {s.launchedAt && <span> · último lançamento {fmtDateTime(s.launchedAt)}</span>}
      </PageHeader>

      {launched && (
        <Notice tone="ok">
          Quantitativos lançados: {launched.created} criado(s), {launched.revised} revisado(s) com nova memória, {launched.unchanged} sem alteração{launched.archived ? `, ${launched.archived} arquivado(s)` : ''}{launched.linkedServices ? `; ${launched.linkedServices} serviço(s) vinculado(s) ao item da EAP` : ''}.{' '}
          <Link className="text-cyan-ink hover:underline" to={`/empreendimentos/${projectId}/quantitativos`}>Ver quantitativos</Link>
        </Notice>
      )}
      {act.error && <div className="mb-3"><Notice tone="danger">{act.error}</Notice></div>}
      {s.archivedAt && <Notice tone="info">Ficha arquivada: somente leitura. Restaure para editar e lançar de novo.</Notice>}
      {s.newerVersion && canEdit && (
        <div className="mb-3"><Notice tone="warn">
          O modelo tem a versão R{s.newerVersion.number}. A ficha continua na R{s.versionNumber} até você atualizar.{' '}
          <Button variant="ghost" disabled={dirty} onClick={() => act.run(() => api('PATCH', `/projects/${projectId}/sheets/${s.id}`, { body: { templateVersionId: s.newerVersion!.id }, version: s.version }))}>Atualizar para R{s.newerVersion.number}</Button>
        </Notice></div>
      )}
      {compiled.issues.length > 0 && <Notice tone="danger">O modelo tem problemas: {compiled.issues.map((i) => i.message).join(' ')}</Notice>}

      <div className="flex flex-col gap-4">
        <section aria-label="Linhas da ficha" className="min-w-0">
          <div className="overflow-x-auto border border-line bg-sheet">
            <table className="w-full border-collapse text-left text-[13px]">
              <thead className="sticky top-0 bg-paper text-[12px]">
                <tr>
                  <th className="w-10 border-b border-line px-2 py-1 font-normal text-muted">#</th>
                  {def.columns.map((c) => (
                    <th key={c.key} scope="col" className={`border-b border-l border-line px-2 py-1 font-medium ${c.kind === 'calc' ? 'bg-cyan-wash text-right' : ''}`} title={c.expression ?? undefined}>
                      {c.label}{c.required && <span className="text-danger"> *</span>}
                      {c.unit && <span className="block font-mono font-normal text-muted">{c.unit}</span>}
                    </th>
                  ))}
                  <th className="border-b border-l border-line px-2 py-1 font-medium">Destino</th>
                  {canEdit && <th className="border-b border-l border-line px-2 py-1 font-normal text-muted"><span className="sr-only">Ações</span></th>}
                </tr>
              </thead>
              <tbody>
                {draft.rows.map((row, r) => {
                  const res = result.rows[r]!;
                  return (
                    <tr key={r} className={`border-t border-line ${res.errors.length ? 'bg-danger-wash' : ''}`}>
                      <td className="px-2 font-mono text-[12px] text-muted">{r + 1}</td>
                      {def.columns.map((c) => {
                        if (c.kind === 'calc') {
                          const cell = res.cells[c.key];
                          return <td key={c.key} className="border-l border-line bg-cyan-wash/40 px-2 text-right font-mono" title={cell?.error}>{res.blank ? '' : cell?.value != null && cell.error === undefined ? fmtQty(cell.value) : <span className="text-danger">—</span>}</td>;
                        }
                        const ci = inputCols.indexOf(c);
                        const cell = res.cells[c.key];
                        const v = row[c.key]?.v ?? '';
                        return (
                          <td key={c.key} className="border-l border-line p-0">
                            <input
                              data-cell={`${r}:${ci}`} aria-label={`${c.label}, linha ${r + 1}`} disabled={!canEdit}
                              className={`${cellBase} ${c.type === 'number' ? 'text-right font-mono' : 'min-w-[150px]'} ${cell?.error ? 'text-danger' : ''}`}
                              value={v} placeholder={c.defaultValue ?? ''} list={c.type === 'choice' ? `opt-${c.key}` : undefined}
                              inputMode={c.type === 'number' ? 'decimal' : undefined}
                              title={cell?.expr ? `= ${fmtQty(cell.value ?? '0')}` : cell?.error}
                              onChange={(e) => setCell(r, c.key, e.target.value)} onKeyDown={(e) => onKeyDown(e, r, ci)} onPaste={(e) => onPaste(e, r, ci)}
                            />
                          </td>
                        );
                      })}
                      <td className="border-l border-line px-1">
                        <button type="button" disabled={!canEdit} aria-label={`Destino da linha ${r + 1}`} onClick={() => setDestRow(r)}
                          className={`max-w-[180px] truncate text-left text-[12px] ${destOf(row) ? 'text-cyan-ink' : 'text-muted'} hover:underline disabled:no-underline`} title={destOf(row)?.label}>
                          {destOf(row)?.label || 'da ficha'}
                        </button>
                      </td>
                      {canEdit && (
                        <td className="whitespace-nowrap border-l border-line px-1">
                          <button type="button" className="px-1 text-muted hover:text-ink" aria-label={`Duplicar linha ${r + 1}`} title="Duplicar" onClick={() => setRows((rows) => [...rows.slice(0, r + 1), structuredClone(rows[r]!), ...rows.slice(r + 1)])}>⧉</button>
                          <button type="button" className="px-1 text-danger" aria-label={`Remover linha ${r + 1}`} title="Remover" onClick={() => setRows((rows) => (rows.length > 1 ? rows.filter((_, i) => i !== r) : [{}]))}>×</button>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-line-strong bg-paper font-medium">
                  <td className="px-2 py-1.5 text-[12px] text-muted">Σ</td>
                  {def.columns.map((c) => {
                    const t = result.totals.find((x) => x.column === c.key);
                    return <td key={c.key} className="border-l border-line px-2 py-1.5 text-right font-mono">{t ? fmtQty(t.total) : ''}</td>;
                  })}
                  <td />
                  {canEdit && <td />}
                </tr>
              </tfoot>
            </table>
            {def.columns.filter((c) => c.type === 'choice').map((c) => <datalist key={c.key} id={`opt-${c.key}`}>{c.options?.map((o) => <option key={o} value={o} />)}</datalist>)}
          </div>
          {canEdit && (
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <Button onClick={() => { setRows((rows) => [...rows, {}]); focus(draft.rows.length, 0); }}>Adicionar linha</Button>
              <Button variant="ghost" onClick={() => setRows((rows) => [...rows, ...blankRows(10)])}>+10 linhas</Button>
              <span className="text-[12.5px] text-muted">Enter desce · cole blocos copiados da planilha · contas na célula (30,29+10,68) · Ctrl+S salva</span>
            </div>
          )}
          {errorRows.length > 0 && (
            <div className="mt-3"><Notice tone="warn">
              <p className="font-medium">{errorRows.length} linha(s) com problema — não entram nos totais e impedem o lançamento:</p>
              <ul className="list-disc pl-5">{errorRows.slice(0, 12).map((x) => <li key={x.i}>Linha {x.i + 1}: {x.errors.join(' ')}</li>)}</ul>
            </Notice></div>
          )}
        </section>

        <aside className="grid items-start gap-4 lg:grid-cols-2 2xl:grid-cols-4">
          <section aria-label="Saídas" className="border border-line bg-sheet p-3">
            <h2 className="mb-2 font-medium">Saídas → quantitativos</h2>
            <ul className="flex flex-col gap-3">
              {def.outputs.map((o) => {
                const t = result.totals.find((x) => x.key === o.key)!;
                const compatible = services.filter((sv) => { const d = unitDim.get(sv.unitSymbol); return d && compatibleDimensions(d, t.dim); });
                const launchedM = s.measurements.find((m) => m.outputKey === o.key && !m.archived);
                return (
                  <li key={o.key}>
                    <p className="flex justify-between gap-2 text-[13.5px]"><span>{o.label}</span><span className="font-mono">{fmtQty(t.total)} {t.unit}</span></p>
                    <SelectField label={`Serviço de ${o.label}`} value={draft.outputMap[o.key] ?? ''} disabled={!canEdit}
                      onChange={(e) => setDraft((d) => ({ ...d, outputMap: { ...d.outputMap, [o.key]: e.target.value || null } }))}>
                      <option value="">Não lançar</option>
                      {compatible.map((sv) => <option key={sv.id} value={sv.id}>{sv.code} — {sv.description} ({sv.unitSymbol})</option>)}
                    </SelectField>
                    {launchedM && <p className="mt-0.5 text-[12px] text-muted">Lançado: {fmtQty(launchedM.quantity)} {launchedM.unit} · R{launchedM.revision}</p>}
                  </li>
                );
              })}
            </ul>
          </section>

          <section aria-label="Destino" className="flex flex-col gap-3 border border-line bg-sheet p-3">
            <h2 className="font-medium">Destino</h2>
            <TextField label="Filtrar itens da EAP" type="search" value={wbsFilter} onChange={(e) => setWbsFilter(e.target.value)} disabled={!canEdit} />
            <SelectField label="Item da EAP" value={draft.wbsNodeId ?? ''} disabled={!canEdit} onChange={(e) => setDraft((d) => ({ ...d, wbsNodeId: e.target.value || null }))}
              hint={items.length === 0 ? 'A EAP ainda não tem itens quantificáveis. Gere a EAP primeiro.' : undefined}>
              <option value="">Selecione</option>
              {wbsShown.map((n) => <option key={n.id} value={n.id}>{n.code} {n.title}</option>)}
            </SelectField>
            <div>
              <p className="text-[13px] font-medium text-graphite-800">Onde (âncora)</p>
              <p className="text-[13.5px]">{anchorLabel ?? <span className="text-muted">não escolhida</span>}</p>
              {canEdit && !pickAnchor && <Button variant="ghost" onClick={() => setPickAnchor(true)}>{draft.anchor ? 'Alterar âncora' : 'Escolher âncora'}</Button>}
            </div>
            {pickAnchor && (
              <>
                <AnchorPicker projectId={projectId} value={draft.anchor} onChange={(a: AnchorInput | null) => { setDraft((d) => ({ ...d, anchor: a })); setAnchorLabel(a ? 'nova âncora (salve para confirmar)' : null); }} />
                <p className="text-[12.5px] text-muted">Ficha de tipologia: o total vale para cada unidade da tipologia (ex.: × 362 apartamentos).</p>
              </>
            )}
            <TextField label="Documento de origem" value={draft.sourceReference} disabled={!canEdit} onChange={(e) => setDraft((d) => ({ ...d, sourceReference: e.target.value }))} hint="Prancha, memorial ou revisão do projeto" />
          </section>

          {def.params.length > 0 && (
            <section aria-label="Parâmetros" className="flex flex-col gap-2 border border-line bg-sheet p-3">
              <h2 className="font-medium">Parâmetros</h2>
              {def.params.map((pm) => (
                <TextField key={pm.key} label={`${pm.label} (${pm.unit})`} inputMode="decimal" className="font-mono" disabled={!canEdit}
                  value={(draft.params[pm.key] ?? pm.value).replace('.', ',')}
                  hint={draft.params[pm.key] !== undefined && draft.params[pm.key] !== pm.value ? `Padrão do modelo: ${pm.value.replace('.', ',')}` : undefined}
                  onChange={(e) => { const v = e.target.value.replace(',', '.'); setDraft((d) => ({ ...d, params: { ...d.params, [pm.key]: v } })); }} />
              ))}
            </section>
          )}

          {canEdit && (
            <section aria-label="Título e arquivamento" className="flex flex-col gap-2 border border-line bg-sheet p-3">
              <TextField label="Título da ficha" value={draft.title} onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))} />
              <ArchiveButton what="ficha" onConfirm={(reason) => act.run(() => api('POST', `/projects/${projectId}/sheets/${s.id}/archive`, { body: { reason }, version: s.version }))} />
              <p className="text-[12px] text-muted">Arquivar a ficha arquiva também os quantitativos lançados por ela.</p>
            </section>
          )}
          {s.archivedAt && <Button onClick={() => act.run(() => api('POST', `/projects/${projectId}/sheets/${s.id}/unarchive`, { body: {}, version: s.version }))}>Restaurar ficha</Button>}
        </aside>
      </div>

      <SidePanel open={destRow !== null} title={destRow !== null ? `Destino da linha ${destRow + 1}` : 'Destino'} onClose={() => setDestRow(null)}>
        {destRow !== null && (
          <div className="flex flex-col gap-3">
            <p className="text-[13px] text-muted">A linha lança na âncora escolhida aqui (ex.: um trecho, um pavimento, um ambiente da tipologia), no mesmo item da EAP da ficha. Sem destino próprio, vale o destino da ficha.</p>
            <AnchorPicker projectId={projectId} value={destOf(draft.rows[destRow]!)?.anchor ?? null}
              onChange={(a) => setRows((rows) => rows.map((x, i) => (i === destRow ? withDest(x, a ? { anchor: a, label: 'novo destino (salve para confirmar)' } : null) : x)))} />
            <div className="flex gap-2">
              <Button variant="primary" onClick={() => setDestRow(null)}>Aplicar</Button>
              <Button variant="ghost" onClick={() => { setRows((rows) => rows.map((x, i) => (i === destRow ? withDest(x, null) : x))); setDestRow(null); }}>Usar destino da ficha</Button>
            </div>
          </div>
        )}
      </SidePanel>
      {s.measurements.length > 0 && (
        <section aria-label="Quantitativos lançados" className="mt-6 border border-line bg-sheet">
          <h2 className="px-3 py-2 font-medium">Quantitativos lançados</h2>
          <table className="w-full text-left text-[13.5px]">
            <thead className="bg-paper text-[12px] text-muted"><tr><th className="px-3 py-1 font-normal">Saída</th><th className="px-3 py-1 font-normal">Serviço</th><th className="px-3 py-1 text-right font-normal">Quantidade</th><th className="px-3 py-1 font-normal">Rev.</th></tr></thead>
            <tbody>{s.measurements.map((m) => (
              <tr key={m.measurementId} className={`border-t border-line ${m.archived ? 'text-graphite-400' : ''}`}>
                <td className="px-3 py-1.5">{def.outputs.find((o) => o.key === m.outputKey)?.label ?? m.outputKey}{m.archived && ' (arquivado)'}</td>
                <td className="px-3 py-1.5"><span className="font-mono text-[12.5px]">{m.serviceCode}</span> {m.serviceDescription}</td>
                <td className="px-3 py-1.5 text-right font-mono">{fmtQty(m.quantity)} {m.unit}</td>
                <td className="px-3 py-1.5 font-mono">R{m.revision}</td>
              </tr>
            ))}</tbody>
          </table>
        </section>
      )}
      <div className="mt-6"><EntityHistory projectId={projectId} entityId={s.id} /></div>
    </>
  );
}
