import { z } from 'zod';
import { optionalText, requiredText } from './common.js';

const code = z.string().trim().toUpperCase().min(1, 'Campo obrigatório').max(30).regex(/^[A-Z0-9][A-Z0-9._-]*$/, 'Use letras, números, ponto, hífen ou sublinhado');
const decimalText = z.string().trim().max(40).regex(/^-?\d+([.,]\d+)?$/, 'Número inválido (use 12,5 ou 12.5)');

// ---------- fórmulas ----------
export const formulaVariableSchema = z.object({
  symbol: z.string().trim().min(1, 'Campo obrigatório').max(30),
  label: requiredText(120),
  unit: z.string().trim().min(1, 'Campo obrigatório').max(12),
  constraint: z.enum(['positive', 'nonnegative']).nullable().optional(),
});
export type FormulaVariableInput = z.infer<typeof formulaVariableSchema>;

export const formulaBodySchema = z.object({
  expression: z.string().trim().min(1, 'Campo obrigatório').max(500),
  variables: z.array(formulaVariableSchema).max(20),
});

export const createFormulaSchema = formulaBodySchema.extend({
  code,
  name: requiredText(120),
  description: optionalText(1000),
});
export type CreateFormulaInput = z.infer<typeof createFormulaSchema>;
export const updateFormulaSchema = z.object({ name: requiredText(120).optional(), description: optionalText(1000) });
export const updateFormulaVersionSchema = formulaBodySchema.partial().extend({ notes: optionalText(1000) });
export type UpdateFormulaVersionInput = z.infer<typeof updateFormulaVersionSchema>;

export const formulaInputSchema = z.object({ symbol: z.string().trim().min(1).max(30), value: z.string().trim().max(40), unit: z.string().trim().min(1).max(12) });

export const evaluateFormulaSchema = formulaBodySchema.extend({
  inputs: z.array(formulaInputSchema).max(20),
  unit: z.string().trim().min(1).max(12),
});

export interface DimensionDto { L: number; M: number; T: number; N: number }

export interface FormulaVersionDto {
  id: string;
  number: number;
  status: 'DRAFT' | 'PUBLISHED';
  expression: string;
  variables: FormulaVariableInput[];
  resultDimension: DimensionDto | null;
  resultDescription: string | null;
  notes: string | null;
  publishedAt: string | null;
  createdAt: string;
  /** Medições cuja revisão atual usa esta versão. */
  measurementCount: number;
  issues: { path: string; message: string }[];
}

export interface FormulaDto {
  id: string;
  code: string;
  name: string;
  description: string | null;
  archivedAt: string | null;
  version: number;
  versions: FormulaVersionDto[];
}

// ---------- medições ----------
export const anchorSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('STRUCTURE_NODE'), id: z.uuid() }),
  z.object({ kind: z.literal('NETWORK_SEGMENT'), id: z.uuid() }),
  z.object({ kind: z.literal('NETWORK_NODE'), id: z.uuid() }),
  z.object({ kind: z.literal('PHYSICAL_ELEMENT'), id: z.uuid() }),
  z.object({ kind: z.literal('TYPOLOGY_ELEMENT'), typologyId: z.uuid(), elementKey: z.string().trim().min(1).max(80), unitId: z.uuid().nullable().optional() }),
]);
export type AnchorInput = z.infer<typeof anchorSchema>;

export const calcSchema = z.discriminatedUnion('method', [
  z.object({ method: z.literal('MANUAL'), value: decimalText, unit: z.string().trim().min(1).max(12) }),
  z.object({ method: z.literal('FORMULA'), formulaVersionId: z.uuid(), inputs: z.array(formulaInputSchema).max(20) }),
]);
export type CalcInput = z.infer<typeof calcSchema>;

export const previewMeasurementSchema = z.object({ serviceId: z.uuid(), calc: calcSchema });

const sourceFields = {
  sourceReference: optionalText(300),
  /** Arquivo de origem já enviado (POST /projects/:id/documents). */
  documentId: z.uuid().nullable().optional(),
  notes: optionalText(2000),
};

export const createMeasurementSchema = z.object({
  wbsNodeId: z.uuid(),
  serviceId: z.uuid(),
  anchor: anchorSchema,
  calc: calcSchema,
  ...sourceFields,
});
export type CreateMeasurementInput = z.infer<typeof createMeasurementSchema>;

export const reviseMeasurementSchema = z.object({ calc: calcSchema, reason: requiredText(500), ...sourceFields });
export type ReviseMeasurementInput = z.infer<typeof reviseMeasurementSchema>;

export const listMeasurementsQuery = z.object({
  wbsNodeId: z.uuid().optional(),
  serviceId: z.uuid().optional(),
  outdated: z.enum(['true', 'false']).optional(),
  archived: z.enum(['true', 'false']).optional(),
});

export const listRevisionsQuery = z.object({
  q: z.string().trim().max(100).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

export interface MemoryDto {
  method: 'MANUAL' | 'FORMULA' | 'IMPORTED';
  import?: { jobId: string; fileName: string; row: number } | null;
  expression: string | null;
  inputs: { symbol: string; label: string; value: string; unit: string; baseValue: string; baseUnit: string }[];
  substituted: string | null;
  resultBase: string;
  resultBaseUnit: string;
  result: string;
  unit: string;
  formula?: { code: string; name: string; versionNumber: number } | null;
}

export interface CalcPreviewDto {
  quantity: string;
  unit: string;
  memory: MemoryDto;
}

export interface MeasurementRevisionDto {
  id: string;
  number: number;
  method: 'MANUAL' | 'FORMULA' | 'IMPORTED';
  formulaVersionId: string | null;
  inputs: unknown;
  document: { id: string; fileName: string; kind: string; size: number } | null;
  memory: MemoryDto;
  quantity: string;
  unit: string;
  sourceReference: string | null;
  notes: string | null;
  reason: string | null;
  createdAt: string;
  createdBy: string;
}

export interface MeasurementDto {
  id: string;
  wbsNodeId: string;
  wbsCode: string;
  wbsTitle: string;
  serviceId: string;
  serviceCode: string;
  serviceDescription: string;
  unit: string;
  anchor: { kind: AnchorInput['kind']; label: string; archived: boolean; typologyId?: string; elementKey?: string; unitId?: string | null };
  quantity: string;
  /** Unidades em que a medição vale (1 para âncoras comuns; nº de unidades para tipologia). */
  multiplier: number;
  effectiveTotal: string;
  replacedUnits: number;
  warnings: string[];
  current: MeasurementRevisionDto;
  /** Existe versão publicada mais nova da fórmula usada. */
  formulaOutdated: { latestVersionId: string; latestNumber: number } | null;
  archivedAt: string | null;
  archiveReason: string | null;
  version: number;
}

export interface MeasurementDetailDto extends MeasurementDto {
  revisions: MeasurementRevisionDto[];
}

export interface MeasurementSummaryDto {
  /** Totais efetivos por item da EAP × serviço. */
  items: { wbsNodeId: string; serviceId: string; count: number; total: string; unit: string }[];
}

export interface AnchorOptionsDto {
  structure: { id: string; label: string; kind: string; path: string; archived: boolean }[];
  typologies: { id: string; code: string; name: string; elements: { key: string; label: string; depth: number }[]; units: { id: string; label: string; extraElements: { key: string; label: string }[] }[] }[];
  segments: { id: string; label: string }[];
  networkNodes: { id: string; label: string }[];
  physicalElements: { id: string; label: string }[];
}

export interface RevisionListItemDto extends MeasurementRevisionDto {
  measurementId: string;
  wbsCode: string;
  wbsTitle: string;
  serviceCode: string;
  serviceDescription: string;
  anchorLabel: string;
}
