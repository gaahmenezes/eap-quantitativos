import { Body, Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import {
  createMeasurementSchema,
  listMeasurementsQuery,
  listRevisionsQuery,
  previewMeasurementSchema,
  reviseMeasurementSchema,
  type CalcInput,
  type CreateMeasurementInput,
  type ReviseMeasurementInput,
} from '@eapq/contracts';
import { actorOf, type AuthContext } from '../../common/auth/auth-context.js';
import { Auth, ProjectPermission } from '../../common/auth/decorators.js';
import { IfMatch } from '../../common/if-match.js';
import { uuidPipe, ZodPipe } from '../../common/zod.pipe.js';
import { MeasurementsService } from './measurements.service.js';

const P = 'projectId';
const archiveBody = z.object({ reason: z.string().trim().min(1, 'Campo obrigatório').max(500) });

@Controller('projects/:projectId/measurements')
export class MeasurementsController {
  constructor(private readonly svc: MeasurementsService) {}

  @Get()
  @ProjectPermission('project.read')
  list(@Auth() a: AuthContext, @Param(P, uuidPipe) p: string, @Query(new ZodPipe(listMeasurementsQuery)) q: z.infer<typeof listMeasurementsQuery>) {
    return this.svc.list(a.organizationId, p, q);
  }

  @Get('summary')
  @ProjectPermission('project.read')
  summary(@Auth() a: AuthContext, @Param(P, uuidPipe) p: string) {
    return this.svc.summary(a.organizationId, p);
  }

  @Get('anchors')
  @ProjectPermission('project.read')
  anchors(@Param(P, uuidPipe) p: string) {
    return this.svc.anchors(p);
  }

  @Get('revisions')
  @ProjectPermission('project.read')
  revisions(@Auth() a: AuthContext, @Param(P, uuidPipe) p: string, @Query(new ZodPipe(listRevisionsQuery)) q: z.infer<typeof listRevisionsQuery>) {
    return this.svc.revisions(a.organizationId, p, q);
  }

  @Post('preview')
  @ProjectPermission('project.content.edit')
  @HttpCode(200)
  preview(@Auth() a: AuthContext, @Param(P, uuidPipe) p: string, @Body(new ZodPipe(previewMeasurementSchema)) b: { serviceId: string; calc: CalcInput }) {
    return this.svc.preview(a.organizationId, p, b);
  }

  @Post()
  @ProjectPermission('project.content.edit')
  create(@Auth() a: AuthContext, @Param(P, uuidPipe) p: string, @Body(new ZodPipe(createMeasurementSchema)) b: CreateMeasurementInput) {
    return this.svc.create(actorOf(a), p, b);
  }

  @Get(':id')
  @ProjectPermission('project.read')
  detail(@Auth() a: AuthContext, @Param(P, uuidPipe) p: string, @Param('id', uuidPipe) id: string) {
    return this.svc.detail(a.organizationId, p, id);
  }

  @Post(':id/revisions')
  @ProjectPermission('project.content.edit')
  @HttpCode(204)
  async revise(@Auth() a: AuthContext, @Param(P, uuidPipe) p: string, @Param('id', uuidPipe) id: string, @IfMatch() v: number, @Body(new ZodPipe(reviseMeasurementSchema)) b: ReviseMeasurementInput) {
    await this.svc.revise(actorOf(a), p, id, v, b);
  }

  @Post(':id/archive')
  @ProjectPermission('project.content.edit')
  @HttpCode(204)
  async archive(@Auth() a: AuthContext, @Param(P, uuidPipe) p: string, @Param('id', uuidPipe) id: string, @IfMatch() v: number, @Body(new ZodPipe(archiveBody)) b: { reason: string }) {
    await this.svc.setArchived(actorOf(a), p, id, v, true, b.reason);
  }

  @Post(':id/unarchive')
  @ProjectPermission('project.content.edit')
  @HttpCode(204)
  async unarchive(@Auth() a: AuthContext, @Param(P, uuidPipe) p: string, @Param('id', uuidPipe) id: string, @IfMatch() v: number) {
    await this.svc.setArchived(actorOf(a), p, id, v, false);
  }
}
