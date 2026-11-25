import { z } from 'zod';
import { optionalText, requiredText } from './common.js';
import { anchorSchema, type AnchorInput } from './measurements.js';

/** Fichas de levantamento (F10, ADR-020). A validação semântica (grandezas, ciclos) fica no domínio. */
const key = z.string().trim().min(1, 'Campo obrigatório').max(30).regex(/^[a-z][a-z0-9_]*$/, 'Use letras minúsculas, números e _ (começando por letra)');
const code = z.string().trim().toUpperCase().min(1, 'Campo obrigatório').max(30).regex(/^[A-Z0-9][A-Z0-9._-]*$/, 'Use letras, números, ponto, hífen ou sublinhado');
const num = z.string().trim().max(40).regex(/^-?\d+(\.\d+)?$/, 'Número inválido (use ponto decimal)');
const unit = z.string().trim().min(1).max(12);

export const sheetColumnSchema = z.object({
  key,
  label: requiredText(60),
  kind: z.enum(['input', 'calc']),
  type: z.enum(['number', 'text', 'choice']),
  unit: unit.nullable().optional(),
  options: z.array(requiredText(60)).max(40).optional(),
  required: z.boolean().optional(),
  defaultValue: z.string().trim().max(60).nullable().optional(),
  expression: z.string().max(500).nullable().optional(),
});
export const sheetParamSchema = z.object({ key, label: requiredText(60), unit, value: num });
export const sheetTableSchema = z.object({
  key, label: requiredText(80), keyType: z.enum(['text', 'number']), keyUnit: unit.nullable().optional(), valueUnit: unit, mode: z.enum(['exact', 'range']),
  rows: z.array(z.object({ key: requiredText(40), value: num })).min(1).max(300),
});
export const sheetOutputSchema = z.object({ key, label: requiredText(80), column: key, suggestedService: z.string().trim().max(30).nullable().optional() });
export const sheetDefSchema = z.object({
  columns: z.array(sheetColumnSchema).min(1).max(40),
  params: z.array(sheetParamSchema).max(20),
  tables: z.array(sheetTableSchema).max(10),
  outputs: z.array(sheetOutputSchema).min(1, 'A ficha precisa de ao menos uma saída').max(20),
});
export type SheetDefInput = z.infer<typeof sheetDefSchema>;

export const createSheetTemplateSchema = z.object({ code, name: requiredText(120), description: optionalText(1000), definition: sheetDefSchema });
export type CreateSheetTemplateInput = z.infer<typeof createSheetTemplateSchema>;
export const updateSheetTemplateSchema = z.object({ name: requiredText(120).optional(), description: optionalText(1000) });
export const updateSheetTemplateVersionSchema = z.object({ definition: sheetDefSchema.optional(), notes: optionalText(1000) });
export type UpdateSheetTemplateVersionInput = z.infer<typeof updateSheetTemplateVersionSchema>;

export const sheetCellSchema = z.object({ v: z.string().max(200).nullable().optional(), ref: z.string().max(120).nullable().optional() });
export const sheetRowsSchema = z.array(z.record(key, sheetCellSchema)).max(2000, 'Máximo de 2.000 linhas por ficha');

export const createSheetSchema = z.object({
  templateVersionId: z.uuid(),
  title: requiredText(160),
  wbsNodeId: z.uuid().nullable().optional(),
  anchor: anchorSchema.nullable().optional(),
});
export type CreateSheetInput = z.infer<typeof createSheetSchema>;

export const updateSheetSchema = z.object({
  title: requiredText(160).optional(),
  templateVersionId: z.uuid().optional(),
  wbsNodeId: z.uuid().nullable().optional(),
  anchor: anchorSchema.nullable().optional(),
  params: z.record(key, num).optional(),
  outputMap: z.record(key, z.uuid().nullable()).optional(),
  rows: sheetRowsSchema.optional(),
  sourceReference: optionalText(300),
  documentId: z.uuid().nullable().optional(),
});
export type UpdateSheetInput = z.infer<typeof updateSheetSchema>;

export const launchSheetSchema = z.object({ reason: optionalText(500) });
export const archiveSheetSchema = z.object({ reason: requiredText(500) });
export const listSheetsQuery = z.object({ archived: z.enum(['true', 'false']).optional() });

// ---------- respostas ----------
export interface SheetIssueDto { path: string; message: string }

export interface SheetTemplateVersionDto {
  id: string;
  number: number;
  status: 'DRAFT' | 'PUBLISHED';
  definition: SheetDefInput;
  notes: string | null;
  publishedAt: string | null;
  createdAt: string;
  sheetCount: number;
  issues: SheetIssueDto[];
}

export interface SheetTemplateDto {
  id: string;
  code: string;
  name: string;
  description: string | null;
  archivedAt: string | null;
  version: number;
  versions: SheetTemplateVersionDto[];
}

export type SheetStatus = 'DRAFT' | 'LAUNCHED' | 'PENDING';

export interface SheetListItemDto {
  id: string;
  title: string;
  templateId: string;
  templateCode: string;
  templateName: string;
  versionNumber: number;
  wbsNodeId: string | null;
  wbsCode: string | null;
  wbsTitle: string | null;
  anchorLabel: string | null;
  rowCount: number;
  status: SheetStatus;
  launchedAt: string | null;
  measurementCount: number;
  archivedAt: string | null;
  version: number;
  updatedAt: string;
}

export interface SheetMeasurementDto {
  outputKey: string;
  measurementId: string;
  serviceId: string;
  serviceCode: string;
  serviceDescription: string;
  quantity: string;
  unit: string;
  revision: number;
  archived: boolean;
}

export interface SheetDetailDto extends SheetListItemDto {
  templateVersionId: string;
  definition: SheetDefInput;
  /** Versão publicada mais nova do modelo, se houver. */
  newerVersion: { id: string; number: number } | null;
  anchor: AnchorInput | null;
  params: Record<string, string>;
  outputMap: Record<string, string | null>;
  rows: Record<string, { v?: string | null; ref?: string | null }>[];
  sourceReference: string | null;
  document: { id: string; fileName: string; kind: string; size: number } | null;
  measurements: SheetMeasurementDto[];
  /** Unidades da organização (o editor calcula ao vivo com o mesmo motor do servidor). */
  units: { symbol: string; dimension: { L: number; M: number; T: number; N: number }; factor: string }[];
}

export interface SheetLaunchResultDto {
  created: number;
  revised: number;
  unchanged: number;
  archived: number;
  linkedServices: number;
}

/** Memória de uma medição lançada por ficha. */
export interface SheetMemoryDto {
  sheetId: string;
  title: string;
  template: { code: string; name: string; versionNumber: number };
  output: { key: string; label: string };
  column: { key: string; label: string; expression: string | null };
  params: { key: string; label: string; value: string; unit: string }[];
  rows: { index: number; label: string; value: string }[];
  skippedRows: number;
  total: string;
  totalUnit: string;
}
