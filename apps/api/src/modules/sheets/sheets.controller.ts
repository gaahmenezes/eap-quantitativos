import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import {
  archiveSheetSchema,
  createSheetSchema,
  createSheetTemplateSchema,
  launchSheetSchema,
  listSheetsQuery,
  updateSheetSchema,
  updateSheetTemplateSchema,
  updateSheetTemplateVersionSchema,
  type CreateSheetInput,
  type CreateSheetTemplateInput,
  type UpdateSheetInput,
  type UpdateSheetTemplateVersionInput,
} from '@eapq/contracts';
import { actorOf, type AuthContext } from '../../common/auth/auth-context.js';
import { Auth, OrgPermission, ProjectPermission } from '../../common/auth/decorators.js';
import { IfMatch } from '../../common/if-match.js';
import { uuidPipe, ZodPipe } from '../../common/zod.pipe.js';
import { SheetTemplatesService } from './sheet-templates.service.js';
import { SheetsService } from './sheets.service.js';

@Controller('sheet-templates')
export class SheetTemplatesController {
  constructor(private readonly svc: SheetTemplatesService) {}

  @Get()
  @OrgPermission('org.read')
  list(@Auth() a: AuthContext) {
    return this.svc.list(a.organizationId);
  }

  @Post()
  @OrgPermission('org.manage')
  create(@Auth() a: AuthContext, @Body(new ZodPipe(createSheetTemplateSchema)) b: CreateSheetTemplateInput) {
    return this.svc.create(actorOf(a), b);
  }

  @Patch(':id')
  @OrgPermission('org.manage')
  @HttpCode(204)
  async update(@Auth() a: AuthContext, @Param('id', uuidPipe) id: string, @IfMatch() v: number, @Body(new ZodPipe(updateSheetTemplateSchema)) b: { name?: string; description?: string | null }) {
    await this.svc.update(actorOf(a), id, v, b);
  }

  @Post(':id/archive')
  @OrgPermission('org.manage')
  @HttpCode(204)
  async archive(@Auth() a: AuthContext, @Param('id', uuidPipe) id: string, @IfMatch() v: number) {
    await this.svc.setArchived(actorOf(a), id, v, true);
  }

  @Post(':id/unarchive')
  @OrgPermission('org.manage')
  @HttpCode(204)
  async unarchive(@Auth() a: AuthContext, @Param('id', uuidPipe) id: string, @IfMatch() v: number) {
    await this.svc.setArchived(actorOf(a), id, v, false);
  }

  @Post(':id/versions')
  @OrgPermission('org.manage')
  newVersion(@Auth() a: AuthContext, @Param('id', uuidPipe) id: string) {
    return this.svc.newVersion(actorOf(a), id);
  }

  @Patch(':id/versions/:versionId')
  @OrgPermission('org.manage')
  @HttpCode(204)
  async updateVersion(@Auth() a: AuthContext, @Param('id', uuidPipe) id: string, @Param('versionId', uuidPipe) vid: string, @Body(new ZodPipe(updateSheetTemplateVersionSchema)) b: UpdateSheetTemplateVersionInput) {
    await this.svc.updateVersion(actorOf(a), id, vid, b);
  }

  @Delete(':id/versions/:versionId')
  @OrgPermission('org.manage')
  @HttpCode(204)
  async discard(@Auth() a: AuthContext, @Param('id', uuidPipe) id: string, @Param('versionId', uuidPipe) vid: string) {
    await this.svc.discard(actorOf(a), id, vid);
  }

  @Post(':id/versions/:versionId/publish')
  @OrgPermission('org.manage')
  @HttpCode(204)
  async publish(@Auth() a: AuthContext, @Param('id', uuidPipe) id: string, @Param('versionId', uuidPipe) vid: string) {
    await this.svc.publish(actorOf(a), id, vid);
  }
}

const P = 'projectId';

@Controller('projects/:projectId/sheets')
export class SheetsController {
  constructor(private readonly svc: SheetsService) {}

  @Get()
  @ProjectPermission('project.read')
  list(@Auth() a: AuthContext, @Param(P, uuidPipe) p: string, @Query(new ZodPipe(listSheetsQuery)) q: z.infer<typeof listSheetsQuery>) {
    return this.svc.list(a.organizationId, p, q);
  }

  @Post()
  @ProjectPermission('project.content.edit')
  create(@Auth() a: AuthContext, @Param(P, uuidPipe) p: string, @Body(new ZodPipe(createSheetSchema)) b: CreateSheetInput) {
    return this.svc.create(actorOf(a), p, b);
  }

  @Get(':id')
  @ProjectPermission('project.read')
  detail(@Auth() a: AuthContext, @Param(P, uuidPipe) p: string, @Param('id', uuidPipe) id: string) {
    return this.svc.detail(a.organizationId, p, id);
  }

  @Patch(':id')
  @ProjectPermission('project.content.edit')
  @HttpCode(204)
  async update(@Auth() a: AuthContext, @Param(P, uuidPipe) p: string, @Param('id', uuidPipe) id: string, @IfMatch() v: number, @Body(new ZodPipe(updateSheetSchema)) b: UpdateSheetInput) {
    await this.svc.update(actorOf(a), p, id, v, b);
  }

  @Post(':id/launch')
  @ProjectPermission('project.content.edit')
  @HttpCode(200)
  launch(@Auth() a: AuthContext, @Param(P, uuidPipe) p: string, @Param('id', uuidPipe) id: string, @IfMatch() v: number, @Body(new ZodPipe(launchSheetSchema)) b: z.infer<typeof launchSheetSchema>) {
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
