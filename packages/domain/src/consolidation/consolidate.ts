/**
 * Consolidação de quantitativos (RN-DUP, F7) — implementação de referência.
 * Entrada: linhas efetivas (uma por medição × unidade em que vale; replicação por tipologia já aplicada),
 * cada uma com os atributos de agrupamento. Saída: somas exatas por combinação das dimensões escolhidas,
 * sempre separadas pela unidade do serviço (nunca soma m² com m³).
 * A consolidação em SQL da API precisa produzir exatamente o mesmo resultado (teste de equivalência).
 */
import { Decimal } from 'decimal.js';

export const CONSOLIDATION_DIMENSIONS = [
  'wbs1', 'wbs2', 'wbs3', 'wbsItem', 'service', 'category', 'module',
  'PHASE', 'STAGE', 'SECTOR', 'BLOCK_QUADRA', 'LOT', 'STREET', 'TOWER', 'BUILDING_BLOCK', 'FLOOR',
  'typology', 'unit', 'system', 'network',
] as const;
export type ConsolidationDimension = (typeof CONSOLIDATION_DIMENSIONS)[number];

export const DIMENSION_LABELS: Record<ConsolidationDimension, string> = {
  wbs1: 'EAP — nível 1', wbs2: 'EAP — nível 2', wbs3: 'EAP — nível 3', wbsItem: 'Item da EAP', service: 'Serviço', category: 'Categoria de serviço', module: 'Módulo',
  PHASE: 'Fase', STAGE: 'Etapa', SECTOR: 'Setor', BLOCK_QUADRA: 'Quadra', LOT: 'Lote', STREET: 'Rua', TOWER: 'Torre', BUILDING_BLOCK: 'Bloco', FLOOR: 'Pavimento',
  typology: 'Tipologia', unit: 'Unidade habitacional', system: 'Sistema de infraestrutura', network: 'Rede',
};

export type LineAttributes = Partial<Record<ConsolidationDimension, string | null>>;

export interface ConsolidationLine {
  measurementId: string;
  /** Quantidade já na unidade atual do serviço. */
  quantity: string;
  unit: string;
  attrs: LineAttributes;
}

export interface ConsolidationRow {
  key: Record<string, string | null>;
  unit: string;
  total: string;
  lines: number;
  measurements: number;
}

export type ConsolidationFilters = Partial<Record<ConsolidationDimension, readonly string[]>>;

export function matchesFilters(attrs: LineAttributes, filters: ConsolidationFilters): boolean {
  for (const [dim, values] of Object.entries(filters) as [ConsolidationDimension, readonly string[]][]) {
    if (!values?.length) continue;
    const v = attrs[dim] ?? null;
    if (v === null || !values.includes(v)) return false;
  }
  return true;
}

export function consolidate(lines: readonly ConsolidationLine[], groupBy: readonly ConsolidationDimension[], filters: ConsolidationFilters = {}): ConsolidationRow[] {
  const acc = new Map<string, { key: Record<string, string | null>; unit: string; total: Decimal; lines: number; ms: Set<string> }>();
  for (const l of lines) {
    if (!matchesFilters(l.attrs, filters)) continue;
    const key: Record<string, string | null> = {};
    for (const d of groupBy) key[d] = l.attrs[d] ?? null;
    const k = JSON.stringify([groupBy.map((d) => key[d]), l.unit]);
    let a = acc.get(k);
    if (!a) { a = { key, unit: l.unit, total: new Decimal(0), lines: 0, ms: new Set() }; acc.set(k, a); }
    a.total = a.total.plus(l.quantity);
    a.lines++;
    a.ms.add(l.measurementId);
  }
  return sortRows([...acc.values()].map((a) => ({ key: a.key, unit: a.unit, total: a.total.toFixed(), lines: a.lines, measurements: a.ms.size })), groupBy);
}

/** Ordem estável: pelas chaves (nulos por último), depois pela unidade. */
export function sortRows(rows: ConsolidationRow[], groupBy: readonly ConsolidationDimension[]): ConsolidationRow[] {
  const cmp = (a: string | null, b: string | null) => (a === b ? 0 : a === null ? 1 : b === null ? -1 : a < b ? -1 : 1);
  return rows.sort((x, y) => {
    for (const d of groupBy) { const c = cmp(x.key[d] ?? null, y.key[d] ?? null); if (c) return c; }
    return x.unit < y.unit ? -1 : x.unit > y.unit ? 1 : 0;
  });
}

/** Total geral por unidade. */
export function grandTotals(rows: readonly ConsolidationRow[]): { unit: string; total: string }[] {
  const acc = new Map<string, Decimal>();
  for (const r of rows) acc.set(r.unit, (acc.get(r.unit) ?? new Decimal(0)).plus(r.total));
  return [...acc].sort(([a], [b]) => (a < b ? -1 : 1)).map(([unit, t]) => ({ unit, total: t.toFixed() }));
}
