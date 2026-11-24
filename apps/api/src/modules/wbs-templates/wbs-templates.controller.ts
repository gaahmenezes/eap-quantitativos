import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import {
  createTemplateNodeSchema,
  createTemplateSchema,
  moveTemplateNodeSchema,
  updateTemplateNodeSchema,
  updateTemplateSchema,
  type CreateTemplateInput,
  type CreateTemplateNodeInput,
  type UpdateTemplateNodeInput,
} from '@eapq/contracts';
import { actorOf, type AuthContext } from '../../common/auth/auth-context.js';
import { Auth, OrgPermission } from '../../common/auth/decorators.js';
import { IfMatch } from '../../common/if-match.js';
import { uuidPipe, ZodPipe } from '../../common/zod.pipe.js';
import { WbsTemplatesService } from './wbs-templates.service.js';

const notes = z.object({ notes: z.string().trim().max(1000).optional() });
const compareQuery = z.object({ from: z.uuid(), to: z.uuid() });

@Controller('wbs-templates')
export class WbsTemplatesController {
  constructor(private readonly svc: WbsTemplatesService) {}

  @Get()
  @OrgPermission('org.read')
  list(@Auth() a: AuthContext) {
    return this.svc.list(a.organizationId);
  }

  @Post()
  @OrgPermission('org.manage')
  create(@Auth() a: AuthContext, @Body(new ZodPipe(createTemplateSchema)) b: CreateTemplateInput) {
    return this.svc.create(actorOf(a), b);
  }

  @Patch(':id')
  @OrgPermission('org.manage')
  @HttpCode(204)
  async update(@Auth() a: AuthContext, @Param('id', uuidPipe) id: string, @IfMatch() v: number, @Body(new ZodPipe(updateTemplateSchema)) b: Partial<CreateTemplateInput>) {
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

  @Get(':id/compare')
  @OrgPermission('org.read')
  compare(@Auth() a: AuthContext, @Param('id', uuidPipe) id: string, @Query(new ZodPipe(compareQuery)) q: { from: string; to: string }) {
    return this.svc.compare(a.organizationId, id, q.from, q.to);
  }

  @Get(':id/versions/:versionId')
  @OrgPermission('org.read')
  version(@Auth() a: AuthContext, @Param('id', uuidPipe) id: string, @Param('versionId', uuidPipe) v: string) {
    return this.svc.getVersion(a.organizationId, id, v);
  }

  @Post(':id/versions')
  @OrgPermission('org.manage')
  createDraft(@Auth() a: AuthContext, @Param('id', uuidPipe) id: string) {
    return this.svc.createDraft(actorOf(a), id);
  }

  @Delete(':id/versions/:versionId')
  @OrgPermission('org.manage')
  @HttpCode(204)
  async discard(@Auth() a: AuthContext, @Param('id', uuidPipe) id: string, @Param('versionId', uuidPipe) v: string) {
    await this.svc.discardDraft(actorOf(a), id, v);
  }

  @Post(':id/versions/:versionId/publish')
  @OrgPermission('org.manage')
  @HttpCode(200)
  publish(@Auth() a: AuthContext, @Param('id', uuidPipe) id: string, @Param('versionId', uuidPipe) v: string, @Body(new ZodPipe(notes)) b: { notes?: string }) {
    return this.svc.publish(actorOf(a), id, v, b.notes);
  }

  @Post(':id/versions/:versionId/nodes')
  @OrgPermission('org.manage')
  addNode(@Auth() a: AuthContext, @Param('id', uuidPipe) id: string, @Param('versionId', uuidPipe) v: string, @Body(new ZodPipe(createTemplateNodeSchema)) b: CreateTemplateNodeInput) {
    return this.svc.addNode(actorOf(a), id, v, b);
  }

  @Patch(':id/versions/:versionId/nodes/:nodeId')
  @OrgPermission('org.manage')
  updateNode(@Auth() a: AuthContext, @Param('id', uuidPipe) id: string, @Param('versionId', uuidPipe) v: string, @Param('nodeId', uuidPipe) n: string, @Body(new ZodPipe(updateTemplateNodeSchema)) b: UpdateTemplateNodeInput) {
    return this.svc.updateNode(actorOf(a), id, v, n, b);
  }

  @Delete(':id/versions/:versionId/nodes/:nodeId')
  @OrgPermission('org.manage')
  @HttpCode(204)
  async removeNode(@Auth() a: AuthContext, @Param('id', uuidPipe) id: string, @Param('versionId', uuidPipe) v: string, @Param('nodeId', uuidPipe) n: string) {
    await this.svc.removeNode(actorOf(a), id, v, n);
  }

  @Post(':id/versions/:versionId/nodes/:nodeId/move')
  @OrgPermission('org.manage')
  @HttpCode(204)
  async moveNode(@Auth() a: AuthContext, @Param('id', uuidPipe) id: string, @Param('versionId', uuidPipe) v: string, @Param('nodeId', uuidPipe) n: string, @Body(new ZodPipe(moveTemplateNodeSchema)) b: { parentId: string | null; position?: number }) {
    await this.svc.moveNode(actorOf(a), id, v, n, b);
  }
}
