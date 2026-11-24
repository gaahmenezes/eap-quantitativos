import { z } from 'zod';
import { optionalText, requiredText } from './common.js';

export const moduleKindSchema = z.enum([
  'VERTICAL_RESIDENTIAL',
  'HORIZONTAL_RESIDENTIAL',
  'LAND_SUBDIVISION',
  'COMMON_AREAS',
  'INFRASTRUCTURE',
]);
export type ModuleKindDto = z.infer<typeof moduleKindSchema>;

export const nodeKindSchema = z.enum([
  'PHASE', 'STAGE', 'SECTOR', 'BLOCK_QUADRA', 'LOT', 'STREET', 'STREET_SECTION', 'TOWER',
  'BUILDING_BLOCK', 'FLOOR', 'DWELLING_UNIT', 'COMMON_AREA', 'TECHNICAL_AREA', 'INSTITUTIONAL_AREA', 'GREEN_AREA',
]);
export type NodeKindDto = z.infer<typeof nodeKindSchema>;

export const typologyKindSchema = z.enum(['APARTMENT', 'HOUSE']);

export const typologyCode = z
  .string()
  .trim()
  .toUpperCase()
  .min(1, 'Campo obrigatório')
  .max(20, 'Máximo de 20 caracteres')
  .regex(/^[A-Z0-9][A-Z0-9._-]*$/, 'Use letras, números, ponto, hífen ou sublinhado');

const count = (max: number) => z.number({ message: 'Informe um número' }).int('Use um número inteiro').min(0).max(max);
const name = requiredText(120);

/** Decimal positivo como texto (ex.: "360.5"); nunca float no transporte de medidas. */
export const positiveDecimal = z
  .string()
  .trim()
  .regex(/^\d{1,10}([.,]\d{1,4})?$/, 'Use um número positivo com até 4 casas decimais')
  .transform((v) => v.replace(',', '.'))
  .refine((v) => Number(v) > 0, 'Deve ser maior que zero');

// ----- Assistente (espelha packages/domain/structure/planner.ts) -----
const towerSchema = z.object({
  name,
  floors: count(200),
  unitsPerFloor: count(60),
  groundFloor: z.boolean().optional(),
  unitTypologies: z.array(typologyCode.nullable()).max(60).optional(),
});
const blockSchema = z.object({ name, lotCount: count(500) });
const streetSchema = z.object({ name, sectionCount: count(200) });

export const wizardModuleSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('VERTICAL_RESIDENTIAL'), name, towers: z.array(towerSchema).max(50) }),
  z.object({
    kind: z.literal('HORIZONTAL_RESIDENTIAL'),
    name,
    layout: z.enum(['UNITS', 'LOTS']),
    houseCount: count(10_000).optional(),
    blocks: z.array(blockSchema).max(500).optional(),
    typologyDistribution: z.array(z.object({ typologyCode, quantity: count(10_000) })).max(50).optional(),
  }),
  z.object({
    kind: z.literal('LAND_SUBDIVISION'),
    name,
    phases: z.array(z.object({ name, blocks: z.array(blockSchema).max(500) })).max(50),
    streets: z.array(streetSchema).max(200).optional(),
    areas: z.array(z.object({ kind: z.enum(['INSTITUTIONAL_AREA', 'GREEN_AREA']), name })).max(200).optional(),
  }),
  z.object({
    kind: z.literal('COMMON_AREAS'),
    name,
    areas: z.array(z.object({ kind: z.enum(['COMMON_AREA', 'TECHNICAL_AREA']), name })).max(200),
  }),
  z.object({ kind: z.literal('INFRASTRUCTURE'), name, streets: z.array(streetSchema).max(200) }),
]);
export type WizardModuleInput = z.infer<typeof wizardModuleSchema>;

export const wizardTypologySchema = z.object({ code: typologyCode, name, kind: typologyKindSchema });

export const wizardInputSchema = z.object({
  typologies: z.array(wizardTypologySchema).max(100),
  modules: z.array(wizardModuleSchema).min(1, 'Selecione ao menos um módulo').max(20),
});
export type WizardInput = z.infer<typeof wizardInputSchema>;

export interface WizardPreviewDto {
  counts: Partial<Record<NodeKindDto, number>>;
  unitsByTypology: Record<string, number>;
  unitsWithoutTypology: number;
  totalNodes: number;
  modules: { kind: ModuleKindDto; name: string; nodeCount: number; sample: { name: string; kind: NodeKindDto; depth: number }[] }[];
  /** Tipologias do assistente que já existem no empreendimento (serão reutilizadas se compatíveis). */
  existingTypologies: string[];
}

// ----- Árvore -----
export interface ModuleDto {
  id: string;
  kind: ModuleKindDto;
  name: string;
  code: string;
  position: number;
  archivedAt: string | null;
  version: number;
}

export interface StructureNodeDto {
  id: string;
  moduleId: string;
  parentId: string | null;
  kind: NodeKindDto;
  name: string;
  code: string;
  position: number;
  depth: number;
  origin: 'WIZARD' | 'MANUAL' | 'DUPLICATE';
  archivedAt: string | null;
  version: number;
  typologyId?: string | null;
  lot?: { area: string | null; frontage: string | null };
}

export interface StructureDto {
  modules: ModuleDto[];
  nodes: StructureNodeDto[];
}

export const createModuleSchema = z.object({ kind: moduleKindSchema, name });
export const updateModuleSchema = z.object({ name });

export const createNodeSchema = z.object({
  moduleId: z.uuid(),
  parentId: z.uuid().nullable(),
  kind: nodeKindSchema,
  name,
  typologyId: z.uuid().nullable().optional(),
});
export type CreateNodeInput = z.infer<typeof createNodeSchema>;

export const updateNodeSchema = z.object({
  name: name.optional(),
  typologyId: z.uuid().nullable().optional(),
  lot: z
    .object({ area: positiveDecimal.nullable().optional(), frontage: positiveDecimal.nullable().optional() })
    .optional(),
  reason: optionalText(500),
});
export type UpdateNodeInput = z.infer<typeof updateNodeSchema>;

export const moveNodeSchema = z.object({
  parentId: z.uuid().nullable(),
  /** Posição desejada entre os novos irmãos, base 1. Omitida = última. */
  position: z.number().int().min(1).optional(),
});
export type MoveNodeInput = z.infer<typeof moveNodeSchema>;

export const archiveNodeSchema = z.object({ reason: requiredText(500) });

// ----- Tipologias -----
export const createTypologySchema = z.object({
  code: typologyCode,
  name,
  kind: typologyKindSchema,
  description: optionalText(2000),
  privateArea: positiveDecimal.nullable().optional(),
});
export type CreateTypologyInput = z.infer<typeof createTypologySchema>;
export const updateTypologySchema = createTypologySchema.omit({ kind: true }).partial();
export type UpdateTypologyInput = z.infer<typeof updateTypologySchema>;

export interface TypologyDto {
  id: string;
  code: string;
  name: string;
  kind: 'APARTMENT' | 'HOUSE';
  description: string | null;
  privateArea: string | null;
  archivedAt: string | null;
  version: number;
  unitCount: number;
}
