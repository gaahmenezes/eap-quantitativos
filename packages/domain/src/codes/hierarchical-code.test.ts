import { describe, expect, it } from 'vitest';
import { deriveTreeCodes, formatHierarchicalCode } from './hierarchical-code.js';

describe('formatHierarchicalCode', () => {
  it('aplica larguras por nível (padrão 01.02.003)', () => {
    expect(formatHierarchicalCode([1, 2, 3])).toBe('01.02.003');
    expect(formatHierarchicalCode([12])).toBe('12');
    expect(formatHierarchicalCode([1, 1, 1, 4])).toBe('01.01.001.004');
  });
  it('rejeita posições inválidas', () => {
    expect(() => formatHierarchicalCode([0])).toThrow();
    expect(() => formatHierarchicalCode([1.5])).toThrow();
  });
});

describe('deriveTreeCodes', () => {
  const nodes = [
    { id: 'b', parentId: null, position: 2 },
    { id: 'a', parentId: null, position: 1 },
    { id: 'a2', parentId: 'a', position: 20 },
    { id: 'a1', parentId: 'a', position: 10 },
    { id: 'a1x', parentId: 'a1', position: 1 },
  ];
  it('deriva códigos pela ordem de position, independentemente da ordem de entrada', () => {
    const codes = deriveTreeCodes(nodes);
    expect(codes.get('a')).toBe('01');
    expect(codes.get('b')).toBe('02');
    expect(codes.get('a1')).toBe('01.01');
    expect(codes.get('a2')).toBe('01.02');
    expect(codes.get('a1x')).toBe('01.01.001');
    expect(deriveTreeCodes([...nodes].reverse())).toEqual(codes);
  });
  it('mover um nó altera apenas códigos, preservando ids', () => {
    const moved = nodes.map((n) => (n.id === 'a1x' ? { ...n, parentId: 'b' } : n));
    const codes = deriveTreeCodes(moved);
    expect(codes.get('a1x')).toBe('02.01');
  });
  it('detecta nós órfãos', () => {
    expect(() => deriveTreeCodes([{ id: 'x', parentId: 'ghost', position: 1 }])).toThrow();
  });
});
