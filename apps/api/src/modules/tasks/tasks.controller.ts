import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import { createTaskSchema, listTasksQuery, transitionTaskSchema, updateTaskSchema, type CreateTaskInput, type UpdateTaskInput } from '@eapq/contracts';
import { actorOf, type AuthContext } from '../../common/auth/auth-context.js';
import { Auth, OrgPermission, ProjectPermission } from '../../common/auth/decorators.js';
import { IfMatch } from '../../common/if-match.js';
import { uuidPipe, ZodPipe } from '../../common/zod.pipe.js';
import { TasksService } from './tasks.service.js';

const P = 'projectId';

@Controller('tasks')
export class MyTasksController {
  constructor(private readonly svc: TasksService) {}

  /** Minhas tarefas abertas (responsável) e as que aguardam minha revisão, em todos os empreendimentos que acesso. */
  @Get('mine') @OrgPermission('org.read')
  mine(@Auth() a: AuthContext) { return this.svc.mine({ ...actorOf(a), orgRole: a.orgRole }); }
}

@Controller('projects/:projectId')
export class TasksController {
  constructor(private readonly svc: TasksService) {}

  @Get('team') @ProjectPermission('project.read')
  team(@Auth() a: AuthContext, @Param(P, uuidPipe) p: string) { return this.svc.team(a.organizationId, p); }

  @Get('tasks') @ProjectPermission('project.read')
  list(@Auth() a: AuthContext, @Param(P, uuidPipe) p: string, @Query(new ZodPipe(listTasksQuery)) q: z.infer<typeof listTasksQuery>) { return this.svc.list(actorOf(a), p, q); }

  @Post('tasks') @ProjectPermission('project.content.edit')
  create(@Auth() a: AuthContext, @Param(P, uuidPipe) p: string, @Body(new ZodPipe(createTaskSchema)) b: CreateTaskInput) { return this.svc.create(actorOf(a), p, b); }

  @Patch('tasks/:id') @ProjectPermission('project.content.edit') @HttpCode(204)
  async update(@Auth() a: AuthContext, @Param(P, uuidPipe) p: string, @Param('id', uuidPipe) id: string, @IfMatch() v: number, @Body(new ZodPipe(updateTaskSchema)) b: UpdateTaskInput) { await this.svc.update(actorOf(a), p, id, v, b); }

  @Post('tasks/:id/transition') @ProjectPermission('project.content.edit') @HttpCode(204)
  async transition(@Auth() a: AuthContext, @Param(P, uuidPipe) p: string, @Param('id', uuidPipe) id: string, @IfMatch() v: number, @Body(new ZodPipe(transitionTaskSchema)) b: z.infer<typeof transitionTaskSchema>) {
    await this.svc.transition(actorOf(a), p, id, v, b.to, b.comment);
  }

  @Post('tasks/:id/archive') @ProjectPermission('project.content.edit') @HttpCode(204)
  async archive(@Auth() a: AuthContext, @Param(P, uuidPipe) p: string, @Param('id', uuidPipe) id: string, @IfMatch() v: number) { await this.svc.setArchived(actorOf(a), p, id, v, true); }

  @Post('tasks/:id/unarchive') @ProjectPermission('project.content.edit') @HttpCode(204)
  async unarchive(@Auth() a: AuthContext, @Param(P, uuidPipe) p: string, @Param('id', uuidPipe) id: string, @IfMatch() v: number) { await this.svc.setArchived(actorOf(a), p, id, v, false); }
}
