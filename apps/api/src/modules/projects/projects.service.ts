import { Injectable } from '@nestjs/common';
import type {
  CreateProjectInput,
  ListProjectsQuery,
  ProjectDto,
  ProjectMemberDto,
  UpdateProjectInput,
} from '@eapq/contracts';
import { orgPermissions, type ProjectRole } from '@eapq/domain';
import type { Actor, AuthContext } from '../../common/auth/auth-context.js';
import { conflict, notFound, versionConflict } from '../../common/errors.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { Prisma, type Project } from '../../generated/prisma/client.js';
import { AuditService } from '../audit/audit.service.js';

const AUDITED_FIELDS = ['code', 'name', 'description', 'classification', 'location', 'status'] as const;

const snapshot = (p: Project) =>
  Object.fromEntries(AUDITED_FIELDS.map((k) => [k, p[k]])) as Record<string, unknown>;

function toDto(p: Project, myProjectRole: ProjectRole | null): ProjectDto {
  return {
    id: p.id,
    code: p.code,
    name: p.name,
    description: p.description,
    classification: p.classification,
    location: p.location,
    status: p.status,
    archivedAt: p.archivedAt?.toISOString() ?? null,
    version: p.version,
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
    myProjectRole,
  };
}

@Injectable()
export class ProjectsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(auth: AuthContext, q: ListProjectsQuery): Promise<ProjectDto[]> {
    const seesAll = orgPermissions(auth.orgRole).has('project.create'); // OWNER/ADMIN
    const where: Prisma.ProjectWhereInput = {
      organizationId: auth.organizationId,
      ...(q.status !== 'ALL' ? { status: q.status } : {}),
      ...(q.classification ? { classification: q.classification } : {}),
      ...(q.q
        ? {
            OR: [
              { name: { contains: q.q, mode: 'insensitive' } },
              { code: { contains: q.q, mode: 'insensitive' } },
            ],
          }
        : {}),
      ...(seesAll ? {} : { members: { some: { userId: auth.userId } } }),
    };
    const rows = await this.prisma.project.findMany({
      where,
      orderBy: [{ status: 'asc' }, { updatedAt: 'desc' }],
      take: 500,
      include: { members: { where: { userId: auth.userId }, select: { role: true } } },
    });
    return rows.map((p) => toDto(p, p.members[0]?.role ?? null));
  }

  async get(auth: AuthContext, projectId: string): Promise<ProjectDto> {
    const p = await this.prisma.project.findFirst({
      where: { id: projectId, organizationId: auth.organizationId },
      include: { members: { where: { userId: auth.userId }, select: { role: true } } },
    });
    if (!p) throw notFound('Empreendimento');
    return toDto(p, p.members[0]?.role ?? null);
  }

  async create(auth: AuthContext, actor: Actor, input: CreateProjectInput): Promise<ProjectDto> {
    const project = await this.prisma.$transaction(async (tx) => {
      const dup = await tx.project.findUnique({
        where: { organizationId_code: { organizationId: auth.organizationId, code: input.code } },
      });
      if (dup) throw conflict('PROJECT_CODE_IN_USE', `Já existe um empreendimento com o código ${input.code}.`);
      const p = await tx.project.create({
        data: {
          organizationId: auth.organizationId,
          code: input.code,
          name: input.name,
          description: input.description ?? null,
          classification: input.classification,
          location: input.location ?? null,
          createdById: auth.userId,
        },
      });
      await tx.projectMember.create({
        data: { organizationId: auth.organizationId, projectId: p.id, userId: auth.userId, role: 'COORDINATOR' },
      });
      await this.audit.record(tx, actor, {
        projectId: p.id,
        entityType: 'Project',
        entityId: p.id,
        action: 'CREATE',
        after: snapshot(p),
      });
      return p;
    });
    return toDto(project, 'COORDINATOR');
  }

  async update(
    auth: AuthContext,
    actor: Actor,
    projectId: string,
    expectedVersion: number,
    input: UpdateProjectInput,
  ): Promise<ProjectDto> {
    const { reason, ...fields } = input;
    const data = Object.fromEntries(
      Object.entries(fields).filter(([, v]) => v !== undefined),
    ) as Prisma.ProjectUpdateInput;
    return this.mutate(auth, actor, projectId, expectedVersion, 'UPDATE', reason ?? null, (p) => {
      if (p.status === 'ARCHIVED') {
        throw conflict('PROJECT_ARCHIVED', 'Empreendimento arquivado não pode ser editado. Reative-o antes.');
      }
      return data;
    });
  }

  async setArchived(
    auth: AuthContext,
    actor: Actor,
    projectId: string,
    expectedVersion: number,
    archived: boolean,
    reason: string | null,
  ): Promise<ProjectDto> {
    return this.mutate(auth, actor, projectId, expectedVersion, archived ? 'ARCHIVE' : 'UNARCHIVE', reason, (p) => {
      if ((p.status === 'ARCHIVED') === archived) {
        throw conflict('NO_CHANGE', archived ? 'Empreendimento já está arquivado.' : 'Empreendimento já está ativo.');
      }
      return archived
        ? { status: 'ARCHIVED', archivedAt: new Date() }
        : { status: 'ACTIVE', archivedAt: null };
    });
  }

  /** Atualização com bloqueio otimista + auditoria na mesma transação. */
  private async mutate(
    auth: AuthContext,
    actor: Actor,
    projectId: string,
    expectedVersion: number,
    action: string,
    reason: string | null,
    build: (current: Project) => Prisma.ProjectUpdateInput,
  ): Promise<ProjectDto> {
    const result = await this.prisma.$transaction(async (tx) => {
      const current = await tx.project.findFirst({
        where: { id: projectId, organizationId: auth.organizationId },
      });
      if (!current) throw notFound('Empreendimento');
      if (current.version !== expectedVersion) throw versionConflict();
      const data = build(current);
      if (typeof data.code === 'string' && data.code !== current.code) {
        const dup = await tx.project.findUnique({
          where: { organizationId_code: { organizationId: auth.organizationId, code: data.code } },
        });
        if (dup) throw conflict('PROJECT_CODE_IN_USE', `Já existe um empreendimento com o código ${data.code}.`);
      }
      const res = await tx.project.updateMany({
        where: { id: projectId, organizationId: auth.organizationId, version: expectedVersion },
        data: { ...(data as Prisma.ProjectUpdateManyMutationInput), version: { increment: 1 } },
      });
      if (res.count !== 1) throw versionConflict();
      const updated = await tx.project.findUniqueOrThrow({ where: { id: projectId } });
      await this.audit.record(tx, actor, {
        projectId,
        entityType: 'Project',
        entityId: projectId,
        action,
        before: snapshot(current),
        after: snapshot(updated),
        reason,
      });
      return updated;
    });
    const role = await this.prisma.projectMember.findUnique({
      where: { projectId_userId: { projectId, userId: auth.userId } },
    });
    return toDto(result, role?.role ?? null);
  }

  // ----- membros do empreendimento -----

  async listMembers(organizationId: string, projectId: string): Promise<ProjectMemberDto[]> {
    const rows = await this.prisma.projectMember.findMany({
      where: { organizationId, projectId },
      include: { membership: { include: { user: { select: { name: true, email: true } } } } },
    });
    return rows
      .map((r) => ({ userId: r.userId, name: r.membership.user.name, email: r.membership.user.email, role: r.role }))
      .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
  }

  async setMember(auth: AuthContext, actor: Actor, projectId: string, userId: string, role: ProjectRole) {
    await this.prisma.$transaction(async (tx) => {
      const membership = await tx.membership.findUnique({
        where: { organizationId_userId: { organizationId: auth.organizationId, userId } },
      });
      // Usuário de outra organização é indistinguível de inexistente.
      if (!membership) throw notFound('Usuário');
      const before = await tx.projectMember.findUnique({
        where: { projectId_userId: { projectId, userId } },
      });
      await tx.projectMember.upsert({
        where: { projectId_userId: { projectId, userId } },
        create: { organizationId: auth.organizationId, projectId, userId, role },
        update: { role },
      });
      await this.audit.record(tx, actor, {
        projectId,
        entityType: 'ProjectMember',
        entityId: userId,
        action: before ? 'ROLE_CHANGED' : 'ADD',
        before: before ? { role: before.role } : null,
        after: { role },
      });
    });
  }

  async removeMember(auth: AuthContext, actor: Actor, projectId: string, userId: string) {
    await this.prisma.$transaction(async (tx) => {
      const before = await tx.projectMember.findFirst({
        where: { projectId, userId, organizationId: auth.organizationId },
      });
      if (!before) throw notFound('Membro do empreendimento');
      if (before.role === 'COORDINATOR') {
        const coordinators = await tx.projectMember.count({ where: { projectId, role: 'COORDINATOR' } });
        if (coordinators <= 1) {
          throw conflict('LAST_COORDINATOR', 'O empreendimento precisa de ao menos um coordenador.');
        }
      }
      await tx.projectMember.delete({ where: { projectId_userId: { projectId, userId } } });
      await this.audit.record(tx, actor, {
        projectId,
        entityType: 'ProjectMember',
        entityId: userId,
        action: 'REMOVE',
        before: { role: before.role },
      });
    });
  }
}
