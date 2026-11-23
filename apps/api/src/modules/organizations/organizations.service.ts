import { Injectable } from '@nestjs/common';
import type { CreateInvitationInput, InvitationDto, MemberDto } from '@eapq/contracts';
import type { OrgRole } from '@eapq/domain';
import type { Actor, AuthContext } from '../../common/auth/auth-context.js';
import { SessionService } from '../../common/auth/session.service.js';
import { newToken, sha256 } from '../../common/auth/tokens.js';
import { conflict, forbidden, notFound } from '../../common/errors.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';

const INVITATION_DAYS = 7;

@Injectable()
export class OrganizationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly sessions: SessionService,
  ) {}

  async listMembers(organizationId: string): Promise<MemberDto[]> {
    const rows = await this.prisma.membership.findMany({
      where: { organizationId },
      include: { user: { select: { id: true, name: true, email: true, status: true } } },
      orderBy: { user: { name: 'asc' } },
    });
    return rows.map((m) => ({
      userId: m.user.id,
      name: m.user.name,
      email: m.user.email,
      role: m.role,
      status: m.user.status,
    }));
  }

  async updateMemberRole(auth: AuthContext, actor: Actor, userId: string, role: OrgRole) {
    if (role === 'OWNER' && auth.orgRole !== 'OWNER') {
      throw forbidden('Somente um OWNER pode conceder o papel OWNER.');
    }
    await this.prisma.$transaction(async (tx) => {
      const current = await tx.membership.findUnique({
        where: { organizationId_userId: { organizationId: auth.organizationId, userId } },
      });
      if (!current) throw notFound('Membro');
      if (current.role === 'OWNER' && auth.orgRole !== 'OWNER') {
        throw forbidden('Somente um OWNER pode alterar outro OWNER.');
      }
      if (current.role === 'OWNER' && role !== 'OWNER') await this.assertNotLastOwner(tx, auth.organizationId);
      await tx.membership.update({
        where: { organizationId_userId: { organizationId: auth.organizationId, userId } },
        data: { role },
      });
      await this.audit.record(tx, actor, {
        entityType: 'Membership',
        entityId: userId,
        action: 'ROLE_CHANGED',
        before: { role: current.role },
        after: { role },
      });
    });
  }

  async removeMember(auth: AuthContext, actor: Actor, userId: string) {
    if (userId === auth.userId) throw conflict('CANNOT_REMOVE_SELF', 'Você não pode remover a si mesmo.');
    await this.prisma.$transaction(async (tx) => {
      const current = await tx.membership.findUnique({
        where: { organizationId_userId: { organizationId: auth.organizationId, userId } },
      });
      if (!current) throw notFound('Membro');
      if (current.role === 'OWNER') {
        if (auth.orgRole !== 'OWNER') throw forbidden('Somente um OWNER pode remover outro OWNER.');
        await this.assertNotLastOwner(tx, auth.organizationId);
      }
      const projects = await tx.projectMember.findMany({
        where: { organizationId: auth.organizationId, userId },
        select: { projectId: true, role: true },
      });
      await tx.projectMember.deleteMany({ where: { organizationId: auth.organizationId, userId } });
      await tx.membership.delete({
        where: { organizationId_userId: { organizationId: auth.organizationId, userId } },
      });
      await this.audit.record(tx, actor, {
        entityType: 'Membership',
        entityId: userId,
        action: 'REMOVED',
        before: { role: current.role, projects },
      });
    });
    await this.sessions.revokeAllForUser(userId, auth.organizationId);
  }

  private async assertNotLastOwner(
    tx: Parameters<Parameters<PrismaService['$transaction']>[0]>[0],
    organizationId: string,
  ) {
    const owners = await tx.membership.count({ where: { organizationId, role: 'OWNER' } });
    if (owners <= 1) throw conflict('LAST_OWNER', 'A organização precisa de ao menos um OWNER.');
  }

  async createInvitation(auth: AuthContext, actor: Actor, input: CreateInvitationInput): Promise<InvitationDto> {
    if (input.role === 'OWNER' && auth.orgRole !== 'OWNER') {
      throw forbidden('Somente um OWNER pode convidar outro OWNER.');
    }
    const already = await this.prisma.membership.findFirst({
      where: { organizationId: auth.organizationId, user: { email: input.email } },
    });
    if (already) throw conflict('ALREADY_MEMBER', 'Este e-mail já é membro da organização.');
    const token = newToken();
    const invitation = await this.prisma.$transaction(async (tx) => {
      // Revoga convite pendente anterior para o mesmo e-mail (índice parcial único).
      await tx.invitation.updateMany({
        where: { organizationId: auth.organizationId, email: input.email, acceptedAt: null, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      const inv = await tx.invitation.create({
        data: {
          organizationId: auth.organizationId,
          email: input.email,
          role: input.role,
          tokenHash: sha256(token),
          invitedById: auth.userId,
          expiresAt: new Date(Date.now() + INVITATION_DAYS * 86_400_000),
        },
      });
      await this.audit.record(tx, actor, {
        entityType: 'Invitation',
        entityId: inv.id,
        action: 'CREATE',
        after: { email: inv.email, role: inv.role, expiresAt: inv.expiresAt },
      });
      return inv;
    });
    return { ...this.toDto(invitation), token };
  }

  async listInvitations(organizationId: string): Promise<InvitationDto[]> {
    const rows = await this.prisma.invitation.findMany({
      where: { organizationId, revokedAt: null },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    return rows.map((r) => this.toDto(r));
  }

  async revokeInvitation(auth: AuthContext, actor: Actor, id: string) {
    await this.prisma.$transaction(async (tx) => {
      const res = await tx.invitation.updateMany({
        where: { id, organizationId: auth.organizationId, acceptedAt: null, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      if (res.count === 0) throw notFound('Convite pendente');
      await this.audit.record(tx, actor, { entityType: 'Invitation', entityId: id, action: 'REVOKE' });
    });
  }

  private toDto(r: {
    id: string;
    email: string;
    role: OrgRole;
    expiresAt: Date;
    acceptedAt: Date | null;
  }): InvitationDto {
    return {
      id: r.id,
      email: r.email,
      role: r.role,
      expiresAt: r.expiresAt.toISOString(),
      acceptedAt: r.acceptedAt?.toISOString() ?? null,
    };
  }
}
