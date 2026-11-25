import { z } from 'zod';
import { requiredText } from './common.js';
import { SCHEDULE_KINDS, type ScheduleKind } from './schedules.js';

/** Migração de planilhas de levantamento (F12, ADR-022). Linhas e colunas são índices a partir de 0. */
const idx = z.number().int().min(0).max(5000);
const col = z.number().int().min(0).max(59);
const ref = z.object({ col, unit: z.string().trim().max(12).nullable().optional() });
const key = z.string().regex(/^[a-z][a-z0-9_]{0,29}$/);
const num = z.string().trim().max(40).regex(/^-?\d+(\.\d+)?$/);

const common = { sheetIndex: z.number().int().min(0).max(199) };
const rows = { headerRow: idx, firstRow: idx, lastRow: idx.nullable().optional() };
export const workbookSheetPlanSchema = z.discriminatedUnion('target', [
  z.object({ ...common, target: z.literal('ignore') }),
  z.object({
    ...common, ...rows, target: z.literal('sheet'), title: requiredText(160), templateVersionId: z.uuid(),
    map: z.record(key, ref), checks: z.record(key, ref).default({}), params: z.record(key, num).default({}),
  }),
  z.object({
    ...common, ...rows, target: z.literal('schedule'), title: requiredText(160), scheduleKind: z.enum(SCHEDULE_KINDS),
    map: z.object({ code: col.optional(), description: col, spec: col.optional(), unit: col.optional(), width: col.optional(), height: col.optional() }),
    dimUnit: z.string().trim().max(12).nullable().optional(), defaultUnit: z.string().trim().min(1).max(12).default('un'),
    quantities: z.array(z.object({ col, label: requiredText(80) })).min(1, 'Escolha ao menos uma coluna de quantidade').max(10),
    check: z.object({ col, multiplier: z.number().int().min(1).max(100000) }).nullable().optional(),
  }),
]);
export type WorkbookSheetPlan = z.infer<typeof workbookSheetPlanSchema>;
export const saveWorkbookPlanSchema = z.object({ sheets: z.array(workbookSheetPlanSchema).max(200) });
export const previewWorkbookSheetSchema = z.object({ plan: workbookSheetPlanSchema });

export interface WorkbookCellDto { v: string; num?: boolean; f?: string }
export interface WorkbookSheetInfoDto { index: number; name: string; rowCount: number; colCount: number; truncated: boolean }
export interface WorkbookImportDto {
  id: string;
  fileName: string;
  documentId: string;
  status: 'DRAFT' | 'APPLIED' | 'CANCELLED';
  version: number;
  createdAt: string;
  createdBy: string;
  sheets: WorkbookSheetInfoDto[];
  plan: WorkbookSheetPlan[];
  result: WorkbookApplyResultDto | null;
}
export interface WorkbookImportListItemDto { id: string; fileName: string; status: WorkbookImportDto['status']; sheetCount: number; planned: number; createdAt: string; createdBy: string }
export interface WorkbookSheetDto extends WorkbookSheetInfoDto {
  rows: (WorkbookCellDto | null)[][];
  suggestedHeaderRow: number;
  labels: string[];
}
export interface WorkbookCheckDto {
  column: string;
  label: string;
  unit: string;
  rows: { row: number; expected: string | null; computed: string | null; delta: string | null; ok: boolean }[];
  expectedTotal: string;
  computedTotal: string;
  ok: boolean;
  divergent: number;
}
export interface WorkbookPreviewDto {
  sheetIndex: number;
  target: 'sheet' | 'schedule';
  rowCount: number;
  /** Linhas montadas (até 50, para conferência visual). */
  sample: { row: number; cells: Record<string, string> }[];
  skipped: { row: number; reason: string }[];
  rowErrors: { row: number; errors: string[] }[];
  checks: WorkbookCheckDto[];
  totals: { key: string; label: string; total: string; unit: string }[];
  problems: string[];
}
export interface WorkbookApplyResultDto {
  appliedAt: string;
  created: { sheetIndex: number; sheetName: string; kind: 'sheet' | 'schedule'; id: string; title: string; rows: number; skipped: number; checksOk: boolean | null }[];
}
export interface WorkbookSuggestionsDto { sheets: (WorkbookSheetPlan & { reason: string })[] }
export type { ScheduleKind as WorkbookScheduleKind };
