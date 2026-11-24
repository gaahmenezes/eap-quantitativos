import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post } from '@nestjs/common';
import {
  archiveWithReasonSchema,
  createOverrideSchema,
  createRevisionSchema,
  createTypologyElementSchema,
  propagateSchema,
  publishRevisionSchema,
  updateTypologyElementSchema,
  type CreateOverrideInput,
  type CreateTypologyElementInput,
  type PropagateInput,
  type UpdateTypologyElementInput,
} from '@eapq/contracts';
import { actorOf, type AuthContext } from '../../common/auth/auth-context.js';
import { Auth, ProjectPermission } from '../../common/auth/decorators.js';
import { uuidPipe, ZodPipe } from '../../common/zod.pipe.js';
import { ConstructiveService } from './constructive.service.js';

const P = 'projectId';
type Notes = { notes?: string };

@Controller('projects/:projectId')
export class ConstructiveController {
  constructor(private readonly svc: ConstructiveService) {}

  @Get('typologies/:typologyId/revisions')
  @ProjectPermission('project.read')
  revisions(@Auth() a: AuthContext, @Param(P, uuidPipe) p: string, @Param('typologyId', uuidPipe) t: string) {
    return this.svc.listRevisions(a.organizationId, p, t);
  }

  @Get('typologies/:typologyId/revisions/:revisionId')
  @ProjectPermission('project.read')
  revision(@Param(P, uuidPipe) p: string, @Param('typologyId', uuidPipe) t: string, @Param('revisionId', uuidPipe) r: string) {
    return this.svc.getRevision(p, t, r);
  }

  @Post('typologies/:typologyId/revisions')
  @ProjectPermission('project.content.edit')
  createDraft(@Auth() a: AuthContext, @Param(P, uuidPipe) p: string, @Param('typologyId', uuidPipe) t: string, @Body(new ZodPipe(createRevisionSchema)) b: Notes) {
    return this.svc.createDraft(actorOf(a), p, t, b.notes);
  }

  @Delete('typologies/:typologyId/revisions/:revisionId')
  @ProjectPermission('project.content.edit')
  @HttpCode(204)
  async discard(@Auth() a: AuthContext, @Param(P, uuidPipe) p: string, @Param('typologyId', uuidPipe) t: string, @Param('revisionId', uuidPipe) r: string) {
    await this.svc.discardDraft(actorOf(a), p, t, r);
  }

  @Post('typologies/:typologyId/revisions/:revisionId/publish')
  @ProjectPermission('project.content.edit')
  @HttpCode(200)
  publish(@Auth() a: AuthContext, @Param(P, uuidPipe) p: string, @Param('typologyId', uuidPipe) t: string, @Param('revisionId', uuidPipe) r: string, @Body(new ZodPipe(publishRevisionSchema)) b: Notes) {
    return this.svc.publish(actorOf(a), p, t, r, b.notes);
  }

  @Post('typologies/:typologyId/revisions/:revisionId/elements')
  @ProjectPermission('project.content.edit')
  addElement(@Auth() a: AuthContext, @Param(P, uuidPipe) p: string, @Param('typologyId', uuidPipe) t: string, @Param('revisionId', uuidPipe) r: string, @Body(new ZodPipe(createTypologyElementSchema)) b: CreateTypologyElementInput) {
    return this.svc.addElement(actorOf(a), p, t, r, b);
  }

  @Patch('typologies/:typologyId/revisions/:revisionId/elements/:elementId')
  @ProjectPermission('project.content.edit')
  updateElement(@Auth() a: AuthContext, @Param(P, uuidPipe) p: string, @Param('typologyId', uuidPipe) t: string, @Param('revisionId', uuidPipe) r: string, @Param('elementId', uuidPipe) e: string, @Body(new ZodPipe(updateTypologyElementSchema)) b: UpdateTypologyElementInput) {
    return this.svc.updateElement(actorOf(a), p, t, r, e, b);
  }

  @Delete('typologies/:typologyId/revisions/:revisionId/elements/:elementId')
  @ProjectPermission('project.content.edit')
  @HttpCode(204)
  async removeElement(@Auth() a: AuthContext, @Param(P, uuidPipe) p: string, @Param('typologyId', uuidPipe) t: string, @Param('revisionId', uuidPipe) r: string, @Param('elementId', uuidPipe) e: string) {
    await this.svc.removeElement(actorOf(a), p, t, r, e);
  }

  @Get('typologies/:typologyId/propagation')
  @ProjectPermission('project.read')
  propagation(@Param(P, uuidPipe) p: string, @Param('typologyId', uuidPipe) t: string) {
    return this.svc.propagationPreview(p, t);
  }

  @Post('typologies/:typologyId/propagation')
  @ProjectPermission('project.content.edit')
  @HttpCode(200)
  propagate(@Auth() a: AuthContext, @Param(P, uuidPipe) p: string, @Param('typologyId', uuidPipe) t: string, @Body(new ZodPipe(propagateSchema)) b: PropagateInput) {
    return this.svc.propagate(actorOf(a), p, t, b);
  }

  @Get('units/:unitId/elements')
  @ProjectPermission('project.read')
  unitElements(@Param(P, uuidPipe) p: string, @Param('unitId', uuidPipe) u: string) {
    return this.svc.unitElements(p, u);
  }

  @Post('units/:unitId/overrides')
  @ProjectPermission('project.content.edit')
  createOverride(@Auth() a: AuthContext, @Param(P, uuidPipe) p: string, @Param('unitId', uuidPipe) u: string, @Body(new ZodPipe(createOverrideSchema)) b: CreateOverrideInput) {
    return this.svc.createOverride(actorOf(a), p, u, b);
  }

  @Post('units/:unitId/overrides/:overrideId/archive')
  @ProjectPermission('project.content.edit')
  @HttpCode(204)
  async archiveOverride(@Auth() a: AuthContext, @Param(P, uuidPipe) p: string, @Param('unitId', uuidPipe) u: string, @Param('overrideId', uuidPipe) o: string, @Body(new ZodPipe(archiveWithReasonSchema)) b: { reason: string }) {
    await this.svc.archiveOverride(actorOf(a), p, u, o, b.reason);
  }
}
