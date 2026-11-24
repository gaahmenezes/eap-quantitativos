import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import type { z } from 'zod';
import { compareRevisionsQuery, issueRevisionSchema, type IssueRevisionInput } from '@eapq/contracts';
import { actorOf, type AuthContext } from '../../common/auth/auth-context.js';
import { Auth, ProjectPermission } from '../../common/auth/decorators.js';
import { uuidPipe, ZodPipe } from '../../common/zod.pipe.js';
import { RevisionsService } from './revisions.service.js';

const P = 'projectId';

@Controller('projects/:projectId/revisions')
export class RevisionsController {
  constructor(private readonly svc: RevisionsService) {}

  @Get()
  @ProjectPermission('project.read')
  list(@Param(P, uuidPipe) p: string) {
    return this.svc.list(p);
  }

  @Post()
  @ProjectPermission('project.revisions.issue')
  issue(@Auth() a: AuthContext, @Param(P, uuidPipe) p: string, @Body(new ZodPipe(issueRevisionSchema)) b: IssueRevisionInput) {
    return this.svc.issue(actorOf(a), p, b);
  }

  @Get('compare')
  @ProjectPermission('project.read')
  compare(@Auth() a: AuthContext, @Param(P, uuidPipe) p: string, @Query(new ZodPipe(compareRevisionsQuery)) q: z.infer<typeof compareRevisionsQuery>) {
    return this.svc.compare(a.organizationId, p, q.from, q.to);
  }

  @Get(':id')
  @ProjectPermission('project.read')
  get(@Param(P, uuidPipe) p: string, @Param('id', uuidPipe) id: string) {
    return this.svc.get(p, id);
  }

  @Get(':id/measurements/:measurementId')
  @ProjectPermission('project.read')
  frozen(@Param(P, uuidPipe) p: string, @Param('id', uuidPipe) id: string, @Param('measurementId', uuidPipe) m: string) {
    return this.svc.frozenMeasurement(p, id, m);
  }
}
