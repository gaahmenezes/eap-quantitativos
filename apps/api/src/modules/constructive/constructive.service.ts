import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import type {
  CreateOverrideInput,
  CreateTypologyElementInput,
  PropagateInput,
  PropagationPreviewDto,
  RevisionDetailDto,
  RevisionDto,
  TypologyElementDto,
  UnitElementsDto,
  UnitOverrideDto,
  UpdateTypologyElementInput,
} from '@eapq/contracts';
import { diffRevisions, propagationImpact, resolveUnitElements, type RevisionElement, type UnitOverrideInput } from '@eapq/domain';
import type { Actor } from '../../common/auth/auth-context.js';
import { AppError, conflict, notFound } from '../../common/errors.js';
import { assertProjectEditable, checkAttributes } from '../../common/project-guard.js';
import { PrismaService, type Tx } from '../../prisma/prisma.service.js';
import { Prisma, type TypologyElement, type UnitOverride } from '../../generated/prisma/client.js';
import { AuditService } from '../audit/audit.service.js';
import { loadElementType } from '../catalog/catalog.service.js';

const TX = { timeout: 60_000 } as const;
const attrs = (v: Prisma.JsonValue | null) => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, string | boolean>) : {});

const elementDto = (e: TypologyElement): TypologyElementDto => ({
  id: e.id,
  stableKey: e.stableKey,
  parentId: e.parentId,
  elementTypeId: e.elementTypeId,
  name: e.name,
  attributes: attrs(e.attributes),
  position: e.position,
});

/** Converte elementos persistidos para o formato do domínio (pais por stableKey), em ordem de árvore. */
export function toRevisionElements(rows: TypologyElement[]): RevisionElement[] {
  const keyById = new Map(rows.map((r) => [r.id, r.stableKey]));
  const children = new Map<string | null, TypologyElement[]>();
  for (const r of rows) children.set(r.parentId, [...(children.get(r.parentId) ?? []), r]);
  const out: RevisionElement[] = [];
  const walk = (parentId: string | null) => {
    for (const r of (children.get(parentId) ?? []).sort((a, b) => a.position - b.position || (a.id < b.id ? -1 : 1))) {
      out.push({ stableKey: r.stableKey, parentStableKey: r.parentId ? keyById.get(r.parentId)! : null, name: r.name, elementTypeId: r.elementTypeId, attributes: attrs(r.attributes) });
      walk(r.id);
    }
  };
  walk(null);
  return out;
}

const toOverrideInput = (o: UnitOverride): UnitOverrideInput =>
  o.op === 'EXCLUDE_ELEMENT'
    ? { id: o.id, op: 'EXCLUDE_ELEMENT', targetStableKey: o.targetStableKey! }
    : { id: o.id, op: 'ADD_ELEMENT', parentStableKey: o.parentStableKey, name: o.name!, elementTypeId: o.elementTypeId!, attributes: attrs(o.attributes) };

/** Última revisão publicada da tipologia (ou null). */
export async function latestPublishedRevision(tx: Tx, typologyId: string) {
  return tx.typologyRevision.findFirst({ where: { typologyId, status: 'PUBLISHED' }, orderBy: { number: 'desc' } });
}

@Injectable()
export class ConstructiveService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private async typology(tx: Tx, projectId: string, typologyId: string) {
    const t = await tx.dwellingTypology.findFirst({ where: { id: typologyId, projectId } });
    if (!t) throw notFound('Tipologia');
    return t;
  }

  private async draft(tx: Tx, projectId: string, typologyId: string, revisionId: string) {
    const r = await tx.typologyRevision.findFirst({ where: { id: revisionId, typologyId, projectId } });
    if (!r) throw notFound('Revisão da tipologia');
    if (r.status !== 'DRAFT') throw conflict('REVISION_PUBLISHED', `A revisão R${r.number} já foi publicada e não pode ser alterada. Crie uma nova revisão.`);
    return r;
  }

  // ---------------- revisões ----------------

  async listRevisions(organizationId: string, projectId: string, typologyId: string): Promise<RevisionDto[]> {
    await this.typology(this.prisma, projectId, typologyId);
    const rows = await this.prisma.typologyRevision.findMany({
      where: { organizationId, projectId, typologyId },
      orderBy: { number: 'desc' },
      include: { _count: { select: { elements: true, units: true } } },
    });
    return rows.map((r) => ({
      id: r.id,
      number: r.number,
      status: r.status,
      notes: r.notes,
      publishedAt: r.publishedAt?.toISOString() ?? null,
      createdAt: r.createdAt.toISOString(),
      elementCount: r._count.elements,
      unitCount: r._count.units,
    }));
  }

  async getRevision(projectId: string, typologyId: string, revisionId: string): Promise<RevisionDetailDto> {
    const r = await this.prisma.typologyRevision.findFirst({
      where: { id: revisionId, typologyId, projectId },
      include: { elements: true, _count: { select: { units: true } } },
    });
    if (!r) throw notFound('Revisão da tipologia');
    const previous = await this.prisma.typologyRevision.findFirst({
      where: { typologyId, status: 'PUBLISHED', number: { lt: r.number } },
      orderBy: { number: 'desc' },
      include: { elements: true },
    });
    const d = previous ? diffRevisions(toRevisionElements(previous.elements), toRevisionElements(r.elements)) : null;
    return {
      id: r.id,
      number: r.number,
      status: r.status,
      notes: r.notes,
      publishedAt: r.publishedAt?.toISOString() ?? null,
      createdAt: r.createdAt.toISOString(),
      elementCount: r.elements.length,
      unitCount: r._count.units,
      elements: [...r.elements].sort((a, b) => a.position - b.position).map(elementDto),
      diff: d ? { added: d.added.length, removed: d.removed.length, changed: d.changed.length } : null,
    };
  }

  /** Nova revisão rascunho, copiando os elementos (e chaves estáveis) da última publicada. */
  async createDraft(actor: Actor, projectId: string, typologyId: string, notes?: string) {
    return this.prisma.$transaction(async (tx) => {
      await assertProjectEditable(tx, actor.organizationId, projectId);
      const t = await this.typology(tx, projectId, typologyId);
      if (t.archivedAt) throw conflict('TYPOLOGY_ARCHIVED', 'Tipologia arquivada.');
      const existing = await tx.typologyRevision.findFirst({ where: { typologyId, status: 'DRAFT' } });
      if (existing) throw conflict('DRAFT_EXISTS', `Já existe a revisão R${existing.number} em elaboração.`);
      const last = await tx.typologyRevision.aggregate({ where: { typologyId }, _max: { number: true } });
      const base = await latestPublishedRevision(tx, typologyId);
      const r = await tx.typologyRevision.create({
        data: { organizationId: actor.organizationId, projectId, typologyId, number: (last._max.number ?? 0) + 1, notes: notes ?? null },
      });
      if (base) {
        const rows = await tx.typologyElement.findMany({ where: { revisionId: base.id }, orderBy: [{ position: 'asc' }] });
        const newIds = new Map(rows.map((x) => [x.id, randomUUID()]));
        // Pais antes dos filhos (FK composta parentId+revisionId).
        const ordered: TypologyElement[] = [];
        const placed = new Set<string>();
        while (ordered.length < rows.length) {
          for (const x of rows) if (!placed.has(x.id) && (!x.parentId || placed.has(x.parentId))) { ordered.push(x); placed.add(x.id); }
        }
        for (const x of ordered) {
          await tx.typologyElement.create({
            data: {
              id: newIds.get(x.id)!,
              organizationId: actor.organizationId,
              revisionId: r.id,
              parentId: x.parentId ? newIds.get(x.parentId)! : null,
              stableKey: x.stableKey,
              elementTypeId: x.elementTypeId,
              name: x.name,
              attributes: x.attributes ?? {},
              position: x.position,
            },
          });
        }
      }
      await this.audit.record(tx, actor, { projectId, entityType: 'TypologyRevision', entityId: r.id, action: 'CREATE', after: { typology: t.code, number: r.number, basedOn: base?.number ?? null } });
      return { id: r.id, number: r.number };
    }, TX);
  }

  async discardDraft(actor: Actor, projectId: string, typologyId: string, revisionId: string) {
    return this.prisma.$transaction(async (tx) => {
      await assertProjectEditable(tx, actor.organizationId, projectId);
      const r = await this.draft(tx, projectId, typologyId, revisionId);
      await tx.typologyRevision.delete({ where: { id: r.id } });
      await this.audit.record(tx, actor, { projectId, entityType: 'TypologyRevision', entityId: r.id, action: 'DISCARD', before: { number: r.number } });
    }, TX);
  }

  async addElement(actor: Actor, projectId: string, typologyId: string, revisionId: string, input: CreateTypologyElementInput): Promise<TypologyElementDto> {
    return this.prisma.$transaction(async (tx) => {
      await assertProjectEditable(tx, actor.organizationId, projectId);
      const r = await this.draft(tx, projectId, typologyId, revisionId);
      const { defs } = await loadElementType(tx, actor.organizationId, input.elementTypeId, { domain: 'CONSTRUTIVO', category: 'ELEMENT' });
      const attributes = checkAttributes(defs, input.attributes);
      if (input.parentId) {
        const parent = await tx.typologyElement.findFirst({ where: { id: input.parentId, revisionId: r.id } });
        if (!parent) throw notFound('Elemento superior');
      }
      const last = await tx.typologyElement.aggregate({ where: { revisionId: r.id, parentId: input.parentId ?? null }, _max: { position: true } });
      const e = await tx.typologyElement.create({
        data: {
          organizationId: actor.organizationId,
          revisionId: r.id,
          parentId: input.parentId ?? null,
          stableKey: randomUUID(),
          elementTypeId: input.elementTypeId,
          name: input.name,
          attributes,
          position: (last._max.position ?? 0) + 1,
        },
      });
      await this.audit.record(tx, actor, { projectId, entityType: 'TypologyElement', entityId: e.id, action: 'CREATE', after: { revision: r.number, ...elementDto(e) } });
      return elementDto(e);
    }, TX);
  }

  async updateElement(actor: Actor, projectId: string, typologyId: string, revisionId: string, elementId: string, input: UpdateTypologyElementInput) {
    return this.prisma.$transaction(async (tx) => {
      await assertProjectEditable(tx, actor.organizationId, projectId);
      const r = await this.draft(tx, projectId, typologyId, revisionId);
      const cur = await tx.typologyElement.findFirst({ where: { id: elementId, revisionId: r.id } });
      if (!cur) throw notFound('Elemento');
      const { defs } = await loadElementType(tx, actor.organizationId, cur.elementTypeId, {});
      const attributes = input.attributes !== undefined ? checkAttributes(defs, input.attributes) : undefined;
      const e = await tx.typologyElement.update({ where: { id: elementId }, data: { ...(input.name ? { name: input.name } : {}), ...(attributes ? { attributes } : {}) } });
      await this.audit.record(tx, actor, { projectId, entityType: 'TypologyElement', entityId: e.id, action: 'UPDATE', before: elementDto(cur), after: elementDto(e) });
      return elementDto(e);
    }, TX);
  }

  /** Remove o elemento (e subelementos) do RASCUNHO. Revisões publicadas não mudam. */
  async removeElement(actor: Actor, projectId: string, typologyId: string, revisionId: string, elementId: string) {
    return this.prisma.$transaction(async (tx) => {
      await assertProjectEditable(tx, actor.organizationId, projectId);
      const r = await this.draft(tx, projectId, typologyId, revisionId);
      const cur = await tx.typologyElement.findFirst({ where: { id: elementId, revisionId: r.id } });
      if (!cur) throw notFound('Elemento');
      await tx.typologyElement.delete({ where: { id: elementId } });
      await this.audit.record(tx, actor, { projectId, entityType: 'TypologyElement', entityId: elementId, action: 'REMOVE', before: { revision: r.number, ...elementDto(cur) } });
    }, TX);
  }

  async publish(actor: Actor, projectId: string, typologyId: string, revisionId: string, notes?: string) {
    return this.prisma.$transaction(async (tx) => {
      await assertProjectEditable(tx, actor.organizationId, projectId);
      const r = await this.draft(tx, projectId, typologyId, revisionId);
      const elements = await tx.typologyElement.findMany({ where: { revisionId: r.id } });
      if (elements.length === 0) throw conflict('EMPTY_REVISION', 'Inclua ao menos um elemento antes de publicar.');
      const prev = await latestPublishedRevision(tx, typologyId);
      const d = prev ? diffRevisions(toRevisionElements(await tx.typologyElement.findMany({ where: { revisionId: prev.id } })), toRevisionElements(elements)) : null;
      await tx.typologyRevision.update({ where: { id: r.id }, data: { status: 'PUBLISHED', publishedAt: new Date(), publishedById: actor.userId, notes: notes ?? r.notes } });
      await this.audit.record(tx, actor, {
        projectId,
        entityType: 'TypologyRevision',
        entityId: r.id,
        action: 'PUBLISH',
        after: { number: r.number, elements: elements.length, diff: d ? { added: d.added.length, removed: d.removed.length, changed: d.changed.length } : null },
        reason: notes ?? null,
      });
      return { id: r.id, number: r.number };
    }, TX);
  }

  // ---------------- propagação ----------------

  private async unitsWithContext(tx: Tx, projectId: string, typologyId: string) {
    return tx.dwellingUnit.findMany({
      where: { projectId, typologyId, node: { archivedAt: null } },
      include: { node: { select: { name: true, code: true } }, pinnedRevision: { include: { elements: true } }, overrides: { where: { archivedAt: null } } },
      orderBy: { node: { code: 'asc' } },
    });
  }

  async propagationPreview(projectId: string, typologyId: string): Promise<PropagationPreviewDto> {
    await this.typology(this.prisma, projectId, typologyId);
    const target = await this.prisma.typologyRevision.findFirst({ where: { typologyId, status: 'PUBLISHED' }, orderBy: { number: 'desc' }, include: { elements: true } });
    const units = await this.unitsWithContext(this.prisma, projectId, typologyId);
    const targetEls = target ? toRevisionElements(target.elements) : [];
    const diffByRevision: PropagationPreviewDto['diffByRevision'] = {};
    const result = units.map((u) => {
      const current = u.pinnedRevision ? toRevisionElements(u.pinnedRevision.elements) : null;
      const impact = propagationImpact(current, targetEls, u.overrides.map(toOverrideInput));
      const key = u.pinnedRevision ? String(u.pinnedRevision.number) : 'none';
      diffByRevision[key] ??= { added: impact.diff.added.length, removed: impact.diff.removed.length, changed: impact.diff.changed.length };
      return {
        unitId: u.structureNodeId,
        name: u.node.name,
        code: u.node.code,
        pinnedRevisionNumber: u.pinnedRevision?.number ?? null,
        overrides: u.overrides.length,
        conflicts: target && u.pinnedRevisionId !== target.id ? impact.conflicts : [],
        upToDate: !!target && u.pinnedRevisionId === target.id,
      };
    });
    return { targetRevision: target ? { id: target.id, number: target.number } : null, units: result, diffByRevision };
  }

  /** Fixa as unidades escolhidas na última revisão publicada. Particularidades são sempre mantidas. */
  async propagate(actor: Actor, projectId: string, typologyId: string, input: PropagateInput) {
    return this.prisma.$transaction(async (tx) => {
      await assertProjectEditable(tx, actor.organizationId, projectId);
      await this.typology(tx, projectId, typologyId);
      const target = await tx.typologyRevision.findFirst({ where: { typologyId, status: 'PUBLISHED' }, orderBy: { number: 'desc' }, include: { elements: true } });
      if (!target) throw conflict('NO_PUBLISHED_REVISION', 'Publique uma revisão da tipologia antes de atualizar as unidades.');
      const units = (await this.unitsWithContext(tx, projectId, typologyId)).filter((u) => input.unitIds.includes(u.structureNodeId));
      if (units.length !== new Set(input.unitIds).size) throw notFound('Uma ou mais unidades desta tipologia');
      const targetEls = toRevisionElements(target.elements);
      const conflicted = units
        .filter((u) => u.pinnedRevisionId !== target.id)
        .map((u) => ({ u, c: propagationImpact(u.pinnedRevision ? toRevisionElements(u.pinnedRevision.elements) : null, targetEls, u.overrides.map(toOverrideInput)).conflicts }))
        .filter((x) => x.c.length > 0);
      if (conflicted.length && !input.acknowledgeConflicts) {
        throw new AppError(
          409,
          'PROPAGATION_CONFLICTS',
          'Particularidades em conflito',
          `${conflicted.length} unidade(s) têm particularidades que deixam de se aplicar na R${target.number}. Confirme para atualizar mesmo assim — as particularidades são mantidas e ficam sinalizadas.`,
          conflicted.map((x) => ({ path: x.u.structureNodeId, message: `${x.u.node.name}: ${x.c.map((c) => c.reason).join(' ')}` })),
        );
      }
      const changed = units.filter((u) => u.pinnedRevisionId !== target.id);
      if (changed.length) {
        await tx.dwellingUnit.updateMany({ where: { projectId, structureNodeId: { in: changed.map((u) => u.structureNodeId) } }, data: { pinnedRevisionId: target.id } });
      }
      await this.audit.record(tx, actor, {
        projectId,
        entityType: 'DwellingTypology',
        entityId: typologyId,
        action: 'PROPAGATE',
        after: {
          revision: target.number,
          units: changed.map((u) => ({ id: u.structureNodeId, code: u.node.code, from: u.pinnedRevision?.number ?? null })),
          withConflicts: conflicted.map((x) => x.u.structureNodeId),
        },
      });
      return { revision: target.number, updated: changed.length, alreadyUpToDate: units.length - changed.length, withConflicts: conflicted.length };
    }, TX);
  }

  // ---------------- unidade: estrutura efetiva e particularidades ----------------

  private async unit(tx: Tx, projectId: string, unitId: string) {
    const u = await tx.dwellingUnit.findFirst({
      where: { structureNodeId: unitId, projectId },
      include: { node: true, typology: true, pinnedRevision: { include: { elements: true } }, overrides: { orderBy: { createdAt: 'asc' } } },
    });
    if (!u) throw notFound('Unidade habitacional');
    return u;
  }

  async unitElements(projectId: string, unitId: string): Promise<UnitElementsDto> {
    const u = await this.unit(this.prisma, projectId, unitId);
    const latest = u.typologyId ? await latestPublishedRevision(this.prisma, u.typologyId) : null;
    const active = u.overrides.filter((o) => !o.archivedAt);
    const res = u.pinnedRevision ? resolveUnitElements(toRevisionElements(u.pinnedRevision.elements), active.map(toOverrideInput)) : null;
    const orphan = new Map((res?.orphanOverrides ?? []).map((o) => [o.overrideId, o.reason]));
    const users = await this.prisma.user.findMany({ where: { id: { in: [...new Set(u.overrides.map((o) => o.createdById))] } }, select: { id: true, name: true } });
    const userName = new Map(users.map((x) => [x.id, x.name]));
    const overrides: UnitOverrideDto[] = u.overrides.map((o) => ({
      id: o.id,
      op: o.op,
      targetStableKey: o.targetStableKey,
      parentStableKey: o.parentStableKey,
      elementTypeId: o.elementTypeId,
      name: o.name,
      attributes: o.attributes ? attrs(o.attributes) : null,
      reason: o.reason,
      createdAt: o.createdAt.toISOString(),
      createdBy: userName.get(o.createdById) ?? '—',
      archivedAt: o.archivedAt?.toISOString() ?? null,
      orphanReason: orphan.get(o.id) ?? null,
    }));
    return {
      unitId,
      typology: u.typology ? { id: u.typology.id, code: u.typology.code, name: u.typology.name } : null,
      pinnedRevision: u.pinnedRevision ? { id: u.pinnedRevision.id, number: u.pinnedRevision.number } : null,
      latestRevision: latest ? { id: latest.id, number: latest.number } : null,
      elements: res?.elements ?? [],
      excluded: (res?.excluded ?? []).map((e) => ({ stableKey: e.stableKey, name: e.name })),
      overrides,
    };
  }

  async createOverride(actor: Actor, projectId: string, unitId: string, input: CreateOverrideInput) {
    return this.prisma.$transaction(async (tx) => {
      await assertProjectEditable(tx, actor.organizationId, projectId);
      const u = await this.unit(tx, projectId, unitId);
      if (u.node.archivedAt) throw conflict('NODE_ARCHIVED', 'Unidade arquivada.');
      if (!u.pinnedRevision) throw conflict('UNIT_NOT_PINNED', 'A unidade ainda não está vinculada a uma revisão publicada da tipologia. Atualize-a pela propagação da tipologia.');
      const keys = new Set(u.pinnedRevision.elements.map((e) => e.stableKey));
      let data: Prisma.UnitOverrideUncheckedCreateInput;
      if (input.op === 'EXCLUDE_ELEMENT') {
        if (!keys.has(input.targetStableKey)) throw notFound('Elemento da tipologia');
        const dup = u.overrides.find((o) => !o.archivedAt && o.op === 'EXCLUDE_ELEMENT' && o.targetStableKey === input.targetStableKey);
        if (dup) throw conflict('OVERRIDE_EXISTS', 'Este elemento já está excluído nesta unidade.');
        data = { organizationId: actor.organizationId, projectId, unitId, op: 'EXCLUDE_ELEMENT', targetStableKey: input.targetStableKey, reason: input.reason, createdById: actor.userId };
      } else {
        if (input.parentStableKey && !keys.has(input.parentStableKey)) throw notFound('Elemento superior da tipologia');
        const { defs } = await loadElementType(tx, actor.organizationId, input.elementTypeId, { domain: 'CONSTRUTIVO', category: 'ELEMENT' });
        const attributes = checkAttributes(defs, input.attributes);
        data = {
          organizationId: actor.organizationId,
          projectId,
          unitId,
          op: 'ADD_ELEMENT',
          parentStableKey: input.parentStableKey ?? null,
          elementTypeId: input.elementTypeId,
          name: input.name,
          attributes,
          reason: input.reason,
          createdById: actor.userId,
        };
      }
      const o = await tx.unitOverride.create({ data });
      await this.audit.record(tx, actor, { projectId, entityType: 'UnitOverride', entityId: o.id, action: 'CREATE', after: { unit: u.node.code, op: o.op, target: o.targetStableKey, name: o.name }, reason: input.reason });
      return { id: o.id };
    }, TX);
  }

  async archiveOverride(actor: Actor, projectId: string, unitId: string, overrideId: string, reason: string) {
    return this.prisma.$transaction(async (tx) => {
      await assertProjectEditable(tx, actor.organizationId, projectId);
      const o = await tx.unitOverride.findFirst({ where: { id: overrideId, unitId, projectId } });
      if (!o) throw notFound('Particularidade');
      if (o.archivedAt) throw conflict('NO_CHANGE', 'Particularidade já removida.');
      await tx.unitOverride.update({ where: { id: o.id }, data: { archivedAt: new Date(), archiveReason: reason } });
      await this.audit.record(tx, actor, { projectId, entityType: 'UnitOverride', entityId: o.id, action: 'ARCHIVE', reason });
    }, TX);
  }
}
