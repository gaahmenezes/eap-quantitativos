import { Controller, Get, Param } from '@nestjs/common';
import type { AuthContext } from '../../common/auth/auth-context.js';
import { Auth, ProjectPermission } from '../../common/auth/decorators.js';
import { uuidPipe } from '../../common/zod.pipe.js';
import { OperationsService } from './operations.service.js';

@Controller('projects/:projectId/operations')
export class OperationsController {
  constructor(private readonly svc: OperationsService) {}

  @Get() @ProjectPermission('project.read')
  overview(@Auth() a: AuthContext, @Param('projectId', uuidPipe) p: string) { return this.svc.overview(a.organizationId, p); }
}
