import { z } from 'zod';

export interface DocumentDto {
  id: string;
  fileName: string;
  kind: 'XLSX' | 'CSV' | 'PDF' | 'PNG' | 'JPEG';
  mime: string;
  size: number;
  sha256: string;
  createdAt: string;
}

export const importKindSchema = z.enum(['SERVICES', 'STRUCTURE', 'MEASUREMENTS']);
export type ImportKindDto = z.infer<typeof importKindSchema>;

export const importMappingSchema = z.object({
  sheet: z.string().trim().max(100).optional(),
  mapping: z.record(z.string().max(30), z.number().int().min(0).max(199).nullable()),
});
export type ImportMappingInput = z.infer<typeof importMappingSchema>;

export const importApplySchema = z.object({ skipInvalid: z.boolean().default(false) });
export const importRowsQuery = z.object({
  status: z.enum(['VALID', 'WARNING', 'ERROR']).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
  offset: z.coerce.number().int().min(0).default(0),
});

export interface ImportJobDto {
  id: string;
  kind: ImportKindDto;
  status: 'UPLOADED' | 'VALIDATED' | 'APPLIED' | 'CANCELLED';
  fileName: string;
  sheets: string[];
  sheet: string | null;
  headers: string[];
  sample: string[][];
  rowCount: number;
  fields: { key: string; label: string; required: boolean }[];
  mapping: Record<string, number | null>;
  summary: { valid: number; warning: number; error: number; created?: number; skipped?: number } | null;
  createdAt: string;
  appliedAt: string | null;
  createdBy: string;
  version: number;
}

export interface ImportRowDto {
  rowNumber: number;
  values: string[];
  status: 'PENDING' | 'VALID' | 'WARNING' | 'ERROR';
  messages: string[];
}

export const exportSchema = z.object({
  report: z.enum(['services', 'structure', 'wbs', 'measurements', 'memories', 'consolidation', 'revision-compare']),
  format: z.enum(['xlsx', 'csv', 'pdf']),
  revisionId: z.uuid().optional(),
  compareTo: z.union([z.uuid(), z.literal('current')]).optional(),
  groupBy: z.array(z.string().max(30)).max(4).optional(),
  filters: z.record(z.string().max(30), z.array(z.string().max(40)).max(200)).optional(),
});
export type ExportInput = z.infer<typeof exportSchema>;
