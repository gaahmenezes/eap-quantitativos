/**
 * Regras de hierarquia do cadastro físico (F2). Cada módulo do empreendimento (ADR-011)
 * define quais tipos de nó podem ser raiz e quais filhos cada tipo aceita.
 * Regras explícitas por módulo evitam relacionamentos inconsistentes
 * (ex.: apartamento direto sob um setor de um módulo vertical).
 */
export const MODULE_KINDS = [
  'VERTICAL_RESIDENTIAL',
  'HORIZONTAL_RESIDENTIAL',
  'LAND_SUBDIVISION',
  'COMMON_AREAS',
  'INFRASTRUCTURE',
] as const;
export type ModuleKind = (typeof MODULE_KINDS)[number];

export const NODE_KINDS = [
  'PHASE',
  'STAGE',
  'SECTOR',
  'BLOCK_QUADRA',
  'LOT',
  'STREET',
  'STREET_SECTION',
  'TOWER',
  'BUILDING_BLOCK',
  'FLOOR',
  'DWELLING_UNIT',
  'COMMON_AREA',
  'TECHNICAL_AREA',
  'INSTITUTIONAL_AREA',
  'GREEN_AREA',
] as const;
export type NodeKind = (typeof NODE_KINDS)[number];

export const MODULE_KIND_LABELS: Record<ModuleKind, string> = {
  VERTICAL_RESIDENTIAL: 'Residencial vertical',
  HORIZONTAL_RESIDENTIAL: 'Residencial horizontal',
  LAND_SUBDIVISION: 'Loteamento',
  COMMON_AREAS: 'Áreas comuns',
  INFRASTRUCTURE: 'Infraestrutura',
};

export const NODE_KIND_LABELS: Record<NodeKind, string> = {
  PHASE: 'Fase',
  STAGE: 'Etapa',
  SECTOR: 'Setor',
  BLOCK_QUADRA: 'Quadra',
  LOT: 'Lote',
  STREET: 'Rua',
  STREET_SECTION: 'Trecho de rua',
  TOWER: 'Torre',
  BUILDING_BLOCK: 'Bloco',
  FLOOR: 'Pavimento',
  DWELLING_UNIT: 'Unidade habitacional',
  COMMON_AREA: 'Área comum',
  TECHNICAL_AREA: 'Área técnica',
  INSTITUTIONAL_AREA: 'Área institucional',
  GREEN_AREA: 'Área verde',
};

interface ModuleRules {
  roots: readonly NodeKind[];
  children: Partial<Record<NodeKind, readonly NodeKind[]>>;
}

const areas = ['COMMON_AREA', 'TECHNICAL_AREA'] as const;

export const MODULE_RULES: Record<ModuleKind, ModuleRules> = {
  VERTICAL_RESIDENTIAL: {
    roots: ['PHASE', 'SECTOR', 'BUILDING_BLOCK', 'TOWER'],
    children: {
      PHASE: ['SECTOR', 'BUILDING_BLOCK', 'TOWER'],
      SECTOR: ['BUILDING_BLOCK', 'TOWER'],
      BUILDING_BLOCK: ['TOWER', 'FLOOR'],
      TOWER: ['FLOOR'],
      FLOOR: ['DWELLING_UNIT', ...areas],
    },
  },
  HORIZONTAL_RESIDENTIAL: {
    roots: ['PHASE', 'SECTOR', 'BLOCK_QUADRA', 'DWELLING_UNIT'],
    children: {
      PHASE: ['SECTOR', 'BLOCK_QUADRA', 'DWELLING_UNIT'],
      SECTOR: ['BLOCK_QUADRA', 'DWELLING_UNIT'],
      BLOCK_QUADRA: ['LOT', 'DWELLING_UNIT'],
      LOT: ['DWELLING_UNIT'],
    },
  },
  LAND_SUBDIVISION: {
    roots: ['PHASE', 'SECTOR', 'BLOCK_QUADRA', 'STREET', 'INSTITUTIONAL_AREA', 'GREEN_AREA'],
    children: {
      PHASE: ['STAGE', 'SECTOR', 'BLOCK_QUADRA', 'STREET', 'INSTITUTIONAL_AREA', 'GREEN_AREA'],
      STAGE: ['SECTOR', 'BLOCK_QUADRA', 'STREET', 'INSTITUTIONAL_AREA', 'GREEN_AREA'],
      SECTOR: ['BLOCK_QUADRA', 'STREET', 'INSTITUTIONAL_AREA', 'GREEN_AREA'],
      BLOCK_QUADRA: ['LOT'],
      STREET: ['STREET_SECTION'],
    },
  },
  COMMON_AREAS: {
    roots: [...areas],
    children: { COMMON_AREA: [...areas] },
  },
  INFRASTRUCTURE: {
    roots: ['PHASE', 'SECTOR', 'STREET'],
    children: {
      PHASE: ['SECTOR', 'STREET'],
      SECTOR: ['STREET'],
      STREET: ['STREET_SECTION'],
    },
  },
};

/** Tipos permitidos como filho de `parentKind` (null = raiz do módulo). */
export function allowedChildKinds(moduleKind: ModuleKind, parentKind: NodeKind | null): readonly NodeKind[] {
  const rules = MODULE_RULES[moduleKind];
  return parentKind === null ? rules.roots : (rules.children[parentKind] ?? []);
}

export function canPlace(moduleKind: ModuleKind, parentKind: NodeKind | null, kind: NodeKind): boolean {
  return allowedChildKinds(moduleKind, parentKind).includes(kind);
}

/** Valida que uma subárvore inteira (kinds relativos) continua válida sob um novo pai. */
export function canPlaceSubtree(
  moduleKind: ModuleKind,
  newParentKind: NodeKind | null,
  subtree: { kind: NodeKind; children: { kind: NodeKind; children: unknown[] }[] },
): boolean {
  if (!canPlace(moduleKind, newParentKind, subtree.kind)) return false;
  const walk = (n: { kind: NodeKind; children: { kind: NodeKind; children: unknown[] }[] }): boolean =>
    n.children.every(
      (c) => canPlace(moduleKind, n.kind, c.kind) && walk(c as Parameters<typeof walk>[0]),
    );
  return walk(subtree);
}
