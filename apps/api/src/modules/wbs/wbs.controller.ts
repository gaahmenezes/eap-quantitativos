import { Body, Controller, Get, HttpCode, Param, Patch, Post, Put } from '@nestjs/common';
import { z } from 'zod';
import {
  applyWbsSchema,
  archiveWbsSchema,
  createWbsNodeSchema,
  moveWbsNodeSchema,
  setWbsServicesSchema,
  updateWbsNodeSchema,
  wbsSelectionSchema,
  type WbsSelectionInput,
} from '@eapq/contracts';
import { actorOf, type AuthContext } from '../../common/auth/auth-context.js';
import { Auth, ProjectPermission } from '../../common/auth/decorators.js';
import { IfMatch } from '../../common/if-match.js';
import { uuidPipe, ZodPipe } from '../../common/zod.pipe.js';
import { WbsService } from './wbs.service.js';

const P = 'projectId';
const optionalReason = z.object({ reason: z.string().trim().max(500).optional() });

@Controller('projects/:projectId/wbs')
export class WbsController {
  constructor(private readonly svc: WbsService) {}

  @Get()
  @ProjectPermission('project.read')
  get(@Auth() a: AuthContext, @Param(P, uuidPipe) p: string) {
    return this.svc.get(a.organizationId, p);
  }

  @Post('preview')
  @ProjectPermission('project.content.edit')
  @HttpCode(200)
  preview(@Auth() a: AuthContext, @Param(P, uuidPipe) p: string, @Body(new ZodPipe(wbsSelectionSchema)) b: WbsSelectionInput) {
    return this.svc.preview(a.organizationId, p, b);
  }

  @Post('apply')
  @ProjectPermission('project.content.edit')
  @HttpCode(200)
  apply(@Auth() a: AuthContext, @Param(P, uuidPipe) p: string, @Body(new ZodPipe(applyWbsSchema)) b: WbsSelectionInput & { planHash: string }) {
    return this.svc.apply(actorOf(a), p, b);
  }

  @Post('nodes')
  @ProjectPermission('project.content.edit')
  create(@Auth() a: AuthContext, @Param(P, uuidPipe) p: string, @Body(new ZodPipe(createWbsNodeSchema)) b: { parentId: string | null; title: string; nodeType: 'GROUP' | 'ITEM' }) {
    return this.svc.createNode(actorOf(a), p, b);
  }

  @Patch('nodes/:id')
  @ProjectPermission('project.content.edit')
  @HttpCode(204)
  async update(@Auth() a: AuthContext, @Param(P, uuidPipe) p: string, @Param('id', uuidPipe) id: string, @IfMatch() v: number, @Body(new ZodPipe(updateWbsNodeSchema)) b: { title?: string; nodeType?: 'GROUP' | 'ITEM' }) {
    await this.svc.updateNode(actorOf(a), p, id, v, b);
  }

  @Post('nodes/:id/move')
  @ProjectPermission('project.content.edit')
  @HttpCode(200)
  move(@Auth() a: AuthContext, @Param(P, uuidPipe) p: string, @Param('id', uuidPipe) id: string, @IfMatch() v: number, @Body(new ZodPipe(moveWbsNodeSchema)) b: { parentId: string | null; position?: number }) {
    return this.svc.moveNode(actorOf(a), p, id, v, b);
  }

  @Post('nodes/:id/duplicate')
  @ProjectPermission('project.content.edit')
  duplicate(@Auth() a: AuthContext, @Param(P, uuidPipe) p: string, @Param('id', uuidPipe) id: string) {
    return this.svc.duplicate(actorOf(a), p, id);
  }

  @Post('nodes/:id/archive')
  @ProjectPermission('project.content.edit')
  @HttpCode(200)
  archive(@Auth() a: AuthContext, @Param(P, uuidPipe) p: string, @Param('id', uuidPipe) id: string, @IfMatch() v: number, @Body(new ZodPipe(archiveWbsSchema)) b: { reason: string }) {
    return this.svc.setArchived(actorOf(a), p, id, v, true, b.reason);
  }

  @Post('nodes/:id/unarchive')
  @ProjectPermission('project.content.edit')
  @HttpCode(200)
  unarchive(@Auth() a: AuthContext, @Param(P, uuidPipe) p: string, @Param('id', uuidPipe) id: string, @IfMatch() v: number, @Body(new ZodPipe(optionalReason)) b: { reason?: string }) {
    return this.svc.setArchived(actorOf(a), p, id, v, false, b.reason ?? null);
  }

  @Put('nodes/:id/services')
  @ProjectPermission('project.content.edit')
  services(@Auth() a: AuthContext, @Param(P, uuidPipe) p: string, @Param('id', uuidPipe) id: string, @Body(new ZodPipe(setWbsServicesSchema)) b: { serviceIds: string[] }) {
    return this.svc.setServices(actorOf(a), p, id, b.serviceIds);
  }
}
