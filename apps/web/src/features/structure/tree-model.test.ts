import { describe, expect, it } from 'vitest';
import type { StructureDto, StructureNodeDto } from '@eapq/contracts';
import { ancestorsOf, indexStructure, isInSubtree, visibleRows } from './tree-model';

const node = (id: string, parentId: string | null, position: number, extra: Partial<StructureNodeDto> = {}): StructureNodeDto => ({
  id,
  moduleId: 'm1',
  parentId,
  kind: 'FLOOR',
  name: id,
  code: '',
  position,
  depth: parentId ? 1 : 0,
  origin: 'WIZARD',
  archivedAt: null,
  version: 1,
  ...extra,
});

const s: StructureDto = {
  modules: [{ id: 'm1', kind: 'VERTICAL_RESIDENTIAL', name: 'Torres', code: '01', position: 1, archivedAt: null, version: 1 }],
  nodes: [
    node('torre-b', null, 2, { kind: 'TOWER', name: 'Torre B' }),
    node('torre-a', null, 1, { kind: 'TOWER', name: 'Torre A' }),
    node('p1', 'torre-a', 1, { name: '1º pavimento', code: '01.01.001' }),
    node('p2', 'torre-a', 2, { name: '2º pavimento', archivedAt: '2026-11-24T00:00:00Z' }),
    node('apto', 'p1', 1, { kind: 'DWELLING_UNIT', name: 'Apto 101', depth: 2 }),
  ],
};

describe('modelo da árvore', () => {
  it('mostra só o módulo quando nada está expandido e ordena irmãos por posição', () => {
    const idx = indexStructure(s, false);
    expect(visibleRows(idx, new Set(), '').map((r) => r.id)).toEqual(['m1']);
    expect(visibleRows(idx, new Set(['m1']), '').map((r) => r.id)).toEqual(['m1', 'torre-a', 'torre-b']);
  });
  it('oculta arquivados por padrão e conta descendentes', () => {
    const idx = indexStructure(s, false);
    expect(idx.descendants.get('torre-a')).toBe(2);
    expect(visibleRows(idx, new Set(['m1', 'torre-a']), '').map((r) => r.id)).toEqual(['m1', 'torre-a', 'p1', 'torre-b']);
    expect(indexStructure(s, true).descendants.get('torre-a')).toBe(3);
  });
  it('busca sem acentos revela o caminho até o item encontrado', () => {
    const idx = indexStructure(s, false);
    expect(visibleRows(idx, new Set(), 'apto').map((r) => r.id)).toEqual(['m1', 'torre-a', 'p1', 'apto']);
    expect(visibleRows(idx, new Set(), 'PAVIMENTO').map((r) => r.id)).toEqual(['m1', 'torre-a', 'p1']);
    expect(visibleRows(idx, new Set(), '01.01.001').map((r) => r.id)).toEqual(['m1', 'torre-a', 'p1']);
  });
  it('calcula ancestrais e pertinência à subárvore', () => {
    const idx = indexStructure(s, false);
    expect(ancestorsOf(idx, 'apto')).toEqual(['m1', 'p1', 'torre-a']);
    expect(isInSubtree(idx, 'torre-a', 'apto')).toBe(true);
    expect(isInSubtree(idx, 'torre-b', 'apto')).toBe(false);
  });
});
