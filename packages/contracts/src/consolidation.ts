import { z } from 'zod';

/** Mesma lista de `CONSOLIDATION_DIMENSIONS` do domínio (teste garante a igualdade). */
export const CONSOLIDATION_DIMENSION_KEYS = [
  'wbs1', 'wbs2', 'wbs3', 'wbsItem', 'service', 'category', 'module',
  'PHASE', 'STAGE', 'SECTOR', 'BLOCK_QUADRA', 'LOT', 'STREET', 'TOWER', 'BUILDING_BLOCK', 'FLOOR',
  'typology', 'unit', 'system', 'network',
] as const;
export const consolidationDimensionSchema = z.enum(CONSOLIDATION_DIMENSION_KEYS);
export type ConsolidationDimensionKey = z.infer<typeof consolidationDimensionSchema>;

/** Valor de filtro: id ou "none" (sem valor nesta dimensão). */
const filterValue = z.union([z.uuid(), z.literal('none')]);
export const consolidationFiltersSchema = z.partialRecord(consolidationDimensionSchema, z.array(filterValue).max(200));
export type ConsolidationFiltersInput = z.infer<typeof consolidationFiltersSchema>;

export const consolidationQuerySchema = z.object({
  /** Base: revisão emitida (fotografia) ou, se ausente, o estado atual. */
  revisionId: z.uuid().optional(),
  groupBy: z.array(consolidationDimensionSchema).max(4).refine((xs) => new Set(xs).size === xs.length, 'Dimensão repetida'),
  filters: consolidationFiltersSchema.default({}),
});
export type ConsolidationQueryInput = z.infer<typeof consolidationQuerySchema>;

export const consolidationLinesSchema = z.object({
  revisionId: z.uuid().optional(),
  filters: consolidationFiltersSchema.default({}),
  limit: z.number().int().min(1).max(500).default(200),
});

export interface ConsolidationKeyValue { id: string; label: string }

export interface ConsolidationResultDto {
  groupBy: ConsolidationDimensionKey[];
  rows: { key: Partial<Record<ConsolidationDimensionKey, ConsolidationKeyValue | null>>; unit: string; total: string; lines: number; measurements: number }[];
  totals: { unit: string; total: string }[];
  truncated: boolean;
  elapsedMs: number;
}

export interface ConsolidationLinesDto {
  total: number;
  lines: { measurementId: string; measurementRevisionId: string | null; wbsCode: string; wbsTitle: string; serviceCode: string; anchorLabel: string; unitLabel: string | null; quantity: string; unit: string }[];
}
