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
/** Atualizar uma ficha/quadro existente (na versão vista na prévia) em vez de criar um novo (ADR-025). */
const updateOf = z.object({ id: z.uuid(), version: z.number().int().min(1) }).nullable().optional();
const rows = { headerRow: idx, firstRow: idx, lastRow: idx.nullable().optional() };
export const workbookSheetPlanSchema = z.discriminatedUnion('target', [
  z.object({ ...common, target: z.literal('ignore') }),
  z.object({
    ...common, ...rows, target: z.literal('sheet'), title: requiredText(160), templateVersionId: z.uuid(),
    map: z.record(key, ref), checks: z.record(key, ref).default({}), params: z.record(key, num).default({}), updateOf,
  }),
  z.object({
    ...common, ...rows, target: z.literal('schedule'), title: requiredText(160), scheduleKind: z.enum(SCHEDULE_KINDS),
    map: z.object({ code: col.optional(), description: col, spec: col.optional(), unit: col.optional(), width: col.optional(), height: col.optional() }),
    dimUnit: z.string().trim().max(12).nullable().optional(), defaultUnit: z.string().trim().min(1).max(12).default('un'),
    quantities: z.array(z.object({ col, label: requiredText(80) })).min(1, 'Escolha ao menos uma coluna de quantidade').max(10),
    check: z.object({ col, multiplier: z.number().int().min(1).max(100000) }).nullable().optional(), updateOf,
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
  /** Fichas e quadros ativos do empreendimento que podem ser atualizados por uma aba. */
  updatable: WorkbookUpdatableDto[];
}
export interface WorkbookUpdatableDto {
  kind: 'sheet' | 'schedule';
  id: string;
  title: string;
  version: number;
  /** Modelo da ficha (a aba precisa usar o mesmo modelo). */
  templateId: string | null;
  templateVersionId: string | null;
  templateCode: string | null;
  /** Colunas de quantidade do quadro (a aba precisa mapear o mesmo número, na mesma ordem). */
  columns: string[];
  sourceSheetName: string | null;
  launched: boolean;
}
export type WorkbookRowStatus = 'added' | 'removed' | 'changed' | 'unchanged';
export interface WorkbookUpdateDiffDto {
  kind: 'sheet' | 'schedule';
  id: string;
  title: string;
  currentVersion: number;
  /** A ficha/quadro mudou depois que a atualização foi planejada: confirme de novo antes de aplicar. */
  stale: boolean;
  /** Já foi lançado em quantitativos: depois de atualizar, relance para revisar as medições. */
  launched: boolean;
  counts: Record<WorkbookRowStatus, number>;
  /** Linhas que entram, saem ou mudam (até 200). `row` = linha da planilha nova. */
  rows: { status: Exclude<WorkbookRowStatus, 'unchanged'>; label: string; row: number | null; changes: { field: string; before: string; after: string }[] }[];
  /** Totais das saídas antes e depois (fichas). */
  totals: { key: string; label: string; unit: string; before: string; after: string }[];
  /** Linhas que perdem o que só existe no sistema: destino por linha (fichas) ou serviços (quadros). */
  lostLinks: number;
  keptLinks: number;
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
  update: WorkbookUpdateDiffDto | null;
}
export interface WorkbookApplyResultDto {
  appliedAt: string;
  created: { sheetIndex: number; sheetName: string; kind: 'sheet' | 'schedule'; id: string; title: string; rows: number; skipped: number; checksOk: boolean | null; action?: 'created' | 'updated'; counts?: Record<WorkbookRowStatus, number> }[];
}
export interface WorkbookSuggestionsDto { sheets: (WorkbookSheetPlan & { reason: string })[] }
export type { ScheduleKind as WorkbookScheduleKind };
