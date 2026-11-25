import { Injectable } from '@nestjs/common';
import type { CreateTaskInput, MyTaskDto, TaskDto, TaskLinkInput, TaskStatus, TeamMemberDto, UpdateTaskInput } from '@eapq/contracts';
import { projectPermissions, type OrgRole, type ProjectRole } from '@eapq/domain';
import type { Actor } from '../../common/auth/auth-context.js';
import { AppError, conflict, notFound, versionConflict } from '../../common/errors.js';
import { assertProjectEditable } from '../../common/project-guard.js';
import type { Prisma, WorkTask } from '../../generated/prisma/client.js';
import { PrismaService, type Tx } from '../../prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';

const invalid = (detail: string, path: string) => new AppError(422, 'VALIDATION_FAILED', 'Dados inválidos', detail, [{ path, message: detail }]);
const LABEL: Record<TaskStatus, string> = { TODO: 'a fazer', DOING: 'em andamento', REVIEW: 'em revisão', DONE: 'concluída' };
const include = {
  assignee: { select: { id: true, name: true } }, reviewer: { select: { id: true, name: true } },
  sheet: { select: { id: true, title: true } }, schedule: { select: { id: true, title: true } }, wbsNode: { select: { id: true, code: true, title: true } },
  workbookImport: { select: { id: true, document: { select: { fileName: true } } } },
} as const;
type Full = Prisma.WorkTaskGetPayload<{ include: typeof include }>;
const today = () => new Date(new Date().toISOString().slice(0, 10));

@Injectable()
export class TasksService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService) {}

  /** Quem acessa o empreendimento: OWNER/ADMIN da organização e membros do empreendimento. */
  async team(organizationId: string, projectId: string): Promise<TeamMemberDto[]> {
    const ms = await this.prisma.membership.findMany({ where: { organizationId }, include: { user: { select: { id: true, name: true, email: true } }, projectMembers: { where: { projectId }, select: { role: true } } } });
    return ms.flatMap((m) => {
      const perms = projectPermissions(m.role as OrgRole, (m.projectMembers[0]?.role as ProjectRole | undefined) ?? null);
      return perms.has('project.read') ? [{ id: m.user.id, name: m.user.name, email: m.user.email, canEdit: perms.has('project.content.edit') }] : [];
    }).sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
  }

  private async checkPerson(organizationId: string, projectId: string, userId: string | null | undefined, what: string) {
    if (!userId) return;
    const t = (await this.team(organizationId, projectId)).find((x) => x.id === userId);
    if (!t) throw notFound(what);
    if (!t.canEdit) throw invalid(`${t.name} não pode editar este empreendimento; dê acesso de edição antes de atribuir.`, what === 'Responsável' ? 'assigneeId' : 'reviewerId');
  }

  private async linkFields(tx: Tx, organizationId: string, projectId: string, link: TaskLinkInput) {
    const empty = { sheetId: null, scheduleId: null, wbsNodeId: null, workbookImportId: null };
    switch (link.kind) {
      case 'OTHER': return { kind: link.kind, ...empty };
      case 'SHEET': if (!(await tx.sheet.count({ where: { id: link.id, projectId, organizationId } }))) throw notFound('Ficha'); return { kind: link.kind, ...empty, sheetId: link.id };
      case 'SCHEDULE': if (!(await tx.schedule.count({ where: { id: link.id, projectId, organizationId } }))) throw notFound('Quadro'); return { kind: link.kind, ...empty, scheduleId: link.id };
      case 'WBS_ITEM': if (!(await tx.wbsNode.count({ where: { id: link.id, projectId, organizationId } }))) throw notFound('Item da EAP'); return { kind: link.kind, ...empty, wbsNodeId: link.id };
      case 'WORKBOOK_IMPORT': if (!(await tx.workbookImport.count({ where: { id: link.id, projectId, organizationId } }))) throw notFound('Migração'); return { kind: link.kind, ...empty, workbookImportId: link.id };
    }
  }

  private dto(t: Full, users: Map<string, string>): TaskDto {
    const link = t.sheet ? { kind: 'SHEET' as const, id: t.sheet.id, label: t.sheet.title }
      : t.schedule ? { kind: 'SCHEDULE' as const, id: t.schedule.id, label: t.schedule.title }
      : t.wbsNode ? { kind: 'WBS_ITEM' as const, id: t.wbsNode.id, label: `${t.wbsNode.code} ${t.wbsNode.title}` }
      : t.workbookImport ? { kind: 'WORKBOOK_IMPORT' as const, id: t.workbookImport.id, label: t.workbookImport.document.fileName } : null;
    return {
      id: t.id, projectId: t.projectId, title: t.title, description: t.description, kind: t.kind, status: t.status, link,
      assignee: t.assignee, reviewer: t.reviewer, dueDate: t.dueDate?.toISOString().slice(0, 10) ?? null,
      overdue: !!t.dueDate && t.status !== 'DONE' && t.dueDate < today(), completedAt: t.completedAt?.toISOString() ?? null,
      archivedAt: t.archivedAt?.toISOString() ?? null, version: t.version, createdBy: users.get(t.createdById) ?? '—', createdAt: t.createdAt.toISOString(), updatedAt: t.updatedAt.toISOString(),
    };
  }
  private async users(ts: WorkTask[]) {
    return new Map((await this.prisma.user.findMany({ where: { id: { in: [...new Set(ts.map((t) => t.createdById))] } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]));
  }

  async list(actor: Actor, projectId: string, q: { status?: TaskStatus; assignee?: string; open?: 'true' | 'false'; archived?: 'true' | 'false' }): Promise<TaskDto[]> {
    const ts = await this.prisma.workTask.findMany({
      where: { projectId, organizationId: actor.organizationId, ...(q.archived !== 'true' && { archivedAt: null }), ...(q.status && { status: q.status }), ...(q.open === 'true' && { status: { not: 'DONE' } }),
        ...(q.assignee && { assigneeId: q.assignee === 'me' ? actor.userId : q.assignee }) },
      include, orderBy: [{ dueDate: { sort: 'asc', nulls: 'last' } }, { createdAt: 'asc' }],
    });
    const u = await this.users(ts);
    return ts.map((t) => this.dto(t, u));
  }

  /** Tarefas abertas em que sou responsável ou revisor (em revisão), nos empreendimentos que acesso. */
  async mine(actor: Actor & { orgRole: OrgRole }): Promise<MyTaskDto[]> {
    const ts = await this.prisma.workTask.findMany({
      where: { organizationId: actor.organizationId, archivedAt: null, project: { status: 'ACTIVE' }, OR: [{ assigneeId: actor.userId, status: { not: 'DONE' } }, { reviewerId: actor.userId, status: 'REVIEW' }] },
      include: { ...include, project: { select: { code: true, name: true, members: { where: { userId: actor.userId }, select: { role: true } } } } },
      orderBy: [{ dueDate: { sort: 'asc', nulls: 'last' } }, { createdAt: 'asc' }],
    });
    const visible = ts.filter((t) => projectPermissions(actor.orgRole, (t.project.members[0]?.role as ProjectRole | undefined) ?? null).has('project.read'));
    const u = await this.users(visible);
    return visible.map((t) => ({ ...this.dto(t, u), projectCode: t.project.code, projectName: t.project.name, role: t.reviewerId === actor.userId && t.status === 'REVIEW' ? 'REVIEWER' : 'ASSIGNEE' }));
  }

  private async task(tx: Tx, organizationId: string, projectId: string, id: string) {
    const t = await tx.workTask.findFirst({ where: { id, projectId, organizationId } });
    if (!t) throw notFound('Tarefa');
    return t;
  }

  async create(actor: Actor, projectId: string, input: CreateTaskInput) {
    await this.checkPerson(actor.organizationId, projectId, input.assigneeId, 'Responsável');
    await this.checkPerson(actor.organizationId, projectId, input.reviewerId, 'Revisor');
    return this.prisma.$transaction(async (tx) => {
      await assertProjectEditable(tx, actor.organizationId, projectId);
      const link = await this.linkFields(tx, actor.organizationId, projectId, input.link);
      const t = await tx.workTask.create({ data: {
        organizationId: actor.organizationId, projectId, title: input.title, description: input.description ?? null, ...link,
        assigneeId: input.assigneeId ?? null, reviewerId: input.reviewerId ?? null, dueDate: input.dueDate ? new Date(input.dueDate) : null, createdById: actor.userId,
      } });
      await this.audit.record(tx, actor, { projectId, entityType: 'WorkTask', entityId: t.id, action: 'CREATE', after: { title: t.title, kind: t.kind, assigneeId: t.assigneeId, reviewerId: t.reviewerId, dueDate: input.dueDate ?? null } });
      return { id: t.id };
    });
  }

  async update(actor: Actor, projectId: string, id: string, version: number, input: UpdateTaskInput) {
    if (input.assigneeId !== undefined) await this.checkPerson(actor.organizationId, projectId, input.assigneeId, 'Responsável');
    if (input.reviewerId !== undefined) await this.checkPerson(actor.organizationId, projectId, input.reviewerId, 'Revisor');
    await this.prisma.$transaction(async (tx) => {
      await assertProjectEditable(tx, actor.organizationId, projectId);
      const t = await this.task(tx, actor.organizationId, projectId, id);
      if (t.archivedAt) throw conflict('ARCHIVED', 'Tarefa arquivada não pode ser alterada.');
      const data: Prisma.WorkTaskUncheckedUpdateManyInput = {
        ...(input.title !== undefined && { title: input.title }), ...(input.description !== undefined && { description: input.description }),
        ...(input.assigneeId !== undefined && { assigneeId: input.assigneeId }), ...(input.reviewerId !== undefined && { reviewerId: input.reviewerId }),
        ...(input.dueDate !== undefined && { dueDate: input.dueDate ? new Date(input.dueDate) : null }),
        ...(input.link && (await this.linkFields(tx, actor.organizationId, projectId, input.link))),
      };
      const r = await tx.workTask.updateMany({ where: { id, version }, data: { ...data, version: { increment: 1 } } });
      if (r.count === 0) throw versionConflict();
      await this.audit.record(tx, actor, { projectId, entityType: 'WorkTask', entityId: id, action: 'UPDATE', before: { title: t.title, assigneeId: t.assigneeId, reviewerId: t.reviewerId, dueDate: t.dueDate?.toISOString().slice(0, 10) ?? null }, after: input });
    });
  }

  /**
   * Fluxo: a fazer ⇄ em andamento → em revisão → concluída. Com revisor, só ele aprova ou devolve;
   * devolver e reabrir exigem comentário. Sem revisor, quem edita conclui direto.
   */
  async transition(actor: Actor, projectId: string, id: string, version: number, to: TaskStatus, comment?: string | null) {
    await this.prisma.$transaction(async (tx) => {
      await assertProjectEditable(tx, actor.organizationId, projectId);
      const t = await this.task(tx, actor.organizationId, projectId, id);
      if (t.archivedAt) throw conflict('ARCHIVED', 'Tarefa arquivada não pode mudar de situação.');
      if (t.version !== version) throw versionConflict();
      const from = t.status;
      if (from === to) return;
      const allowed: Record<TaskStatus, TaskStatus[]> = { TODO: ['DOING', 'DONE'], DOING: ['TODO', 'REVIEW', 'DONE'], REVIEW: ['DOING', 'DONE'], DONE: ['DOING'] };
      if (!allowed[from].includes(to)) throw conflict('INVALID_TRANSITION', `Não é possível passar de "${LABEL[from]}" para "${LABEL[to]}".`);
      if (to === 'REVIEW' && !t.reviewerId) throw invalid('Defina o revisor antes de enviar para revisão.', 'reviewerId');
      if (t.reviewerId && to === 'DONE') {
        if (from !== 'REVIEW') throw conflict('REVIEW_REQUIRED', 'Esta tarefa tem revisor: envie para revisão antes de concluir.');
        if (actor.userId !== t.reviewerId) throw new AppError(403, 'NOT_REVIEWER', 'Acesso negado', 'Só o revisor da tarefa pode aprovar.');
      }
      if (from === 'REVIEW' && to === 'DOING') {
        if (t.reviewerId && actor.userId !== t.reviewerId) throw new AppError(403, 'NOT_REVIEWER', 'Acesso negado', 'Só o revisor da tarefa pode devolver.');
        if (!comment?.trim()) throw invalid('Diga o que precisa ser corrigido ao devolver.', 'comment');
      }
      if (from === 'DONE' && !comment?.trim()) throw invalid('Diga o motivo para reabrir a tarefa.', 'comment');
      await tx.workTask.update({ where: { id }, data: { status: to, completedAt: to === 'DONE' ? new Date() : null, version: { increment: 1 } } });
      await this.audit.record(tx, actor, { projectId, entityType: 'WorkTask', entityId: id, action: 'TRANSITION', reason: comment ?? undefined, before: { status: from }, after: { status: to } });
    });
  }

  async setArchived(actor: Actor, projectId: string, id: string, version: number, archived: boolean) {
    await this.prisma.$transaction(async (tx) => {
      await assertProjectEditable(tx, actor.organizationId, projectId);
      await this.task(tx, actor.organizationId, projectId, id);
      const r = await tx.workTask.updateMany({ where: { id, version }, data: { archivedAt: archived ? new Date() : null, version: { increment: 1 } } });
      if (r.count === 0) throw versionConflict();
      await this.audit.record(tx, actor, { projectId, entityType: 'WorkTask', entityId: id, action: archived ? 'ARCHIVE' : 'UNARCHIVE' });
    });
  }
}
