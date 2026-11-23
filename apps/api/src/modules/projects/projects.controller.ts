import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { z } from 'zod';
import {
  archiveProjectSchema,
  createProjectSchema,
  listProjectsQuery,
  projectRoleSchema,
  updateProjectSchema,
  type CreateProjectInput,
  type ListProjectsQuery,
  type UpdateProjectInput,
} from '@eapq/contracts';
import type { ProjectRole } from '@eapq/domain';
import { actorOf, type AuthContext } from '../../common/auth/auth-context.js';
import { Auth, Authenticated, OrgPermission, ProjectPermission } from '../../common/auth/decorators.js';
import { IfMatch } from '../../common/if-match.js';
import { uuidPipe, ZodPipe } from '../../common/zod.pipe.js';
import { AuditService } from '../audit/audit.service.js';
import { ProjectsService } from './projects.service.js';

const unarchiveSchema = z.object({ reason: z.string().trim().max(500).optional() });
const setMemberSchema = z.object({ role: projectRoleSchema });

@Controller('projects')
export class ProjectsController {
  constructor(
    private readonly projects: ProjectsService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  @Authenticated()
  list(@Auth() auth: AuthContext, @Query(new ZodPipe(listProjectsQuery)) q: ListProjectsQuery) {
    return this.projects.list(auth, q);
  }

  @Post()
  @OrgPermission('project.create')
  create(@Auth() auth: AuthContext, @Body(new ZodPipe(createProjectSchema)) body: CreateProjectInput) {
    return this.projects.create(auth, actorOf(auth), body);
  }

  @Get(':projectId')
  @ProjectPermission('project.read')
  get(@Auth() auth: AuthContext, @Param('projectId', uuidPipe) id: string) {
    return this.projects.get(auth, id);
  }

  @Patch(':projectId')
  @ProjectPermission('project.update')
  update(
    @Auth() auth: AuthContext,
    @Param('projectId', uuidPipe) id: string,
    @IfMatch() version: number,
    @Body(new ZodPipe(updateProjectSchema)) body: UpdateProjectInput,
  ) {
    return this.projects.update(auth, actorOf(auth), id, version, body);
  }

  @Post(':projectId/archive')
  @ProjectPermission('project.archive')
  @HttpCode(200)
  archive(
    @Auth() auth: AuthContext,
    @Param('projectId', uuidPipe) id: string,
    @IfMatch() version: number,
    @Body(new ZodPipe(archiveProjectSchema)) body: { reason: string },
  ) {
    return this.projects.setArchived(auth, actorOf(auth), id, version, true, body.reason);
  }

  @Post(':projectId/unarchive')
  @ProjectPermission('project.archive')
  @HttpCode(200)
  unarchive(
    @Auth() auth: AuthContext,
    @Param('projectId', uuidPipe) id: string,
    @IfMatch() version: number,
    @Body(new ZodPipe(unarchiveSchema)) body: { reason?: string },
  ) {
    return this.projects.setArchived(auth, actorOf(auth), id, version, false, body.reason ?? null);
  }

  @Get(':projectId/members')
  @ProjectPermission('project.read')
  members(@Auth() auth: AuthContext, @Param('projectId', uuidPipe) id: string) {
    return this.projects.listMembers(auth.organizationId, id);
  }

  @Put(':projectId/members/:userId')
  @ProjectPermission('project.members.manage')
  @HttpCode(204)
  async setMember(
    @Auth() auth: AuthContext,
    @Param('projectId', uuidPipe) id: string,
    @Param('userId', uuidPipe) userId: string,
    @Body(new ZodPipe(setMemberSchema)) body: { role: ProjectRole },
  ) {
    await this.projects.setMember(auth, actorOf(auth), id, userId, body.role);
  }

  @Delete(':projectId/members/:userId')
  @ProjectPermission('project.members.manage')
  @HttpCode(204)
  async removeMember(
    @Auth() auth: AuthContext,
    @Param('projectId', uuidPipe) id: string,
    @Param('userId', uuidPipe) userId: string,
  ) {
    await this.projects.removeMember(auth, actorOf(auth), id, userId);
  }

  @Get(':projectId/audit')
  @ProjectPermission('audit.read')
  history(@Auth() auth: AuthContext, @Param('projectId', uuidPipe) id: string) {
    return this.audit.listForProject(auth.organizationId, id);
  }
}
