import { describe, expect, it } from 'vitest';
import { diffByKey, quantityDeltas, revisionCode } from './compare.js';

describe('comparação de revisões', () => {
  it('deltas de quantidade exatos: inclusão, exclusão e alteração', () => {
    const r00 = [{ key: 'pisos|REV.004', unit: 'm²', total: '1104' }, { key: 'muros|ALV.001', unit: 'm²', total: '83.3' }, { key: 'rodape|REV.005', unit: 'm', total: '725' }];
    const r01 = [{ key: 'pisos|REV.004', unit: 'm²', total: '1105.6' }, { key: 'rodape|REV.005', unit: 'm', total: '725.00' }, { key: 'forro|FOR.001', unit: 'm²', total: '12.5' }];
    expect(quantityDeltas(r00, r01)).toEqual([
      { key: 'forro|FOR.001', unit: 'm²', before: null, after: '12.5', delta: '12.5', kind: 'added' },
      { key: 'muros|ALV.001', unit: 'm²', before: '83.3', after: null, delta: '-83.3', kind: 'removed' },
      { key: 'pisos|REV.004', unit: 'm²', before: '1104', after: '1105.6', delta: '1.6', kind: 'changed' },
    ]);
  });
  it('diferença por chave estável compara campos (números por valor)', () => {
    const d = diffByKey(
      [{ id: 'a', title: 'Torre A', q: '10' }, { id: 'b', title: 'Torre B', q: '5.0' }, { id: 'c', title: 'x', q: '1' }],
      [{ id: 'a', title: 'Torre A1', q: '10' }, { id: 'b', title: 'Torre B', q: '5' }, { id: 'd', title: 'y', q: '2' }],
      (x) => x.id, ['title', 'q'],
    );
    expect(d.added.map((x) => x.id)).toEqual(['d']);
    expect(d.removed.map((x) => x.id)).toEqual(['c']);
    expect(d.changed).toEqual([{ before: { id: 'a', title: 'Torre A', q: '10' }, after: { id: 'a', title: 'Torre A1', q: '10' }, fields: ['title'] }]);
    expect(d.unchanged).toBe(1);
    expect([revisionCode(0), revisionCode(1), revisionCode(12)]).toEqual(['R00', 'R01', 'R12']);
  });
});
