/**
 * Comparação entre duas fotografias (revisão × revisão ou revisão × estado atual), por chave estável.
 * Quantidades em decimal exato; delta = depois − antes.
 */
import { Decimal } from 'decimal.js';

export interface KeyedDiff<T> {
  added: T[];
  removed: T[];
  changed: { before: T; after: T; fields: string[] }[];
  unchanged: number;
}

/** Diferença genérica por chave, comparando os campos indicados. */
export function diffByKey<T>(before: readonly T[], after: readonly T[], key: (x: T) => string, fields: readonly (keyof T)[]): KeyedDiff<T> {
  const a = new Map(before.map((x) => [key(x), x]));
  const b = new Map(after.map((x) => [key(x), x]));
  const out: KeyedDiff<T> = { added: [], removed: [], changed: [], unchanged: 0 };
  for (const [k, x] of b) {
    const y = a.get(k);
    if (!y) { out.added.push(x); continue; }
    const changed = fields.filter((f) => !same(y[f], x[f])).map(String);
    if (changed.length) out.changed.push({ before: y, after: x, fields: changed });
    else out.unchanged++;
  }
  for (const [k, y] of a) if (!b.has(k)) out.removed.push(y);
  return out;
}

const same = (x: unknown, y: unknown) => {
  if (typeof x === 'string' && typeof y === 'string' && /^-?\d+(\.\d+)?$/.test(x) && /^-?\d+(\.\d+)?$/.test(y)) return new Decimal(x).eq(y);
  return x === y;
};

export interface QuantityTotal {
  key: string;
  unit: string;
  total: string;
}

export interface QuantityDelta {
  key: string;
  unit: string;
  before: string | null;
  after: string | null;
  delta: string;
  kind: 'added' | 'removed' | 'changed';
}

/** Deltas de quantidade por chave (ex.: item da EAP × serviço) e unidade; omite os iguais. */
export function quantityDeltas(before: readonly QuantityTotal[], after: readonly QuantityTotal[]): QuantityDelta[] {
  const k = (x: QuantityTotal) => `${x.key}|${x.unit}`;
  const a = new Map(before.map((x) => [k(x), x]));
  const b = new Map(after.map((x) => [k(x), x]));
  const out: QuantityDelta[] = [];
  for (const [kk, x] of b) {
    const y = a.get(kk);
    if (!y) out.push({ key: x.key, unit: x.unit, before: null, after: x.total, delta: new Decimal(x.total).toFixed(), kind: 'added' });
    else if (!new Decimal(y.total).eq(x.total)) out.push({ key: x.key, unit: x.unit, before: y.total, after: x.total, delta: new Decimal(x.total).minus(y.total).toFixed(), kind: 'changed' });
  }
  for (const [kk, y] of a) if (!b.has(kk)) out.push({ key: y.key, unit: y.unit, before: y.total, after: null, delta: new Decimal(y.total).neg().toFixed(), kind: 'removed' });
  return out.sort((x, y) => (x.key < y.key ? -1 : x.key > y.key ? 1 : x.unit < y.unit ? -1 : 1));
}

/** Código da revisão: R00, R01… */
export const revisionCode = (n: number) => `R${String(n).padStart(2, '0')}`;
