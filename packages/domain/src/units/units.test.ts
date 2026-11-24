import { describe, expect, it } from 'vitest';
import { convert, DEFAULT_UNITS, describeDimension, multiplyDimensions, UnitConversionError, validateUnit } from './units.js';
import { DEFAULT_ELEMENT_TYPES } from '../catalog/defaults.js';
import { DEFAULT_SERVICE_CATEGORIES, DEFAULT_SERVICES } from '../services/defaults.js';
import { normalizeDescription } from '../services/normalize.js';

const U = (s: string) => DEFAULT_UNITS.find((u) => u.symbol === s)!;

describe('conversão de unidades (valores conhecidos, decimal exato)', () => {
  it('comprimento, área, volume e massa', () => {
    expect(convert('250', U('cm'), U('m'))).toBe('2.5');
    expect(convert('1', U('m²'), U('cm²'))).toBe('10000');
    expect(convert('2.5', U('ha'), U('m²'))).toBe('25000');
    expect(convert('1', U('m³'), U('L'))).toBe('1000');
    expect(convert('3.2', U('t'), U('kg'))).toBe('3200');
    expect(convert('600', U('mm'), U('m'))).toBe('0.6');
  });
  it('não introduz erro de ponto flutuante (0,1 + 0,2)', () => {
    expect(convert('0.3', U('m'), U('cm'))).toBe('30');
    expect(convert('0.1', U('m'), U('mm'))).toBe('100');
  });
  it('vazão e porcentagem', () => {
    expect(convert('36', U('m³/h'), U('L/s'))).toBe('10');
    expect(convert('0.6', U('%'), DEFAULT_UNITS.find((u) => u.symbol === '%')!)).toBe('0.6');
  });
  it('rejeita grandezas incompatíveis', () => {
    expect(() => convert('1', U('m'), U('m²'))).toThrow(UnitConversionError);
    expect(() => convert('1', U('kg'), U('un'))).toThrow(/Massa.*Contagem/);
  });
});

describe('dimensões', () => {
  it('nomeia grandezas e compõe dimensões', () => {
    expect(describeDimension(U('m³').dimension)).toBe('Volume');
    expect(describeDimension(multiplyDimensions(U('m').dimension, U('m²').dimension))).toBe('Volume');
    expect(describeDimension({ L: 1, M: 0, T: -1, N: 0 })).toBe('L·T⁻¹');
  });
  it('valida unidades criadas pelo usuário', () => {
    expect(validateUnit({ symbol: 'pol', factor: '0.0254', decimals: 2, dimension: { L: 1, M: 0, T: 0, N: 0 } })).toEqual([]);
    expect(validateUnit({ symbol: 'x y', factor: '0', decimals: 9, dimension: { L: 7, M: 0, T: 0, N: 0 } })).toHaveLength(4);
  });
});

describe('catálogos padrão coerentes', () => {
  it('símbolos únicos e todos os atributos/serviços padrão usam unidades existentes', () => {
    const symbols = new Set(DEFAULT_UNITS.map((u) => u.symbol));
    expect(symbols.size).toBe(DEFAULT_UNITS.length);
    for (const t of DEFAULT_ELEMENT_TYPES) for (const a of t.attributes) if (a.unit) expect(symbols.has(a.unit), `${t.code}.${a.key}: ${a.unit}`).toBe(true);
    const cats = new Set(DEFAULT_SERVICE_CATEGORIES.map((c) => c.code));
    for (const s of DEFAULT_SERVICES) {
      expect(symbols.has(s.unit), s.code).toBe(true);
      expect(cats.has(s.categoryCode), s.code).toBe(true);
    }
    expect(new Set(DEFAULT_SERVICES.map((s) => s.code)).size).toBe(DEFAULT_SERVICES.length);
  });
});

describe('normalização de descrição', () => {
  it('ignora acentos, caixa, pontuação e símbolos de unidade', () => {
    expect(normalizeDescription('  Escavação  mecânica — 1ª CATEGORIA, até 2,5 m³ ')).toBe('escavacao mecanica 1a categoria ate 2.5 m3');
    expect(normalizeDescription('Piso cerâmico')).toBe(normalizeDescription('PISO  CERAMICO.'));
  });
});
