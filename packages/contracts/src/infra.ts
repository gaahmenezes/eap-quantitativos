import { z } from 'zod';
import { optionalText, requiredText } from './common.js';

/** Decimal como texto, com sinal opcional e casas limitadas (cotas, comprimentos). */
export const decimalString = (opts: { decimals: number; signed?: boolean; positive?: boolean }) =>
  z
    .string()
    .trim()
    .regex(new RegExp(`^${opts.signed ? '-?' : ''}\\d{1,9}([.,]\\d{1,${opts.decimals}})?$`), `Use um número${opts.signed ? '' : ' positivo'} com até ${opts.decimals} casas decimais`)
    .transform((v) => v.replace(',', '.'))
    .refine((v) => !opts.positive || Number(v) > 0, 'Deve ser maior que zero');

export const elevation = decimalString({ decimals: 3, signed: true });
export const lengthM = decimalString({ decimals: 3, positive: true });
export const diameterMm = decimalString({ decimals: 1, positive: true });

const code = z
  .string()
  .trim()
  .toUpperCase()
  .min(1, 'Campo obrigatório')
  .max(30, 'Máximo de 30 caracteres')
  .regex(/^[A-Z0-9][A-Z0-9._/-]*$/, 'Use letras, números, ponto, barra, hífen ou sublinhado');

export const attributesInput = z.record(z.string().max(40), z.union([z.string().max(200), z.boolean(), z.number()])).default({});

// ---------- catálogo ----------
export const elementDomainSchema = z.enum(['INFRA', 'CONSTRUTIVO']);
export const elementCategorySchema = z.enum(['NETWORK_NODE', 'NETWORK_SEGMENT', 'ELEMENT']);
export const attributeDataTypeSchema = z.enum(['NUMBER', 'TEXT', 'BOOLEAN', 'ENUM']);

export const attributeDefinitionSchema = z.object({
  key: z.string().trim().min(1).max(40),
  label: requiredText(80),
  dataType: attributeDataTypeSchema,
  unit: z.string().trim().max(16).nullable().optional(),
  required: z.boolean().default(false),
  enumValues: z.array(z.string().trim().min(1).max(60)).max(50).nullable().optional(),
  min: decimalString({ decimals: 6, signed: true }).nullable().optional(),
  max: decimalString({ decimals: 6, signed: true }).nullable().optional(),
});
export type AttributeDefinitionInput = z.infer<typeof attributeDefinitionSchema>;

export const createSystemTypeSchema = z.object({ code, name: requiredText(120), networkBased: z.boolean() });
export const updateSystemTypeSchema = z.object({ name: requiredText(120) });

export const createElementTypeSchema = z.object({
  code,
  name: requiredText(120),
  domain: elementDomainSchema,
  category: elementCategorySchema,
  systemTypeId: z.uuid().nullable().optional(),
  attributes: z.array(attributeDefinitionSchema).max(40).default([]),
});
export type CreateElementTypeInput = z.infer<typeof createElementTypeSchema>;
export const updateElementTypeSchema = z.object({
  name: requiredText(120).optional(),
  attributes: z.array(attributeDefinitionSchema).max(40).optional(),
});
export type UpdateElementTypeInput = z.infer<typeof updateElementTypeSchema>;

export interface SystemTypeDto {
  id: string;
  code: string;
  name: string;
  networkBased: boolean;
  archivedAt: string | null;
  version: number;
}

export interface AttributeDefinitionDto {
  key: string;
  label: string;
  dataType: 'NUMBER' | 'TEXT' | 'BOOLEAN' | 'ENUM';
  unit: string | null;
  required: boolean;
  enumValues: string[] | null;
  min: string | null;
  max: string | null;
}

export interface ElementTypeDto {
  id: string;
  code: string;
  name: string;
  domain: 'INFRA' | 'CONSTRUTIVO';
  category: 'NETWORK_NODE' | 'NETWORK_SEGMENT' | 'ELEMENT';
  systemTypeId: string | null;
  attributes: AttributeDefinitionDto[];
  archivedAt: string | null;
  version: number;
}

// ---------- infraestrutura do empreendimento ----------
export const createSystemSchema = z.object({ systemTypeId: z.uuid(), name: requiredText(120), scopeNodeId: z.uuid().nullable().optional() });
export const updateSystemSchema = z.object({ name: requiredText(120).optional(), scopeNodeId: z.uuid().nullable().optional() });
export const createNetworkSchema = z.object({ code, name: requiredText(120) });
export const updateNetworkSchema = createNetworkSchema.partial();

export const createNetworkNodeSchema = z.object({
  elementTypeId: z.uuid(),
  code,
  locationNodeId: z.uuid().nullable().optional(),
  coverElevation: elevation.nullable().optional(),
  bottomElevation: elevation.nullable().optional(),
  attributes: attributesInput,
});
export type CreateNetworkNodeInput = z.infer<typeof createNetworkNodeSchema>;
export const updateNetworkNodeSchema = createNetworkNodeSchema.omit({ elementTypeId: true }).partial();
export type UpdateNetworkNodeInput = z.infer<typeof updateNetworkNodeSchema>;

export const createSegmentSchema = z.object({
  elementTypeId: z.uuid(),
  code,
  fromNodeId: z.uuid(),
  toNodeId: z.uuid(),
  streetSectionId: z.uuid().nullable().optional(),
  length: lengthM,
  diameter: diameterMm.nullable().optional(),
  material: optionalText(60),
  upstreamInvert: elevation.nullable().optional(),
  downstreamInvert: elevation.nullable().optional(),
  attributes: attributesInput,
});
export type CreateSegmentInput = z.infer<typeof createSegmentSchema>;
export const updateSegmentSchema = createSegmentSchema.omit({ elementTypeId: true }).partial();
export type UpdateSegmentInput = z.infer<typeof updateSegmentSchema>;

export const createElementSchema = z.object({
  elementTypeId: z.uuid(),
  name: requiredText(120),
  systemId: z.uuid().nullable().optional(),
  structureNodeId: z.uuid().nullable().optional(),
  attributes: attributesInput,
});
export type CreateElementInput = z.infer<typeof createElementSchema>;
export const updateElementSchema = z.object({
  name: requiredText(120).optional(),
  structureNodeId: z.uuid().nullable().optional(),
  attributes: attributesInput.optional(),
});
export type UpdateElementInput = z.infer<typeof updateElementSchema>;

export const archiveWithReasonSchema = z.object({ reason: requiredText(500) });

export interface SystemDto {
  id: string;
  systemTypeId: string;
  name: string;
  scopeNodeId: string | null;
  archivedAt: string | null;
  version: number;
  networkCount: number;
  elementCount: number;
}

export interface NetworkNodeDto {
  id: string;
  networkId: string;
  elementTypeId: string;
  code: string;
  locationNodeId: string | null;
  coverElevation: string | null;
  bottomElevation: string | null;
  attributes: Record<string, string | boolean>;
  archivedAt: string | null;
  version: number;
}

export interface SegmentDto {
  id: string;
  networkId: string;
  elementTypeId: string;
  code: string;
  fromNodeId: string;
  toNodeId: string;
  streetSectionId: string | null;
  length: string;
  diameter: string | null;
  material: string | null;
  upstreamInvert: string | null;
  downstreamInvert: string | null;
  attributes: Record<string, string | boolean>;
  archivedAt: string | null;
  version: number;
  geometry: { slope: string | null; slopePercent: string | null; upstreamDepth: string | null; downstreamDepth: string | null; averageDepth: string | null; adverseSlope: boolean };
}

export interface NetworkDto {
  id: string;
  systemId: string;
  code: string;
  name: string;
  archivedAt: string | null;
  version: number;
  nodes: NetworkNodeDto[];
  segments: SegmentDto[];
  totals: { segments: number; length: string; nodesByType: Record<string, number> };
}

export interface PhysicalElementDto {
  id: string;
  elementTypeId: string;
  systemId: string | null;
  structureNodeId: string | null;
  name: string;
  attributes: Record<string, string | boolean>;
  archivedAt: string | null;
  version: number;
}

export interface SystemDetailDto extends SystemDto {
  networks: NetworkDto[];
  elements: PhysicalElementDto[];
}
