/**
 * Atualização de uma ficha ou de um quadro por uma nova versão da planilha (ADR-025). Funções puras: casam as linhas
 * antigas com as novas pela chave (texto que identifica a linha: ambiente + tipo, trecho, código do item…) e dizem o
 * que entrou, saiu ou mudou. As linhas casadas preservam o que só existe no sistema (destino por linha, serviços).
 */
import { Decimal } from 'decimal.js';
import type { SheetDef, SheetRowInput } from '../sheet/engine.js';
import { evaluateCellNumber } from '../sheet/engine.js';
import { norm } from './workbook.js';

export interface KeyedRow { key: string; values: Record<string, string> }
export type RowStatus = 'added' | 'removed' | 'changed' | 'unchanged';
export interface RowChange { field: string; before: string; after: string }
export interface RowDiff { status: RowStatus; key: string; before: number | null; after: number | null; changes: RowChange[] }
export interface RowsDiff {
  /** Para cada linha nova, o índice da linha antiga correspondente (ou null = nova). */
  matches: (number | null)[];
  rows: RowDiff[];
  counts: Record<RowStatus, number>;
}

/**
 * Casa linhas pela chave, na ordem (a 1ª ocorrência nova com a 1ª antiga de mesma chave, e assim por diante).
 * Linhas sem chave casam entre si pela ordem de aparição.
 */
export function matchRows(oldKeys: readonly string[], newKeys: readonly string[]): (number | null)[] {
  const queues = new Map<string, number[]>();
  oldKeys.forEach((k, i) => { const q = queues.get(k) ?? []; q.push(i); queues.set(k, q); });
  return newKeys.map((k) => queues.get(k)?.shift() ?? null);
}

/** Igualdade de valores: texto igual, ou números (inclusive contas na célula) com o mesmo valor. */
export function sameValue(a: string | undefined, b: string | undefined): boolean {
  const x = (a ?? '').trim(); const y = (b ?? '').trim();
  if (x === y) return true;
  if (!x || !y) return false;
  try { return new Decimal(evaluateCellNumber(x)).equals(evaluateCellNumber(y)) && /[+\-*/()]/.test(x) === /[+\-*/()]/.test(y); } catch { return false; }
}

export function diffRows(before: readonly KeyedRow[], after: readonly KeyedRow[], labels: Record<string, string> = {}): RowsDiff {
  const matches = matchRows(before.map((r) => r.key), after.map((r) => r.key));
  const used = new Set(matches.filter((m): m is number => m !== null));
  const rows: RowDiff[] = [];
  after.forEach((r, i) => {
    const m = matches[i];
    if (m === null || m === undefined) { rows.push({ status: 'added', key: r.key, before: null, after: i, changes: [] }); return; }
    const old = before[m]!;
    const fields = [...new Set([...Object.keys(old.values), ...Object.keys(r.values)])];
    const changes = fields.filter((f) => !sameValue(old.values[f], r.values[f])).map((f) => ({ field: labels[f] ?? f, before: old.values[f] ?? '', after: r.values[f] ?? '' }));
    rows.push({ status: changes.length ? 'changed' : 'unchanged', key: r.key, before: m, after: i, changes });
  });
  before.forEach((r, i) => { if (!used.has(i)) rows.push({ status: 'removed', key: r.key, before: i, after: null, changes: [] }); });
  const counts = { added: 0, removed: 0, changed: 0, unchanged: 0 } as Record<RowStatus, number>;
  for (const r of rows) counts[r.status]++;
  return { matches, rows, counts };
}

/** Chave de uma linha de ficha: as colunas de texto e de escolha do modelo, normalizadas. */
export function sheetRowKey(def: SheetDef, row: SheetRowInput): string {
  return def.columns.filter((c) => c.kind === 'input' && c.type !== 'number').map((c) => norm(row[c.key]?.v ?? '')).join('|');
}
export function sheetKeyed(def: SheetDef, rows: readonly SheetRowInput[]): KeyedRow[] {
  const inputs = def.columns.filter((c) => c.kind === 'input');
  return rows.map((r) => ({ key: sheetRowKey(def, r), values: Object.fromEntries(inputs.map((c) => [c.key, r[c.key]?.v ?? '']).filter(([, v]) => v)) }));
}
export const sheetLabels = (def: SheetDef) => Object.fromEntries(def.columns.map((c) => [c.key, c.label]));

/** Item de quadro: identificado pelo código (Id) ou, sem código, pela descrição + especificação. */
export interface ScheduleItem { code: string | null; description: string; spec: string | null; unit: string; width: string | null; height: string | null; cells: Record<string, string> }
export const scheduleRowKey = (r: ScheduleItem) => (r.code?.trim() ? `#${norm(r.code)}` : `${norm(r.description)}|${norm(r.spec ?? '')}`);
export function scheduleKeyed(rows: readonly ScheduleItem[]): KeyedRow[] {
  return rows.map((r) => ({
    key: scheduleRowKey(r),
    values: Object.fromEntries(Object.entries({ code: r.code ?? '', description: r.description, spec: r.spec ?? '', unit: r.unit, width: r.width ?? '', height: r.height ?? '', ...Object.fromEntries(Object.entries(r.cells).map(([k, v]) => [`cell:${k}`, v])) }).filter(([, v]) => v)),
  }));
}
