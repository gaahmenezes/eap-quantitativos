import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router';
import { SCHEDULE_KINDS, type ScheduleKind, type WorkbookImportDto, type WorkbookPreviewDto, type WorkbookSheetDto, type WorkbookSheetPlan, type WorkbookUpdatableDto, type WorkbookUpdateDiffDto } from '@eapq/contracts';
import { colLetter, projectPermissions, type SheetDef } from '@eapq/domain';
import { Breadcrumbs, PageHeader } from '../../app/shell';
import { useAction } from '../../components/ui/actions';
import { Button } from '../../components/ui/button';
import { ErrorState, Loading, Notice } from '../../components/ui/feedback';
import { SelectField, TextField } from '../../components/ui/field';
import { ConfirmDialog } from '../../components/ui/panel';
import { api, ApiError, errorMessage } from '../../lib/api';
import { fmtDateTime, fmtQty } from '../../lib/format';
import { useSession } from '../auth/session';
import { useProject } from '../projects/api';
import { KIND_LABEL } from '../schedules/api';
import { sheetKeys, useSheetTemplates } from '../sheets/api';
import { scheduleKeys } from '../schedules/api';
import { STATUS, useWorkbookImport, useWorkbookSheet, wbKeys } from './api';

type Plan = WorkbookSheetPlan;
type SheetP = Extract<Plan, { target: 'sheet' }>;
type SchedP = Extract<Plan, { target: 'schedule' }>;
interface Tpl { versionId: string; templateId: string; code: string; name: string; number: number; def: SheetDef }
/** Unidade só da migração: número decimal que é porcentagem (0,35 = 35%). */
const FRACTION = 'fração';

export function WorkbookWizardPage() {
  const { projectId = '', importId = '' } = useParams();
  const { me } = useSession();
  const project = useProject(projectId);
  const w = useWorkbookImport(projectId, importId);
  const templates = useSheetTemplates();
  // problemas da última tentativa de aplicar (sobrevivem à recriação do assistente quando o plano é salvo antes)
  const [applyProblems, setApplyProblems] = useState<{ path: string; message: string }[]>([]);
  if (project.isPending || w.isPending || templates.isPending) return <Loading />;
  if (project.isError) return <ErrorState message={errorMessage(project.error)} />;
  if (w.isError) return <ErrorState message={errorMessage(w.error)} onRetry={() => w.refetch()} />;
  const p = project.data;
  const canEdit = projectPermissions(me!.orgRole, p.myProjectRole).has('project.content.edit') && p.status === 'ACTIVE' && w.data.status === 'DRAFT';
  const tpls: Tpl[] = (templates.data ?? []).filter((t) => !t.archivedAt).flatMap((t) => {
    const v = t.versions.find((x) => x.status === 'PUBLISHED');
    return v ? [{ versionId: v.id, templateId: t.id, code: t.code, name: t.name, number: v.number, def: v.definition as SheetDef }] : [];
  });
  return (
    <>
      <Breadcrumbs items={[{ label: 'Empreendimentos', to: '/empreendimentos' }, { label: p.name, to: `/empreendimentos/${p.id}` }, { label: 'Migração de planilhas', to: `/empreendimentos/${p.id}/migracao` }, { label: w.data.fileName }]} />
      <Wizard key={w.data.version} projectId={p.id} w={w.data} tpls={tpls} canEdit={canEdit} applyProblems={applyProblems} onApplyProblems={setApplyProblems} />
    </>
  );
}

function Wizard({ projectId, w, tpls, canEdit, applyProblems, onApplyProblems }: {
  projectId: string; w: WorkbookImportDto; tpls: Tpl[]; canEdit: boolean; applyProblems: { path: string; message: string }[]; onApplyProblems: (p: { path: string; message: string }[]) => void;
}) {
  const [plans, setPlans] = useState<Plan[]>(() => w.sheets.map((s) => w.plan.find((x) => x.sheetIndex === s.index) ?? { sheetIndex: s.index, target: 'ignore' }));
  const [current, setCurrent] = useState<number>(() => plans.find((x) => x.target !== 'ignore')?.sheetIndex ?? 0);
  const [onlyPlanned, setOnlyPlanned] = useState(false);
  const [previews, setPreviews] = useState<Record<number, WorkbookPreviewDto>>({});
  const [confirm, setConfirm] = useState(false);
  const act = useAction([wbKeys.all(projectId), sheetKeys.all(projectId), scheduleKeys.all(projectId)]);
  const dirty = JSON.stringify(plans.filter((x) => x.target !== 'ignore')) !== JSON.stringify(w.plan.filter((x) => x.target !== 'ignore'));
  const plan = plans.find((x) => x.sheetIndex === current)!;
  const setPlan = (np: Plan) => { setPlans((ps) => ps.map((x) => (x.sheetIndex === np.sheetIndex ? np : x))); setPreviews((pv) => { const { [np.sheetIndex]: _gone, ...rest } = pv; return rest; }); };
  const save = () => act.run(() => api('PUT', `/projects/${projectId}/workbook-imports/${w.id}/plan`, { body: { sheets: plans }, version: w.version }));
  const apply = async () => {
    let version = w.version;
    if (dirty) { if (!(await save())) return; version += 1; }
    onApplyProblems([]);
    await act.run(async () => {
      try { return await api('POST', `/projects/${projectId}/workbook-imports/${w.id}/apply`, { body: {}, version }); } catch (e) {
        if (e instanceof ApiError && e.code === 'WORKBOOK_PLAN_INVALID') onApplyProblems(e.problem.errors ?? []);
        throw e;
      }
    });
  };
  const planned = plans.filter((x) => x.target !== 'ignore');
  const badge = (i: number) => {
    const pv = previews[i];
    if (!pv) return null;
    if (pv.problems.length || pv.rowErrors.length) return <span className="text-danger" title="Há erros">✗</span>;
    if (pv.checks.some((c) => !c.ok)) return <span className="text-warn" title="Conferência com divergências">⚠</span>;
    return <span className="text-ok" title="Conferido">✓</span>;
  };

  if (w.status !== 'DRAFT') return <Result projectId={projectId} w={w} />;
  return (
    <>
      <PageHeader title={w.fileName} actions={canEdit && (
        <div className="flex flex-wrap items-center gap-2">
          {dirty && <span className="text-[13px] text-warn" role="status">Plano não salvo</span>}
          <Button disabled={!dirty} busy={act.pending} onClick={() => void save()}>Salvar plano</Button>
          <Button variant="primary" disabled={!planned.length} busy={act.pending} onClick={() => setConfirm(true)}>Aplicar migração</Button>
          <Button variant="ghost" onClick={() => act.run(() => api('POST', `/projects/${projectId}/workbook-imports/${w.id}/cancel`, { body: {} }))}>Cancelar migração</Button>
        </div>
      )}>
        {STATUS[w.status]} · {w.sheets.length} abas · {planned.length} com destino · enviada por {w.createdBy} em {fmtDateTime(w.createdAt)}
      </PageHeader>
      {act.error && !applyProblems.length && <div className="mb-3"><Notice tone="danger">{act.error}</Notice></div>}
      {applyProblems.length > 0 && (
        <div className="mb-3" role="alert">
          <Notice tone="danger">
            <p className="font-medium">A migração não foi aplicada: {applyProblems.length} problema(s). Corrija ou marque a aba como “Ignorar”.</p>
            <ul className="mt-1 list-disc pl-5">{applyProblems.map((e, i) => {
              const idx = Number(/^sheets\.(\d+)$/.exec(e.path)?.[1] ?? NaN);
              return <li key={i}>{Number.isFinite(idx) ? <button type="button" className="text-left underline" onClick={() => setCurrent(idx)}>{e.message}</button> : e.message}</li>;
            })}</ul>
          </Notice>
        </div>
      )}
      <div className="grid gap-4 lg:grid-cols-[260px_minmax(0,1fr)]">
        <nav aria-label="Abas da planilha" className="self-start border border-line bg-sheet">
          <label className="flex items-center gap-1.5 border-b border-line px-3 py-2 text-[13px]"><input type="checkbox" checked={onlyPlanned} onChange={(e) => setOnlyPlanned(e.target.checked)} /> Só abas com destino</label>
          <ul className="max-h-[70vh] overflow-auto">{plans.filter((x) => !onlyPlanned || x.target !== 'ignore').map((x) => {
            const s = w.sheets.find((y) => y.index === x.sheetIndex)!;
            const upd = x.target !== 'ignore' && x.updateOf ? w.updatable.find((u) => u.id === x.updateOf!.id) : undefined;
            const label = upd ? `Atualiza ${upd.kind === 'sheet' ? 'ficha' : 'quadro'}: ${upd.title}` : x.target === 'sheet' ? `Ficha ${tpls.find((t) => t.versionId === x.templateVersionId)?.code ?? w.updatable.find((u) => u.templateVersionId === x.templateVersionId)?.templateCode ?? ''}` : x.target === 'schedule' ? `Quadro · ${KIND_LABEL[x.scheduleKind]}` : 'Ignorar';
            return (
              <li key={x.sheetIndex}>
                <button type="button" onClick={() => setCurrent(x.sheetIndex)} aria-current={x.sheetIndex === current ? 'true' : undefined}
                  className={`flex w-full items-start justify-between gap-2 border-l-[3px] px-3 py-1.5 text-left ${x.sheetIndex === current ? 'border-signal bg-cyan-wash' : 'border-transparent hover:bg-paper'} ${x.target === 'ignore' ? 'text-graphite-400' : ''}`}>
                  <span><span className="block text-[13.5px]">{s.name}</span><span className="block text-[12px] text-muted">{label}</span></span>
                  {badge(x.sheetIndex)}
                </button>
              </li>
            );
          })}</ul>
        </nav>
        <SheetEditor key={current} projectId={projectId} w={w} plan={plan} tpls={tpls} canEdit={canEdit} onChange={setPlan}
          preview={previews[current] ?? null} onPreview={(r) => setPreviews((pv) => ({ ...pv, [current]: r }))} />
      </div>
      <ConfirmDialog open={confirm} title="Aplicar migração" onClose={() => setConfirm(false)} footer={<>
        <Button variant="ghost" onClick={() => setConfirm(false)}>Voltar</Button>
        <Button variant="primary" busy={act.pending} onClick={async () => { await apply(); setConfirm(false); }}>Aplicar</Button>
      </>}>
        {(() => {
          const upd = planned.filter((x) => 'updateOf' in x && x.updateOf);
          const neu = planned.filter((x) => !('updateOf' in x && x.updateOf));
          return <>
            {neu.length > 0 && <p>Serão criadas {neu.filter((x) => x.target === 'sheet').length} ficha(s) e {neu.filter((x) => x.target === 'schedule').length} quadro(s), com a origem de cada célula.</p>}
            {upd.length > 0 && <p className={neu.length ? 'mt-2' : ''}>Serão atualizados {upd.length} ficha(s)/quadro(s) existentes pela nova versão da planilha: as linhas casadas mantêm o destino por linha e os serviços; as que saíram da planilha são retiradas.</p>}
            <p className="mt-2">Nada é lançado em quantitativos. O que já foi lançado fica “alterado desde o lançamento” até você relançar.</p>
          </>;
        })()}
        {planned.some((x) => !previews[x.sheetIndex]) && <p className="mt-2 text-warn">Há abas ainda não verificadas; a aplicação revalida tudo e recusa se houver erro.</p>}
      </ConfirmDialog>
    </>
  );
}

function Result({ projectId, w }: { projectId: string; w: WorkbookImportDto }) {
  return (
    <>
      <PageHeader title={w.fileName}>{STATUS[w.status]}{w.result && ` em ${fmtDateTime(w.result.appliedAt)}`}</PageHeader>
      {w.status === 'CANCELLED' && <Notice tone="info">Migração cancelada: nada foi criado.</Notice>}
      {w.id.startsWith('local-') && w.status === 'APPLIED' && <div className="mb-3"><Notice tone="info">Demonstração: a planilha passou em todas as validações da aplicação. Nada foi gravado — na aplicação real, as fichas e quadros abaixo seriam criados com a origem de cada célula.</Notice></div>}
      {w.result && (
        <section aria-label="Resultado da migração" className="border border-line bg-sheet">
          <h2 className="px-3 py-2 font-medium">Criado ou atualizado a partir da planilha</h2>
          <table className="w-full text-left text-[13.5px]">
            <thead className="bg-paper text-[12px] text-muted"><tr><th className="px-3 py-1 font-normal">Aba</th><th className="px-3 py-1 font-normal">Resultado</th><th className="px-3 py-1 text-right font-normal">Linhas</th><th className="px-3 py-1 text-right font-normal">Ignoradas</th><th className="px-3 py-1 font-normal">Conferência</th></tr></thead>
            <tbody>{w.result.created.map((c) => (
              <tr key={c.id} className="border-t border-line">
                <td className="px-3 py-1.5">{c.sheetName}</td>
                <td className="px-3 py-1.5">
                  <span className="mr-1 text-[12px] text-muted">{c.action === 'updated' ? 'Atualizado' : 'Criado'}</span>
                  {c.id.startsWith('local-') ? <span>{c.kind === 'sheet' ? 'Ficha' : 'Quadro'}: {c.title}</span> : <Link className="text-cyan-ink hover:underline" to={`/empreendimentos/${projectId}/${c.kind === 'sheet' ? 'fichas' : 'quadros'}/${c.id}`}>{c.kind === 'sheet' ? 'Ficha' : 'Quadro'}: {c.title}</Link>}
                  {c.counts && <span className="block text-[12px] text-muted">{c.counts.added} nova(s) · {c.counts.changed} alterada(s) · {c.counts.removed} retirada(s) · {c.counts.unchanged} igual(is)</span>}
                </td>
                <td className="px-3 py-1.5 text-right font-mono">{c.rows}</td>
                <td className="px-3 py-1.5 text-right font-mono">{c.skipped}</td>
                <td className="px-3 py-1.5">{c.checksOk === null ? <span className="text-muted">sem conferência</span> : c.checksOk ? <span className="text-ok">confere</span> : <span className="text-warn">com divergências</span>}</td>
              </tr>
            ))}</tbody>
          </table>
          <p className="px-3 py-2 text-[13px] text-muted">Próximo passo: nas fichas e quadros criados, escolha o item da EAP e a âncora (e os serviços dos itens dos quadros) e lance; nos atualizados que já estavam lançados, relance para revisar as medições.</p>
        </section>
      )}
    </>
  );
}

const num = (s: string) => (s === '' ? null : Number(s) - 1);

function SheetEditor({ projectId, w, plan, tpls, canEdit, onChange, preview, onPreview }: {
  projectId: string; w: WorkbookImportDto; plan: Plan; tpls: Tpl[]; canEdit: boolean; onChange: (p: Plan) => void; preview: WorkbookPreviewDto | null; onPreview: (r: WorkbookPreviewDto) => void;
}) {
  const info = w.sheets.find((s) => s.index === plan.sheetIndex)!;
  const headerRow = plan.target === 'ignore' ? null : plan.headerRow;
  const sheet = useWorkbookSheet(projectId, w.id, plan.sheetIndex, headerRow);
  const act = useAction([]);
  if (sheet.isPending) return <Loading />;
  if (sheet.isError) return <ErrorState message={errorMessage(sheet.error)} />;
  const s = sheet.data;
  const hr = headerRow ?? s.suggestedHeaderRow;
  const colOpts = s.labels.map((l, i) => ({ value: String(i), label: `${colLetter(i)} — ${l || '(sem título)'}` }));
  const toSheet = (versionId = tpls[0]?.versionId ?? ''): SheetP => ({ sheetIndex: plan.sheetIndex, target: 'sheet', title: info.name, templateVersionId: versionId, headerRow: hr, firstRow: hr + 1, lastRow: null, map: {}, checks: {}, params: {} });
  const toSched = (kind: ScheduleKind = 'OUTROS'): SchedP => ({ sheetIndex: plan.sheetIndex, target: 'schedule', title: info.name, scheduleKind: kind, headerRow: hr, firstRow: hr + 1, lastRow: null, map: { description: 0 }, dimUnit: 'm', defaultUnit: 'un', quantities: [{ col: Math.min(1, s.labels.length - 1), label: 'Unidade' }], check: null });
  const tpl = plan.target === 'sheet' ? tpls.find((t) => t.versionId === plan.templateVersionId) : undefined;
  const mappedCols = new Map<number, string>();
  if (plan.target === 'sheet' && tpl) {
    for (const [k, r] of Object.entries(plan.map)) mappedCols.set(r.col, tpl.def.columns.find((c) => c.key === k)?.label ?? k);
    for (const [k, r] of Object.entries(plan.checks)) mappedCols.set(r.col, `conferir: ${tpl.def.columns.find((c) => c.key === k)?.label ?? k}`);
  } else if (plan.target === 'schedule') {
    const names: Record<string, string> = { code: 'Id', description: 'Descrição', spec: 'Especificação', unit: 'Unidade', width: 'Largura', height: 'Altura' };
    for (const [k, c] of Object.entries(plan.map)) if (c !== undefined) mappedCols.set(c, names[k]!);
    for (const q of plan.quantities) mappedCols.set(q.col, `qtde: ${q.label}`);
    if (plan.check) mappedCols.set(plan.check.col, `conferir × ${plan.check.multiplier}`);
  }
  const verify = async () => { const r = await act.run(() => api<WorkbookPreviewDto>('POST', `/projects/${projectId}/workbook-imports/${w.id}/preview`, { body: { plan } })); if (r && r !== true) onPreview(r); };

  return (
    <section aria-label={`Aba ${info.name}`} className="flex min-w-0 flex-col gap-4">
      <div className="grid gap-3 border border-line bg-sheet p-3 md:grid-cols-3">
        <SelectField label="Destino da aba" value={plan.target} disabled={!canEdit} onChange={(e) => onChange(e.target.value === 'sheet' ? toSheet() : e.target.value === 'schedule' ? toSched() : { sheetIndex: plan.sheetIndex, target: 'ignore' })}>
          <option value="ignore">Ignorar</option><option value="sheet">Ficha de levantamento</option><option value="schedule">Quadro de componentes</option>
        </SelectField>
        {plan.target === 'sheet' && <SelectField label="Modelo de ficha" value={plan.templateVersionId} disabled={!canEdit || !!plan.updateOf} onChange={(e) => onChange({ ...toSheet(e.target.value), title: plan.title, headerRow: plan.headerRow, firstRow: plan.firstRow, lastRow: plan.lastRow })}>
          {tpls.map((t) => <option key={t.versionId} value={t.versionId}>{t.code} R{t.number} — {t.name}</option>)}
          {!tpls.some((t) => t.versionId === plan.templateVersionId) && <option value={plan.templateVersionId}>{w.updatable.find((u) => u.templateVersionId === plan.templateVersionId)?.templateCode ?? 'Modelo'} — versão usada pela ficha</option>}
        </SelectField>}
        {plan.target === 'schedule' && <SelectField label="Tipo de quadro" value={plan.scheduleKind} disabled={!canEdit} onChange={(e) => onChange({ ...plan, scheduleKind: e.target.value as ScheduleKind })}>
          {SCHEDULE_KINDS.map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
        </SelectField>}
        {plan.target !== 'ignore' && <UpdateSelect plan={plan} w={w} tpls={tpls} canEdit={canEdit} onChange={onChange} />}
        {plan.target !== 'ignore' && <TextField label="Título" value={plan.title} disabled={!canEdit || !!plan.updateOf} onChange={(e) => onChange({ ...plan, title: e.target.value })} hint={plan.updateOf ? 'Mantém o título atual.' : undefined} />}
        {plan.target !== 'ignore' && <>
          <TextField label="Linha do cabeçalho" type="number" min={1} value={String(plan.headerRow + 1)} disabled={!canEdit} onChange={(e) => { const v = num(e.target.value); if (v !== null && v >= 0) onChange({ ...plan, headerRow: v, firstRow: Math.max(plan.firstRow, v + 1) }); }} />
          <TextField label="Primeira linha de dados" type="number" min={1} value={String(plan.firstRow + 1)} disabled={!canEdit} onChange={(e) => { const v = num(e.target.value); if (v !== null && v >= 0) onChange({ ...plan, firstRow: v }); }} />
          <TextField label="Última linha (opcional)" type="number" min={1} value={plan.lastRow != null ? String(plan.lastRow + 1) : ''} disabled={!canEdit} onChange={(e) => onChange({ ...plan, lastRow: num(e.target.value) })} hint="Deixe vazio para ir até o fim; linhas de total são ignoradas." />
        </>}
      </div>

      <Grid sheet={s} headerRow={hr} firstRow={plan.target === 'ignore' ? hr + 1 : plan.firstRow} lastRow={plan.target === 'ignore' ? null : plan.lastRow ?? null} mapped={mappedCols} />
      {info.truncated && <Notice tone="warn">Aba grande: só as primeiras 3.000 linhas e 60 colunas foram lidas.</Notice>}

      {plan.target === 'sheet' && tpl && <SheetMapping plan={plan} tpl={tpl} colOpts={colOpts} canEdit={canEdit} onChange={onChange} />}
      {plan.target === 'schedule' && <ScheduleMapping plan={plan} colOpts={colOpts} canEdit={canEdit} onChange={onChange} />}

      {plan.target !== 'ignore' && (
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="primary" busy={act.pending} onClick={() => void verify()}>Verificar aba</Button>
          <span className="text-[12.5px] text-muted">Monta as linhas com o mapeamento e confere os valores recalculados contra a planilha, sem gravar nada.</span>
        </div>
      )}
      {act.error && <Notice tone="danger">{act.error}</Notice>}
      {preview?.update && <UpdateReport u={preview.update} canEdit={canEdit} onUseCurrent={() => plan.target !== 'ignore' && plan.updateOf && onChange({ ...plan, updateOf: { id: plan.updateOf.id, version: preview.update!.currentVersion } })} />}
      {preview && <PreviewReport r={preview} />}
    </section>
  );
}

function Grid({ sheet, headerRow, firstRow, lastRow, mapped }: { sheet: WorkbookSheetDto; headerRow: number; firstRow: number; lastRow: number | null; mapped: Map<number, string> }) {
  const start = Math.max(0, headerRow - 1);
  const rows = sheet.rows.slice(start, start + 40);
  const width = Math.min(Math.max(1, ...rows.map((r) => r.length), sheet.labels.length), 60);
  return (
    <div className="max-h-[420px] overflow-auto border border-line bg-sheet" aria-label="Pré-visualização da aba" role="region">
      <table className="border-collapse text-[12px]">
        <thead className="sticky top-0 z-10 bg-paper">
          <tr>
            <th className="border border-line px-1 text-muted" />
            {Array.from({ length: width }, (_, c) => (
              <th key={c} className={`min-w-[72px] border border-line px-1 py-0.5 text-left font-normal ${mapped.has(c) ? 'bg-cyan-wash' : ''}`}>
                <span className="font-mono text-muted">{colLetter(c)}</span>
                {mapped.has(c) && <span className="block font-medium text-cyan-ink">{mapped.get(c)}</span>}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{rows.map((r, i) => {
          const n = start + i;
          const inData = n >= firstRow && (lastRow === null || n <= lastRow);
          return (
            <tr key={n} className={n === headerRow ? 'bg-signal/15 font-medium' : inData ? '' : 'text-graphite-400'}>
              <td className="border border-line px-1 text-right font-mono text-muted">{n + 1}</td>
              {Array.from({ length: width }, (_, c) => {
                const cell = r[c];
                return <td key={c} title={cell?.f ? `=${cell.f}` : undefined} className={`max-w-[180px] truncate border border-line px-1 ${cell?.num ? 'text-right font-mono' : ''}`}>
                  {cell ? (cell.num ? fmtQty(String(Math.round(Number(cell.v) * 1e6) / 1e6)) : cell.v) : ''}{cell?.f && <sup className="ml-0.5 text-cyan-ink">ƒ</sup>}
                </td>;
              })}
            </tr>
          );
        })}</tbody>
      </table>
    </div>
  );
}

function ColSelect({ label, value, colOpts, canEdit, onChange, allowEmpty = true }: { label: string; value: number | undefined; colOpts: { value: string; label: string }[]; canEdit: boolean; onChange: (v: number | undefined) => void; allowEmpty?: boolean }) {
  return (
    <SelectField label={label} value={value === undefined ? '' : String(value)} disabled={!canEdit} onChange={(e) => onChange(e.target.value === '' ? undefined : Number(e.target.value))}>
      {allowEmpty && <option value="">— não usar —</option>}
      {colOpts.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </SelectField>
  );
}

function SheetMapping({ plan, tpl, colOpts, canEdit, onChange }: { plan: SheetP; tpl: Tpl; colOpts: { value: string; label: string }[]; canEdit: boolean; onChange: (p: Plan) => void }) {
  const set = (field: 'map' | 'checks', key: string, col: number | undefined, unit?: string | null) => {
    const next = { ...plan[field] };
    if (col === undefined) delete next[key]; else next[key] = { col, ...(unit ? { unit } : {}) };
    onChange({ ...plan, [field]: next });
  };
  const unitsFor = (u: string | null | undefined) => (u === 'cm' || u === 'mm' || u === 'm' ? ['m', 'cm', 'mm'] : u === 'm²' ? ['m²', 'cm²'] : u === 'kg' ? ['kg', 't'] : u === '%' ? ['%', FRACTION] : u ? [u] : []);
  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <fieldset className="border border-line bg-sheet p-3">
        <legend className="px-1 font-medium">Colunas da ficha ← colunas da planilha</legend>
        <div className="grid gap-2">
          {tpl.def.columns.filter((c) => c.kind === 'input').map((c) => {
            const m = plan.map[c.key];
            const opts = c.type === 'number' ? unitsFor(c.unit) : [];
            return (
              <div key={c.key} className="grid grid-cols-[minmax(0,1fr)_88px] items-end gap-2">
                <ColSelect label={`${c.label}${c.required ? ' *' : ''}`} value={m?.col} colOpts={colOpts} canEdit={canEdit} onChange={(v) => set('map', c.key, v, m?.unit)} />
                {opts.length > 1 ? (
                  <SelectField label={`Unidade de ${c.label}`} value={m?.unit ?? c.unit ?? ''} disabled={!canEdit || !m} onChange={(e) => set('map', c.key, m?.col, e.target.value === c.unit ? null : e.target.value)}>
                    {opts.map((u) => <option key={u} value={u}>{u === FRACTION ? 'fração (0,35 = 35%)' : u}</option>)}
                  </SelectField>
                ) : <span className="pb-2 font-mono text-[12px] text-muted">{c.unit ?? ''}</span>}
              </div>
            );
          })}
        </div>
      </fieldset>
      <div className="flex flex-col gap-4">
        <fieldset className="border border-line bg-sheet p-3">
          <legend className="px-1 font-medium">Conferência: coluna calculada da ficha × coluna da planilha</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {tpl.def.columns.filter((c) => c.kind === 'calc' && c.type === 'number').map((c) => (
              <ColSelect key={c.key} label={`${c.label} (${c.unit ?? ''})`} value={plan.checks[c.key]?.col} colOpts={colOpts} canEdit={canEdit} onChange={(v) => set('checks', c.key, v)} />
            ))}
          </div>
        </fieldset>
        {tpl.def.params.length > 0 && (
          <fieldset className="border border-line bg-sheet p-3">
            <legend className="px-1 font-medium">Parâmetros da ficha</legend>
            <div className="grid gap-2 sm:grid-cols-2">
              {tpl.def.params.map((pm) => (
                <TextField key={pm.key} label={`${pm.label} (${pm.unit})`} inputMode="decimal" className="font-mono" disabled={!canEdit} value={(plan.params[pm.key] ?? pm.value).replace('.', ',')}
                  onChange={(e) => { const v = e.target.value.replace(',', '.'); const next = { ...plan.params }; if (!v || v === pm.value) delete next[pm.key]; else if (/^-?\d+(\.\d+)?$/.test(v)) next[pm.key] = v; onChange({ ...plan, params: next }); }} />
              ))}
            </div>
          </fieldset>
        )}
      </div>
    </div>
  );
}

function ScheduleMapping({ plan, colOpts, canEdit, onChange }: { plan: SchedP; colOpts: { value: string; label: string }[]; canEdit: boolean; onChange: (p: Plan) => void }) {
  const fields: [keyof SchedP['map'], string][] = [['code', 'Id'], ['description', 'Descrição *'], ['spec', 'Especificação'], ['unit', 'Unidade'], ['width', 'Largura'], ['height', 'Altura']];
  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <fieldset className="border border-line bg-sheet p-3">
        <legend className="px-1 font-medium">Campos do item ← colunas da planilha</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {fields.map(([k, label]) => (
            <ColSelect key={k} label={label} value={plan.map[k]} colOpts={colOpts} canEdit={canEdit} allowEmpty={k !== 'description'}
              onChange={(v) => { const map = { ...plan.map }; if (v === undefined) delete map[k]; else map[k] = v; onChange({ ...plan, map: map as SchedP['map'] }); }} />
          ))}
          <TextField label="Unidade quando não informada" className="font-mono" value={plan.defaultUnit} disabled={!canEdit} onChange={(e) => onChange({ ...plan, defaultUnit: e.target.value })} />
          <SelectField label="Largura/altura na planilha em" value={plan.dimUnit ?? 'm'} disabled={!canEdit} onChange={(e) => onChange({ ...plan, dimUnit: e.target.value })}>
            {['m', 'cm', 'mm'].map((u) => <option key={u} value={u}>{u}</option>)}
          </SelectField>
        </div>
      </fieldset>
      <fieldset className="border border-line bg-sheet p-3">
        <legend className="px-1 font-medium">Quantidades → destinos do quadro</legend>
        <div className="flex flex-col gap-2">
          {plan.quantities.map((q, i) => (
            <div key={i} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] items-end gap-2">
              <ColSelect label={`Coluna da quantidade ${i + 1}`} value={q.col} colOpts={colOpts} canEdit={canEdit} allowEmpty={false} onChange={(v) => onChange({ ...plan, quantities: plan.quantities.map((x, k) => (k === i ? { ...x, col: v! } : x)) })} />
              <TextField label={`Destino ${i + 1}`} value={q.label} disabled={!canEdit} onChange={(e) => onChange({ ...plan, quantities: plan.quantities.map((x, k) => (k === i ? { ...x, label: e.target.value } : x)) })} />
              {canEdit && plan.quantities.length > 1 && <button type="button" className="pb-2 text-danger" aria-label={`Remover destino ${i + 1}`} onClick={() => onChange({ ...plan, quantities: plan.quantities.filter((_, k) => k !== i) })}>×</button>}
            </div>
          ))}
          {canEdit && plan.quantities.length < 10 && <div><Button onClick={() => onChange({ ...plan, quantities: [...plan.quantities, { col: plan.quantities[plan.quantities.length - 1]!.col, label: `Destino ${plan.quantities.length + 1}` }] })}>Outra coluna de quantidade</Button></div>}
          <div className="grid grid-cols-[minmax(0,1fr)_120px] items-end gap-2 border-t border-line pt-2">
            <ColSelect label="Conferir com a coluna de total da obra" value={plan.check?.col} colOpts={colOpts} canEdit={canEdit} onChange={(v) => onChange({ ...plan, check: v === undefined ? null : { col: v, multiplier: plan.check?.multiplier ?? 1 } })} />
            <TextField label="Nº de repetições" type="number" min={1} value={String(plan.check?.multiplier ?? 1)} disabled={!canEdit || !plan.check} onChange={(e) => plan.check && onChange({ ...plan, check: { ...plan.check, multiplier: Math.max(1, Number(e.target.value) || 1) } })} />
          </div>
        </div>
      </fieldset>
    </div>
  );
}

function PreviewReport({ r }: { r: WorkbookPreviewDto }) {
  const keys = useMemo(() => [...new Set(r.sample.flatMap((x) => Object.keys(x.cells)))], [r.sample]);
  return (
    <section aria-label="Verificação da aba" className="flex flex-col gap-3">
      {r.problems.length > 0 && <Notice tone="danger"><ul className="list-disc pl-5">{r.problems.map((p, i) => <li key={i}>{p}</li>)}</ul></Notice>}
      <p className="text-[13.5px]"><strong>{r.rowCount}</strong> linha(s) montada(s) · {r.skipped.length} ignorada(s){r.rowErrors.length > 0 && <span className="text-danger"> · {r.rowErrors.length} com erro</span>}</p>
      {r.totals.length > 0 && <p className="text-[13px]">{r.totals.map((t) => <span key={t.key} className="mr-4">{t.label}: <span className="font-mono">{fmtQty(t.total)} {t.unit}</span></span>)}</p>}
      {r.checks.map((c) => (
        <div key={c.column} className={`border p-3 ${c.ok ? 'border-ok bg-ok-wash' : 'border-warn bg-warn-wash'}`}>
          <p className="font-medium">{c.ok ? 'Confere' : `${c.divergent} linha(s) divergente(s)`} — {c.label}</p>
          <p className="font-mono text-[13px]">planilha {fmtQty(c.expectedTotal)} · recalculado {fmtQty(c.computedTotal)} {c.unit}</p>
          {!c.ok && (
            <table className="mt-2 text-[12.5px]">
              <thead className="text-muted"><tr><th className="pr-3 text-left font-normal">Linha</th><th className="pr-3 text-right font-normal">Planilha</th><th className="pr-3 text-right font-normal">Recalculado</th><th className="text-right font-normal">Δ</th></tr></thead>
              <tbody>{c.rows.filter((x) => !x.ok).slice(0, 15).map((x) => (
                <tr key={x.row}><td className="pr-3 font-mono">{x.row}</td><td className="pr-3 text-right font-mono">{x.expected ? fmtQty(x.expected) : '—'}</td><td className="pr-3 text-right font-mono">{x.computed ? fmtQty(x.computed) : '—'}</td><td className="text-right font-mono">{x.delta ? fmtQty(x.delta) : ''}</td></tr>
              ))}</tbody>
            </table>
          )}
        </div>
      ))}
      {r.rowErrors.length > 0 && <Notice tone="warn"><p className="font-medium">Linhas com erro (corrija o mapeamento ou limite as linhas):</p><ul className="list-disc pl-5">{r.rowErrors.slice(0, 10).map((e) => <li key={e.row}>Linha {e.row}: {e.errors.join(' ')}</li>)}</ul></Notice>}
      {r.skipped.length > 0 && <details className="text-[13px]"><summary className="cursor-pointer">Linhas ignoradas ({r.skipped.length})</summary><ul className="list-disc pl-5">{r.skipped.slice(0, 30).map((x) => <li key={x.row}>Linha {x.row}: {x.reason}</li>)}</ul></details>}
      {r.sample.length > 0 && (
        <details open className="border border-line bg-sheet">
          <summary className="cursor-pointer px-3 py-2 font-medium">Linhas montadas (primeiras {Math.min(r.sample.length, 15)})</summary>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[12.5px]">
              <thead className="bg-paper text-muted"><tr><th className="px-2 py-1 font-normal">Linha</th>{keys.map((k) => <th key={k} className="px-2 py-1 font-normal">{k}</th>)}</tr></thead>
              <tbody>{r.sample.slice(0, 15).map((x) => <tr key={x.row} className="border-t border-line"><td className="px-2 py-1 font-mono">{x.row}</td>{keys.map((k) => <td key={k} className="px-2 py-1 font-mono">{x.cells[k] ?? ''}</td>)}</tr>)}</tbody>
            </table>
          </div>
        </details>
      )}
    </section>
  );
}

/** Criar novo ou atualizar uma ficha/quadro existente (mesmo modelo / mesmo número de colunas de quantidade). */
function UpdateSelect({ plan, w, tpls, canEdit, onChange }: { plan: SheetP | SchedP; w: WorkbookImportDto; tpls: Tpl[]; canEdit: boolean; onChange: (p: Plan) => void }) {
  const templateId = plan.target === 'sheet' ? tpls.find((t) => t.versionId === plan.templateVersionId)?.templateId ?? w.updatable.find((u) => u.templateVersionId === plan.templateVersionId)?.templateId : null;
  const fits = (u: WorkbookUpdatableDto) => (plan.target === 'sheet' ? u.kind === 'sheet' && u.templateId === templateId : u.kind === 'schedule');
  const options = w.updatable.filter(fits);
  const pick = (id: string) => {
    if (!id) { const { updateOf: _u, ...rest } = plan; onChange(rest as Plan); return; }
    const u = w.updatable.find((x) => x.id === id)!;
    if (plan.target === 'sheet') onChange({ ...plan, title: u.title, templateVersionId: u.templateVersionId ?? plan.templateVersionId, updateOf: { id: u.id, version: u.version } });
    else onChange({ ...plan, title: u.title, quantities: u.columns.map((label, i) => ({ col: plan.quantities[i]?.col ?? plan.quantities[plan.quantities.length - 1]!.col, label })), updateOf: { id: u.id, version: u.version } });
  };
  const what = plan.target === 'sheet' ? 'ficha' : 'quadro';
  return (
    <SelectField label="Ação" value={plan.updateOf?.id ?? ''} disabled={!canEdit || (!options.length && !plan.updateOf)} onChange={(e) => pick(e.target.value)}
      hint={options.length ? `Nova versão da planilha? Atualize ${plan.target === 'sheet' ? 'a ficha' : 'o quadro'} em vez de criar outro.` : undefined}>
      <option value="">{plan.target === 'sheet' ? 'Criar nova ficha' : 'Criar novo quadro'}</option>
      {options.map((u) => <option key={u.id} value={u.id}>Atualizar {what}: {u.title}{u.sourceSheetName ? ` (aba ${u.sourceSheetName})` : ''}</option>)}
    </SelectField>
  );
}

const STATUS_LABEL: Record<WorkbookUpdateDiffDto['rows'][number]['status'], [string, string]> = { added: ['Nova', 'text-ok'], removed: ['Retirada', 'text-danger'], changed: ['Alterada', 'text-warn'] };

function UpdateReport({ u, canEdit, onUseCurrent }: { u: WorkbookUpdateDiffDto; canEdit: boolean; onUseCurrent: () => void }) {
  const what = u.kind === 'sheet' ? 'a ficha' : 'o quadro';
  return (
    <section aria-label="Diferenças da atualização" className="flex flex-col gap-3 border border-line bg-sheet p-3">
      <h3 className="font-medium">Atualização d{what} “{u.title}”</h3>
      <p className="text-[13.5px]">
        <span className="text-ok">{u.counts.added} nova(s)</span> · <span className="text-warn">{u.counts.changed} alterada(s)</span> · <span className="text-danger">{u.counts.removed} retirada(s)</span> · {u.counts.unchanged} igual(is)
      </p>
      {u.stale && <Notice tone="warn"><p>{u.kind === 'sheet' ? 'A ficha foi alterada' : 'O quadro foi alterado'} depois que esta atualização foi planejada. Confira as diferenças abaixo (já contra o estado atual) e confirme.</p>{canEdit && <div className="mt-2"><Button onClick={onUseCurrent}>Atualizar sobre a versão atual</Button></div>}</Notice>}
      {u.launched && <Notice tone="info">Já lançado em quantitativos: as medições só mudam quando você relançar {what} depois de aplicar.</Notice>}
      {u.lostLinks > 0 && <Notice tone="warn">{u.lostLinks} linha(s) retirada(s) tinham {u.kind === 'sheet' ? 'destino próprio' : 'serviços'} definidos no sistema; isso se perde com a linha. {u.keptLinks} linha(s) casada(s) mantêm o que tinham.</Notice>}
      {u.totals.length > 0 && (
        <table className="text-[13px]">
          <thead className="text-muted"><tr><th className="pr-4 text-left font-normal">Saída</th><th className="pr-4 text-right font-normal">Atual</th><th className="pr-4 text-right font-normal">Nova versão</th><th className="text-right font-normal">Δ</th></tr></thead>
          <tbody>{u.totals.map((t) => {
            const d = Number(t.after) - Number(t.before);
            return <tr key={t.key}><td className="pr-4">{t.label}</td><td className="pr-4 text-right font-mono">{fmtQty(t.before)} {t.unit}</td><td className="pr-4 text-right font-mono">{fmtQty(t.after)} {t.unit}</td><td className={`text-right font-mono ${d ? (d > 0 ? 'text-ok' : 'text-danger') : 'text-muted'}`}>{d > 0 ? '+' : ''}{fmtQty(String(Math.round(d * 1e6) / 1e6))}</td></tr>;
          })}</tbody>
        </table>
      )}
      {u.rows.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-[13px]">
            <thead className="bg-paper text-[12px] text-muted"><tr><th className="px-2 py-1 font-normal">Situação</th><th className="px-2 py-1 font-normal">Linha</th><th className="px-2 py-1 font-normal">Na planilha</th><th className="px-2 py-1 font-normal">O que muda</th></tr></thead>
            <tbody>{u.rows.map((r, i) => (
              <tr key={i} className="border-t border-line align-top">
                <td className={`px-2 py-1 ${STATUS_LABEL[r.status][1]}`}>{STATUS_LABEL[r.status][0]}</td>
                <td className="px-2 py-1">{r.label}</td>
                <td className="px-2 py-1 font-mono">{r.row ?? '—'}</td>
                <td className="px-2 py-1">{r.changes.map((c, k) => <span key={k} className="block">{c.field}: <span className="font-mono text-muted line-through">{c.before || '∅'}</span> → <span className="font-mono">{c.after || '∅'}</span></span>)}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      ) : <p className="text-[13px] text-muted">Nenhuma linha muda.</p>}
    </section>
  );
}
