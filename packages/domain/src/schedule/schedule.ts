/**
 * Quadros de componentes e materiais (F11, ADR-021): esquadrias, louças e metais, materiais de instalações.
 * Linhas = itens (com unidade de entrada e, para esquadrias, largura × altura); colunas = destinos
 * (item da EAP + âncora, ex.: "Casa tipo" × 362 unidades); células = quantidade do item naquele destino.
 * O lançamento soma por serviço × destino (quadro de resumo): itens diferentes do mesmo material viram
 * uma única medição por destino, sem dupla contagem. Tudo em decimal, sem eval.
 */
import { Decimal } from 'decimal.js';
import { compatibleDimensions, QUANTITY_SCALE, type FormulaUnit } from '../formula/formula.js';
import { evaluateCellNumber } from '../sheet/engine.js';
import { type Dimension } from '../units/units.js';

const D = Decimal.clone({ precision: 34, rounding: Decimal.ROUND_HALF_UP });
const fmt = (d: Decimal) => { const s = d.toDecimalPlaces(QUANTITY_SCALE).toFixed(); return s === '-0' ? '0' : s; };
const isCount = (d: Dimension) => d.L === 0 && d.M === 0 && d.T === 0;
const AREA: Dimension = { L: 2, M: 0, T: 0, N: 0 };

export interface ScheduleColumnInput { key: string; label: string }
export interface ScheduleRowInput {
  key: string;
  code?: string | null;
  description: string;
  spec?: string | null;
  /** Unidade em que as células são digitadas (un, m, pç…). */
  unit: string;
  /** Vão da esquadria, em metros (texto decimal). */
  width?: string | null;
  height?: string | null;
  serviceIds: string[];
  /** Quantidade por coluna: número ou conta só com números ("12+3"). */
  cells: Record<string, string | null | undefined>;
}
export interface ScheduleService { id: string; code: string; unit: FormulaUnit }

export interface ScheduleContribution {
  rowKey: string;
  code: string | null;
  description: string;
  spec: string | null;
  entered: string;
  enteredUnit: string;
  /** Área por peça (L × A) quando o serviço é medido em área. */
  perItem: string | null;
  value: string;
}
export interface SchedulePlan {
  serviceId: string;
  columnKey: string;
  /** Quantidade na unidade do serviço, por destino (antes do multiplicador da tipologia). */
  quantity: string;
  unit: string;
  contributions: ScheduleContribution[];
}
export interface ScheduleCellResult { value: string | null; error?: string; expr?: string }
export interface ScheduleRowResult { cells: Record<string, ScheduleCellResult>; errors: string[]; total: string }
export interface ScheduleResult { rows: ScheduleRowResult[]; plans: SchedulePlan[]; errorCount: number }

/** Quanto de serviço uma peça representa: contagem, comprimento/massa convertidos ou L × A para área. */
function factorFor(row: ScheduleRowInput, entry: FormulaUnit, svc: ScheduleService): { factor: Decimal; perItem: string | null } | string {
  const target = svc.unit;
  if (compatibleDimensions(entry.dimension, target.dimension) && !(isCount(entry.dimension) !== isCount(target.dimension))) {
    return { factor: new D(entry.factor).div(target.factor), perItem: null };
  }
  if (isCount(entry.dimension) && compatibleDimensions(target.dimension, AREA)) {
    const w = (row.width ?? '').trim(); const h = (row.height ?? '').trim();
    if (!w || !h) return `${svc.code} é medido em ${target.symbol}: informe largura e altura do item.`;
    const area = new D(w).times(h);
    return { factor: area.div(target.factor), perItem: fmt(area) };
  }
  return `${svc.code} é medido em ${target.symbol}, incompatível com a unidade do item (${entry.symbol}).`;
}

export function computeSchedule(columns: readonly ScheduleColumnInput[], rows: readonly ScheduleRowInput[], services: ReadonlyMap<string, ScheduleService>, units: readonly FormulaUnit[]): ScheduleResult {
  const unitBy = new Map(units.map((u) => [u.symbol, u]));
  const acc = new Map<string, SchedulePlan & { sum: Decimal }>();
  let errorCount = 0;
  const out: ScheduleRowResult[] = rows.map((row) => {
    const errors: string[] = [];
    const cells: Record<string, ScheduleCellResult> = {};
    const entry = unitBy.get(row.unit);
    if (!row.description.trim()) errors.push('Informe a descrição.');
    if (!entry) errors.push(`Unidade não cadastrada: ${row.unit}.`);
    for (const [w, label] of [[row.width, 'Largura'], [row.height, 'Altura']] as const) {
      if (w && !/^\d+(\.\d+)?$/.test(w.trim())) errors.push(`${label} inválida: ${w}.`);
    }
    let total = new D(0);
    const values = new Map<string, Decimal>();
    for (const col of columns) {
      const text = (row.cells[col.key] ?? '').trim();
      if (!text) continue;
      try {
        const v = evaluateCellNumber(text);
        if (v.isNeg()) throw new Error('Quantidade negativa.');
        values.set(col.key, v);
        total = total.plus(v);
        cells[col.key] = { value: fmt(v), ...(!/^\d+([.,]\d+)?$/.test(text) && { expr: text }) };
      } catch (e) {
        const msg = e instanceof Error && e.message === 'Quantidade negativa.' ? e.message : 'Digite um número ou uma conta com números.';
        cells[col.key] = { value: null, error: msg };
        errors.push(`${col.label}: ${msg}`);
      }
    }
    if (values.size && !row.serviceIds.length) errors.push('Escolha o serviço do item.');
    const factors: { svc: ScheduleService; factor: Decimal; perItem: string | null }[] = [];
    if (entry) {
      for (const sid of row.serviceIds) {
        const svc = services.get(sid);
        if (!svc) { errors.push('Serviço inexistente ou arquivado.'); continue; }
        const f = factorFor(row, entry, svc);
        if (typeof f === 'string') errors.push(f);
        else factors.push({ svc, ...f });
      }
    }
    if (errors.length) { errorCount++; return { cells, errors, total: fmt(total) }; }
    for (const [colKey, v] of values) {
      if (v.isZero()) continue;
      for (const f of factors) {
        const k = `${f.svc.id}|${colKey}`;
        const q = v.times(f.factor);
        const p = acc.get(k) ?? { serviceId: f.svc.id, columnKey: colKey, quantity: '0', unit: f.svc.unit.symbol, contributions: [], sum: new D(0) };
        p.sum = p.sum.plus(q);
        p.contributions.push({ rowKey: row.key, code: row.code?.trim() || null, description: row.description.trim(), spec: row.spec?.trim() || null, entered: fmt(v), enteredUnit: entry!.symbol, perItem: f.perItem, value: fmt(q) });
        acc.set(k, p);
      }
    }
    return { cells, errors, total: fmt(total) };
  });
  const colOrder = new Map(columns.map((c, i) => [c.key, i]));
  const plans = [...acc.values()]
    .map(({ sum, ...p }) => ({ ...p, quantity: fmt(sum) }))
    .sort((a, b) => (services.get(a.serviceId)!.code.localeCompare(services.get(b.serviceId)!.code, 'pt-BR')) || colOrder.get(a.columnKey)! - colOrder.get(b.columnKey)!);
  return { rows: out, plans, errorCount };
}

/** Total no empreendimento: Σ (quantidade × unidades do destino). */
export function totalWithMultipliers(values: readonly { quantity: string; multiplier: number }[]): string {
  return fmt(values.reduce((s, v) => s.plus(new D(v.quantity).times(v.multiplier)), new D(0)));
}
