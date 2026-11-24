/**
 * Quantidade efetiva das medições (RN-TIP, RN-DUP):
 *  - medição comum: uma linha com a própria quantidade;
 *  - medição de elemento de tipologia (sem unidade): uma linha por unidade da tipologia em que o
 *    elemento existe (revisão fixada + particularidades), exceto unidades que têm medição própria
 *    do mesmo elemento para o mesmo nó da EAP e serviço (que a substitui — nunca soma);
 *  - medição de elemento de tipologia de uma unidade: uma linha para aquela unidade.
 * Tudo em decimal; o total é a soma exata das linhas.
 */
import { Decimal } from 'decimal.js';

export type ExpandAnchor =
  | { kind: 'OTHER' }
  | { kind: 'TYPOLOGY_ELEMENT'; typologyId: string; elementKey: string; unitId: string | null };

export interface ExpandMeasurement {
  id: string;
  wbsNodeId: string;
  serviceId: string;
  quantity: string;
  anchor: ExpandAnchor;
}

export interface ExpandUnit {
  id: string;
  typologyId: string | null;
  /** Chaves dos elementos efetivos da unidade; null quando a unidade não tem revisão fixada. */
  elementKeys: ReadonlySet<string> | null;
}

export interface EffectiveLine {
  measurementId: string;
  wbsNodeId: string;
  serviceId: string;
  unitId: string | null;
  quantity: string;
}

export interface ExpandResult {
  lines: EffectiveLine[];
  /** Por medição: número de linhas (multiplicador) e total efetivo. */
  byMeasurement: Map<string, { count: number; total: string; replacedUnits: number }>;
  warnings: { measurementId: string; message: string }[];
}

export function expandMeasurements(measurements: readonly ExpandMeasurement[], units: readonly ExpandUnit[]): ExpandResult {
  const unitsByTypology = new Map<string, ExpandUnit[]>();
  for (const u of units) if (u.typologyId) unitsByTypology.set(u.typologyId, [...(unitsByTypology.get(u.typologyId) ?? []), u]);
  const unitById = new Map(units.map((u) => [u.id, u]));
  const replaced = new Set<string>();
  const rk = (m: ExpandMeasurement, unitId: string) => m.anchor.kind === 'TYPOLOGY_ELEMENT' ? `${m.wbsNodeId}|${m.serviceId}|${m.anchor.typologyId}|${m.anchor.elementKey}|${unitId}` : '';
  for (const m of measurements) if (m.anchor.kind === 'TYPOLOGY_ELEMENT' && m.anchor.unitId) replaced.add(rk(m, m.anchor.unitId));

  const lines: EffectiveLine[] = [];
  const byMeasurement: ExpandResult['byMeasurement'] = new Map();
  const warnings: ExpandResult['warnings'] = [];
  for (const m of measurements) {
    const q = new Decimal(m.quantity);
    const emit = (unitId: string | null) => lines.push({ measurementId: m.id, wbsNodeId: m.wbsNodeId, serviceId: m.serviceId, unitId, quantity: m.quantity });
    let count = 0;
    let replacedUnits = 0;
    if (m.anchor.kind === 'OTHER') { emit(null); count = 1; }
    else if (m.anchor.unitId) {
      const u = unitById.get(m.anchor.unitId);
      if (!u || u.typologyId !== m.anchor.typologyId) warnings.push({ measurementId: m.id, message: 'A unidade não pertence mais a esta tipologia; medição não contabilizada.' });
      else if (!u.elementKeys) warnings.push({ measurementId: m.id, message: 'A unidade não tem revisão de tipologia fixada; medição não contabilizada.' });
      else if (!u.elementKeys.has(m.anchor.elementKey)) warnings.push({ measurementId: m.id, message: 'O elemento não existe na unidade (revisão fixada ou particularidades); medição não contabilizada.' });
      else { emit(u.id); count = 1; }
    } else {
      let withoutRevision = 0;
      for (const u of unitsByTypology.get(m.anchor.typologyId) ?? []) {
        if (!u.elementKeys) { withoutRevision++; continue; }
        if (!u.elementKeys.has(m.anchor.elementKey)) continue;
        if (replaced.has(rk(m, u.id))) { replacedUnits++; continue; }
        emit(u.id);
        count++;
      }
      if (withoutRevision) warnings.push({ measurementId: m.id, message: `${withoutRevision} unidade(s) da tipologia sem revisão fixada não foram contabilizadas.` });
    }
    byMeasurement.set(m.id, { count, total: q.times(count).toFixed(), replacedUnits });
  }
  return { lines, byMeasurement, warnings };
}

/** Soma exata por chave (ex.: nó da EAP × serviço). */
export function sumBy(lines: readonly EffectiveLine[], key: (l: EffectiveLine) => string): Map<string, string> {
  const acc = new Map<string, Decimal>();
  for (const l of lines) acc.set(key(l), (acc.get(key(l)) ?? new Decimal(0)).plus(l.quantity));
  return new Map([...acc].map(([k, v]) => [k, v.toFixed()]));
}
