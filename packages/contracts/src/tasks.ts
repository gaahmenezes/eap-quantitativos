import { z } from 'zod';
import { optionalText, requiredText } from './common.js';

/** Fila de trabalho do empreendimento (F13, ADR-023). */
export const TASK_STATUSES = ['TODO', 'DOING', 'REVIEW', 'DONE'] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];
export const TASK_KINDS = ['SHEET', 'SCHEDULE', 'WBS_ITEM', 'WORKBOOK_IMPORT', 'OTHER'] as const;
export type TaskKind = (typeof TASK_KINDS)[number];

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data inválida (AAAA-MM-DD)');
export const taskLinkSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('OTHER') }),
  z.object({ kind: z.literal('SHEET'), id: z.uuid() }),
  z.object({ kind: z.literal('SCHEDULE'), id: z.uuid() }),
  z.object({ kind: z.literal('WBS_ITEM'), id: z.uuid() }),
  z.object({ kind: z.literal('WORKBOOK_IMPORT'), id: z.uuid() }),
]);
export type TaskLinkInput = z.infer<typeof taskLinkSchema>;

export const createTaskSchema = z.object({
  title: requiredText(160),
  description: optionalText(2000),
  link: taskLinkSchema.default({ kind: 'OTHER' }),
  assigneeId: z.uuid().nullable().optional(),
  reviewerId: z.uuid().nullable().optional(),
  dueDate: date.nullable().optional(),
});
export type CreateTaskInput = z.infer<typeof createTaskSchema>;
export const updateTaskSchema = createTaskSchema.partial();
export type UpdateTaskInput = z.infer<typeof updateTaskSchema>;
export const transitionTaskSchema = z.object({ to: z.enum(TASK_STATUSES), comment: optionalText(500) });
export const listTasksQuery = z.object({
  status: z.enum(TASK_STATUSES).optional(),
  assignee: z.union([z.literal('me'), z.uuid()]).optional(),
  open: z.enum(['true', 'false']).optional(),
  archived: z.enum(['true', 'false']).optional(),
});

export interface TaskPersonDto { id: string; name: string }
export interface TaskDto {
  id: string;
  projectId: string;
  title: string;
  description: string | null;
  kind: TaskKind;
  status: TaskStatus;
  link: { kind: TaskKind; id: string; label: string } | null;
  assignee: TaskPersonDto | null;
  reviewer: TaskPersonDto | null;
  dueDate: string | null;
  overdue: boolean;
  completedAt: string | null;
  archivedAt: string | null;
  version: number;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}
export interface MyTaskDto extends TaskDto { projectCode: string; projectName: string; role: 'ASSIGNEE' | 'REVIEWER' }
export interface TeamMemberDto { id: string; name: string; email: string; canEdit: boolean }
