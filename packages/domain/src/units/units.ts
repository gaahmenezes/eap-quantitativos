/**
 * Unidades de medida com análise dimensional (ADR-004, RN-FOR).
 * Dimensão = expoentes de [comprimento L, massa M, tempo T, contagem N].
 * Valor na base = valor × fator (base: m, kg, s, un). Toda conversão em decimal.
 */
import { Decimal } from 'decimal.js';

export interface Dimension {
  L: number;
  M: number;
  T: number;
  N: number;
}

export interface UnitDef {
  symbol: string;
  name: string;
  dimension: Dimension;
  /** Fator para a unidade base da dimensão, como texto decimal exato. */
  factor: string;
  /** Casas decimais sugeridas para exibição de quantidades. */
  decimals: number;
}

export const DIMENSIONLESS: Dimension = { L: 0, M: 0, T: 0, N: 0 };
const dim = (L = 0, M = 0, T = 0, N = 0): Dimension => ({ L, M, T, N });

export const DEFAULT_UNITS: UnitDef[] = [
  // comprimento
  { symbol: 'm', name: 'metro', dimension: dim(1), factor: '1', decimals: 2 },
  { symbol: 'cm', name: 'centímetro', dimension: dim(1), factor: '0.01', decimals: 1 },
  { symbol: 'mm', name: 'milímetro', dimension: dim(1), factor: '0.001', decimals: 0 },
  { symbol: 'km', name: 'quilômetro', dimension: dim(1), factor: '1000', decimals: 3 },
  // área
  { symbol: 'm²', name: 'metro quadrado', dimension: dim(2), factor: '1', decimals: 2 },
  { symbol: 'cm²', name: 'centímetro quadrado', dimension: dim(2), factor: '0.0001', decimals: 1 },
  { symbol: 'ha', name: 'hectare', dimension: dim(2), factor: '10000', decimals: 4 },
  // volume
  { symbol: 'm³', name: 'metro cúbico', dimension: dim(3), factor: '1', decimals: 3 },
  { symbol: 'L', name: 'litro', dimension: dim(3), factor: '0.001', decimals: 1 },
  // massa
  { symbol: 'kg', name: 'quilograma', dimension: dim(0, 1), factor: '1', decimals: 2 },
  { symbol: 't', name: 'tonelada', dimension: dim(0, 1), factor: '1000', decimals: 3 },
  // tempo
  { symbol: 'h', name: 'hora', dimension: dim(0, 0, 1), factor: '3600', decimals: 2 },
  { symbol: 'dia', name: 'dia', dimension: dim(0, 0, 1), factor: '86400', decimals: 1 },
  // contagem
  { symbol: 'un', name: 'unidade', dimension: dim(0, 0, 0, 1), factor: '1', decimals: 0 },
  { symbol: 'pç', name: 'peça', dimension: dim(0, 0, 0, 1), factor: '1', decimals: 0 },
  { symbol: 'cj', name: 'conjunto', dimension: dim(0, 0, 0, 1), factor: '1', decimals: 0 },
  { symbol: 'pt', name: 'ponto', dimension: dim(0, 0, 0, 1), factor: '1', decimals: 0 },
  // derivadas usadas em atributos técnicos
  { symbol: 'kg/m', name: 'quilograma por metro', dimension: dim(-1, 1), factor: '1', decimals: 3 },
  { symbol: 'kg/m³', name: 'quilograma por metro cúbico', dimension: dim(-3, 1), factor: '1', decimals: 1 },
  { symbol: 'L/s', name: 'litro por segundo', dimension: dim(3, 0, -1), factor: '0.001', decimals: 2 },
  { symbol: 'm³/h', name: 'metro cúbico por hora', dimension: dim(3, 0, -1), factor: '0.000277777777777777777777777777778', decimals: 2 },
  { symbol: 'kPa', name: 'quilopascal', dimension: dim(-1, 1, -2), factor: '1000', decimals: 1 },
  { symbol: 'MPa', name: 'megapascal', dimension: dim(-1, 1, -2), factor: '1000000', decimals: 1 },
  { symbol: 'cv', name: 'cavalo-vapor', dimension: dim(2, 1, -3), factor: '735.49875', decimals: 1 },
  { symbol: 'kW', name: 'quilowatt', dimension: dim(2, 1, -3), factor: '1000', decimals: 2 },
  // adimensional
  { symbol: '%', name: 'porcentagem', dimension: DIMENSIONLESS, factor: '0.01', decimals: 2 },
];

export const sameDimension = (a: Dimension, b: Dimension) => a.L === b.L && a.M === b.M && a.T === b.T && a.N === b.N;

export function multiplyDimensions(a: Dimension, b: Dimension, sign: 1 | -1 = 1): Dimension {
  return { L: a.L + sign * b.L, M: a.M + sign * b.M, T: a.T + sign * b.T, N: a.N + sign * b.N };
}

const SUP: Record<string, string> = { '-': '⁻', '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹' };
const sup = (n: number) => (n === 1 ? '' : String(n).split('').map((c) => SUP[c] ?? c).join(''));

/** Rótulo da grandeza: comprimento, área, volume… ou fórmula dimensional (ex.: L³·T⁻¹). */
export function describeDimension(d: Dimension): string {
  const known: [Dimension, string][] = [
    [dim(1), 'Comprimento'], [dim(2), 'Área'], [dim(3), 'Volume'], [dim(0, 1), 'Massa'], [dim(0, 0, 1), 'Tempo'],
    [dim(0, 0, 0, 1), 'Contagem'], [DIMENSIONLESS, 'Adimensional'], [dim(3, 0, -1), 'Vazão'], [dim(-1, 1, -2), 'Pressão'],
    [dim(2, 1, -3), 'Potência'], [dim(-3, 1), 'Massa específica'], [dim(-1, 1), 'Massa linear'],
  ];
  const hit = known.find(([k]) => sameDimension(k, d));
  if (hit) return hit[1];
  return (['L', 'M', 'T', 'N'] as const).filter((k) => d[k] !== 0).map((k) => `${k}${sup(d[k])}`).join('·');
}

export class UnitConversionError extends Error {}

/** Converte um valor decimal entre unidades da mesma dimensão (resultado exato em decimal, 34 dígitos). */
export function convert(value: string, from: Pick<UnitDef, 'symbol' | 'dimension' | 'factor'>, to: Pick<UnitDef, 'symbol' | 'dimension' | 'factor'>): string {
  if (!sameDimension(from.dimension, to.dimension)) {
    throw new UnitConversionError(`Unidades incompatíveis: ${from.symbol} (${describeDimension(from.dimension)}) e ${to.symbol} (${describeDimension(to.dimension)}).`);
  }
  const D = Decimal.clone({ precision: 34 });
  return new D(value).times(from.factor).div(to.factor).toSignificantDigits(28).toString();
}

export function validateUnit(u: { symbol: string; factor: string; decimals: number; dimension: Dimension }): string[] {
  const issues: string[] = [];
  if (!/^\S{1,12}$/.test(u.symbol)) issues.push('Símbolo deve ter de 1 a 12 caracteres, sem espaços.');
  let f: Decimal | null = null;
  try { f = new Decimal(u.factor); } catch { issues.push('Fator inválido.'); }
  if (f && !f.gt(0)) issues.push('O fator deve ser maior que zero.');
  if (!Number.isInteger(u.decimals) || u.decimals < 0 || u.decimals > 6) issues.push('Casas decimais entre 0 e 6.');
  for (const k of ['L', 'M', 'T', 'N'] as const) if (!Number.isInteger(u.dimension[k]) || Math.abs(u.dimension[k]) > 4) issues.push(`Expoente ${k} deve ser inteiro entre -4 e 4.`);
  return issues;
}

/** Símbolo da unidade base (SI) de uma dimensão: m, m², kg, W, Pa, m³/s… */
export function baseUnitSymbol(d: Dimension): string {
  const named: [Dimension, string][] = [
    [dim(2, 1, -3), 'W'], [dim(-1, 1, -2), 'Pa'], [dim(1, 1, -2), 'N'], [dim(3, 0, -1), 'm³/s'], [dim(1, 0, -1), 'm/s'],
    [dim(-3, 1), 'kg/m³'], [dim(-1, 1), 'kg/m'], [dim(0, 0, 0, 1), 'un'], [DIMENSIONLESS, '1'],
  ];
  const hit = named.find(([k]) => sameDimension(k, d));
  if (hit) return hit[1];
  const parts: string[] = [];
  const add = (sym: string, e: number) => { if (e) parts.push(`${sym}${sup(e)}`); };
  add('m', d.L); add('kg', d.M); add('s', d.T); add('un', d.N);
  return parts.join('·');
}

const QUANTITY_ORDER = ['Comprimento', 'Área', 'Volume', 'Massa', 'Tempo', 'Contagem', 'Adimensional'];
/** Ordenação de exibição: grandezas mais usadas em levantamento primeiro, depois por fator. */
export function compareUnitsForDisplay(a: { dimension: Dimension; factor: string }, b: { dimension: Dimension; factor: string }): number {
  const qa = QUANTITY_ORDER.indexOf(describeDimension(a.dimension));
  const qb = QUANTITY_ORDER.indexOf(describeDimension(b.dimension));
  const ra = qa < 0 ? 99 : qa;
  const rb = qb < 0 ? 99 : qb;
  if (ra !== rb) return ra - rb;
  const da = describeDimension(a.dimension);
  const db = describeDimension(b.dimension);
  if (da !== db) return da.localeCompare(db, 'pt-BR');
  return new Decimal(a.factor).comparedTo(b.factor);
}
