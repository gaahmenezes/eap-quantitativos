import { z } from 'zod';
import { optionalText, requiredText } from './common.js';
import { anchorSchema, type AnchorInput } from './measurements.js';

/** Quadros de componentes e materiais (F11, ADR-021). */
export const SCHEDULE_KINDS = ['ESQUADRIAS', 'LOUCAS_METAIS', 'INSTALACOES_HIDRAULICAS', 'INSTALACOES_ELETRICAS', 'OUTROS'] as const;
export type ScheduleKind = (typeof SCHEDULE_KINDS)[number];

const key = z.string().trim().min(1).max(20).regex(/^[A-Za-z0-9_-]+$/, 'Chave inválida');
const dim = z.string().trim().max(20).regex(/^\d+([.,]\d+)?$/, 'Número inválido').transform((v) => v.replace(',', '.')).nullable().optional();

export const createScheduleSchema = z.object({
  kind: z.enum(SCHEDULE_KINDS),
  title: requiredText(160),
  /** Copia os itens (sem destinos) de outro quadro da organização — lista padrão. */
  copyFromId: z.uuid().nullable().optional(),
});
export type CreateScheduleInput = z.infer<typeof createScheduleSchema>;

export const scheduleColumnSchema = z.object({
  key,
  label: requiredText(80),
  wbsNodeId: z.uuid().nullable().optional(),
  anchor: anchorSchema.nullable().optional(),
});
export const scheduleRowSchema = z.object({
  key,
  code: optionalText(30),
  description: requiredText(200),
  spec: optionalText(200),
  unit: z.string().trim().min(1).max(12),
  width: dim,
  height: dim,
  serviceIds: z.array(z.uuid()).max(3, 'No máximo 3 serviços por item'),
  cells: z.record(key, z.string().max(120)),
});
export const saveScheduleSchema = z.object({
  title: requiredText(160).optional(),
  sourceReference: optionalText(300),
  documentId: z.uuid().nullable().optional(),
  columns: z.array(scheduleColumnSchema).max(60, 'No máximo 60 destinos'),
  rows: z.array(scheduleRowSchema).max(1500, 'No máximo 1.500 itens'),
});
export type SaveScheduleInput = z.infer<typeof saveScheduleSchema>;
export const launchScheduleSchema = z.object({ reason: optionalText(500) });

export interface ScheduleColumnDto {
  key: string;
  label: string;
  wbsNodeId: string | null;
  wbsCode: string | null;
  wbsTitle: string | null;
  anchor: AnchorInput | null;
  anchorLabel: string | null;
  /** Unidades em que o destino vale (× n para elemento de tipologia). */
  multiplier: number;
}
export interface ScheduleRowDto {
  key: string;
  code: string | null;
  description: string;
  spec: string | null;
  unit: string;
  width: string | null;
  height: string | null;
  serviceIds: string[];
  cells: Record<string, string>;
}
export type ScheduleStatus = 'DRAFT' | 'LAUNCHED' | 'PENDING';
export interface ScheduleListItemDto {
  id: string;
  kind: ScheduleKind;
  title: string;
  rowCount: number;
  columnCount: number;
  status: ScheduleStatus;
  launchedAt: string | null;
  measurementCount: number;
  archivedAt: string | null;
  version: number;
  updatedAt: string;
}
export interface ScheduleDetailDto extends ScheduleListItemDto {
  sourceReference: string | null;
  columns: ScheduleColumnDto[];
  rows: ScheduleRowDto[];
  measurements: { key: string; measurementId: string; serviceId: string; serviceCode: string; serviceDescription: string; columnKey: string; quantity: string; unit: string; revision: number; archived: boolean }[];
  /** Serviços usados nos itens (código e unidade), para o cálculo ao vivo. */
  services: { id: string; code: string; description: string; unit: string; archived: boolean }[];
  units: { symbol: string; dimension: { L: number; M: number; T: number; N: number }; factor: string }[];
}
export interface ScheduleLaunchResultDto { created: number; revised: number; unchanged: number; archived: number; linkedServices: number }
export interface ScheduleCreateResultDto { id: string; droppedServices: number }

export interface ScheduleMemoryDto {
  scheduleId: string;
  title: string;
  kind: ScheduleKind;
  column: { key: string; label: string };
  rows: { code: string | null; description: string; spec: string | null; entered: string; enteredUnit: string; perItem: string | null; value: string }[];
  total: string;
  unit: string;
}
