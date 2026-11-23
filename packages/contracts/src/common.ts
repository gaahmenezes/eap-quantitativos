import { z } from 'zod';

export const uuid = z.uuid();

/** Texto obrigatório com trim e limites. */
export const requiredText = (max: number) =>
  z.string().trim().min(1, 'Campo obrigatório').max(max, `Máximo de ${max} caracteres`);

export const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Máximo de ${max} caracteres`)
    .transform((v) => (v === '' ? null : v))
    .nullable()
    .optional();

/** Corpo de erro padrão (RFC 9457 problem+json). */
export interface ProblemDetails {
  type: string;
  title: string;
  status: number;
  detail?: string;
  code: string;
  errors?: { path: string; message: string }[];
  requestId?: string;
}

export interface Paginated<T> {
  items: T[];
  total: number;
}
