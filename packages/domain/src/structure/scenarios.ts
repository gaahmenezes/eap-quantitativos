/** Cenários de aceitação da diretriz (seção 20), reutilizados por testes de domínio, API e E2E. */
import type { StructurePlanInput } from './planner.js';

export const SCENARIO_A_VERTICAL: StructurePlanInput = {
  typologies: [
    { code: '2Q', name: 'Apartamento 2 quartos', kind: 'APARTMENT' },
    { code: '3Q', name: 'Apartamento 3 quartos', kind: 'APARTMENT' },
  ],
  modules: [
    {
      kind: 'VERTICAL_RESIDENTIAL',
      name: 'Torres residenciais',
      towers: ['Torre A', 'Torre B'].map((name) => ({
        name,
        floors: 10,
        unitsPerFloor: 4,
        groundFloor: true,
        unitTypologies: ['2Q', '2Q', '3Q', '3Q'],
      })),
    },
    {
      kind: 'COMMON_AREAS',
      name: 'Áreas comuns',
      areas: [
        { kind: 'COMMON_AREA', name: 'Portaria' },
        { kind: 'COMMON_AREA', name: 'Salão de festas' },
        { kind: 'COMMON_AREA', name: 'Piscina' },
        { kind: 'TECHNICAL_AREA', name: 'Reservatório inferior' },
      ],
    },
    { kind: 'INFRASTRUCTURE', name: 'Infraestrutura externa', streets: [{ name: 'Via interna', sectionCount: 3 }] },
  ],
};

export const SCENARIO_B_HORIZONTAL: StructurePlanInput = {
  typologies: [
    { code: 'A', name: 'Casa tipo A', kind: 'HOUSE' },
    { code: 'B', name: 'Casa tipo B', kind: 'HOUSE' },
    { code: 'C', name: 'Casa tipo C', kind: 'HOUSE' },
  ],
  modules: [
    {
      kind: 'HORIZONTAL_RESIDENTIAL',
      name: 'Casas',
      layout: 'LOTS',
      blocks: [
        { name: 'Quadra 1', lotCount: 30 },
        { name: 'Quadra 2', lotCount: 30 },
        { name: 'Quadra 3', lotCount: 30 },
        { name: 'Quadra 4', lotCount: 30 },
      ],
      typologyDistribution: [
        { typologyCode: 'A', quantity: 60 },
        { typologyCode: 'B', quantity: 40 },
        { typologyCode: 'C', quantity: 20 },
      ],
    },
    {
      kind: 'COMMON_AREAS',
      name: 'Áreas comuns',
      areas: ['Portaria', 'Salão de festas', 'Piscina', 'Quadra poliesportiva', 'Paisagismo'].map((name) => ({
        kind: 'COMMON_AREA' as const,
        name,
      })),
    },
    {
      kind: 'INFRASTRUCTURE',
      name: 'Infraestrutura',
      streets: [
        { name: 'Rua 1', sectionCount: 4 },
        { name: 'Rua 2', sectionCount: 4 },
      ],
    },
  ],
};

export const SCENARIO_C_LOTEAMENTO: StructurePlanInput = {
  typologies: [],
  modules: [
    {
      kind: 'LAND_SUBDIVISION',
      name: 'Loteamento',
      phases: [
        { name: 'Fase 1', blocks: [{ name: 'Quadra A', lotCount: 20 }, { name: 'Quadra B', lotCount: 18 }] },
        { name: 'Fase 2', blocks: [{ name: 'Quadra C', lotCount: 24 }, { name: 'Quadra D', lotCount: 16 }, { name: 'Quadra E', lotCount: 22 }] },
      ],
      streets: [
        { name: 'Avenida Principal', sectionCount: 6 },
        { name: 'Rua das Palmeiras', sectionCount: 4 },
        { name: 'Rua dos Ipês', sectionCount: 3 },
      ],
      areas: [
        { kind: 'INSTITUTIONAL_AREA', name: 'Área institucional 1' },
        { kind: 'GREEN_AREA', name: 'Área verde 1' },
        { kind: 'GREEN_AREA', name: 'Área verde 2' },
      ],
    },
  ],
};

export const SCENARIO_D_MISTO: StructurePlanInput = {
  typologies: [
    { code: 'AP2', name: 'Apartamento 2 quartos', kind: 'APARTMENT' },
    { code: 'CS1', name: 'Casa térrea', kind: 'HOUSE' },
  ],
  modules: [
    {
      kind: 'VERTICAL_RESIDENTIAL',
      name: 'Setor vertical',
      towers: [{ name: 'Torre 1', floors: 8, unitsPerFloor: 6, unitTypologies: Array(6).fill('AP2') }],
    },
    {
      kind: 'HORIZONTAL_RESIDENTIAL',
      name: 'Setor de casas',
      layout: 'UNITS',
      houseCount: 40,
      typologyDistribution: [{ typologyCode: 'CS1', quantity: 40 }],
    },
    {
      kind: 'LAND_SUBDIVISION',
      name: 'Lotes comerciais',
      phases: [{ name: 'Fase única', blocks: [{ name: 'Quadra 10', lotCount: 12 }] }],
      streets: [{ name: 'Rua Comercial', sectionCount: 2 }],
    },
    { kind: 'COMMON_AREAS', name: 'Áreas comuns', areas: [{ kind: 'COMMON_AREA', name: 'Clube' }] },
  ],
};
