import { z } from 'zod';
import { requiredText } from './common.js';
import { attributesInput } from './infra.js';

export const createRevisionSchema = z.object({ notes: z.string().trim().max(1000).optional() });
export const publishRevisionSchema = z.object({ notes: z.string().trim().max(1000).optional() });

export const createTypologyElementSchema = z.object({
  elementTypeId: z.uuid(),
  name: requiredText(120),
  parentId: z.uuid().nullable().optional(),
  attributes: attributesInput,
});
export type CreateTypologyElementInput = z.infer<typeof createTypologyElementSchema>;
export const updateTypologyElementSchema = z.object({ name: requiredText(120).optional(), attributes: attributesInput.optional() });
export type UpdateTypologyElementInput = z.infer<typeof updateTypologyElementSchema>;

export const createOverrideSchema = z.discriminatedUnion('op', [
  z.object({ op: z.literal('EXCLUDE_ELEMENT'), targetStableKey: z.uuid(), reason: requiredText(500) }),
  z.object({
    op: z.literal('ADD_ELEMENT'),
    parentStableKey: z.uuid().nullable().optional(),
    elementTypeId: z.uuid(),
    name: requiredText(120),
    attributes: attributesInput,
    reason: requiredText(500),
  }),
]);
export type CreateOverrideInput = z.infer<typeof createOverrideSchema>;

export const propagateSchema = z.object({
  unitIds: z.array(z.uuid()).min(1, 'Selecione ao menos uma unidade').max(10_000),
  /** Confirma que as unidades com particularidades em conflito podem ser atualizadas (as particularidades são mantidas). */
  acknowledgeConflicts: z.boolean().default(false),
});
export type PropagateInput = z.infer<typeof propagateSchema>;

export interface TypologyElementDto {
  id: string;
  stableKey: string;
  parentId: string | null;
  elementTypeId: string;
  name: string;
  attributes: Record<string, string | boolean>;
  position: number;
}

export interface RevisionDto {
  id: string;
  number: number;
  status: 'DRAFT' | 'PUBLISHED';
  notes: string | null;
  publishedAt: string | null;
  createdAt: string;
  elementCount: number;
  unitCount: number;
}

export interface RevisionDetailDto extends RevisionDto {
  elements: TypologyElementDto[];
  /** Diferença em relação à revisão publicada anterior. */
  diff: { added: number; removed: number; changed: number } | null;
}

export interface PropagationUnitDto {
  unitId: string;
  name: string;
  code: string;
  pinnedRevisionNumber: number | null;
  overrides: number;
  conflicts: { overrideId: string; reason: string }[];
  upToDate: boolean;
}

export interface PropagationPreviewDto {
  targetRevision: { id: string; number: number } | null;
  units: PropagationUnitDto[];
  diffByRevision: Record<string, { added: number; removed: number; changed: number }>;
}

export interface UnitOverrideDto {
  id: string;
  op: 'EXCLUDE_ELEMENT' | 'ADD_ELEMENT';
  targetStableKey: string | null;
  parentStableKey: string | null;
  elementTypeId: string | null;
  name: string | null;
  attributes: Record<string, string | boolean> | null;
  reason: string;
  createdAt: string;
  createdBy: string;
  archivedAt: string | null;
  orphanReason: string | null;
}

export interface UnitElementsDto {
  unitId: string;
  typology: { id: string; code: string; name: string } | null;
  pinnedRevision: { id: string; number: number } | null;
  latestRevision: { id: string; number: number } | null;
  elements: {
    stableKey: string;
    parentStableKey: string | null;
    elementTypeId: string;
    name: string;
    attributes: Record<string, unknown>;
    source: 'TYPOLOGY' | 'UNIT';
    overrideId?: string;
  }[];
  excluded: { stableKey: string; name: string }[];
  overrides: UnitOverrideDto[];
}
