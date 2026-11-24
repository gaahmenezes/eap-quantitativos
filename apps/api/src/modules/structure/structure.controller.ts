import { Body, Controller, Get, HttpCode, Param, Patch, Post } from '@nestjs/common';
import { z } from 'zod';
import {
  archiveNodeSchema,
  createModuleSchema,
  createNodeSchema,
  createTypologySchema,
  moveNodeSchema,
  updateModuleSchema,
  updateNodeSchema,
  updateTypologySchema,
  wizardInputSchema,
  type CreateNodeInput,
  type CreateTypologyInput,
  type MoveNodeInput,
  type UpdateNodeInput,
  type UpdateTypologyInput,
  type WizardInput,
} from '@eapq/contracts';
import type { ModuleKind } from '@eapq/domain';
import { actorOf, type AuthContext } from '../../common/auth/auth-context.js';
import { Auth, ProjectPermission } from '../../common/auth/decorators.js';
import { IfMatch } from '../../common/if-match.js';
import { uuidPipe, ZodPipe } from '../../common/zod.pipe.js';
import { StructureService } from './structure.service.js';
import { TypologiesService } from './typologies.service.js';

const optionalReason = z.object({ reason: z.string().trim().max(500).optional() });

@Controller('projects/:projectId')
export class StructureController {
  constructor(
    private readonly structure: StructureService,
    private readonly typologies: TypologiesService,
  ) {}

  @Get('structure')
  @ProjectPermission('project.read')
  get(@Auth() auth: AuthContext, @Param('projectId', uuidPipe) projectId: string) {
    return this.structure.get(auth.organizationId, projectId);
  }

  @Post('structure/wizard/preview')
  @ProjectPermission('project.content.edit')
  @HttpCode(200)
  preview(@Auth() auth: AuthContext, @Param('projectId', uuidPipe) projectId: string, @Body(new ZodPipe(wizardInputSchema)) body: WizardInput) {
    return this.structure.previewWizard(auth.organizationId, projectId, body);
  }

  @Post('structure/wizard/apply')
  @ProjectPermission('project.content.edit')
  apply(@Auth() auth: AuthContext, @Param('projectId', uuidPipe) projectId: string, @Body(new ZodPipe(wizardInputSchema)) body: WizardInput) {
    return this.structure.applyWizard(actorOf(auth), projectId, body);
  }

  @Post('structure/modules')
  @ProjectPermission('project.content.edit')
  createModule(
    @Auth() auth: AuthContext,
    @Param('projectId', uuidPipe) projectId: string,
    @Body(new ZodPipe(createModuleSchema)) body: { kind: ModuleKind; name: string },
  ) {
    return this.structure.createModule(actorOf(auth), projectId, body);
  }

  @Patch('structure/modules/:moduleId')
  @ProjectPermission('project.content.edit')
  renameModule(
    @Auth() auth: AuthContext,
    @Param('projectId', uuidPipe) projectId: string,
    @Param('moduleId', uuidPipe) moduleId: string,
    @IfMatch() version: number,
    @Body(new ZodPipe(updateModuleSchema)) body: { name: string },
  ) {
    return this.structure.renameModule(actorOf(auth), projectId, moduleId, version, body.name);
  }

  @Post('structure/nodes')
  @ProjectPermission('project.content.edit')
  createNode(@Auth() auth: AuthContext, @Param('projectId', uuidPipe) projectId: string, @Body(new ZodPipe(createNodeSchema)) body: CreateNodeInput) {
    return this.structure.createNode(actorOf(auth), projectId, body);
  }

  @Patch('structure/nodes/:nodeId')
  @ProjectPermission('project.content.edit')
  updateNode(
    @Auth() auth: AuthContext,
    @Param('projectId', uuidPipe) projectId: string,
    @Param('nodeId', uuidPipe) nodeId: string,
    @IfMatch() version: number,
    @Body(new ZodPipe(updateNodeSchema)) body: UpdateNodeInput,
  ) {
    return this.structure.updateNode(actorOf(auth), projectId, nodeId, version, body);
  }

  @Post('structure/nodes/:nodeId/move')
  @ProjectPermission('project.content.edit')
  @HttpCode(200)
  move(
    @Auth() auth: AuthContext,
    @Param('projectId', uuidPipe) projectId: string,
    @Param('nodeId', uuidPipe) nodeId: string,
    @IfMatch() version: number,
    @Body(new ZodPipe(moveNodeSchema)) body: MoveNodeInput,
  ) {
    return this.structure.moveNode(actorOf(auth), projectId, nodeId, version, body);
  }

  @Post('structure/nodes/:nodeId/duplicate')
  @ProjectPermission('project.content.edit')
  duplicate(@Auth() auth: AuthContext, @Param('projectId', uuidPipe) projectId: string, @Param('nodeId', uuidPipe) nodeId: string) {
    return this.structure.duplicateNode(actorOf(auth), projectId, nodeId);
  }

  @Post('structure/nodes/:nodeId/archive')
  @ProjectPermission('project.content.edit')
  @HttpCode(200)
  archive(
    @Auth() auth: AuthContext,
    @Param('projectId', uuidPipe) projectId: string,
    @Param('nodeId', uuidPipe) nodeId: string,
    @IfMatch() version: number,
    @Body(new ZodPipe(archiveNodeSchema)) body: { reason: string },
  ) {
    return this.structure.setArchived(actorOf(auth), projectId, nodeId, version, true, body.reason);
  }

  @Post('structure/nodes/:nodeId/unarchive')
  @ProjectPermission('project.content.edit')
  @HttpCode(200)
  unarchive(
    @Auth() auth: AuthContext,
    @Param('projectId', uuidPipe) projectId: string,
    @Param('nodeId', uuidPipe) nodeId: string,
    @IfMatch() version: number,
    @Body(new ZodPipe(optionalReason)) body: { reason?: string },
  ) {
    return this.structure.setArchived(actorOf(auth), projectId, nodeId, version, false, body.reason ?? null);
  }

  // ---------- tipologias ----------

  @Get('typologies')
  @ProjectPermission('project.read')
  listTypologies(@Auth() auth: AuthContext, @Param('projectId', uuidPipe) projectId: string) {
    return this.typologies.list(auth.organizationId, projectId);
  }

  @Post('typologies')
  @ProjectPermission('project.content.edit')
  createTypology(@Auth() auth: AuthContext, @Param('projectId', uuidPipe) projectId: string, @Body(new ZodPipe(createTypologySchema)) body: CreateTypologyInput) {
    return this.typologies.create(actorOf(auth), projectId, body);
  }

  @Patch('typologies/:typologyId')
  @ProjectPermission('project.content.edit')
  updateTypology(
    @Auth() auth: AuthContext,
    @Param('projectId', uuidPipe) projectId: string,
    @Param('typologyId', uuidPipe) id: string,
    @IfMatch() version: number,
    @Body(new ZodPipe(updateTypologySchema)) body: UpdateTypologyInput,
  ) {
    return this.typologies.update(actorOf(auth), projectId, id, version, body);
  }

  @Post('typologies/:typologyId/archive')
  @ProjectPermission('project.content.edit')
  @HttpCode(200)
  archiveTypology(
    @Auth() auth: AuthContext,
    @Param('projectId', uuidPipe) projectId: string,
    @Param('typologyId', uuidPipe) id: string,
    @IfMatch() version: number,
    @Body(new ZodPipe(optionalReason)) body: { reason?: string },
  ) {
    return this.typologies.setArchived(actorOf(auth), projectId, id, version, true, body.reason ?? null);
  }

  @Post('typologies/:typologyId/unarchive')
  @ProjectPermission('project.content.edit')
  @HttpCode(200)
  unarchiveTypology(
    @Auth() auth: AuthContext,
    @Param('projectId', uuidPipe) projectId: string,
    @Param('typologyId', uuidPipe) id: string,
    @IfMatch() version: number,
  ) {
    return this.typologies.setArchived(actorOf(auth), projectId, id, version, false, null);
  }
}
