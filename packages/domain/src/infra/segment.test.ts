import { describe, expect, it } from 'vitest';
import { segmentGeometry, sumDecimals } from './segment.js';

describe('geometria de trecho', () => {
  it('calcula declividade e profundidades com resultado exato (valores conhecidos)', () => {
    // PV-01: tampa 100,000 / fundo 98,500 ; PV-02: tampa 99,600 / fundo 98,200 ; L = 50 m
    const g = segmentGeometry({
      length: '50',
      fromNode: { coverElevation: '100.000', bottomElevation: '98.500' },
      toNode: { coverElevation: '99.600', bottomElevation: '98.200' },
    });
    expect(g).toEqual({ slope: '0.006', slopePercent: '0.6', upstreamDepth: '1.5', downstreamDepth: '1.4', averageDepth: '1.45', adverseSlope: false });
  });
  it('prefere as cotas de fundo do próprio trecho às dos dispositivos', () => {
    const g = segmentGeometry({ length: '40', upstreamInvert: '10.30', downstreamInvert: '10.10', fromNode: { bottomElevation: '0' }, toNode: { bottomElevation: '0' } });
    expect(g.slope).toBe('0.005');
  });
  it('sinaliza declividade adversa e não inventa valores sem dados', () => {
    expect(segmentGeometry({ length: '10', upstreamInvert: '5', downstreamInvert: '5.1' }).adverseSlope).toBe(true);
    expect(segmentGeometry({ length: null, upstreamInvert: '5', downstreamInvert: '4' }).slope).toBeNull();
    expect(segmentGeometry({ length: '10' }).averageDepth).toBeNull();
  });
  it('soma comprimentos sem erro de ponto flutuante', () => {
    expect(sumDecimals(['0.1', '0.2', null, '12.345'])).toBe('12.645');
  });
});
