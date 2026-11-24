import { z } from 'zod';
import { optionalText, requiredText } from './common.js';
import type { MeasurementRevisionDto } from './measurements.js';

export const issueRevisionSchema = z.object({ title: requiredText(200), notes: optionalText(2000) });
export type IssueRevisionInput = z.infer<typeof issueRevisionSchema>;

export const compareRevisionsQuery = z.object({ from: z.uuid(), to: z.union([z.uuid(), z.literal('current')]) });

export interface RevisionSummary {
  wbsNodes: number;
  items: number;
  structureNodes: number;
  measurements: number;
  lines: number;
  totals: { unit: string; total: string }[];
}

export interface ProjectRevisionDto {
  id: string;
  number: number;
  code: string;
  title: string;
  notes: string | null;
  summary: RevisionSummary;
  issuedAt: string;
  issuedBy: string;
}

export interface RevisionCompareDto {
  from: { id: string; code: string };
  to: { id: string | null; code: string };
  quantities: { wbs: string; service: string; unit: string; before: string | null; after: string | null; delta: string; kind: 'added' | 'removed' | 'changed' }[];
  measurements: {
    added: { id: string; label: string; quantity: string; unit: string }[];
    removed: { id: string; label: string; quantity: string; unit: string }[];
    changed: { id: string; label: string; before: string; after: string; delta: string; unit: string; fromRevision: number; toRevision: number }[];
  };
  wbs: { added: { id: string; code: string; title: string }[]; removed: { id: string; code: string; title: string }[]; changed: { id: string; code: string; title: string; before: string; fields: string[] }[] };
  structure: { added: { id: string; label: string }[]; removed: { id: string; label: string }[]; changed: { id: string; label: string; before: string; fields: string[] }[] };
  truncated: boolean;
}

export interface FrozenMeasurementDto {
  revisionCode: string;
  measurementId: string;
  wbsCode: string;
  wbsTitle: string;
  serviceCode: string;
  anchorLabel: string;
  multiplier: number;
  effectiveTotal: string;
  revision: MeasurementRevisionDto;
}

export const auditQuery = z.object({ entityId: z.uuid().optional(), entityType: z.string().trim().max(60).optional() });
