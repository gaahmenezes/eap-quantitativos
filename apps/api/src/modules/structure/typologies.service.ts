import { Injectable } from '@nestjs/common';
import type { CreateTypologyInput, TypologyDto, UpdateTypologyInput } from '@eapq/contracts';
import type { Actor } from '../../common/auth/auth-context.js';
import { conflict, notFound, versionConflict } from '../../common/errors.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { Prisma, type DwellingTypology } from '../../generated/prisma/client.js';
import { AuditService } from '../audit/audit.service.js';

const view = (t: DwellingTypology) => ({
  code: t.code,
  name: t.name,
  kind: t.kind,
  description: t.description,
  privateArea: t.privateArea?.toString() ?? null,
});

@Injectable()
export class TypologiesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private dto(t: DwellingTypology, unitCount: number): TypologyDto {
    return { id: t.id, ...view(t), archivedAt: t.archivedAt?.toISOString() ?? null, version: t.version, unitCount };
  }

  private async editable(tx: Prisma.TransactionClient, organizationId: string, projectId: string) {
    const p = await tx.project.findFirst({ where: { id: projectId, organizationId }, select: { status: true } });
    if (!p) throw notFound('Empreendimento');
    if (p.status === 'ARCHIVED') throw conflict('PROJECT_ARCHIVED', 'Empreendimento arquivado não pode ser alterado.');
  }

  /** Contagem de unidades ATIVAS vinculadas a cada tipologia. */
  private async unitCounts(projectId: string): Promise<Map<string, number>> {
    const rows = await this.prisma.$queryRaw<{ typologyId: string; n: bigint }[]>`
      SELECT u."typologyId", count(*) AS n
      FROM dwelling_unit u JOIN structure_node s ON s.id = u."structureNodeId"
      WHERE u."projectId" = ${projectId}::uuid AND u."typologyId" IS NOT NULL AND s."archivedAt" IS NULL
      GROUP BY u."typologyId"`;
    return new Map(rows.map((r) => [r.typologyId, Number(r.n)]));
  }

  async list(organizationId: string, projectId: string): Promise<TypologyDto[]> {
    const [rows, counts] = await Promise.all([
      this.prisma.dwellingTypology.findMany({ where: { organizationId, projectId }, orderBy: [{ archivedAt: { sort: 'asc', nulls: 'first' } }, { code: 'asc' }] }),
      this.unitCounts(projectId),
    ]);
    return rows.map((t) => this.dto(t, counts.get(t.id) ?? 0));
  }

  async create(actor: Actor, projectId: string, input: CreateTypologyInput): Promise<TypologyDto> {
    const t = await this.prisma.$transaction(async (tx) => {
      await this.editable(tx, actor.organizationId, projectId);
      const dup = await tx.dwellingTypology.findUnique({ where: { projectId_code: { projectId, code: input.code } } });
      if (dup) throw conflict('TYPOLOGY_CODE_IN_USE', `Já existe uma tipologia com o código ${input.code}.`);
      const t = await tx.dwellingTypology.create({
        data: {
          organizationId: actor.organizationId,
          projectId,
          code: input.code,
          name: input.name,
          kind: input.kind,
          description: input.description ?? null,
          privateArea: input.privateArea ? new Prisma.Decimal(input.privateArea) : null,
        },
      });
      await this.audit.record(tx, actor, { projectId, entityType: 'DwellingTypology', entityId: t.id, action: 'CREATE', after: view(t) });
      return t;
    });
    return this.dto(t, 0);
  }

  async update(actor: Actor, projectId: string, id: string, version: number, input: UpdateTypologyInput): Promise<TypologyDto> {
    const t = await this.prisma.$transaction(async (tx) => {
      await this.editable(tx, actor.organizationId, projectId);
      const cur = await tx.dwellingTypology.findFirst({ where: { id, projectId } });
      if (!cur) throw notFound('Tipologia');
      if (cur.archivedAt) throw conflict('TYPOLOGY_ARCHIVED', 'Tipologia arquivada não pode ser editada.');
      if (cur.version !== version) throw versionConflict();
      if (input.code && input.code !== cur.code) {
        const dup = await tx.dwellingTypology.findUnique({ where: { projectId_code: { projectId, code: input.code } } });
        if (dup) throw conflict('TYPOLOGY_CODE_IN_USE', `Já existe uma tipologia com o código ${input.code}.`);
      }
      const res = await tx.dwellingTypology.updateMany({
        where: { id, version },
        data: {
          ...(input.code !== undefined ? { code: input.code } : {}),
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.description !== undefined ? { description: input.description ?? null } : {}),
          ...(input.privateArea !== undefined ? { privateArea: input.privateArea ? new Prisma.Decimal(input.privateArea) : null } : {}),
          version: { increment: 1 },
        },
      });
      if (res.count !== 1) throw versionConflict();
      const t = await tx.dwellingTypology.findUniqueOrThrow({ where: { id } });
      await this.audit.record(tx, actor, { projectId, entityType: 'DwellingTypology', entityId: id, action: 'UPDATE', before: view(cur), after: view(t) });
      return t;
    });
    return this.dto(t, (await this.unitCounts(projectId)).get(id) ?? 0);
  }

  async setArchived(actor: Actor, projectId: string, id: string, version: number, archived: boolean, reason: string | null): Promise<TypologyDto> {
    const t = await this.prisma.$transaction(async (tx) => {
      await this.editable(tx, actor.organizationId, projectId);
      const cur = await tx.dwellingTypology.findFirst({ where: { id, projectId } });
      if (!cur) throw notFound('Tipologia');
      if (cur.version !== version) throw versionConflict();
      if (!!cur.archivedAt === archived) throw conflict('NO_CHANGE', archived ? 'Tipologia já está arquivada.' : 'Tipologia já está ativa.');
      if (archived) {
        const linked = await tx.dwellingUnit.count({ where: { projectId, typologyId: id, node: { archivedAt: null } } });
        if (linked > 0) throw conflict('TYPOLOGY_IN_USE', `A tipologia está vinculada a ${linked} unidade(s) ativa(s). Altere a tipologia dessas unidades antes de arquivar.`);
      }
      const t = await tx.dwellingTypology.update({ where: { id }, data: { archivedAt: archived ? new Date() : null, version: { increment: 1 } } });
      await this.audit.record(tx, actor, { projectId, entityType: 'DwellingTypology', entityId: id, action: archived ? 'ARCHIVE' : 'UNARCHIVE', reason });
      return t;
    });
    return this.dto(t, 0);
  }
}
