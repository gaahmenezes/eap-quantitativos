import { Body, Controller, Get, HttpCode, Param, Post, Query, Res, StreamableFile } from '@nestjs/common';
import type { Response } from 'express';
import { z } from 'zod';
import { exportSchema, importKindSchema, type ExportInput } from '@eapq/contracts';
import type { AuthContext } from '../../common/auth/auth-context.js';
import { Auth, OrgPermission, ProjectPermission } from '../../common/auth/decorators.js';
import { uuidPipe, ZodPipe } from '../../common/zod.pipe.js';
import { AppError } from '../../common/errors.js';
import { sendFile } from '../documents/documents.controller.js';
import { ExportsService } from './exports.service.js';

const formatQuery = z.object({ format: z.enum(['xlsx', 'csv']).default('xlsx') });

@Controller()
export class ExportsController {
  constructor(private readonly svc: ExportsService) {}

  private async send(res: Response, file: { buffer: Buffer; mime: string; fileName: string }) {
    sendFile(res, { fileName: file.fileName, mime: file.mime, size: file.buffer.length });
    return new StreamableFile(file.buffer);
  }

  /** Relatórios do empreendimento (POST pelo corpo com dimensões e filtros; não altera nada). */
  @Post('projects/:projectId/exports')
  @ProjectPermission('project.read')
  @HttpCode(200)
  async project(@Auth() a: AuthContext, @Param('projectId', uuidPipe) p: string, @Body(new ZodPipe(exportSchema)) b: ExportInput, @Res({ passthrough: true }) res: Response) {
    return this.send(res, await this.svc.render(await this.svc.project(a.organizationId, p, b), b.format));
  }

  @Post('exports')
  @OrgPermission('org.read')
  @HttpCode(200)
  async org(@Auth() a: AuthContext, @Body(new ZodPipe(exportSchema)) b: ExportInput, @Res({ passthrough: true }) res: Response) {
    if (b.report !== 'services') throw new AppError(422, 'VALIDATION_FAILED', 'Dados inválidos', 'Fora de um empreendimento só há o relatório do catálogo de serviços.');
    return this.send(res, await this.svc.render(await this.svc.servicesCatalog(a.organizationId), b.format));
  }

  @Get('import-templates/:kind')
  @OrgPermission('org.read')
  async template(@Param('kind', new ZodPipe(importKindSchema)) kind: z.infer<typeof importKindSchema>, @Query(new ZodPipe(formatQuery)) q: z.infer<typeof formatQuery>, @Res({ passthrough: true }) res: Response) {
    return this.send(res, await this.svc.render(this.svc.template(kind), q.format));
  }
}
