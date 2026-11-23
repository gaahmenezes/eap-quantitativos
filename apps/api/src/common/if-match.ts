import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import { AppError } from './errors.js';

/** Lê a versão esperada do header If-Match (bloqueio otimista, RNF05). Obrigatório. */
export const IfMatch = createParamDecorator((_: unknown, ctx: ExecutionContext): number => {
  const req = ctx.switchToHttp().getRequest<{ header(name: string): string | undefined }>();
  const raw = req.header('if-match')?.replace(/^W\//, '').replace(/"/g, '').trim();
  const version = raw ? Number(raw) : NaN;
  if (!Number.isInteger(version) || version < 1) {
    throw new AppError(
      428,
      'PRECONDITION_REQUIRED',
      'Versão obrigatória',
      'Envie o header If-Match com a versão do registro.',
    );
  }
  return version;
});
