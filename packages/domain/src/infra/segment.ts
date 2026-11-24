/**
 * Geometria de trechos de rede (PV a PV). Cálculos em decimal (RNF03).
 * Declividade (m/m) = (cota de fundo montante − cota de fundo jusante) / comprimento.
 * Profundidade = cota de tampa − cota de fundo, em cada extremidade.
 */
import { Decimal } from 'decimal.js';

export interface SegmentGeometryInput {
  length: string | null;
  /** Cotas de fundo no trecho; na ausência, usa a cota de fundo dos dispositivos. */
  upstreamInvert?: string | null;
  downstreamInvert?: string | null;
  fromNode?: { coverElevation?: string | null; bottomElevation?: string | null } | null;
  toNode?: { coverElevation?: string | null; bottomElevation?: string | null } | null;
}

export interface SegmentGeometry {
  /** m/m, 6 casas. null quando faltam dados. */
  slope: string | null;
  /** % com 3 casas. */
  slopePercent: string | null;
  upstreamDepth: string | null;
  downstreamDepth: string | null;
  averageDepth: string | null;
  /** Fundo sobe no sentido do escoamento (declividade negativa). */
  adverseSlope: boolean;
}

const dec = (v: string | null | undefined) => (v == null || v === '' ? null : new Decimal(v));

export function segmentGeometry(s: SegmentGeometryInput): SegmentGeometry {
  const length = dec(s.length);
  const up = dec(s.upstreamInvert) ?? dec(s.fromNode?.bottomElevation);
  const down = dec(s.downstreamInvert) ?? dec(s.toNode?.bottomElevation);
  let slope: Decimal | null = null;
  if (length && length.gt(0) && up && down) slope = up.minus(down).div(length);
  const depth = (cover: Decimal | null, invert: Decimal | null) => (cover && invert ? cover.minus(invert) : null);
  const ud = depth(dec(s.fromNode?.coverElevation), up);
  const dd = depth(dec(s.toNode?.coverElevation), down);
  const avg = ud && dd ? ud.plus(dd).div(2) : null;
  return {
    slope: slope ? slope.toDecimalPlaces(6).toString() : null,
    slopePercent: slope ? slope.times(100).toDecimalPlaces(3).toString() : null,
    upstreamDepth: ud ? ud.toDecimalPlaces(3).toString() : null,
    downstreamDepth: dd ? dd.toDecimalPlaces(3).toString() : null,
    averageDepth: avg ? avg.toDecimalPlaces(3).toString() : null,
    adverseSlope: !!slope && slope.lt(0),
  };
}

/** Soma decimal de comprimentos (totais por rede). */
export function sumDecimals(values: (string | null | undefined)[]): string {
  return values.reduce((acc: Decimal, v) => (v ? acc.plus(v) : acc), new Decimal(0)).toString();
}
