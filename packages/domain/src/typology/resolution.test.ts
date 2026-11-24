import { describe, expect, it } from 'vitest';
import { diffRevisions, propagationImpact, resolveUnitElements, type RevisionElement } from './resolution.js';

const el = (stableKey: string, name: string, parent: string | null = null, attributes: Record<string, unknown> = {}): RevisionElement => ({
  stableKey, parentStableKey: parent, name, elementTypeId: 'tipo', attributes,
});

const r1 = [el('sala', 'Sala', null, { area: '18' }), el('quarto1', 'Quarto 1'), el('piso-sala', 'Piso da sala', 'sala'), el('varanda', 'Varanda')];
const r2 = [el('sala', 'Sala', null, { area: '19.5' }), el('quarto1', 'Quarto 1'), el('piso-sala', 'Piso da sala', 'sala'), el('lavabo', 'Lavabo')];

describe('resolução da unidade (tipologia + particularidades)', () => {
  it('unidade sem particularidades herda todos os elementos da revisão', () => {
    const r = resolveUnitElements(r1, []);
    expect(r.elements.map((e) => e.stableKey)).toEqual(['sala', 'quarto1', 'piso-sala', 'varanda']);
    expect(r.elements.every((e) => e.source === 'TYPOLOGY')).toBe(true);
  });
  it('exclusão remove o elemento e seus subelementos; inclusão acrescenta elemento próprio', () => {
    const r = resolveUnitElements(r1, [
      { id: 'o1', op: 'EXCLUDE_ELEMENT', targetStableKey: 'sala' },
      { id: 'o2', op: 'ADD_ELEMENT', parentStableKey: 'quarto1', name: 'Armário embutido', elementTypeId: 'tipo', attributes: {} },
    ]);
    expect(r.excluded.map((e) => e.stableKey)).toEqual(['sala', 'piso-sala']);
    expect(r.elements.map((e) => e.name)).toEqual(['Quarto 1', 'Varanda', 'Armário embutido']);
    expect(r.elements.at(-1)).toMatchObject({ source: 'UNIT', overrideId: 'o2' });
  });
  it('particularidade sobrevive a uma nova revisão; alvo removido vira conflito, nunca é apagado', () => {
    const overrides = [
      { id: 'o1', op: 'EXCLUDE_ELEMENT' as const, targetStableKey: 'varanda' },
      { id: 'o2', op: 'ADD_ELEMENT' as const, parentStableKey: 'quarto1', name: 'Armário', elementTypeId: 'tipo', attributes: {} },
    ];
    const impact = propagationImpact(r1, r2, overrides);
    expect(impact.conflicts).toEqual([{ overrideId: 'o1', reason: 'O elemento excluído não existe na revisão fixada.' }]);
    const after = resolveUnitElements(r2, overrides);
    expect(after.elements.map((e) => e.name)).toContain('Armário');
    expect(after.elements.map((e) => e.name)).toContain('Lavabo');
  });
  it('compara revisões por chave estável (inclusões, exclusões e alterações)', () => {
    const d = diffRevisions(r1, r2);
    expect(d.added.map((e) => e.stableKey)).toEqual(['lavabo']);
    expect(d.removed.map((e) => e.stableKey)).toEqual(['varanda']);
    expect(d.changed.map((c) => c.after.stableKey)).toEqual(['sala']);
    expect(d.unchanged).toBe(2);
  });
});
