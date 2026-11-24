import { z } from 'zod';
import { optionalText, requiredText } from './common.js';
import { moduleKindSchema } from './structure.js';

export const repeatScopeSchema = z.enum([
  'TOWER', 'BUILDING_BLOCK', 'FLOOR', 'DWELLING_UNIT', 'DWELLING_TYPOLOGY', 'COMMON_AREA', 'SPECIAL_AREA',
  'PHASE', 'STAGE', 'SECTOR', 'BLOCK_QUADRA', 'LOT', 'STREET', 'STREET_SECTION', 'INFRA_SYSTEM', 'NETWORK',
]);
export const wbsNodeTypeSchema = z.enum(['GROUP', 'ITEM']);

const code = z.string().trim().toUpperCase().min(1, 'Campo obrigatório').max(30).regex(/^[A-Z0-9][A-Z0-9._-]*$/, 'Use letras, números, ponto, hífen ou sublinhado');

// ---------- templates ----------
export const createTemplateSchema = z.object({
  code,
  name: requiredText(120),
  description: optionalText(1000),
  moduleKinds: z.array(moduleKindSchema).min(1, 'Escolha ao menos um tipo de módulo'),
});
export type CreateTemplateInput = z.infer<typeof createTemplateSchema>;
export const updateTemplateSchema = createTemplateSchema.omit({ code: true }).partial();

export const templateNodeInputSchema = z.object({
  title: requiredText(200),
  nodeType: wbsNodeTypeSchema,
  condition: z.string().trim().max(500).nullable().optional().transform((v) => (v ? v : null)),
  repeat: repeatScopeSchema.nullable().optional(),
  serviceIds: z.array(z.uuid()).max(50).default([]),
});
export const createTemplateNodeSchema = templateNodeInputSchema.extend({ parentId: z.uuid().nullable().optional() });
export type CreateTemplateNodeInput = z.infer<typeof createTemplateNodeSchema>;
export const updateTemplateNodeSchema = templateNodeInputSchema.partial();
export type UpdateTemplateNodeInput = z.infer<typeof updateTemplateNodeSchema>;
export const moveTemplateNodeSchema = z.object({ parentId: z.uuid().nullable(), position: z.number().int().min(1).optional() });

export interface TemplateNodeDto {
  id: string;
  parentId: string | null;
  stableKey: string;
  title: string;
  nodeType: 'GROUP' | 'ITEM';
  condition: string | null;
  repeat: z.infer<typeof repeatScopeSchema> | null;
  position: number;
  serviceIds: string[];
}

export interface TemplateVersionDto {
  id: string;
  number: number;
  status: 'DRAFT' | 'PUBLISHED';
  notes: string | null;
  publishedAt: string | null;
  createdAt: string;
  nodeCount: number;
  projectCount: number;
}

export interface TemplateDto {
  id: string;
  code: string;
  name: string;
  description: string | null;
  moduleKinds: z.infer<typeof moduleKindSchema>[];
  archivedAt: string | null;
  version: number;
  versions: TemplateVersionDto[];
}

export interface TemplateVersionDetailDto extends TemplateVersionDto {
  templateId: string;
  nodes: TemplateNodeDto[];
  /** Problemas que impedem a publicação (validação do domínio). */
  issues: { path: string; message: string }[];
}

export interface TemplateCompareDto {
  added: { stableKey: string; title: string }[];
  removed: { stableKey: string; title: string }[];
  changed: { stableKey: string; title: string; fields: string[] }[];
}

// ---------- EAP do empreendimento ----------
export const wbsSelectionSchema = z.object({
  selections: z.array(z.object({ moduleId: z.uuid(), templateVersionId: z.uuid() })).min(1, 'Selecione ao menos um módulo').max(50),
});
export type WbsSelectionInput = z.infer<typeof wbsSelectionSchema>;
export const applyWbsSchema = wbsSelectionSchema.extend({
  /** Hash do plano exibido na prévia: se o cadastro ou os templates mudaram desde então, a aplicação é recusada. */
  planHash: z.string().regex(/^[0-9a-f]{16}$/),
});

export interface WbsPlanDto {
  planHash: string;
  factsHash: string;
  totals: { desired: number; create: number; update: number; unchanged: number; remove: number; obsolete: number; keptArchived: number };
  create: { key: string; title: string; parentTitle: string | null; depth: number }[];
  update: { id: string; title: string; changes: string[] }[];
  remove: { id: string; title: string }[];
  obsolete: { id: string; title: string; reason: string }[];
}

export interface WbsNodeDto {
  id: string;
  parentId: string | null;
  title: string;
  code: string;
  depth: number;
  position: number;
  nodeType: 'GROUP' | 'ITEM';
  origin: 'GENERATED' | 'MANUAL';
  status: 'ACTIVE' | 'OBSOLETE';
  moduleId: string | null;
  templateVersionId: string | null;
  binding: { kind: 'MODULE' | 'STRUCTURE' | 'TYPOLOGY' | 'SYSTEM' | 'NETWORK'; id: string } | null;
  titleOverridden: boolean;
  placementOverridden: boolean;
  archivedAt: string | null;
  version: number;
  serviceIds: string[];
}

export interface WbsDto {
  nodes: WbsNodeDto[];
  /** Versão de template usada por módulo na última geração. */
  moduleTemplates: { moduleId: string; templateVersionId: string; templateId: string; templateName: string; versionNumber: number; latestVersionNumber: number }[];
  runs: { id: string; createdAt: string; createdBy: string; summary: WbsPlanDto['totals']; factsHash: string; resultHash: string }[];
}

export const createWbsNodeSchema = z.object({ parentId: z.uuid().nullable(), title: requiredText(200), nodeType: wbsNodeTypeSchema });
export const updateWbsNodeSchema = z.object({ title: requiredText(200).optional(), nodeType: wbsNodeTypeSchema.optional() });
export const moveWbsNodeSchema = z.object({ parentId: z.uuid().nullable(), position: z.number().int().min(1).optional() });
export const setWbsServicesSchema = z.object({ serviceIds: z.array(z.uuid()).max(100) });
export const archiveWbsSchema = z.object({ reason: requiredText(500) });
