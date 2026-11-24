import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import type {
  CreateNodeInput,
  ModuleDto,
  MoveNodeInput,
  StructureDto,
  StructureNodeDto,
  UpdateNodeInput,
  WizardInput,
  WizardPreviewDto,
} from '@eapq/contracts';
import {
  allowedChildKinds,
  canPlace,
  canPlaceSubtree,
  MODULE_KIND_LABELS,
  NODE_KIND_LABELS,
  planStructure,
  StructurePlanError,
  type ModuleKind,
  type NodeKind,
  type StructurePlan,
} from '@eapq/domain';
import type { Actor } from '../../common/auth/auth-context.js';
import { AppError, conflict, notFound, versionConflict } from '../../common/errors.js';
import { PrismaService, type Tx } from '../../prisma/prisma.service.js';
import { Prisma } from '../../generated/prisma/client.js';
import { AuditService } from '../audit/audit.service.js';
import { recomputeStructureCodes, renumberSiblings } from './codes.js';

const MAX_DUPLICATE = 5000;
const TX = { timeout: 60_000, maxWait: 10_000 } as const;

const invalidHierarchy = (moduleKind: ModuleKind, parentKind: NodeKind | null, kind: NodeKind) => {
  const allowed = allowedChildKinds(moduleKind, parentKind).map((k) => NODE_KIND_LABELS[k]);
  return new AppError(
    422,
    'INVALID_HIERARCHY',
    'Hierarquia inválida',
    `${NODE_KIND_LABELS[kind]} não pode ficar ${parentKind ? `sob ${NODE_KIND_LABELS[parentKind]}` : 'na raiz'} de um módulo ${MODULE_KIND_LABELS[moduleKind].toLowerCase()}.` +
      (allowed.length ? ` Permitidos: ${allowed.join(', ')}.` : ' Este item não aceita subitens.'),
  );
};

const typologyKindFor = (m: ModuleKind) =>
  m === 'VERTICAL_RESIDENTIAL' ? 'APARTMENT' : m === 'HORIZONTAL_RESIDENTIAL' ? 'HOUSE' : null;

type NodeRow = Prisma.StructureNodeGetPayload<{ include: { unit: true; lot: true } }>;

function nodeDto(n: NodeRow): StructureNodeDto {
  return {
    id: n.id,
    moduleId: n.moduleId,
    parentId: n.parentId,
    kind: n.kind,
    name: n.name,
    code: n.code,
    position: n.position,
    depth: n.depth,
    origin: n.origin,
    archivedAt: n.archivedAt?.toISOString() ?? null,
    version: n.version,
    ...(n.kind === 'DWELLING_UNIT' ? { typologyId: n.unit?.typologyId ?? null } : {}),
    ...(n.kind === 'LOT' ? { lot: { area: n.lot?.area?.toString() ?? null, frontage: n.lot?.frontage?.toString() ?? null } } : {}),
  };
}

const moduleDto = (m: { id: string; kind: ModuleKind; name: string; code: string; position: number; archivedAt: Date | null; version: number }): ModuleDto => ({
  id: m.id,
  kind: m.kind,
  name: m.name,
  code: m.code,
  position: m.position,
  archivedAt: m.archivedAt?.toISOString() ?? null,
  version: m.version,
});

@Injectable()
export class StructureService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** Empreendimento arquivado é somente leitura. */
  private async assertEditable(tx: Tx, organizationId: string, projectId: string) {
    const p = await tx.project.findFirst({ where: { id: projectId, organizationId }, select: { status: true } });
    if (!p) throw notFound('Empreendimento');
    if (p.status === 'ARCHIVED') throw conflict('PROJECT_ARCHIVED', 'Empreendimento arquivado não pode ser alterado.');
    // Serializa alterações estruturais do mesmo empreendimento (posições e códigos derivados).
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${projectId}, 0))`;
  }

  async get(organizationId: string, projectId: string): Promise<StructureDto> {
    const [modules, nodes] = await Promise.all([
      this.prisma.projectModule.findMany({ where: { organizationId, projectId }, orderBy: [{ position: 'asc' }, { id: 'asc' }] }),
      this.prisma.structureNode.findMany({
        where: { organizationId, projectId },
        orderBy: [{ depth: 'asc' }, { position: 'asc' }, { id: 'asc' }],
        include: { unit: true, lot: true },
      }),
    ]);
    return { modules: modules.map(moduleDto), nodes: nodes.map(nodeDto) };
  }

  // ---------------- módulos ----------------

  async createModule(actor: Actor, projectId: string, input: { kind: ModuleKind; name: string }) {
    return this.prisma.$transaction(async (tx) => {
      await this.assertEditable(tx, actor.organizationId, projectId);
      const last = await tx.projectModule.aggregate({ where: { projectId }, _max: { position: true } });
      const m = await tx.projectModule.create({
        data: {
          organizationId: actor.organizationId,
          projectId,
          kind: input.kind,
          name: input.name,
          position: (last._max.position ?? 0) + 1,
          code: '',
        },
      });
      await recomputeStructureCodes(tx, projectId);
      await this.audit.record(tx, actor, { projectId, entityType: 'ProjectModule', entityId: m.id, action: 'CREATE', after: { kind: m.kind, name: m.name } });
      return moduleDto(await tx.projectModule.findUniqueOrThrow({ where: { id: m.id } }));
    }, TX);
  }

  async renameModule(actor: Actor, projectId: string, moduleId: string, version: number, name: string) {
    return this.prisma.$transaction(async (tx) => {
      await this.assertEditable(tx, actor.organizationId, projectId);
      const m = await tx.projectModule.findFirst({ where: { id: moduleId, projectId } });
      if (!m) throw notFound('Módulo');
      const res = await tx.projectModule.updateMany({ where: { id: moduleId, version }, data: { name, version: { increment: 1 } } });
      if (res.count !== 1) throw versionConflict();
      await this.audit.record(tx, actor, { projectId, entityType: 'ProjectModule', entityId: moduleId, action: 'UPDATE', before: { name: m.name }, after: { name } });
      return moduleDto(await tx.projectModule.findUniqueOrThrow({ where: { id: moduleId } }));
    }, TX);
  }

  // ---------------- nós ----------------

  private async loadModule(tx: Tx, projectId: string, moduleId: string) {
    const m = await tx.projectModule.findFirst({ where: { id: moduleId, projectId } });
    if (!m) throw notFound('Módulo');
    if (m.archivedAt) throw conflict('MODULE_ARCHIVED', 'Módulo arquivado não pode ser alterado.');
    return m;
  }

  private async loadNode(tx: Tx, projectId: string, nodeId: string) {
    const n = await tx.structureNode.findFirst({ where: { id: nodeId, projectId }, include: { unit: true, lot: true } });
    if (!n) throw notFound('Item do cadastro');
    return n;
  }

  private async checkTypology(tx: Tx, projectId: string, moduleKind: ModuleKind, typologyId: string | null | undefined) {
    if (!typologyId) return;
    const t = await tx.dwellingTypology.findFirst({ where: { id: typologyId, projectId } });
    if (!t) throw notFound('Tipologia');
    if (t.archivedAt) throw conflict('TYPOLOGY_ARCHIVED', 'Tipologia arquivada não pode receber unidades.');
    const expected = typologyKindFor(moduleKind);
    if (expected && t.kind !== expected) {
      throw new AppError(422, 'TYPOLOGY_KIND_MISMATCH', 'Tipologia incompatível', `A tipologia ${t.code} é de ${t.kind === 'HOUSE' ? 'casa' : 'apartamento'} e não serve para este módulo.`);
    }
  }

  async createNode(actor: Actor, projectId: string, input: CreateNodeInput): Promise<StructureNodeDto> {
    return this.prisma.$transaction(async (tx) => {
      await this.assertEditable(tx, actor.organizationId, projectId);
      const mod = await this.loadModule(tx, projectId, input.moduleId);
      let parent: NodeRow | null = null;
      if (input.parentId) {
        parent = await this.loadNode(tx, projectId, input.parentId);
        if (parent.moduleId !== mod.id) throw new AppError(422, 'INVALID_HIERARCHY', 'Hierarquia inválida', 'O item superior pertence a outro módulo.');
        if (parent.archivedAt) throw conflict('PARENT_ARCHIVED', 'Não é possível incluir itens sob um item arquivado.');
      }
      if (!canPlace(mod.kind, parent?.kind ?? null, input.kind)) throw invalidHierarchy(mod.kind, parent?.kind ?? null, input.kind);
      if (input.typologyId && input.kind !== 'DWELLING_UNIT') throw new AppError(422, 'VALIDATION_FAILED', 'Dados inválidos', 'Tipologia só se aplica a unidades habitacionais.');
      await this.checkTypology(tx, projectId, mod.kind, input.typologyId);
      const last = await tx.structureNode.aggregate({ where: { projectId, moduleId: mod.id, parentId: parent?.id ?? null }, _max: { position: true } });
      const id = randomUUID();
      await tx.structureNode.create({
        data: {
          id,
          organizationId: actor.organizationId,
          projectId,
          moduleId: mod.id,
          parentId: parent?.id ?? null,
          kind: input.kind,
          name: input.name,
          position: (last._max.position ?? 0) + 1,
          depth: parent ? parent.depth + 1 : 0,
          path: parent ? `${parent.path}/${id}` : id,
          code: '',
          origin: 'MANUAL',
        },
      });
      if (input.kind === 'DWELLING_UNIT') await tx.dwellingUnit.create({ data: { structureNodeId: id, projectId, typologyId: input.typologyId ?? null } });
      if (input.kind === 'LOT') await tx.lotDetail.create({ data: { structureNodeId: id, projectId } });
      await recomputeStructureCodes(tx, projectId);
      const created = await this.loadNode(tx, projectId, id);
      await this.audit.record(tx, actor, { projectId, entityType: 'StructureNode', entityId: id, action: 'CREATE', after: this.auditView(created) });
      return nodeDto(created);
    }, TX);
  }

  private auditView(n: NodeRow) {
    return {
      kind: n.kind,
      name: n.name,
      code: n.code,
      parentId: n.parentId,
      ...(n.unit ? { typologyId: n.unit.typologyId } : {}),
      ...(n.lot ? { area: n.lot.area?.toString() ?? null, frontage: n.lot.frontage?.toString() ?? null } : {}),
    };
  }

  async updateNode(actor: Actor, projectId: string, nodeId: string, version: number, input: UpdateNodeInput): Promise<StructureNodeDto> {
    return this.prisma.$transaction(async (tx) => {
      await this.assertEditable(tx, actor.organizationId, projectId);
      const n = await this.loadNode(tx, projectId, nodeId);
      if (n.archivedAt) throw conflict('NODE_ARCHIVED', 'Item arquivado não pode ser editado. Reative-o antes.');
      if (n.version !== version) throw versionConflict();
      if (input.typologyId !== undefined) {
        if (n.kind !== 'DWELLING_UNIT') throw new AppError(422, 'VALIDATION_FAILED', 'Dados inválidos', 'Tipologia só se aplica a unidades habitacionais.');
        const mod = await tx.projectModule.findUniqueOrThrow({ where: { id: n.moduleId } });
        await this.checkTypology(tx, projectId, mod.kind, input.typologyId);
        await tx.dwellingUnit.update({ where: { structureNodeId: n.id }, data: { typologyId: input.typologyId } });
      }
      if (input.lot !== undefined) {
        if (n.kind !== 'LOT') throw new AppError(422, 'VALIDATION_FAILED', 'Dados inválidos', 'Área e testada só se aplicam a lotes.');
        await tx.lotDetail.update({
          where: { structureNodeId: n.id },
          data: {
            ...(input.lot.area !== undefined ? { area: input.lot.area === null ? null : new Prisma.Decimal(input.lot.area) } : {}),
            ...(input.lot.frontage !== undefined ? { frontage: input.lot.frontage === null ? null : new Prisma.Decimal(input.lot.frontage) } : {}),
          },
        });
      }
      const res = await tx.structureNode.updateMany({
        where: { id: n.id, version },
        data: { ...(input.name ? { name: input.name } : {}), version: { increment: 1 } },
      });
      if (res.count !== 1) throw versionConflict();
      const updated = await this.loadNode(tx, projectId, nodeId);
      await this.audit.record(tx, actor, { projectId, entityType: 'StructureNode', entityId: n.id, action: 'UPDATE', before: this.auditView(n), after: this.auditView(updated), reason: input.reason ?? null });
      return nodeDto(updated);
    }, TX);
  }

  private async subtree(tx: Tx, projectId: string, n: { id: string; path: string }) {
    return tx.structureNode.findMany({
      where: { projectId, OR: [{ id: n.id }, { path: { startsWith: `${n.path}/` } }] },
      include: { unit: true, lot: true },
      orderBy: [{ depth: 'asc' }, { position: 'asc' }, { id: 'asc' }],
    });
  }

  private siblings(tx: Tx, projectId: string, moduleId: string, parentId: string | null, excludeId?: string) {
    return tx.structureNode.findMany({
      where: { projectId, moduleId, parentId, ...(excludeId ? { NOT: { id: excludeId } } : {}) },
      orderBy: [{ position: 'asc' }, { id: 'asc' }],
      select: { id: true },
    });
  }

  async moveNode(actor: Actor, projectId: string, nodeId: string, version: number, input: MoveNodeInput) {
    return this.prisma.$transaction(async (tx) => {
      await this.assertEditable(tx, actor.organizationId, projectId);
      const n = await this.loadNode(tx, projectId, nodeId);
      if (n.version !== version) throw versionConflict();
      if (n.archivedAt) throw conflict('NODE_ARCHIVED', 'Item arquivado não pode ser movido.');
      const mod = await this.loadModule(tx, projectId, n.moduleId);
      let parent: NodeRow | null = null;
      if (input.parentId) {
        parent = await this.loadNode(tx, projectId, input.parentId);
        if (parent.moduleId !== n.moduleId) throw new AppError(422, 'INVALID_HIERARCHY', 'Hierarquia inválida', 'Mover entre módulos não é permitido.');
        if (parent.id === n.id || parent.path.startsWith(`${n.path}/`)) {
          throw new AppError(422, 'INVALID_HIERARCHY', 'Hierarquia inválida', 'Um item não pode ser movido para dentro de si mesmo.');
        }
        if (parent.archivedAt) throw conflict('PARENT_ARCHIVED', 'Não é possível mover para um item arquivado.');
      }
      const nodes = await this.subtree(tx, projectId, n);
      type T = { kind: NodeKind; children: T[] };
      const byId = new Map<string, T>(nodes.map((x) => [x.id, { kind: x.kind, children: [] }]));
      for (const x of nodes) if (x.id !== n.id && x.parentId) byId.get(x.parentId)?.children.push(byId.get(x.id)!);
      if (!canPlaceSubtree(mod.kind, parent?.kind ?? null, byId.get(n.id)!)) throw invalidHierarchy(mod.kind, parent?.kind ?? null, n.kind);

      const before = { parentId: n.parentId, position: n.position, code: n.code };
      const newParentId = parent?.id ?? null;
      // Ordem final dos novos irmãos com o item inserido na posição pedida.
      const sibs = (await this.siblings(tx, projectId, n.moduleId, newParentId, n.id)).map((s) => s.id);
      const index = Math.min(Math.max((input.position ?? sibs.length + 1) - 1, 0), sibs.length);
      sibs.splice(index, 0, n.id);

      if (newParentId !== n.parentId) {
        const newPath = parent ? `${parent.path}/${n.id}` : n.id;
        const delta = (parent ? parent.depth + 1 : 0) - n.depth;
        await tx.$executeRaw`
          UPDATE structure_node
          SET path = ${newPath} || substr(path, ${n.path.length + 1}), depth = depth + ${delta}
          WHERE "projectId" = ${projectId}::uuid AND (id = ${n.id}::uuid OR path LIKE ${`${n.path}/%`})`;
        await tx.structureNode.update({ where: { id: n.id }, data: { parentId: newParentId } });
        const old = (await this.siblings(tx, projectId, n.moduleId, n.parentId)).map((s) => s.id);
        await renumberSiblings(tx, projectId, old);
      }
      await renumberSiblings(tx, projectId, sibs);
      await tx.structureNode.update({ where: { id: n.id }, data: { version: { increment: 1 } } });
      await recomputeStructureCodes(tx, projectId);
      const after = await tx.structureNode.findUniqueOrThrow({ where: { id: n.id } });
      await this.audit.record(tx, actor, {
        projectId,
        entityType: 'StructureNode',
        entityId: n.id,
        action: 'MOVE',
        before,
        after: { parentId: after.parentId, position: after.position, code: after.code },
      });
      return { id: n.id, code: after.code, version: after.version };
    }, TX);
  }

  async duplicateNode(actor: Actor, projectId: string, nodeId: string) {
    return this.prisma.$transaction(async (tx) => {
      await this.assertEditable(tx, actor.organizationId, projectId);
      const n = await this.loadNode(tx, projectId, nodeId);
      if (n.archivedAt) throw conflict('NODE_ARCHIVED', 'Item arquivado não pode ser duplicado.');
      await this.loadModule(tx, projectId, n.moduleId);
      const nodes = (await this.subtree(tx, projectId, n)).filter((x) => !x.archivedAt || x.id === n.id);
      if (nodes.length > MAX_DUPLICATE) throw conflict('TOO_LARGE', `A duplicação está limitada a ${MAX_DUPLICATE} itens por vez.`);
      const active = new Set(nodes.map((x) => x.id));
      const kept = nodes.filter((x) => x.id === n.id || (x.parentId && active.has(x.parentId)));
      const idMap = new Map(kept.map((x) => [x.id, randomUUID()]));
      const pathMap = new Map<string, string>();
      const parentPrefix = n.path.slice(0, n.path.length - n.id.length); // "" ou "…/"
      const rows: Prisma.StructureNodeCreateManyInput[] = [];
      for (const x of kept) {
        const id = idMap.get(x.id)!;
        const isRoot = x.id === n.id;
        const path = isRoot ? `${parentPrefix}${id}` : `${pathMap.get(x.parentId!)!}/${id}`;
        pathMap.set(x.id, path);
        rows.push({
          id,
          organizationId: actor.organizationId,
          projectId,
          moduleId: x.moduleId,
          parentId: isRoot ? x.parentId : idMap.get(x.parentId!)!,
          kind: x.kind,
          name: isRoot ? `${x.name} (cópia)`.slice(0, 120) : x.name,
          position: isRoot ? x.position + 1 : x.position,
          depth: x.depth,
          path,
          code: '',
          origin: 'DUPLICATE',
        });
      }
      await tx.structureNode.createMany({ data: rows });
      await tx.dwellingUnit.createMany({
        data: kept.filter((x) => x.unit).map((x) => ({ structureNodeId: idMap.get(x.id)!, projectId, typologyId: x.unit!.typologyId })),
      });
      await tx.lotDetail.createMany({
        data: kept.filter((x) => x.lot).map((x) => ({ structureNodeId: idMap.get(x.id)!, projectId, area: x.lot!.area, frontage: x.lot!.frontage })),
      });
      const sibs = (await this.siblings(tx, projectId, n.moduleId, n.parentId)).map((s) => s.id).filter((id) => id !== idMap.get(n.id));
      sibs.splice(sibs.indexOf(n.id) + 1, 0, idMap.get(n.id)!);
      await renumberSiblings(tx, projectId, sibs);
      await recomputeStructureCodes(tx, projectId);
      const copy = await tx.structureNode.findUniqueOrThrow({ where: { id: idMap.get(n.id)! } });
      await this.audit.record(tx, actor, {
        projectId,
        entityType: 'StructureNode',
        entityId: copy.id,
        action: 'DUPLICATE',
        after: { sourceId: n.id, name: copy.name, code: copy.code, items: kept.length },
      });
      return { id: copy.id, code: copy.code, items: kept.length };
    }, TX);
  }

  async setArchived(actor: Actor, projectId: string, nodeId: string, version: number, archived: boolean, reason: string | null) {
    return this.prisma.$transaction(async (tx) => {
      await this.assertEditable(tx, actor.organizationId, projectId);
      const n = await this.loadNode(tx, projectId, nodeId);
      if (n.version !== version) throw versionConflict();
      if (!!n.archivedAt === archived) throw conflict('NO_CHANGE', archived ? 'Item já está arquivado.' : 'Item já está ativo.');
      let affected: number;
      if (archived) {
        const at = new Date();
        // Arquiva a subárvore; itens já arquivados antes mantêm a data original.
        affected = await tx.$executeRaw`
          UPDATE structure_node SET "archivedAt" = ${at}, version = version + 1
          WHERE "projectId" = ${projectId}::uuid AND "archivedAt" IS NULL AND (id = ${n.id}::uuid OR path LIKE ${`${n.path}/%`})`;
      } else {
        if (n.parentId) {
          const parent = await tx.structureNode.findUniqueOrThrow({ where: { id: n.parentId } });
          if (parent.archivedAt) throw conflict('PARENT_ARCHIVED', 'Reative primeiro o item superior.');
        }
        // Reativa apenas o que foi arquivado junto com este item.
        affected = await tx.$executeRaw`
          UPDATE structure_node SET "archivedAt" = NULL, version = version + 1
          WHERE "projectId" = ${projectId}::uuid AND "archivedAt" = ${n.archivedAt} AND (id = ${n.id}::uuid OR path LIKE ${`${n.path}/%`})`;
      }
      await this.audit.record(tx, actor, {
        projectId,
        entityType: 'StructureNode',
        entityId: n.id,
        action: archived ? 'ARCHIVE' : 'UNARCHIVE',
        before: { name: n.name, code: n.code },
        after: { items: affected },
        reason,
      });
      return { id: n.id, items: affected };
    }, TX);
  }

  // ---------------- assistente ----------------

  private plan(input: WizardInput): StructurePlan {
    try {
      return planStructure(input);
    } catch (e) {
      if (e instanceof StructurePlanError) {
        throw new AppError(422, 'VALIDATION_FAILED', 'Dados inválidos', 'Revise os parâmetros destacados.', e.issues);
      }
      throw e;
    }
  }

  async previewWizard(organizationId: string, projectId: string, input: WizardInput): Promise<WizardPreviewDto> {
    const plan = this.plan(input);
    const existing = await this.prisma.dwellingTypology.findMany({
      where: { organizationId, projectId, code: { in: input.typologies.map((t) => t.code) } },
      select: { code: true },
    });
    return {
      counts: plan.counts,
      unitsByTypology: plan.unitsByTypology,
      unitsWithoutTypology: plan.unitsWithoutTypology,
      totalNodes: plan.totalNodes,
      existingTypologies: existing.map((t) => t.code),
      modules: plan.modules.map((m) => {
        const depth = new Map<string, number>();
        for (const n of m.nodes) depth.set(n.key, n.parentKey ? depth.get(n.parentKey)! + 1 : 0);
        return {
          kind: m.kind,
          name: m.name,
          nodeCount: m.nodes.length,
          sample: m.nodes.slice(0, 40).map((n) => ({ name: n.name, kind: n.kind, depth: depth.get(n.key)! })),
        };
      }),
    };
  }

  async applyWizard(actor: Actor, projectId: string, input: WizardInput) {
    const plan = this.plan(input);
    return this.prisma.$transaction(async (tx) => {
      await this.assertEditable(tx, actor.organizationId, projectId);
      // Tipologias: reutiliza existentes de mesmo código e tipo; conflito de tipo é erro.
      const typologyIds = new Map<string, string>();
      for (const t of plan.typologies) {
        const existing = await tx.dwellingTypology.findUnique({ where: { projectId_code: { projectId, code: t.code } } });
        if (existing) {
          if (existing.kind !== t.kind) throw conflict('TYPOLOGY_KIND_MISMATCH', `A tipologia ${t.code} já existe com outro tipo.`);
          if (existing.archivedAt) throw conflict('TYPOLOGY_ARCHIVED', `A tipologia ${t.code} está arquivada.`);
          typologyIds.set(t.code, existing.id);
        } else {
          const created = await tx.dwellingTypology.create({
            data: { organizationId: actor.organizationId, projectId, code: t.code, name: t.name, kind: t.kind },
          });
          typologyIds.set(t.code, created.id);
          await this.audit.record(tx, actor, { projectId, entityType: 'DwellingTypology', entityId: created.id, action: 'CREATE', after: { code: t.code, name: t.name, kind: t.kind } });
        }
      }
      const last = await tx.projectModule.aggregate({ where: { projectId }, _max: { position: true } });
      let modulePos = last._max.position ?? 0;
      const createdModules: string[] = [];
      for (const pm of plan.modules) {
        const m = await tx.projectModule.create({
          data: { organizationId: actor.organizationId, projectId, kind: pm.kind, name: pm.name, position: ++modulePos, code: '' },
        });
        createdModules.push(m.id);
        const ids = new Map<string, { id: string; path: string; depth: number }>();
        const rows: Prisma.StructureNodeCreateManyInput[] = [];
        const units: Prisma.DwellingUnitCreateManyInput[] = [];
        const lots: Prisma.LotDetailCreateManyInput[] = [];
        for (const n of pm.nodes) {
          const id = randomUUID();
          const parent = n.parentKey ? ids.get(n.parentKey)! : null;
          const info = { id, path: parent ? `${parent.path}/${id}` : id, depth: parent ? parent.depth + 1 : 0 };
          ids.set(n.key, info);
          rows.push({
            id,
            organizationId: actor.organizationId,
            projectId,
            moduleId: m.id,
            parentId: parent?.id ?? null,
            kind: n.kind,
            name: n.name,
            position: n.position,
            depth: info.depth,
            path: info.path,
            code: '',
            origin: 'WIZARD',
          });
          if (n.kind === 'DWELLING_UNIT') units.push({ structureNodeId: id, projectId, typologyId: n.typologyCode ? typologyIds.get(n.typologyCode)! : null });
          if (n.kind === 'LOT') lots.push({ structureNodeId: id, projectId });
        }
        for (let i = 0; i < rows.length; i += 2000) await tx.structureNode.createMany({ data: rows.slice(i, i + 2000) });
        for (let i = 0; i < units.length; i += 4000) await tx.dwellingUnit.createMany({ data: units.slice(i, i + 4000) });
        for (let i = 0; i < lots.length; i += 4000) await tx.lotDetail.createMany({ data: lots.slice(i, i + 4000) });
      }
      await recomputeStructureCodes(tx, projectId);
      await this.audit.record(tx, actor, {
        projectId,
        entityType: 'StructureWizard',
        entityId: projectId,
        action: 'APPLY',
        after: { input, counts: plan.counts, unitsByTypology: plan.unitsByTypology, modules: createdModules },
      });
      return { modules: createdModules, counts: plan.counts, totalNodes: plan.totalNodes };
    }, TX);
  }
}
