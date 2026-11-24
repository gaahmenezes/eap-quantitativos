import { z } from 'zod';
import { optionalText, requiredText } from './common.js';
import { decimalString } from './infra.js';

const code = z
  .string()
  .trim()
  .toUpperCase()
  .min(1, 'Campo obrigatório')
  .max(30, 'Máximo de 30 caracteres')
  .regex(/^[A-Z0-9][A-Z0-9._/-]*$/, 'Use letras, números, ponto, barra, hífen ou sublinhado');

const exponent = z.number().int('Use inteiro').min(-4).max(4);

// ---------- unidades ----------
export const createUnitSchema = z.object({
  symbol: z.string().trim().min(1, 'Campo obrigatório').max(12).regex(/^\S+$/, 'Sem espaços'),
  name: requiredText(60),
  dimension: z.object({ L: exponent, M: exponent, T: exponent, N: exponent }),
  factor: z
    .string()
    .trim()
    .regex(/^\d{1,10}([.,]\d{1,30})?$/, 'Fator decimal positivo (ex.: 0,0254)')
    .transform((v) => v.replace(',', '.'))
    .refine((v) => Number(v) > 0, 'Deve ser maior que zero'),
  decimals: z.number().int().min(0).max(6),
});
export type CreateUnitInput = z.infer<typeof createUnitSchema>;
export const updateUnitSchema = z.object({ name: requiredText(60).optional(), decimals: z.number().int().min(0).max(6).optional() });

export const convertQuery = z.object({
  value: decimalString({ decimals: 12, signed: true }),
  from: z.uuid(),
  to: z.uuid(),
});

export interface UnitDto {
  id: string;
  symbol: string;
  name: string;
  dimension: { L: number; M: number; T: number; N: number };
  quantity: string;
  factor: string;
  decimals: number;
  system: boolean;
  archivedAt: string | null;
  version: number;
  serviceCount: number;
}

// ---------- categorias ----------
export const createCategorySchema = z.object({ code, name: requiredText(120), parentId: z.uuid().nullable().optional() });
export const updateCategorySchema = z.object({ name: requiredText(120).optional(), parentId: z.uuid().nullable().optional() });

export interface CategoryDto {
  id: string;
  parentId: string | null;
  code: string;
  name: string;
  position: number;
  archivedAt: string | null;
  version: number;
  serviceCount: number;
}

// ---------- serviços ----------
export const serviceInputSchema = z.object({
  code,
  description: requiredText(300),
  categoryId: z.uuid(),
  unitId: z.uuid(),
  measurementCriterion: optionalText(2000),
  technicalDescription: optionalText(4000),
});
export type ServiceInput = z.infer<typeof serviceInputSchema>;
export const updateServiceSchema = serviceInputSchema.partial().extend({ reason: optionalText(500) });
export type UpdateServiceInput = z.infer<typeof updateServiceSchema>;

export const duplicateServiceSchema = z.object({
  code,
  /** Destino: null = catálogo da organização; id = específico do empreendimento. */
  projectId: z.uuid().nullable(),
});

export const listServicesQuery = z.object({
  q: z.string().trim().max(100).optional(),
  categoryId: z.uuid().optional(),
  unitId: z.uuid().optional(),
  status: z.enum(['ACTIVE', 'ARCHIVED', 'ALL']).default('ACTIVE'),
  /** Para listas de empreendimento: ALL = catálogo + específicos; PROJECT = só específicos. */
  scope: z.enum(['ALL', 'CATALOG', 'PROJECT']).default('ALL'),
  offset: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
export type ListServicesQuery = z.infer<typeof listServicesQuery>;

export const similarQuery = z.object({
  description: z.string().trim().min(3).max(300),
  excludeId: z.uuid().optional(),
});

export interface ServiceDto {
  id: string;
  projectId: string | null;
  code: string;
  description: string;
  categoryId: string;
  unitId: string;
  unitSymbol: string;
  measurementCriterion: string | null;
  technicalDescription: string | null;
  origin: 'CATALOG' | 'PROJECT' | 'DUPLICATE' | 'IMPORT';
  derivedFrom: { id: string; code: string } | null;
  archivedAt: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface SimilarServiceDto {
  id: string;
  code: string;
  description: string;
  unitSymbol: string;
  projectId: string | null;
  similarity: number;
}

export interface ServiceSaveResult {
  service: ServiceDto;
  /** Serviços com descrição parecida (aviso; não impede o cadastro). */
  similar: SimilarServiceDto[];
}
