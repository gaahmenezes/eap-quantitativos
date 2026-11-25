import { Body, Controller, Get, HttpCode, Param, ParseIntPipe, Post, Put, Query, UploadedFile, UseInterceptors } from '@nestjs/common';
import { z } from 'zod';
import { previewWorkbookSheetSchema, saveWorkbookPlanSchema } from '@eapq/contracts';
import { actorOf, type AuthContext } from '../../common/auth/auth-context.js';
import { Auth, ProjectPermission } from '../../common/auth/decorators.js';
import { IfMatch } from '../../common/if-match.js';
import { uuidPipe, ZodPipe } from '../../common/zod.pipe.js';
import { uploadInterceptor } from '../documents/documents.controller.js';
import type { UploadedFile as File } from '../documents/documents.service.js';
import { WorkbooksService } from './workbooks.service.js';

const P = 'projectId';
const sheetQuery = z.object({ headerRow: z.coerce.number().int().min(0).max(5000).optional() });

/** Migração de planilhas de levantamento (abas → fichas e quadros). */
@Controller('projects/:projectId/workbook-imports')
export class WorkbooksController {
  constructor(private readonly svc: WorkbooksService) {}

  @Get() @ProjectPermission('project.read')
  list(@Auth() a: AuthContext, @Param(P, uuidPipe) p: string) { return this.svc.list(a.organizationId, p); }

  @Post() @ProjectPermission('project.content.edit') @UseInterceptors(uploadInterceptor())
  create(@Auth() a: AuthContext, @Param(P, uuidPipe) p: string, @UploadedFile() f: File | undefined) { return this.svc.create(actorOf(a), p, f); }

  @Get(':id') @ProjectPermission('project.read')
  get(@Auth() a: AuthContext, @Param(P, uuidPipe) p: string, @Param('id', uuidPipe) id: string) { return this.svc.get(a.organizationId, p, id); }

  @Get(':id/sheets/:index') @ProjectPermission('project.read')
  sheet(@Auth() a: AuthContext, @Param(P, uuidPipe) p: string, @Param('id', uuidPipe) id: string, @Param('index', ParseIntPipe) index: number, @Query(new ZodPipe(sheetQuery)) q: z.infer<typeof sheetQuery>) {
    return this.svc.sheet(a.organizationId, p, id, index, q.headerRow);
  }

  @Put(':id/plan') @ProjectPermission('project.content.edit') @HttpCode(204)
  async plan(@Auth() a: AuthContext, @Param(P, uuidPipe) p: string, @Param('id', uuidPipe) id: string, @IfMatch() v: number, @Body(new ZodPipe(saveWorkbookPlanSchema)) b: z.infer<typeof saveWorkbookPlanSchema>) {
    await this.svc.savePlan(actorOf(a), p, id, v, b.sheets);
  }

  @Post(':id/preview') @ProjectPermission('project.read') @HttpCode(200)
  preview(@Auth() a: AuthContext, @Param(P, uuidPipe) p: string, @Param('id', uuidPipe) id: string, @Body(new ZodPipe(previewWorkbookSheetSchema)) b: z.infer<typeof previewWorkbookSheetSchema>) {
    return this.svc.preview(a.organizationId, p, id, b.plan);
  }

  @Post(':id/apply') @ProjectPermission('project.content.edit') @HttpCode(200)
  apply(@Auth() a: AuthContext, @Param(P, uuidPipe) p: string, @Param('id', uuidPipe) id: string, @IfMatch() v: number) { return this.svc.apply(actorOf(a), p, id, v); }

  @Post(':id/cancel') @ProjectPermission('project.content.edit') @HttpCode(204)
  async cancel(@Auth() a: AuthContext, @Param(P, uuidPipe) p: string, @Param('id', uuidPipe) id: string) { await this.svc.cancel(actorOf(a), p, id); }
}
