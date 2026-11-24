import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import {
  archiveWithReasonSchema,
  createElementSchema,
  createNetworkNodeSchema,
  createNetworkSchema,
  createSegmentSchema,
  createSystemSchema,
  updateElementSchema,
  updateNetworkNodeSchema,
  updateNetworkSchema,
  updateSegmentSchema,
  updateSystemSchema,
  type CreateElementInput,
  type CreateNetworkNodeInput,
  type CreateSegmentInput,
  type UpdateElementInput,
  type UpdateNetworkNodeInput,
  type UpdateSegmentInput,
} from '@eapq/contracts';
import { actorOf, type AuthContext } from '../../common/auth/auth-context.js';
import { Auth, ProjectPermission } from '../../common/auth/decorators.js';
import { IfMatch } from '../../common/if-match.js';
import { uuidPipe, ZodPipe } from '../../common/zod.pipe.js';
import { InfrastructureService } from './infrastructure.service.js';

const elementsQuery = z.object({ structureNodeId: z.uuid().optional(), systemId: z.uuid().optional() });
type Reason = { reason: string };
const P = 'projectId';

@Controller('projects/:projectId')
export class InfrastructureController {
  constructor(private readonly infra: InfrastructureService) {}

  @Get('infrastructure/systems')
  @ProjectPermission('project.read')
  list(@Auth() a: AuthContext, @Param(P, uuidPipe) p: string) {
    return this.infra.listSystems(a.organizationId, p);
  }

  @Get('infrastructure/systems/:id')
  @ProjectPermission('project.read')
  get(@Auth() a: AuthContext, @Param(P, uuidPipe) p: string, @Param('id', uuidPipe) id: string) {
    return this.infra.getSystem(a.organizationId, p, id);
  }

  @Post('infrastructure/systems')
  @ProjectPermission('project.content.edit')
  createSystem(@Auth() a: AuthContext, @Param(P, uuidPipe) p: string, @Body(new ZodPipe(createSystemSchema)) b: { systemTypeId: string; name: string; scopeNodeId?: string | null }) {
    return this.infra.createSystem(actorOf(a), p, b);
  }

  @Patch('infrastructure/systems/:id')
  @ProjectPermission('project.content.edit')
  @HttpCode(204)
  async updateSystem(@Auth() a: AuthContext, @Param(P, uuidPipe) p: string, @Param('id', uuidPipe) id: string, @IfMatch() v: number, @Body(new ZodPipe(updateSystemSchema)) b: { name?: string; scopeNodeId?: string | null }) {
    await this.infra.updateSystem(actorOf(a), p, id, v, b);
  }

  @Post('infrastructure/systems/:id/archive')
  @ProjectPermission('project.content.edit')
  @HttpCode(200)
  archiveSystem(@Auth() a: AuthContext, @Param(P, uuidPipe) p: string, @Param('id', uuidPipe) id: string, @IfMatch() v: number, @Body(new ZodPipe(archiveWithReasonSchema)) b: Reason) {
    return this.infra.archiveSystem(actorOf(a), p, id, v, b.reason);
  }

  @Post('infrastructure/systems/:id/networks')
  @ProjectPermission('project.content.edit')
  createNetwork(@Auth() a: AuthContext, @Param(P, uuidPipe) p: string, @Param('id', uuidPipe) id: string, @Body(new ZodPipe(createNetworkSchema)) b: { code: string; name: string }) {
    return this.infra.createNetwork(actorOf(a), p, id, b);
  }

  @Patch('infrastructure/networks/:id')
  @ProjectPermission('project.content.edit')
  @HttpCode(204)
  async updateNetwork(@Auth() a: AuthContext, @Param(P, uuidPipe) p: string, @Param('id', uuidPipe) id: string, @IfMatch() v: number, @Body(new ZodPipe(updateNetworkSchema)) b: { code?: string; name?: string }) {
    await this.infra.updateNetwork(actorOf(a), p, id, v, b);
  }

  @Post('infrastructure/networks/:id/archive')
  @ProjectPermission('project.content.edit')
  @HttpCode(200)
  archiveNetwork(@Auth() a: AuthContext, @Param(P, uuidPipe) p: string, @Param('id', uuidPipe) id: string, @IfMatch() v: number, @Body(new ZodPipe(archiveWithReasonSchema)) b: Reason) {
    return this.infra.archiveNetwork(actorOf(a), p, id, v, b.reason);
  }

  @Post('infrastructure/networks/:id/nodes')
  @ProjectPermission('project.content.edit')
  createNode(@Auth() a: AuthContext, @Param(P, uuidPipe) p: string, @Param('id', uuidPipe) id: string, @Body(new ZodPipe(createNetworkNodeSchema)) b: CreateNetworkNodeInput) {
    return this.infra.createNode(actorOf(a), p, id, b);
  }

  @Patch('infrastructure/nodes/:id')
  @ProjectPermission('project.content.edit')
  updateNode(@Auth() a: AuthContext, @Param(P, uuidPipe) p: string, @Param('id', uuidPipe) id: string, @IfMatch() v: number, @Body(new ZodPipe(updateNetworkNodeSchema)) b: UpdateNetworkNodeInput) {
    return this.infra.updateNode(actorOf(a), p, id, v, b);
  }

  @Post('infrastructure/nodes/:id/archive')
  @ProjectPermission('project.content.edit')
  @HttpCode(204)
  async archiveNode(@Auth() a: AuthContext, @Param(P, uuidPipe) p: string, @Param('id', uuidPipe) id: string, @IfMatch() v: number, @Body(new ZodPipe(archiveWithReasonSchema)) b: Reason) {
    await this.infra.archiveNode(actorOf(a), p, id, v, b.reason);
  }

  @Post('infrastructure/networks/:id/segments')
  @ProjectPermission('project.content.edit')
  createSegment(@Auth() a: AuthContext, @Param(P, uuidPipe) p: string, @Param('id', uuidPipe) id: string, @Body(new ZodPipe(createSegmentSchema)) b: CreateSegmentInput) {
    return this.infra.createSegment(actorOf(a), p, id, b);
  }

  @Patch('infrastructure/segments/:id')
  @ProjectPermission('project.content.edit')
  @HttpCode(204)
  async updateSegment(@Auth() a: AuthContext, @Param(P, uuidPipe) p: string, @Param('id', uuidPipe) id: string, @IfMatch() v: number, @Body(new ZodPipe(updateSegmentSchema)) b: UpdateSegmentInput) {
    await this.infra.updateSegment(actorOf(a), p, id, v, b);
  }

  @Post('infrastructure/segments/:id/archive')
  @ProjectPermission('project.content.edit')
  @HttpCode(204)
  async archiveSegment(@Auth() a: AuthContext, @Param(P, uuidPipe) p: string, @Param('id', uuidPipe) id: string, @IfMatch() v: number, @Body(new ZodPipe(archiveWithReasonSchema)) b: Reason) {
    await this.infra.archiveSegment(actorOf(a), p, id, v, b.reason);
  }

  @Get('elements')
  @ProjectPermission('project.read')
  elements(@Auth() a: AuthContext, @Param(P, uuidPipe) p: string, @Query(new ZodPipe(elementsQuery)) q: { structureNodeId?: string; systemId?: string }) {
    return this.infra.listElements(a.organizationId, p, q);
  }

  @Post('elements')
  @ProjectPermission('project.content.edit')
  createElement(@Auth() a: AuthContext, @Param(P, uuidPipe) p: string, @Body(new ZodPipe(createElementSchema)) b: CreateElementInput) {
    return this.infra.createElement(actorOf(a), p, b);
  }

  @Patch('elements/:id')
  @ProjectPermission('project.content.edit')
  updateElement(@Auth() a: AuthContext, @Param(P, uuidPipe) p: string, @Param('id', uuidPipe) id: string, @IfMatch() v: number, @Body(new ZodPipe(updateElementSchema)) b: UpdateElementInput) {
    return this.infra.updateElement(actorOf(a), p, id, v, b);
  }

  @Post('elements/:id/archive')
  @ProjectPermission('project.content.edit')
  @HttpCode(204)
  async archiveElement(@Auth() a: AuthContext, @Param(P, uuidPipe) p: string, @Param('id', uuidPipe) id: string, @IfMatch() v: number, @Body(new ZodPipe(archiveWithReasonSchema)) b: Reason) {
    await this.infra.archiveElement(actorOf(a), p, id, v, b.reason);
  }
}
