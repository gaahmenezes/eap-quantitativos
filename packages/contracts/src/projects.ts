import { z } from 'zod';
import { optionalText, requiredText } from './common.js';
import { projectRoleSchema } from './organizations.js';

export const PROJECT_CLASSIFICATIONS = ['VERTICAL', 'HORIZONTAL', 'LOTEAMENTO', 'MISTO'] as const;
export const projectClassificationSchema = z.enum(PROJECT_CLASSIFICATIONS);
export type ProjectClassification = z.infer<typeof projectClassificationSchema>;

export const PROJECT_CLASSIFICATION_LABELS: Record<ProjectClassification, string> = {
  VERTICAL: 'Empreendimento vertical',
  HORIZONTAL: 'Empreendimento horizontal',
  LOTEAMENTO: 'Loteamento',
  MISTO: 'Empreendimento misto',
};

export const projectCode = z
  .string()
  .trim()
  .toUpperCase()
  .min(2, 'Mínimo de 2 caracteres')
  .max(30, 'Máximo de 30 caracteres')
  .regex(/^[A-Z0-9][A-Z0-9._-]*$/, 'Use letras, números, ponto, hífen ou sublinhado');

export const createProjectSchema = z.object({
  code: projectCode,
  name: requiredText(200),
  description: optionalText(4000),
  classification: projectClassificationSchema,
  location: optionalText(300),
});
export type CreateProjectInput = z.infer<typeof createProjectSchema>;

export const updateProjectSchema = createProjectSchema.partial().extend({
  reason: optionalText(500),
});
export type UpdateProjectInput = z.infer<typeof updateProjectSchema>;

export const archiveProjectSchema = z.object({ reason: requiredText(500) });

export const listProjectsQuery = z.object({
  q: z.string().trim().max(100).optional(),
  status: z.enum(['ACTIVE', 'ARCHIVED', 'ALL']).default('ACTIVE'),
  classification: projectClassificationSchema.optional(),
});
export type ListProjectsQuery = z.infer<typeof listProjectsQuery>;

export interface ProjectDto {
  id: string;
  code: string;
  name: string;
  description: string | null;
  classification: ProjectClassification;
  location: string | null;
  status: 'ACTIVE' | 'ARCHIVED';
  archivedAt: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
  myProjectRole: z.infer<typeof projectRoleSchema> | null;
}

export const addProjectMemberSchema = z.object({
  userId: z.uuid(),
  role: projectRoleSchema,
});

export interface ProjectMemberDto {
  userId: string;
  name: string;
  email: string;
  role: z.infer<typeof projectRoleSchema>;
}

export interface AuditEntryDto {
  id: string;
  at: string;
  actor: { id: string; name: string } | null;
  entityType: string;
  entityId: string;
  action: string;
  before: unknown;
  after: unknown;
  reason: string | null;
}
