/**
 * Planejador da migração (ADR-022/025): sugestão do plano de cada aba e montagem/conferência sem gravar nada.
 * Puro: usado pela API (com os modelos e unidades da organização) e pela demonstração no navegador — a mesma regra
 * nos dois lugares. A atualização de fichas/quadros existentes (que lê o banco) fica na API.
 */
import type { FormulaUnit } from '../formula/formula.js';
import { compileSheet, type SheetDef } from '../sheet/engine.js';
import {
  blockEnd, buildScheduleRows, buildSheetRows, detectDimensionPair, detectUnitColumn, FRACTION, hasNumbers, headerCandidates, headerLabels, looksLikeFraction,
  reconcileSheet, suggestColumns, suggestHeaderRow, suggestTarget, type BuiltSheet, type SchedulePlanInput, type SheetPlan, type SheetReconciliation, type XCell, type XSheet,
} from './workbook.js';

export type ScheduleKindCode = 'ESQUADRIAS' | 'LOUCAS_METAIS' | 'INSTALACOES_HIDRAULICAS' | 'INSTALACOES_ELETRICAS' | 'OUTROS';
interface ColRef { col: number; unit?: string | null }
interface Rows { sheetIndex: number; headerRow: number; firstRow: number; lastRow?: number | null; title: string; updateOf?: { id: string; version: number } | null }
/** Mesmo formato do contrato `WorkbookSheetPlan` (packages/contracts). */
export type MigrationPlan =
  | { sheetIndex: number; target: 'ignore' }
  | (Rows & { target: 'sheet'; templateVersionId: string; map: Record<string, ColRef>; checks: Record<string, ColRef>; params: Record<string, string> })
  | (Rows & {
    target: 'schedule'; scheduleKind: ScheduleKindCode;
    map: { code?: number; description: number; spec?: number; unit?: number; width?: number; height?: number };
    dimUnit?: string | null; defaultUnit: string; quantities: { col: number; label: string }[]; check?: { col: number; multiplier: number } | null;
  });
export type ActiveMigrationPlan = Exclude<MigrationPlan, { target: 'ignore' }>;
export interface PlannerTemplate { versionId: string; templateId: string; code: string; def: SheetDef }

export const MAX_SHEET_ROWS = 2000;
export const MAX_SCHEDULE_ROWS = 1500;

/** Plano sugerido para uma aba: destino pelo nome e cabeçalhos; colunas pelos rótulos. */
export function suggestPlan(s: XSheet, byCode: ReadonlyMap<string, PlannerTemplate>, units: readonly FormulaUnit[]): MigrationPlan {
  const headerRow = suggestHeaderRow(s);
  const labels = headerLabels(s, headerRow);
  const t = suggestTarget(s.name, labels, { unitColumn: detectUnitColumn(s, headerRow + 1, units) !== null });
  if (t.target === 'sheet') {
    const tpl = byCode.get(t.templateCode);
    // aba com mais de um bloco: o cabeçalho é o que mais casa com o modelo
    const options = tpl ? headerCandidates(s).map((h) => suggestSheetPlan(s, h, tpl, units)) : [];
    const best = options.reduce<(typeof options)[number] | null>((b, o) => (!b || o.mapped > b.mapped ? o : b), null);
    if (best && best.mapped >= 2) return best.plan;
    // poucas colunas reconhecidas: talvez seja uma lista de materiais
    return suggestSchedulePlan(s, headerRow, labels, 'OUTROS', units) ?? { sheetIndex: s.index, target: 'ignore' };
  }
  if (t.target === 'schedule') return suggestSchedulePlan(s, headerRow, labels, t.scheduleKind, units) ?? { sheetIndex: s.index, target: 'ignore' };
  return { sheetIndex: s.index, target: 'ignore' };
}

function suggestSheetPlan(s: XSheet, headerRow: number, tpl: PlannerTemplate, units: readonly FormulaUnit[]) {
  const labels = headerLabels(s, headerRow);
  const first = headerRow + 1;
  const map: Record<string, ColRef> = {};
  // dimensões "L x A": peça da cerâmica (em m na planilha), pano do telhado, peça de mármore
  const pair = detectDimensionPair(s, first);
  const pairKeys = tpl.code === 'CER' ? ['peca_l', 'peca_c'] : tpl.code === 'TELHADO' || tpl.code === 'MARM' ? ['comprimento', 'largura'] : null;
  if (pair && pairKeys) { map[pairKeys[0]!] = { col: pair[0], ...(tpl.code === 'CER' && { unit: 'm' }) }; map[pairKeys[1]!] = { col: pair[1], ...(tpl.code === 'CER' && { unit: 'm' }) }; }
  const taken = new Set(Object.values(map).map((m) => m.col));
  const inputs = suggestColumns(labels.map((l, i) => (taken.has(i) ? '' : l)), tpl.def.columns.filter((c) => c.kind === 'input' && !(c.key in map)));
  for (const [k, col] of Object.entries(inputs)) map[k] = { col };
  // porcentagem escrita como fração (cabeçalho "(%)" ou "m/m" com valores 0,35 = 35%)
  for (const c of tpl.def.columns) {
    const m = map[c.key];
    if (c.kind === 'input' && c.unit === '%' && m && !m.unit && /%|m\/m/.test(labels[m.col] ?? '') && looksLikeFraction(s, m.col, first)) map[c.key] = { ...m, unit: FRACTION };
  }
  const used = new Set(Object.values(map).map((m) => m.col));
  // conferência só com cabeçalho bem parecido (evita divergências falsas)
  const calcs = suggestColumns(labels.map((l, i) => (used.has(i) || !hasNumbers(s, i, first) ? '' : l)), tpl.def.columns.filter((c) => c.kind === 'calc'), 0.8);
  // superfícies sem medidas (perímetro × altura): a área de parede da planilha é a entrada, não a conferência
  if (tpl.code === 'SUP' && calcs['parede_liq'] !== undefined && (!map['perimetro'] || !hasNumbers(s, map['perimetro'].col, first))) { map['parede_inf'] = { col: calcs['parede_liq'] }; delete calcs['parede_liq']; }
  // pontuação: colunas numéricas reconhecidas + campos obrigatórios presentes; zero se não sai nenhuma linha
  const numeric = Object.values(map).filter((m) => hasNumbers(s, m.col, first)).length;
  const required = tpl.def.columns.filter((c) => c.kind === 'input' && c.required).every((c) => c.key in map) ? 1 : 0;
  const lastRow = blockEnd(s, headerRow);
  const rows = numeric ? buildSheetRows(s, { headerRow, firstRow: first, lastRow, map }, tpl.def, units).rows.length : 0;
  const mapped = rows ? numeric + required : 0;
  const plan: MigrationPlan = {
    sheetIndex: s.index, headerRow, firstRow: first, lastRow, title: s.name, target: 'sheet', templateVersionId: tpl.versionId, map,
    checks: Object.fromEntries(Object.entries(calcs).map(([k, col]) => [k, { col }])), params: {},
  };
  return { plan, mapped };
}

function suggestSchedulePlan(s: XSheet, headerRow: number, labels: string[], scheduleKind: ScheduleKindCode, units: readonly FormulaUnit[]): MigrationPlan | null {
  const m = suggestColumns(labels, [{ key: 'code', label: 'Id' }, { key: 'description', label: 'Descrição' }, { key: 'spec', label: 'Especificação' }, { key: 'unit', label: 'Unidade' }, { key: 'width', label: 'Largura' }, { key: 'height', label: 'Altura' }]);
  const pair = detectDimensionPair(s, headerRow + 1);
  if (pair && m['width'] === undefined && m['height'] === undefined) { m['width'] = pair[0]; m['height'] = pair[1]; }
  if (m['unit'] === undefined) { const u = detectUnitColumn(s, headerRow + 1, units, new Set(Object.values(m))); if (u !== null) m['unit'] = u; }
  // sem coluna "Descrição": a primeira coluna de texto (ex.: "Tipologia", "Elemento")
  if (m['description'] === undefined) {
    const used0 = new Set(Object.values(m));
    const first = labels.findIndex((l, i) => !!l && !used0.has(i) && s.rows.slice(headerRow + 1, headerRow + 30).some((r) => r[i] && !r[i]!.num && r[i]!.v.trim()));
    if (first >= 0) m['description'] = first;
  }
  const used = new Set(Object.values(m));
  const q = suggestColumns(labels.map((l, i) => (used.has(i) || !hasNumbers(s, i, headerRow + 1) ? '' : l)), [{ key: 'qty', label: 'Quantidade' }]);
  if (m['description'] === undefined || q['qty'] === undefined) return null;
  const plan = { sheetIndex: s.index, headerRow, firstRow: headerRow + 1, lastRow: null, title: s.name, target: 'schedule' as const, scheduleKind, map: m as { description: number }, dimUnit: 'm', defaultUnit: 'un', quantities: [{ col: q['qty'], label: 'Unidade' }], check: null };
  // sugestão que não monta nenhum item não é sugestão: a aba fica para o usuário decidir
  return buildSchedulePlan(s, plan, units).built!.rows.length ? plan : null;
}

export type SheetBuild = { kind: 'sheet'; problems: string[]; built: BuiltSheet | null; rec: SheetReconciliation | null };
export type ScheduleBuild = { kind: 'schedule'; problems: string[]; built: ReturnType<typeof buildScheduleRows> | null };

/** Problemas do plano que impedem montar a aba (antes de olhar as linhas). */
export function planProblems(plan: ActiveMigrationPlan, units: readonly FormulaUnit[], tpl?: PlannerTemplate): string[] {
  const problems: string[] = [];
  if (plan.firstRow <= plan.headerRow) problems.push('A primeira linha de dados deve vir depois do cabeçalho.');
  const has = (u: string) => units.some((x) => x.symbol === u);
  if (plan.target === 'sheet') {
    if (!tpl) return [...problems, 'Modelo de ficha não encontrado.'];
    problems.push(...compileSheet(tpl.def, units).issues.map((i) => i.message));
    for (const k of Object.keys(plan.map)) if (!tpl.def.columns.some((c) => c.key === k && c.kind === 'input')) problems.push(`Coluna de entrada inexistente no modelo: ${k}.`);
    for (const k of Object.keys(plan.checks)) if (!tpl.def.columns.some((c) => c.key === k && c.kind === 'calc')) problems.push(`Coluna calculada inexistente no modelo: ${k}.`);
    for (const r of [...Object.values(plan.map), ...Object.values(plan.checks)]) if (r.unit && r.unit !== FRACTION && !has(r.unit)) problems.push(`Unidade não cadastrada: ${r.unit}.`);
  } else {
    if (!has(plan.defaultUnit)) problems.push(`Unidade não cadastrada: ${plan.defaultUnit}.`);
    if (plan.dimUnit && !has(plan.dimUnit)) problems.push(`Unidade não cadastrada: ${plan.dimUnit}.`);
  }
  return problems;
}

/** Monta e confere uma ficha conforme o plano (parâmetros: os do plano, ou os da ficha que será atualizada). */
export function buildSheetPlan(s: XSheet, plan: Extract<MigrationPlan, { target: 'sheet' }>, tpl: PlannerTemplate, units: readonly FormulaUnit[], params: Record<string, string> = plan.params): SheetBuild {
  const sp: SheetPlan = { headerRow: plan.headerRow, firstRow: plan.firstRow, lastRow: plan.lastRow ?? null, map: plan.map, checks: plan.checks };
  const built = buildSheetRows(s, sp, tpl.def, units);
  const rec = reconcileSheet(s, sp, built, tpl.def, units, params);
  const problems: string[] = [];
  if (!built.rows.length) problems.push('Nenhuma linha de dados encontrada com o mapeamento escolhido.');
  if (built.rows.length > MAX_SHEET_ROWS) problems.push(`A aba gera mais de ${MAX_SHEET_ROWS} linhas.`);
  return { kind: 'sheet', problems, built, rec };
}

export function buildSchedulePlan(s: XSheet, plan: Extract<MigrationPlan, { target: 'schedule' }>, units: readonly FormulaUnit[]): ScheduleBuild {
  const sp: SchedulePlanInput = { headerRow: plan.headerRow, firstRow: plan.firstRow, lastRow: plan.lastRow ?? null, map: plan.map, dimUnit: plan.dimUnit ?? 'm', defaultUnit: plan.defaultUnit, quantities: plan.quantities, check: plan.check ?? null };
  const built = buildScheduleRows(s, sp, units);
  const problems: string[] = [];
  if (!built.rows.length) problems.push('Nenhum item encontrado com o mapeamento escolhido.');
  if (built.rows.length > MAX_SCHEDULE_ROWS) problems.push(`A aba gera mais de ${MAX_SCHEDULE_ROWS} itens.`);
  return { kind: 'schedule', problems, built };
}

/** Relatório da verificação (mesmo formato de `WorkbookPreviewDto`, sem a parte de atualização). */
export function previewOf(plan: ActiveMigrationPlan, b: SheetBuild | ScheduleBuild, problems: string[]) {
  const base = { sheetIndex: plan.sheetIndex, target: plan.target, problems };
  if (b.kind === 'sheet') {
    return {
      ...base, rowCount: b.built?.rows.length ?? 0,
      sample: (b.built?.rows ?? []).slice(0, 50).map((r, i) => ({ row: b.built!.sourceRows[i]!, cells: Object.fromEntries(Object.entries(r).map(([k, c]) => [k, c?.v ?? ''])) })),
      skipped: b.built?.skipped ?? [], rowErrors: b.rec?.rowErrors ?? [], checks: b.rec?.checks ?? [], totals: b.rec?.totals ?? [],
    };
  }
  const sb = b.built;
  return {
    ...base, rowCount: sb?.rows.length ?? 0,
    sample: (sb?.rows ?? []).slice(0, 50).map((r) => ({ row: r.sourceRow, cells: { code: r.code ?? '', description: r.description, spec: r.spec ?? '', unit: r.unit, width: r.width ?? '', height: r.height ?? '', ...r.cells } })),
    skipped: sb?.skipped ?? [], rowErrors: [] as { row: number; errors: string[] }[], checks: sb?.check ? [sb.check] : [], totals: [] as { key: string; label: string; total: string; unit: string }[],
  };
}

// ------------------------------------------------------------------ extrato (sem depender do leitor de XLSX)

/** O mínimo de uma pasta de trabalho do exceljs que o extrato usa (a API e o navegador passam o objeto real). */
export interface CellLike { address: string; value: unknown; isMerged: boolean; master?: { address: string }; formula?: string }
export interface WorksheetLike { name: string; rowCount: number; columnCount: number; getRow(r: number): { getCell(c: number): CellLike } }
export const EXTRACT_LIMITS = { sheets: 200, rows: 3000, cols: 60 } as const;

export function extractCell(cell: CellLike): XCell | null {
  // célula mesclada: só a mestre carrega o valor (o exceljs repete o valor nas demais)
  if (cell.isMerged && cell.master && cell.master.address !== cell.address) return null;
  const raw = cell.value;
  if (raw === null || raw === undefined) return null;
  let f: string | undefined;
  let v: unknown = raw;
  if (typeof raw === 'object' && !(raw instanceof Date)) {
    const o = raw as Record<string, unknown>;
    if ('formula' in o || 'sharedFormula' in o) {
      try { f = cell.formula || undefined; } catch { f = undefined; }
      v = o['result'] ?? null;
      if (v && typeof v === 'object' && 'error' in (v as object)) v = null;
    } else if (Array.isArray(o['richText'])) v = (o['richText'] as { text: string }[]).map((r) => r.text).join('');
    else if ('text' in o) v = String(o['text'] ?? '');
    else if ('error' in o) v = null;
  }
  if (v instanceof Date) return { v: v.toISOString().slice(0, 10), ...(f && { f }) };
  if (typeof v === 'number') return Number.isFinite(v) ? { v: String(v), num: true, ...(f && { f }) } : null;
  if (typeof v === 'boolean') return { v: v ? 'verdadeiro' : 'falso' };
  if (typeof v === 'string') return v.trim() || f ? { v: v.slice(0, 500), ...(f && { f }) } : null;
  return f ? { v: '', f } : null;
}

/** Extrato das abas: valores calculados e texto das fórmulas, sem executar nada; limites por aba. */
export function extractSheets(worksheets: readonly WorksheetLike[]): XSheet[] {
  return worksheets.map((ws, index) => {
    const rows: (XCell | null)[][] = [];
    const maxRow = Math.min(ws.rowCount, EXTRACT_LIMITS.rows);
    const maxCol = Math.min(ws.columnCount, EXTRACT_LIMITS.cols);
    for (let r = 1; r <= maxRow; r++) {
      const row = ws.getRow(r);
      const out: (XCell | null)[] = [];
      for (let c = 1; c <= maxCol; c++) out.push(extractCell(row.getCell(c)));
      while (out.length && out[out.length - 1] === null) out.pop();
      rows.push(out);
    }
    while (rows.length && rows[rows.length - 1]!.length === 0) rows.pop();
    return { index, name: ws.name.slice(0, 100), rows, truncated: ws.rowCount > EXTRACT_LIMITS.rows || ws.columnCount > EXTRACT_LIMITS.cols };
  });
}
