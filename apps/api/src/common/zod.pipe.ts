import { type PipeTransform } from '@nestjs/common';
import type { ZodType } from 'zod';
import { AppError } from './errors.js';

/** Validação de entrada com os schemas de @eapq/contracts. */
export class ZodPipe<T> implements PipeTransform<unknown, T> {
  constructor(private readonly schema: ZodType<T>) {}

  transform(value: unknown): T {
    const result = this.schema.safeParse(value ?? {});
    if (!result.success) {
      throw new AppError(
        422,
        'VALIDATION_FAILED',
        'Dados inválidos',
        'Verifique os campos destacados.',
        result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      );
    }
    return result.data;
  }
}

export const uuidPipe = {
  transform(value: unknown): string {
    if (
      typeof value !== 'string' ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
    ) {
      throw new AppError(404, 'NOT_FOUND', 'Não encontrado', 'Recurso não encontrado.');
    }
    return value.toLowerCase();
  },
};
