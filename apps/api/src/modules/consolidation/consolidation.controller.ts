import { Body, Controller, HttpCode, Param, Post } from '@nestjs/common';
import { z } from 'zod';
import { consolidationLinesSchema, consolidationQuerySchema, type ConsolidationQueryInput } from '@eapq/contracts';
import type { AuthContext } from '../../common/auth/auth-context.js';
import { Auth, ProjectPermission } from '../../common/auth/decorators.js';
import { uuidPipe, ZodPipe } from '../../common/zod.pipe.js';
import { ConsolidationService } from './consolidation.service.js';

@Controller('projects/:projectId/consolidation')
export class ConsolidationController {
  constructor(private readonly svc: ConsolidationService) {}

  /** Consulta (POST por causa do corpo com dimensões e filtros; não altera nada). */
  @Post()
  @ProjectPermission('project.read')
  @HttpCode(200)
  query(@Auth() a: AuthContext, @Param('projectId', uuidPipe) p: string, @Body(new ZodPipe(consolidationQuerySchema)) b: ConsolidationQueryInput) {
    return this.svc.query(a.organizationId, p, b);
  }

  @Post('lines')
  @ProjectPermission('project.read')
  @HttpCode(200)
  lines(@Param('projectId', uuidPipe) p: string, @Body(new ZodPipe(consolidationLinesSchema)) b: z.infer<typeof consolidationLinesSchema>) {
    return this.svc.lines(p, b.filters, b.limit);
  }
}
