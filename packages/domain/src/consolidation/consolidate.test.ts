import { describe, expect, it } from 'vitest';
import { consolidate, grandTotals, type ConsolidationLine } from './consolidate.js';

// Cenário B reduzido: 3 tipologias, casas em 2 quadras; piso (m²) e rodapé (m) no mesmo item.
const lines: ConsolidationLine[] = [];
for (let i = 0; i < 120; i++) {
  const typology = i < 60 ? 'A' : i < 100 ? 'B' : 'C';
  const q = i < 60 ? '18.4' : i < 100 ? '22.15' : '30';
  lines.push({ measurementId: `piso-${typology}`, quantity: q, unit: 'm²', attrs: { wbsItem: 'pisos', service: 'REV.004', typology, unit: `u${i}`, BLOCK_QUADRA: i % 2 ? 'Q2' : 'Q1' } });
  lines.push({ measurementId: `rodape-${typology}`, quantity: '12.5', unit: 'm', attrs: { wbsItem: 'pisos', service: 'REV.005', typology, unit: `u${i}`, BLOCK_QUADRA: i % 2 ? 'Q2' : 'Q1' } });
}
lines.push({ measurementId: 'muro', quantity: '33.3', unit: 'm²', attrs: { wbsItem: 'muros', service: 'REV.004', typology: null, unit: null } });

describe('consolidação de referência', () => {
  it('total por tipologia × unidades = total geral, separado por unidade', () => {
    const byTyp = consolidate(lines, ['typology']);
    expect(byTyp).toEqual([
      { key: { typology: 'A' }, unit: 'm', total: '750', lines: 60, measurements: 1 },
      { key: { typology: 'A' }, unit: 'm²', total: '1104', lines: 60, measurements: 1 },
      { key: { typology: 'B' }, unit: 'm', total: '500', lines: 40, measurements: 1 },
      { key: { typology: 'B' }, unit: 'm²', total: '886', lines: 40, measurements: 1 },
      { key: { typology: 'C' }, unit: 'm', total: '250', lines: 20, measurements: 1 },
      { key: { typology: 'C' }, unit: 'm²', total: '600', lines: 20, measurements: 1 },
      { key: { typology: null }, unit: 'm²', total: '33.3', lines: 1, measurements: 1 },
    ]);
    expect(grandTotals(byTyp)).toEqual([{ unit: 'm', total: '1500' }, { unit: 'm²', total: '2623.3' }]);
    expect(grandTotals(consolidate(lines, []))).toEqual(grandTotals(byTyp));
    expect(grandTotals(consolidate(lines, ['BLOCK_QUADRA', 'service']))).toEqual(grandTotals(byTyp));
  });

  it('filtros restringem sem duplicar; uma linha conta em um único grupo', () => {
    const q1 = consolidate(lines, ['service'], { BLOCK_QUADRA: ['Q1'] });
    expect(q1).toEqual([
      { key: { service: 'REV.004' }, unit: 'm²', total: '1295', lines: 60, measurements: 3 }, // 30 × 18,4 + 20 × 22,15 + 10 × 30
      { key: { service: 'REV.005' }, unit: 'm', total: '750', lines: 60, measurements: 3 },
    ]);
    const both = consolidate(lines, ['BLOCK_QUADRA'], { service: ['REV.004'] });
    const sum = both.reduce((a, r) => a + r.lines, 0);
    expect(sum).toBe(121);
    expect(consolidate(lines, ['unit'], { unit: ['u7'] })).toEqual([
      { key: { unit: 'u7' }, unit: 'm', total: '12.5', lines: 1, measurements: 1 },
      { key: { unit: 'u7' }, unit: 'm²', total: '18.4', lines: 1, measurements: 1 },
    ]);
  });

  it('soma decimal exata com muitas linhas', () => {
    const many: ConsolidationLine[] = Array.from({ length: 10_000 }, (_, i) => ({ measurementId: `m${i}`, quantity: '0.1', unit: 'm', attrs: {} }));
    expect(consolidate(many, [])[0]!.total).toBe('1000');
  });
});
