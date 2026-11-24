import { describe, expect, it } from 'vitest';
import { allowedChildKinds, canPlace, canPlaceSubtree } from './rules.js';
import { planStructure, StructurePlanError, type StructurePlanInput } from './planner.js';
import { SCENARIO_A_VERTICAL, SCENARIO_B_HORIZONTAL, SCENARIO_C_LOTEAMENTO, SCENARIO_D_MISTO } from './scenarios.js';

describe('regras de hierarquia', () => {
  it('pavimento só existe sob torre ou bloco; unidade vertical só sob pavimento', () => {
    expect(canPlace('VERTICAL_RESIDENTIAL', 'TOWER', 'FLOOR')).toBe(true);
    expect(canPlace('VERTICAL_RESIDENTIAL', 'SECTOR', 'FLOOR')).toBe(false);
    expect(canPlace('VERTICAL_RESIDENTIAL', 'FLOOR', 'DWELLING_UNIT')).toBe(true);
    expect(canPlace('VERTICAL_RESIDENTIAL', 'SECTOR', 'DWELLING_UNIT')).toBe(false);
    expect(canPlace('VERTICAL_RESIDENTIAL', null, 'DWELLING_UNIT')).toBe(false);
  });
  it('lote só existe sob quadra; rua só tem trechos', () => {
    expect(canPlace('LAND_SUBDIVISION', 'BLOCK_QUADRA', 'LOT')).toBe(true);
    expect(canPlace('LAND_SUBDIVISION', 'PHASE', 'LOT')).toBe(false);
    expect(allowedChildKinds('LAND_SUBDIVISION', 'STREET')).toEqual(['STREET_SECTION']);
    expect(allowedChildKinds('LAND_SUBDIVISION', 'LOT')).toEqual([]);
  });
  it('cada módulo restringe seus tipos (torre não existe em loteamento)', () => {
    expect(canPlace('LAND_SUBDIVISION', null, 'TOWER')).toBe(false);
    expect(canPlace('COMMON_AREAS', null, 'LOT')).toBe(false);
  });
  it('valida subárvores ao mover', () => {
    const tower = { kind: 'TOWER' as const, children: [{ kind: 'FLOOR' as const, children: [] }] };
    expect(canPlaceSubtree('VERTICAL_RESIDENTIAL', 'SECTOR', tower)).toBe(true);
    expect(canPlaceSubtree('VERTICAL_RESIDENTIAL', 'FLOOR', tower)).toBe(false);
  });
});

describe('cenário A — vertical: 2 torres × 10 pavimentos, 2 tipologias', () => {
  const plan = planStructure(SCENARIO_A_VERTICAL);
  it('gera torres, pavimentos (com térreo) e unidades com contagens exatas', () => {
    expect(plan.counts.TOWER).toBe(2);
    expect(plan.counts.FLOOR).toBe(22); // 2 × (10 + térreo)
    expect(plan.counts.DWELLING_UNIT).toBe(80); // 2 × 10 × 4
    expect(plan.unitsByTypology).toEqual({ '2Q': 40, '3Q': 40 });
    expect(plan.unitsWithoutTypology).toBe(0);
    expect(plan.counts.COMMON_AREA).toBe(3);
    expect(plan.counts.TECHNICAL_AREA).toBe(1);
    expect(plan.counts.STREET_SECTION).toBe(3);
  });
  it('numera unidades por pavimento e posição (Apto 101 … Apto 1004)', () => {
    const units = plan.modules[0]!.nodes.filter((n) => n.kind === 'DWELLING_UNIT');
    expect(units[0]).toMatchObject({ name: 'Apto 101', typologyCode: '2Q' });
    expect(units[3]).toMatchObject({ name: 'Apto 104', typologyCode: '3Q' });
    expect(units.at(-1)).toMatchObject({ name: 'Apto 1004' });
  });
  it('é determinístico', () => {
    expect(planStructure(SCENARIO_A_VERTICAL)).toEqual(plan);
    expect(JSON.stringify(planStructure(structuredClone(SCENARIO_A_VERTICAL)))).toBe(JSON.stringify(plan));
  });
});

describe('cenário B — horizontal: 120 casas em 3 tipologias (60/40/20)', () => {
  const plan = planStructure(SCENARIO_B_HORIZONTAL);
  it('gera quadras, lotes e casas com a distribuição exata', () => {
    expect(plan.counts.BLOCK_QUADRA).toBe(4);
    expect(plan.counts.LOT).toBe(120);
    expect(plan.counts.DWELLING_UNIT).toBe(120);
    expect(plan.unitsByTypology).toEqual({ A: 60, B: 40, C: 20 });
    expect(plan.counts.COMMON_AREA).toBe(5);
  });
  it('atribui tipologias em sequência na ordem das quadras e lotes', () => {
    const houses = plan.modules[0]!.nodes.filter((n) => n.kind === 'DWELLING_UNIT');
    expect(houses[59]).toMatchObject({ typologyCode: 'A', name: 'Casa Quadra 2 L30' });
    expect(houses[60]).toMatchObject({ typologyCode: 'B', name: 'Casa Quadra 3 L01' });
    expect(houses[100]).toMatchObject({ typologyCode: 'C' });
  });
  it('cada casa fica sob um lote', () => {
    const byKey = new Map(plan.modules[0]!.nodes.map((n) => [n.key, n]));
    for (const h of plan.modules[0]!.nodes.filter((n) => n.kind === 'DWELLING_UNIT')) {
      expect(byKey.get(h.parentKey!)!.kind).toBe('LOT');
    }
  });
});

describe('cenário C — loteamento com fases, quadras, lotes, ruas e áreas', () => {
  const plan = planStructure(SCENARIO_C_LOTEAMENTO);
  it('organiza o cadastro por fase, quadra e lote', () => {
    expect(plan.counts.PHASE).toBe(2);
    expect(plan.counts.BLOCK_QUADRA).toBe(5);
    expect(plan.counts.LOT).toBe(100);
    expect(plan.counts.STREET).toBe(3);
    expect(plan.counts.STREET_SECTION).toBe(13);
    expect(plan.counts.INSTITUTIONAL_AREA).toBe(1);
    expect(plan.counts.GREEN_AREA).toBe(2);
    expect(plan.counts.DWELLING_UNIT).toBeUndefined();
  });
});

describe('cenário D — misto: torres, casas, lotes e áreas comuns sem hierarquia imposta', () => {
  const plan = planStructure(SCENARIO_D_MISTO);
  it('mantém cada domínio no seu módulo', () => {
    expect(plan.modules.map((m) => m.kind)).toEqual([
      'VERTICAL_RESIDENTIAL',
      'HORIZONTAL_RESIDENTIAL',
      'LAND_SUBDIVISION',
      'COMMON_AREAS',
    ]);
    expect(plan.counts.DWELLING_UNIT).toBe(48 + 40);
    expect(plan.unitsByTypology).toEqual({ AP2: 48, CS1: 40 });
    expect(plan.counts.LOT).toBe(12);
    // casas sem lote: raiz do módulo horizontal
    expect(plan.modules[1]!.nodes.every((n) => n.parentKey === null)).toBe(true);
  });
});

describe('validações do assistente', () => {
  const issues = (input: StructurePlanInput) => {
    try {
      planStructure(input);
      return [];
    } catch (e) {
      if (e instanceof StructurePlanError) return e.issues;
      throw e;
    }
  };
  it('rejeita distribuição de tipologias que não fecha com o total de casas', () => {
    const r = issues({
      typologies: [{ code: 'A', name: 'A', kind: 'HOUSE' }],
      modules: [{ kind: 'HORIZONTAL_RESIDENTIAL', name: 'Casas', layout: 'UNITS', houseCount: 10, typologyDistribution: [{ typologyCode: 'A', quantity: 9 }] }],
    });
    expect(r[0]?.message).toMatch(/\(9\).*\(10\)/);
  });
  it('rejeita tipologia de casa em apartamento e tipologia inexistente', () => {
    const r = issues({
      typologies: [{ code: 'CASA', name: 'Casa', kind: 'HOUSE' }],
      modules: [{ kind: 'VERTICAL_RESIDENTIAL', name: 'T', towers: [{ name: 'T1', floors: 1, unitsPerFloor: 2, unitTypologies: ['CASA', 'XX'] }] }],
    });
    expect(r.map((i) => i.path)).toEqual(['modules.0.towers.0.unitTypologies.0', 'modules.0.towers.0.unitTypologies.1']);
  });
  it('rejeita nomes repetidos, quantidades fora do limite e códigos de tipologia duplicados', () => {
    const r = issues({
      typologies: [{ code: 'A', name: 'A', kind: 'APARTMENT' }, { code: 'A', name: 'A2', kind: 'APARTMENT' }],
      modules: [{ kind: 'VERTICAL_RESIDENTIAL', name: 'T', towers: [{ name: 'Torre', floors: 0, unitsPerFloor: 2 }, { name: 'torre', floors: 2, unitsPerFloor: 2 }] }],
    });
    expect(r.map((i) => i.path)).toEqual(expect.arrayContaining(['typologies.1.code', 'modules.0.towers.1.name', 'modules.0.towers.0.floors']));
  });
  it('rejeita estruturas acima do limite total', () => {
    const r = issues({
      typologies: [],
      modules: [{ kind: 'VERTICAL_RESIDENTIAL', name: 'T', towers: Array.from({ length: 50 }, (_, i) => ({ name: `T${i}`, floors: 200, unitsPerFloor: 10 })) }],
    });
    expect(r.at(-1)?.message).toMatch(/excede o limite/);
  });
});
