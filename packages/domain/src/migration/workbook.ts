/**
 * Migração de planilhas de levantamento (F12, ADR-022): cada aba de uma pasta de trabalho vira uma ficha
 * (ADR-020) ou um quadro (ADR-021). Funções puras sobre um extrato da aba (valores e fórmulas em texto —
 * nenhuma fórmula é executada): sugestão de destino e de mapeamento, montagem das linhas e conferência
 * dos totais recalculados contra os valores que a planilha tinha.
 */
import { Decimal } from 'decimal.js';
import type { FormulaUnit } from '../formula/formula.js';
import { compileSheet, computeSheet, evaluateCellNumber, isBlankRow, type SheetDef, type SheetRowInput } from '../sheet/engine.js';

const D = Decimal.clone({ precision: 34, rounding: Decimal.ROUND_HALF_UP });

/** Célula do extrato: `v` é o valor (número em texto com ponto, ou texto); `f`, a fórmula sem "=". */
export interface XCell { v: string; num?: boolean; f?: string }
export interface XSheet { index: number; name: string; rows: (XCell | null)[][]; truncated?: boolean }

export const colLetter = (i: number): string => (i < 26 ? String.fromCharCode(65 + i) : colLetter(Math.floor(i / 26) - 1) + String.fromCharCode(65 + (i % 26)));
export const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9²³]+/g, ' ').trim();

/** Fórmula só com números e + − × ÷ ( ): vira conta na célula (preserva a memória, ex.: 29,11+53,35). */
const ARITH = /^[\d.\s+\-*/()]+$/;
export function cellInput(c: XCell | null | undefined): string {
  if (!c) return '';
  if (c.f && ARITH.test(c.f) && /\d/.test(c.f)) {
    const expr = c.f.replace(/\s+/g, '');
    return expr;
  }
  return c.v.trim();
}
const cellNumber = (c: XCell | null | undefined): Decimal | null => {
  if (!c) return null;
  if (c.num) return new D(c.v);
  const t = c.v.trim().replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.');
  return /^-?\d+(\.\d+)?$/.test(t) ? new D(t) : null;
};

const TOTAL_RE = /\b(sub ?total|total|soma)\b/;
/** Linha de total da planilha: texto "total"/"subtotal" ou fórmula SOMA/SUBTOTAL. */
export const isTotalRow = (row: (XCell | null)[]) => row.some((c) => c && ((!c.num && TOTAL_RE.test(norm(c.v))) || (c.f && /^(SUM|SUBTOTAL|SOMA)\(/i.test(c.f.trim()))));

/** Linha de cabeçalho provável: a com mais rótulos de texto entre as 20 primeiras, seguida de números. */
export function suggestHeaderRow(s: XSheet): number {
  let best = 0; let score = -1;
  for (let r = 0; r < Math.min(s.rows.length, 20); r++) {
    const texts = new Set((s.rows[r] ?? []).filter((c) => c && !c.num && !c.f && c.v.trim().length >= 2).map((c) => norm(c!.v))).size;
    const nextHasNumbers = s.rows.slice(r + 1, r + 4).some((row) => (row ?? []).some((c) => c?.num));
    if (texts >= 2 && nextHasNumbers && texts > score) { best = r; score = texts; }
  }
  return best;
}

/** Rótulos das colunas: texto do cabeçalho (ou da linha de cima, em cabeçalhos mesclados). */
export function headerLabels(s: XSheet, headerRow: number): string[] {
  const width = Math.max(0, ...s.rows.slice(0, headerRow + 40).map((r) => r?.length ?? 0));
  return Array.from({ length: width }, (_, i) => {
    const h = s.rows[headerRow]?.[i];
    const up = headerRow > 0 ? s.rows[headerRow - 1]?.[i] : null;
    const t = h && !h.num ? h.v : up && !up.num ? up.v : '';
    return t.replace(/\s+/g, ' ').trim();
  });
}

// ------------------------------------------------------------------ destino sugerido

export type SuggestedTarget = { target: 'sheet'; templateCode: string } | { target: 'schedule'; scheduleKind: 'ESQUADRIAS' | 'LOUCAS_METAIS' | 'INSTALACOES_HIDRAULICAS' | 'INSTALACOES_ELETRICAS' | 'OUTROS' } | { target: 'ignore' };
const RULES: [RegExp, SuggestedTarget][] = [
  [/esquad|portas?\b|janela/, { target: 'schedule', scheduleKind: 'ESQUADRIAS' }],
  [/louca|metais/, { target: 'schedule', scheduleKind: 'LOUCAS_METAIS' }],
  [/hidraul|hidross|rdu material/, { target: 'schedule', scheduleKind: 'INSTALACOES_HIDRAULICAS' }],
  [/eletric|eletrico/, { target: 'schedule', scheduleKind: 'INSTALACOES_ELETRICAS' }],
  [/ceram|piso|revest/, { target: 'sheet', templateCode: 'CER' }],
  [/drenag|esgoto|rede de agua|rede agua/, { target: 'sheet', templateCode: 'REDE' }],
  [/telhado|cobert/, { target: 'sheet', templateCode: 'TELHADO' }],
  [/concreto|forma|estrutura/, { target: 'sheet', templateCode: 'CONC' }],
  [/\baco\b/, { target: 'sheet', templateCode: 'ACO' }],
  [/alvenaria|pintura|chapisco|emboco|alv\b|drywall/, { target: 'sheet', templateCode: 'PAREDE' }],
  [/consideracoes|planilha1|resumo|sienge|custo|orcament|preco/, { target: 'ignore' }],
];
export function suggestTarget(name: string, labels: string[] = []): SuggestedTarget {
  const n = norm(name);
  const t = RULES.find(([re]) => re.test(n))?.[1] ?? { target: 'ignore' };
  // aba de rede com colunas "unidade" e "quantidade" é lista de materiais (quadro), não ficha de cálculo
  const ls = labels.map(norm);
  const isList = ls.some((l) => /^(und|unid|unidade|un|um)$/.test(l)) && ls.some((l) => /^(quantidade|qtde|qtd)\b/.test(l));
  if (t.target === 'sheet' && t.templateCode === 'REDE' && isList) return { target: 'schedule', scheduleKind: 'OUTROS' };
  return t;
}

// ------------------------------------------------------------------ mapeamento sugerido

const SYNONYMS: Record<string, string[]> = {
  ambiente: ['ambiente', 'local', 'comodo'], tipo: ['tipologia', 'tipo'], pecas: ['pecas', 'pecas ambiente', 'qtde pecas'],
  area_geo: ['area geometrica', 'area gemometrica', 'area de projeto'], perimetro: ['perimetro'], altura: ['altura', 'h parede', 'h rodape', 'altura paredes'],
  desconto: ['desconto', 'area de desconto'], paginacao: ['paginacao', 'utilizou paginacao'], comprimento: ['comprimento', 'extensao', 'dimensao', 'perimetro'],
  largura: ['largura'], quantidade: ['quantidade', 'qtde', 'qtd'], elemento: ['elemento', 'identificacao', 'descricao'], espessura: ['espessura', 'espessura do concreto'],
  area_laje: ['area lajes', 'area laje'], trecho: ['trecho', 'pv', 'id'], dn: ['dn', 'diametro', 'diametro nominal'], inclinacao: ['inclinacao', 'declividade'],
  profundidade: ['profundidade', 'prof'], material: ['material'], bitola: ['bitola', 'diametro'], tela: ['tela'], pano: ['id', 'pano', 'peca'],
  // quadros
  code: ['id', 'codigo', 'cod'], description: ['descricao', 'elemento', 'item', 'descricao do material'], spec: ['tipo', 'especificacao', 'modelo', 'dimensao'],
  unit: ['unidade', 'un', 'und', 'unid', 'um'], width: ['largura'], height: ['altura'], qty: ['quantidade', 'qtde', 'qtd', 'qtde casa', 'quantidade unitaria', 'qtde und'],
};
const score = (label: string, candidates: string[]) => {
  const l = norm(label);
  if (!l) return 0;
  let best = 0;
  for (const c of candidates.map(norm)) {
    if (l === c) return 1;
    const lt = new Set(l.split(' ')); const ct = c.split(' ');
    const hit = ct.filter((t) => lt.has(t)).length;
    if (hit) best = Math.max(best, hit / Math.max(ct.length, lt.size) + (l.startsWith(c) ? 0.2 : 0));
  }
  return best;
};
/** Sugere a coluna da planilha para cada campo (cada coluna usada uma vez; pontuação mínima 0,5). */
export function suggestColumns(labels: string[], fields: { key: string; label: string }[]): Record<string, number> {
  const pairs: { key: string; col: number; s: number }[] = [];
  for (const f of fields) labels.forEach((l, col) => { const s = score(l, [f.label, f.key.replace(/_/g, ' '), ...(SYNONYMS[f.key] ?? [])]); if (s >= 0.5) pairs.push({ key: f.key, col, s }); });
  pairs.sort((a, b) => b.s - a.s || a.col - b.col);
  const out: Record<string, number> = {}; const used = new Set<number>();
  for (const p of pairs) if (!(p.key in out) && !used.has(p.col)) { out[p.key] = p.col; used.add(p.col); }
  return out;
}

// ------------------------------------------------------------------ ficha

export interface ColumnRef { col: number; unit?: string | null }
export interface SheetPlan {
  headerRow: number;
  firstRow: number;
  lastRow?: number | null;
  /** Coluna de entrada da ficha → coluna da planilha (e unidade dessa coluna, se diferente). */
  map: Record<string, ColumnRef>;
  /** Coluna calculada da ficha → coluna da planilha com o valor esperado (conferência). */
  checks?: Record<string, ColumnRef>;
}
export interface Skipped { row: number; reason: string }
export interface BuiltSheet { rows: SheetRowInput[]; sourceRows: number[]; skipped: Skipped[] }

const unitOf = (units: readonly FormulaUnit[], s: string | null | undefined) => (s ? units.find((u) => u.symbol === s) : undefined);
const convert = (text: string, from: FormulaUnit, to: FormulaUnit): string => {
  const v = evaluateCellNumber(text);
  return v.times(from.factor).div(to.factor).toDecimalPlaces(10).toFixed();
};

export function buildSheetRows(s: XSheet, plan: SheetPlan, def: SheetDef, units: readonly FormulaUnit[]): BuiltSheet {
  const rows: SheetRowInput[] = []; const sourceRows: number[] = []; const skipped: Skipped[] = [];
  const last = Math.min(plan.lastRow ?? s.rows.length - 1, s.rows.length - 1);
  const mappedCols = Object.values(plan.map).map((m) => m.col);
  for (let r = plan.firstRow; r <= last; r++) {
    const src = s.rows[r] ?? [];
    if (!mappedCols.some((c) => cellInput(src[c]))) continue; // linha vazia nas colunas usadas
    if (isTotalRow(src)) { skipped.push({ row: r + 1, reason: 'Linha de total da planilha' }); continue; }
    const out: SheetRowInput = {};
    let problem: string | null = null;
    for (const col of def.columns.filter((c) => c.kind === 'input')) {
      const m = plan.map[col.key];
      if (!m) continue;
      let text = cellInput(src[m.col]);
      if (!text) continue;
      if (col.type === 'number') {
        const from = unitOf(units, m.unit); const to = unitOf(units, col.unit ?? 'un');
        try {
          if (from && to && from.symbol !== to.symbol) text = convert(text, from, to);
          else evaluateCellNumber(text);
        } catch { problem = `${col.label}: valor "${text}" não é número (célula ${colLetter(m.col)}${r + 1})`; }
      } else if (col.type === 'choice') {
        const opt = (col.options ?? []).find((o) => norm(o) === norm(text));
        if (opt) text = opt;
      }
      out[col.key] = { v: text, ref: `${s.name}!${colLetter(m.col)}${r + 1}` };
    }
    if (problem) { skipped.push({ row: r + 1, reason: problem }); continue; }
    if (isBlankRow(out)) continue;
    rows.push(out); sourceRows.push(r + 1);
  }
  return { rows, sourceRows, skipped };
}

export interface CheckRow { row: number; expected: string | null; computed: string | null; delta: string | null; ok: boolean }
export interface CheckResult { column: string; label: string; unit: string; rows: CheckRow[]; expectedTotal: string; computedTotal: string; ok: boolean; divergent: number }
export interface SheetReconciliation { checks: CheckResult[]; rowErrors: { row: number; errors: string[] }[]; totals: { key: string; label: string; total: string; unit: string }[] }

/** Tolerância da conferência: 0,001 na unidade da coluna (ou 1 milionésimo do valor). */
export const within = (a: Decimal, b: Decimal) => a.minus(b).abs().lte(Decimal.max(new D('0.001'), b.abs().times('0.000001')));
const fmt = (d: Decimal) => d.toDecimalPlaces(10).toFixed();

export function reconcileSheet(s: XSheet, plan: SheetPlan, built: BuiltSheet, def: SheetDef, units: readonly FormulaUnit[], params: Record<string, string> = {}): SheetReconciliation {
  const res = computeSheet(compileSheet(def, units), built.rows, params);
  const checks: CheckResult[] = Object.entries(plan.checks ?? {}).map(([key, ref]) => {
    const col = def.columns.find((c) => c.key === key)!;
    const from = unitOf(units, ref.unit); const to = unitOf(units, col.unit ?? null);
    let exp = new D(0); let comp = new D(0); let divergent = 0;
    const rows = built.sourceRows.map((row, i) => {
      let e = cellNumber(s.rows[row - 1]?.[ref.col]);
      if (e && from && to && from.symbol !== to.symbol) e = e.times(from.factor).div(to.factor);
      const cv = res.rows[i]!.cells[key]?.value;
      const c = cv != null && !res.rows[i]!.errors.length ? new D(cv) : null;
      if (e) exp = exp.plus(e);
      if (c) comp = comp.plus(c);
      const ok = !!e && !!c ? within(c, e) : !e && (!c || c.isZero());
      if (!ok) divergent++;
      return { row, expected: e ? fmt(e) : null, computed: c ? fmt(c) : null, delta: e && c ? fmt(c.minus(e)) : null, ok };
    });
    return { column: key, label: col.label, unit: col.unit ?? '', rows, expectedTotal: fmt(exp), computedTotal: fmt(comp), ok: divergent === 0, divergent };
  });
  return {
    checks,
    rowErrors: res.rows.flatMap((r, i) => (r.errors.length ? [{ row: built.sourceRows[i]!, errors: r.errors }] : [])),
    totals: res.totals.map((t) => ({ key: t.key, label: t.label, total: t.total, unit: t.unit })),
  };
}

// ------------------------------------------------------------------ quadro

export interface SchedulePlanInput {
  headerRow: number;
  firstRow: number;
  lastRow?: number | null;
  map: Partial<Record<'code' | 'description' | 'spec' | 'unit' | 'width' | 'height', number>>;
  /** Unidade de largura/altura na planilha (m por padrão). */
  dimUnit?: string | null;
  defaultUnit: string;
  /** Colunas de quantidade → destinos do quadro. */
  quantities: { col: number; label: string }[];
  /** Conferência: coluna com o total da obra e o número de repetições usado na planilha. */
  check?: { col: number; multiplier: number } | null;
}
export interface BuiltScheduleRow { key: string; code: string | null; description: string; spec: string | null; unit: string; width: string | null; height: string | null; cells: Record<string, string>; sourceRow: number }

const UNIT_ALIASES: Record<string, string> = { und: 'un', unid: 'un', unidade: 'un', un: 'un', pc: 'pç', 'pç': 'pç', peca: 'pç', pecas: 'pç', m: 'm', ml: 'm', metro: 'm', m2: 'm²', 'm²': 'm²', m3: 'm³', 'm³': 'm³', kg: 'kg', cj: 'cj', conj: 'cj', pt: 'pt', ponto: 'pt', vb: 'vb', l: 'L' };
export function normalizeUnit(raw: string, units: readonly FormulaUnit[]): string | null {
  const t = raw.trim();
  if (units.some((u) => u.symbol === t)) return t;
  const a = UNIT_ALIASES[norm(t).replace(/ /g, '')] ?? UNIT_ALIASES[t.toLowerCase()];
  return a && units.some((u) => u.symbol === a) ? a : null;
}

export function buildScheduleRows(s: XSheet, plan: SchedulePlanInput, units: readonly FormulaUnit[]): { rows: BuiltScheduleRow[]; skipped: Skipped[]; check: CheckResult | null } {
  const rows: BuiltScheduleRow[] = []; const skipped: Skipped[] = [];
  const last = Math.min(plan.lastRow ?? s.rows.length - 1, s.rows.length - 1);
  const dim = unitOf(units, plan.dimUnit ?? 'm'); const m = unitOf(units, 'm');
  const text = (src: (XCell | null)[], c: number | undefined) => (c === undefined ? '' : (src[c]?.v ?? '').trim());
  const dimText = (src: (XCell | null)[], c: number | undefined) => {
    const n = c === undefined ? null : cellNumber(src[c]);
    if (!n || n.lte(0)) return null;
    return dim && m && dim.symbol !== 'm' ? fmt(n.times(dim.factor).div(m.factor)) : fmt(n);
  };
  let exp = new D(0); let comp = new D(0); const checkRows: CheckRow[] = []; let divergent = 0;
  for (let r = plan.firstRow; r <= last; r++) {
    const src = s.rows[r] ?? [];
    const description = text(src, plan.map.description);
    const qtys = plan.quantities.map((q) => cellInput(src[q.col]));
    if (isTotalRow(src)) { skipped.push({ row: r + 1, reason: 'Linha de total da planilha' }); continue; }
    if (!description && !qtys.some(Boolean)) continue;
    if (!description) { skipped.push({ row: r + 1, reason: 'Sem descrição' }); continue; }
    if (!qtys.some(Boolean)) { skipped.push({ row: r + 1, reason: 'Sem quantidade (título de grupo?)' }); continue; }
    const rawUnit = text(src, plan.map.unit);
    const unit = rawUnit ? normalizeUnit(rawUnit, units) : plan.defaultUnit;
    if (!unit) { skipped.push({ row: r + 1, reason: `Unidade não reconhecida: ${rawUnit}` }); continue; }
    const cells: Record<string, string> = {};
    plan.quantities.forEach((q, i) => { if (qtys[i]) cells[`d${i + 1}`] = qtys[i]!; });
    rows.push({ key: `r${r + 1}`, code: text(src, plan.map.code) || null, description: description.slice(0, 200), spec: text(src, plan.map.spec).slice(0, 200) || null, unit, width: dimText(src, plan.map.width), height: dimText(src, plan.map.height), cells, sourceRow: r + 1 });
    if (plan.check) {
      const e = cellNumber(src[plan.check.col]);
      let c = new D(0); let valid = true;
      for (const v of Object.values(cells)) { try { c = c.plus(evaluateCellNumber(v)); } catch { valid = false; } }
      c = c.times(plan.check.multiplier);
      if (e) exp = exp.plus(e);
      comp = comp.plus(c);
      const ok = valid && (e ? within(c, e) : c.isZero());
      if (!ok) divergent++;
      checkRows.push({ row: r + 1, expected: e ? fmt(e) : null, computed: valid ? fmt(c) : null, delta: e && valid ? fmt(c.minus(e)) : null, ok });
    }
  }
  const check = plan.check ? { column: 'qty', label: `Quantidade × ${plan.check.multiplier}`, unit: '', rows: checkRows, expectedTotal: fmt(exp), computedTotal: fmt(comp), ok: divergent === 0, divergent } : null;
  return { rows, skipped, check };
}
