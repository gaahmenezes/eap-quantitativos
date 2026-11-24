import { Injectable } from '@nestjs/common';
import type { AuditEntryDto } from '@eapq/contracts';
import type { Actor } from '../../common/auth/auth-context.js';
import { PrismaService, type Tx } from '../../prisma/prisma.service.js';
import { Prisma } from '../../generated/prisma/client.js';

export interface AuditInput {
  projectId?: string | null;
  entityType: string;
  entityId: string;
  action: string;
  before?: unknown;
  after?: unknown;
  reason?: string | null;
}

const json = (v: unknown) =>
  v === undefined || v === null ? Prisma.DbNull : (JSON.parse(JSON.stringify(v)) as Prisma.InputJsonValue);

/** Auditoria append-only. Sempre chamar DENTRO da transação da alteração (RNF04). */
@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  /** Vários registros de uma vez (importações), na mesma transação da alteração. */
  async recordMany(tx: Tx, actor: Actor, entries: AuditInput[]) {
    for (let i = 0; i < entries.length; i += 1000) {
      await tx.auditLog.createMany({
        data: entries.slice(i, i + 1000).map((e) => ({
          organizationId: actor.organizationId, projectId: e.projectId ?? null, actorId: actor.userId, entityType: e.entityType, entityId: e.entityId,
          action: e.action, before: json(e.before), after: json(e.after), reason: e.reason ?? null, requestId: actor.requestId,
        })),
      });
    }
  }

  async record(tx: Tx, actor: Actor | { userId: null; organizationId: string; requestId: string }, e: AuditInput) {
    await tx.auditLog.create({
      data: {
        organizationId: actor.organizationId,
        projectId: e.projectId ?? null,
        actorId: actor.userId,
        entityType: e.entityType,
        entityId: e.entityId,
        action: e.action,
        before: json(e.before),
        after: json(e.after),
        reason: e.reason ?? null,
        requestId: actor.requestId,
      },
    });
  }

  async listForProject(organizationId: string, projectId: string, limit = 200, filter: { entityId?: string; entityType?: string } = {}): Promise<AuditEntryDto[]> {
    const rows = await this.prisma.auditLog.findMany({
      where: { organizationId, projectId, ...(filter.entityId && { entityId: filter.entityId }), ...(filter.entityType && { entityType: filter.entityType }) },
      orderBy: [{ at: 'desc' }, { id: 'desc' }],
      take: Math.min(Math.max(limit, 1), 500),
      include: { actor: { select: { id: true, name: true } } },
    });
    return rows.map((r) => ({
      id: r.id,
      at: r.at.toISOString(),
      actor: r.actor,
      entityType: r.entityType,
      entityId: r.entityId,
      action: r.action,
      before: r.before,
      after: r.after,
      reason: r.reason,
    }));
  }
}
