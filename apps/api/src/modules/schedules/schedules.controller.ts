import { Body, Controller, Get, HttpCode, Param, Post, Put, Query } from '@nestjs/common';
import { z } from 'zod';
import { archiveSheetSchema, createScheduleSchema, launchScheduleSchema, listSheetsQuery, saveScheduleSchema, type CreateScheduleInput, type SaveScheduleInput } from '@eapq/contracts';
import { actorOf, type AuthContext } from '../../common/auth/auth-context.js';
import { Auth, OrgPermission, ProjectPermission } from '../../common/auth/decorators.js';
import { IfMatch } from '../../common/if-match.js';
import { uuidPipe, ZodPipe } from '../../common/zod.pipe.js';
import { SchedulesService } from './schedules.service.js';

const P = 'projectId';

@Controller('schedule-sources')
export class ScheduleSourcesController {
  constructor(private readonly svc: SchedulesService) {}

  /** Quadros da organização que podem servir de lista padrão para um novo quadro. */
  @Get()
  @OrgPermission('org.read')
  list(@Auth() a: AuthContext) {
    return this.svc.sources(a.organizationId);
  }
}

@Controller('projects/:projectId/schedules')
export class SchedulesController {
  constructor(private readonly svc: SchedulesService) {}

  @Get()
  @ProjectPermission('project.read')
  list(@Auth() a: AuthContext, @Param(P, uuidPipe) p: string, @Query(new ZodPipe(listSheetsQuery)) q: z.infer<typeof listSheetsQuery>) {
    return this.svc.list(a.organizationId, p, q);
  }

  @Post()
  @ProjectPermission('project.content.edit')
  create(@Auth() a: AuthContext, @Param(P, uuidPipe) p: string, @Body(new ZodPipe(createScheduleSchema)) b: CreateScheduleInput) {
    return this.svc.create(actorOf(a), p, b);
  }

  @Get(':id')
  @ProjectPermission('project.read')
  detail(@Auth() a: AuthContext, @Param(P, uuidPipe) p: string, @Param('id', uuidPipe) id: string) {
    return this.svc.detail(a.organizationId, p, id);
  }

  @Put(':id')
  @ProjectPermission('project.content.edit')
  @HttpCode(204)
  async save(@Auth() a: AuthContext, @Param(P, uuidPipe) p: string, @Param('id', uuidPipe) id: string, @IfMatch() v: number, @Body(new ZodPipe(saveScheduleSchema)) b: SaveScheduleInput) {
    await this.svc.save(actorOf(a), p, id, v, b);
  }

  @Post(':id/launch')
  @ProjectPermission('project.content.edit')
  @HttpCode(200)
  launch(@Auth() a: AuthContext, @Param(P, uuidPipe) p: string, @Param('id', uuidPipe) id: string, @IfMatch() v: number, @Body(new ZodPipe(launchScheduleSchema)) b: z.infer<typeof launchScheduleSchema>) {
    return this.svc.launch(actorOf(a), p, id, v, b.reason);
  }

  @Post(':id/archive')
  @ProjectPermission('project.content.edit')
  @HttpCode(204)
  async archive(@Auth() a: AuthContext, @Param(P, uuidPipe) p: string, @Param('id', uuidPipe) id: string, @IfMatch() v: number, @Body(new ZodPipe(archiveSheetSchema)) b: { reason: string }) {
    await this.svc.setArchived(actorOf(a), p, id, v, true, b.reason);
  }

  @Post(':id/unarchive')
  @ProjectPermission('project.content.edit')
  @HttpCode(204)
  async unarchive(@Auth() a: AuthContext, @Param(P, uuidPipe) p: string, @Param('id', uuidPipe) id: string, @IfMatch() v: number) {
    await this.svc.setArchived(actorOf(a), p, id, v, false);
  }
}
