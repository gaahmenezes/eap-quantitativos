import { type ArgumentsHost, Catch, type ExceptionFilter, HttpException, Logger } from '@nestjs/common';
import type { Request, Response } from 'express';
import type { ProblemDetails } from '@eapq/contracts';
import { ThrottlerException } from '@nestjs/throttler';
import { AppError } from './errors.js';
import { Prisma } from '../generated/prisma/client.js';

@Catch()
export class ProblemFilter implements ExceptionFilter {
  private readonly logger = new Logger('Errors');

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const req = ctx.getRequest<Request & { id?: string }>();
    const res = ctx.getResponse<Response>();
    const problem = this.toProblem(exception);
    problem.requestId = req.id;
    if (problem.status >= 500) {
      this.logger.error(
        { requestId: req.id, path: req.path, err: exception instanceof Error ? exception.stack : exception },
        'Erro não tratado',
      );
    }
    res.status(problem.status).type('application/problem+json').json(problem);
  }

  private toProblem(e: unknown): ProblemDetails {
    if (e instanceof AppError) {
      return {
        type: `about:blank#${e.code}`,
        title: e.title,
        status: e.status,
        detail: e.detail,
        code: e.code,
        ...(e.errors ? { errors: e.errors } : {}),
      };
    }
    if (e instanceof ThrottlerException) {
      return {
        type: 'about:blank#RATE_LIMITED',
        title: 'Muitas requisições',
        status: 429,
        detail: 'Aguarde alguns instantes e tente novamente.',
        code: 'RATE_LIMITED',
      };
    }
    if (e instanceof Prisma.PrismaClientKnownRequestError) {
      if (e.code === 'P2002') {
        return {
          type: 'about:blank#UNIQUE_VIOLATION',
          title: 'Conflito',
          status: 409,
          detail: 'Já existe um registro com estes dados.',
          code: 'UNIQUE_VIOLATION',
        };
      }
      if (e.code === 'P2003') {
        return {
          type: 'about:blank#INVALID_REFERENCE',
          title: 'Referência inválida',
          status: 422,
          detail: 'Um dos registros referenciados não existe ou não pertence a esta organização.',
          code: 'INVALID_REFERENCE',
        };
      }
    }
    if (e instanceof HttpException) {
      const status = e.getStatus();
      return {
        type: `about:blank#HTTP_${status}`,
        title: status === 404 ? 'Não encontrado' : 'Erro na requisição',
        status,
        detail: status === 404 ? 'Rota não encontrada.' : e.message,
        code: status === 404 ? 'NOT_FOUND' : `HTTP_${status}`,
      };
    }
    return {
      type: 'about:blank#INTERNAL',
      title: 'Erro interno',
      status: 500,
      detail: 'Ocorreu um erro inesperado. Informe o código da requisição ao suporte.',
      code: 'INTERNAL',
    };
  }
}
