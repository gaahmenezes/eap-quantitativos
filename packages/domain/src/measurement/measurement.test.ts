import { describe, expect, it } from 'vitest';
import { elementChain, findCoverageConflicts, typologyCoverage } from './coverage.js';
import { expandMeasurements, sumBy, type ExpandMeasurement, type ExpandUnit } from './expand.js';

describe('disjunção de âncoras (RN-DUP)', () => {
  const existing = [
    { id: 'torreA', paths: ['mod/torreA'] },
    { id: 'pe1', paths: ['mod/torreB/p1/pe:x'] },
    { id: 'parede', paths: typologyCoverage(['mod/torreC/p1/u101', 'mod/torreC/p1/u102'], ['k-parede']) },
    { id: 'seg', paths: ['net:n1/seg:s1'] },
  ];
  it('ancestral, descendente e igual conflitam; irmãos não', () => {
    expect(findCoverageConflicts(existing, ['mod/torreA/p3/u301']).map((c) => c.measurementId)).toEqual(['torreA']);
    expect(findCoverageConflicts(existing, ['mod/torreB']).map((c) => c.measurementId)).toEqual(['pe1']);
    expect(findCoverageConflicts(existing, ['mod/torreB/p2'])).toEqual([]);
    expect(findCoverageConflicts(existing, ['net:n1/seg:s1']).map((c) => c.measurementId)).toEqual(['seg']);
    expect(findCoverageConflicts(existing, ['net:n1/seg:s2'])).toEqual([]);
  });
  it('tipologia: medir a unidade inteira conflita; outro elemento ou subelemento distinto não', () => {
    expect(findCoverageConflicts(existing, ['mod/torreC/p1/u102']).map((c) => c.measurementId)).toEqual(['parede']);
    expect(findCoverageConflicts(existing, typologyCoverage(['mod/torreC/p1/u101'], ['k-piso']))).toEqual([]);
    expect(findCoverageConflicts(existing, typologyCoverage(['mod/torreC/p1/u101'], ['k-parede', 'k-revest'])).map((c) => c.measurementId)).toEqual(['parede']);
    expect(findCoverageConflicts(existing, ['mod/torreC/p1/u102'], 'parede')).toEqual([]);
  });
  it('cadeia de elementos', () => {
    const els = [{ stableKey: 'a', parentStableKey: null }, { stableKey: 'b', parentStableKey: 'a' }, { stableKey: 'c', parentStableKey: 'b' }];
    expect(elementChain(els, 'c')).toEqual(['a', 'b', 'c']);
    expect(elementChain(els, 'z')).toBeNull();
  });
});

describe('replicação por tipologia — cenário B (120 casas: 60/40/20)', () => {
  const units: ExpandUnit[] = [];
  const keys = new Set(['parede', 'piso']);
  for (let i = 0; i < 120; i++) {
    const typologyId = i < 60 ? 'T1' : i < 100 ? 'T2' : 'T3';
    // a casa 0 excluiu o piso (particularidade); a casa 119 ainda não tem revisão fixada
    units.push({ id: `u${i}`, typologyId, elementKeys: i === 119 ? null : i === 0 ? new Set(['parede']) : keys });
  }
  const m = (id: string, typologyId: string, elementKey: string, quantity: string, unitId: string | null = null): ExpandMeasurement =>
    ({ id, wbsNodeId: 'w', serviceId: 's', quantity, anchor: { kind: 'TYPOLOGY_ELEMENT', typologyId, elementKey, unitId } });

  it('total por tipologia × unidades = total geral, com particularidade e substituição', () => {
    const ms = [
      m('p1', 'T1', 'parede', '120.5'),
      m('p2', 'T2', 'parede', '98.25'),
      m('p3', 'T3', 'parede', '150'),
      m('f1', 'T1', 'piso', '45.30'),
      m('u5', 'T1', 'parede', '130', 'u5'), // casa 5 tem parede diferente: substitui, não soma
      { id: 'muro', wbsNodeId: 'w', serviceId: 's', quantity: '33.3', anchor: { kind: 'OTHER' } } as ExpandMeasurement,
    ];
    const r = expandMeasurements(ms, units);
    expect(r.byMeasurement.get('p1')).toEqual({ count: 59, total: '7109.5', replacedUnits: 1 });
    expect(r.byMeasurement.get('u5')).toEqual({ count: 1, total: '130', replacedUnits: 0 });
    expect(r.byMeasurement.get('p2')!.count).toBe(40);
    expect(r.byMeasurement.get('p3')).toMatchObject({ count: 19 });
    expect(r.byMeasurement.get('f1')).toMatchObject({ count: 59, total: '2672.7' }); // casa 0 sem piso
    expect(r.warnings).toEqual([{ measurementId: 'p3', message: '1 unidade(s) da tipologia sem revisão fixada não foram contabilizadas.' }]);
    const total = sumBy(r.lines, (l) => `${l.wbsNodeId}|${l.serviceId}`).get('w|s');
    // 7109,5 + 130 + 40 × 98,25 + 19 × 150 + 2672,7 + 33,3
    expect(total).toBe('16725.5');
    const perUnit5 = sumBy(r.lines, (l) => l.unitId ?? '-').get('u5');
    expect(perUnit5).toBe('175.3'); // 130 (próprio) + 45,30 (piso da tipologia)
  });

  it('medição própria de elemento inexistente na unidade é avisada e não conta', () => {
    const r = expandMeasurements([m('x', 'T1', 'piso', '10', 'u0')], units);
    expect(r.byMeasurement.get('x')!.count).toBe(0);
    expect(r.warnings[0]!.message).toContain('O elemento não existe na unidade');
  });
});
