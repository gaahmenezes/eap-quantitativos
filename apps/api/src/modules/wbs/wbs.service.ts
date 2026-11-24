import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import type { WbsDto, WbsNodeDto, WbsPlanDto, WbsSelectionInput } from '@eapq/contracts';
import {
  deriveTreeCodes,
  diffWbs,
  generateWbs,
  stableHash,
  WbsGenerationError,
  type DesiredNode,
  type ExistingWbsNode,
  type ProjectFacts,
  type TemplateDef,
  type WbsDiff,
} from '@eapq/domain';
import type { Actor } from '../../common/auth/auth-context.js';
import { AppError, conflict, notFound, versionConflict } from '../../common/errors.js';
import { assertProjectEditable } from '../../common/project-guard.js';
import { PrismaService, type Tx } from '../../prisma/prisma.service.js';
import { Prisma, type WbsNode } from '../../generated/prisma/client.js';
import { AuditService } from '../audit/audit.service.js';
import { WbsTemplatesService } from '../wbs-templates/wbs-templates.service.js';

const TX = { timeout: 120_000, maxWait: 10_000 } as const;
const lock = (tx: Tx, projectId: string) => tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`wbs:${projectId}`}, 0))`;

type NodeWithServices = WbsNode & { services: { serviceId: string; fromTemplate: boolean }[] };

const nodeDto = (n: NodeWithServices): WbsNodeDto => ({
  id: n.id,
  parentId: n.parentId,
  title: n.title,
  code: n.code,
  depth: n.depth,
  position: n.position,
  nodeType: n.nodeType,
  origin: n.origin,
  status: n.status,
  moduleId: n.moduleId,
  templateVersionId: n.templateVersionId,
  binding: n.bindingKind && n.bindingId ? { kind: n.bindingKind, id: n.bindingId } : null,
  titleOverridden: n.titleOverridden,
  placementOverridden: n.placementOverridden,
  archivedAt: n.archivedAt?.toISOString() ?? null,
  version: n.version,
  serviceIds: n.services.map((s) => s.serviceId).sort(),
});

const toExisting = (n: WbsNode): ExistingWbsNode => ({
  id: n.id,
  parentId: n.parentId,
  generationKey: n.generationKey,
  moduleId: n.moduleId,
  title: n.title,
  nodeType: n.nodeType,
  position: n.position,
  status: n.status,
  archived: !!n.archivedAt,
  origin: n.origin,
  titleOverridden: n.titleOverridden,
  placementOverridden: n.placementOverridden,
  templateVersionId: n.templateVersionId,
});

/** Recalcula posições (sequenciais por pai), profundidade, caminho e códigos derivados da EAP (ADR-005). */
export async function recomputeWbsTree(tx: Tx, projectId: string) {
  const rows = await tx.wbsNode.findMany({ where: { projectId }, select: { id: true, parentId: true, position: true, origin: true, createdAt: true, archivedAt: true, path: true, depth: true, code: true } });
  const kids = new Map<string | null, typeof rows>();
  for (const r of rows) kids.set(r.parentId, [...(kids.get(r.parentId) ?? []), r]);
  const next = new Map<string, { position: number; depth: number; path: string }>();
  const walk = (parent: string | null, depth: number, prefix: string) => {
    const list = (kids.get(parent) ?? []).sort((a, b) => a.position - b.position || (a.origin === b.origin ? 0 : a.origin === 'GENERATED' ? -1 : 1) || a.createdAt.getTime() - b.createdAt.getTime() || (a.id < b.id ? -1 : 1));
    list.forEach((r, i) => {
      const path = prefix ? `${prefix}/${r.id}` : r.id;
      next.set(r.id, { position: i + 1, depth, path });
      walk(r.id, depth + 1, path);
    });
  };
  walk(null, 0, '');
  const active = rows.filter((r) => !r.archivedAt && (!r.parentId || next.has(r.parentId)));
  const activeIds = new Set(active.map((r) => r.id));
  const codes = deriveTreeCodes(active.filter((r) => !r.parentId || activeIds.has(r.parentId)).map((r) => ({ id: r.id, parentId: r.parentId, position: next.get(r.id)!.position })));
  const changed = rows.filter((r) => {
    const n = next.get(r.id)!;
    return n.position !== r.position || n.depth !== r.depth || n.path !== r.path || (codes.has(r.id) && codes.get(r.id) !== r.code);
  });
  for (let i = 0; i < changed.length; i += 5000) {
    const part = changed.slice(i, i + 5000);
    await tx.$executeRaw`
      UPDATE wbs_node w SET position = v.pos, depth = v.depth, path = v.path, code = v.code
      FROM unnest(${part.map((r) => r.id)}::uuid[], ${part.map((r) => next.get(r.id)!.position)}::int[], ${part.map((r) => next.get(r.id)!.depth)}::int[],
                  ${part.map((r) => next.get(r.id)!.path)}::text[], ${part.map((r) => codes.get(r.id) ?? r.code)}::text[]) AS v(id, pos, depth, path, code)
      WHERE w.id = v.id AND w."projectId" = ${projectId}::uuid`;
  }
}

interface Plan {
  facts: ProjectFacts;
  factsHash: string;
  desired: DesiredNode[];
  diff: WbsDiff;
  existing: WbsNode[];
  planHash: string;
  selections: { moduleId: string; templateVersionId: string }[];
}

@Injectable()
export class WbsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly templates: WbsTemplatesService,
  ) {}

  // ---------------- leitura ----------------

  async get(organizationId: string, projectId: string): Promise<WbsDto> {
    const [nodes, runs] = await Promise.all([
      this.prisma.wbsNode.findMany({ where: { organizationId, projectId }, include: { services: { select: { serviceId: true, fromTemplate: true } } }, orderBy: [{ depth: 'asc' }, { position: 'asc' }, { id: 'asc' }] }),
      this.prisma.wbsGenerationRun.findMany({ where: { organizationId, projectId }, orderBy: { createdAt: 'desc' }, take: 20 }),
    ]);
    const users = new Map((await this.prisma.user.findMany({ where: { id: { in: [...new Set(runs.map((r) => r.createdById))] } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]));
    // versão de template em uso por módulo (nós gerados ativos)
    const pairs = new Map<string, string>();
    for (const n of nodes) if (n.origin === 'GENERATED' && !n.archivedAt && n.moduleId && n.templateVersionId && !pairs.has(n.moduleId)) pairs.set(n.moduleId, n.templateVersionId);
    const versions = await this.prisma.wbsTemplateVersion.findMany({ where: { id: { in: [...pairs.values()] } }, include: { template: { include: { versions: { where: { status: 'PUBLISHED' }, select: { number: true } } } } } });
    const vById = new Map(versions.map((v) => [v.id, v]));
    return {
      nodes: nodes.map(nodeDto),
      moduleTemplates: [...pairs.entries()].map(([moduleId, vid]) => {
        const v = vById.get(vid)!;
        return { moduleId, templateVersionId: vid, templateId: v.templateId, templateName: v.template.name, versionNumber: v.number, latestVersionNumber: Math.max(...v.template.versions.map((x) => x.number)) };
      }),
      runs: runs.map((r) => ({ id: r.id, createdAt: r.createdAt.toISOString(), createdBy: users.get(r.createdById) ?? '—', summary: r.summary as WbsPlanDto['totals'], factsHash: r.factsHash, resultHash: r.resultHash })),
    };
  }

  // ---------------- geração ----------------

  private async facts(tx: Tx, organizationId: string, projectId: string): Promise<ProjectFacts> {
    const [project, modules, structure, typologies, systems] = await Promise.all([
      tx.project.findFirstOrThrow({ where: { id: projectId, organizationId } }),
      tx.projectModule.findMany({ where: { projectId, archivedAt: null } }),
      tx.structureNode.findMany({ where: { projectId, archivedAt: null }, include: { unit: { select: { typologyId: true } } } }),
      tx.dwellingTypology.findMany({ where: { projectId, archivedAt: null } }),
      tx.infrastructureSystem.findMany({ where: { projectId, archivedAt: null }, include: { systemType: true, networks: { where: { archivedAt: null } } } }),
    ]);
    const activeIds = new Set(structure.map((s) => s.id));
    return {
      classification: project.classification,
      modules: modules.map((m) => ({ id: m.id, kind: m.kind, name: m.name, code: m.code, position: m.position })),
      structure: structure
        .filter((s) => !s.parentId || activeIds.has(s.parentId))
        .map((s) => ({ id: s.id, moduleId: s.moduleId, parentId: s.parentId, kind: s.kind, name: s.name, code: s.code, position: s.position, typologyId: s.unit?.typologyId ?? null })),
      typologies: typologies.map((t) => ({ id: t.id, code: t.code, name: t.name, kind: t.kind })),
      systems: systems.map((s) => ({ id: s.id, typeCode: s.systemType.code, typeName: s.systemType.name, name: s.name, networks: s.networks.map((n) => ({ id: n.id, code: n.code, name: n.name })) })),
    };
  }

  private async plan(tx: Tx, actorOrg: string, projectId: string, input: WbsSelectionInput): Promise<Plan> {
    const facts = await this.facts(tx, actorOrg, projectId);
    const moduleById = new Map(facts.modules.map((m) => [m.id, m]));
    const seen = new Set<string>();
    const sels: { moduleId: string; template: TemplateDef }[] = [];
    for (const s of input.selections) {
      const mod = moduleById.get(s.moduleId);
      if (!mod) throw notFound('Módulo');
      if (seen.has(s.moduleId)) throw new AppError(422, 'VALIDATION_FAILED', 'Dados inválidos', `O módulo ${mod.name} foi selecionado mais de uma vez.`);
      seen.add(s.moduleId);
      const { def, template } = await this.templates.publishedDef(tx, actorOrg, s.templateVersionId);
      if (template.archivedAt) throw conflict('TEMPLATE_ARCHIVED', `O template ${template.name} está arquivado.`);
      if (!template.moduleKinds.includes(mod.kind as (typeof template.moduleKinds)[number])) throw new AppError(422, 'TEMPLATE_MISMATCH', 'Template incompatível', `O template ${template.name} não se aplica ao módulo ${mod.name}.`);
      sels.push({ moduleId: s.moduleId, template: def });
    }
    let desired: DesiredNode[];
    try {
      desired = generateWbs(facts, sels);
    } catch (e) {
      if (e instanceof WbsGenerationError) throw new AppError(422, 'GENERATION_FAILED', 'Não foi possível gerar a EAP', 'Revise as regras do template.', e.issues);
      throw e;
    }
    const existing = await tx.wbsNode.findMany({ where: { projectId } });
    const manualLinks = await tx.wbsNodeService.findMany({ where: { projectId, fromTemplate: false }, select: { wbsNodeId: true } });
    const protectedIds = new Set(manualLinks.map((l) => l.wbsNodeId));
    const diff = diffWbs(existing.map(toExisting), desired, { moduleIds: sels.map((s) => s.moduleId), protectedIds });
    const selections = [...input.selections].sort((a, b) => (a.moduleId < b.moduleId ? -1 : 1));
    const factsHash = stableHash(facts);
    const planHash = stableHash({
      factsHash,
      selections,
      create: diff.create.map((d) => d.key),
      update: diff.update.map((u) => [u.id, u.changes]),
      remove: diff.remove.map((r) => r.id),
      obsolete: diff.obsolete.map((o) => o.id),
    });
    return { facts, factsHash, desired, diff, existing, planHash, selections };
  }

  private planDto(p: Plan): WbsPlanDto {
    const titleByKey = new Map(p.desired.map((d) => [d.key, d.title]));
    const depth = new Map<string, number>();
    for (const d of p.desired) depth.set(d.key, d.parentKey ? (depth.get(d.parentKey) ?? 0) + 1 : 0);
    const existingTitle = new Map(p.existing.map((e) => [e.id, e.title]));
    const labels: Record<string, string> = { title: 'título', nodeType: 'tipo', parentKey: 'posição na árvore', position: 'ordem', reactivate: 'reativado', templateVersionId: 'versão do template' };
    return {
      planHash: p.planHash,
      factsHash: p.factsHash,
      totals: {
        desired: p.desired.length,
        create: p.diff.create.length,
        update: p.diff.update.filter((u) => Object.keys(u.changes).some((k) => k !== 'templateVersionId')).length,
        unchanged: p.diff.unchanged,
        remove: p.diff.remove.length,
        obsolete: p.diff.obsolete.length,
        keptArchived: p.diff.keptArchived,
      },
      create: p.diff.create.slice(0, 500).map((d) => ({ key: d.key, title: d.title, parentTitle: d.parentKey ? (titleByKey.get(d.parentKey) ?? null) : null, depth: depth.get(d.key) ?? 0 })),
      update: p.diff.update.filter((u) => Object.keys(u.changes).some((k) => k !== 'templateVersionId')).slice(0, 500)
        .map((u) => ({ id: u.id, title: u.changes.title?.to ?? existingTitle.get(u.id) ?? '', changes: Object.keys(u.changes).filter((k) => k !== 'templateVersionId').map((k) => labels[k] ?? k) })),
      remove: p.diff.remove.slice(0, 500),
      obsolete: p.diff.obsolete.slice(0, 500),
    };
  }

  async preview(organizationId: string, projectId: string, input: WbsSelectionInput): Promise<WbsPlanDto> {
    return this.planDto(await this.plan(this.prisma, organizationId, projectId, input));
  }

  async apply(actor: Actor, projectId: string, input: WbsSelectionInput & { planHash: string }) {
    return this.prisma.$transaction(async (tx) => {
      await assertProjectEditable(tx, actor.organizationId, projectId);
      await lock(tx, projectId);
      const p = await this.plan(tx, actor.organizationId, projectId, input);
      if (p.planHash !== input.planHash) {
        throw conflict('PLAN_CHANGED', 'O cadastro, os templates ou a EAP mudaram desde a prévia. Gere a prévia novamente antes de aplicar.');
      }
      const idByKey = new Map(p.existing.filter((e) => e.generationKey).map((e) => [e.generationKey!, e.id]));
      for (const d of p.diff.create) idByKey.set(d.key, randomUUID());
      const validServices = new Set((await tx.service.findMany({ where: { organizationId: actor.organizationId, projectId: null, archivedAt: null }, select: { id: true } })).map((s) => s.id));

      // inclusões (pais antes dos filhos: a ordem do gerador já garante)
      const rows: Prisma.WbsNodeCreateManyInput[] = p.diff.create.map((d) => {
        const id = idByKey.get(d.key)!;
        return {
          id, organizationId: actor.organizationId, projectId, parentId: d.parentKey ? idByKey.get(d.parentKey)! : null, title: d.title, code: '', depth: 0, position: d.position, path: id,
          nodeType: d.nodeType, origin: 'GENERATED', generationKey: d.key, moduleId: d.moduleId, templateVersionId: d.templateVersionId, templateNodeKey: d.templateNodeKey,
          bindingKind: d.binding.kind, bindingId: d.binding.id,
        };
      });
      for (let i = 0; i < rows.length; i += 2000) await tx.wbsNode.createMany({ data: rows.slice(i, i + 2000) });
      const links = p.diff.create.filter((d) => d.nodeType === 'ITEM').flatMap((d) => d.serviceIds.filter((s) => validServices.has(s)).map((serviceId) => ({ wbsNodeId: idByKey.get(d.key)!, projectId, organizationId: actor.organizationId, serviceId, fromTemplate: true })));
      for (let i = 0; i < links.length; i += 5000) await tx.wbsNodeService.createMany({ data: links.slice(i, i + 5000), skipDuplicates: true });

      // alterações
      for (const u of p.diff.update) {
        const c = u.changes;
        await tx.wbsNode.update({
          where: { id: u.id },
          data: {
            ...(c.title ? { title: c.title.to } : {}),
            ...(c.nodeType ? { nodeType: c.nodeType.to } : {}),
            ...(c.parentKey ? { parentId: c.parentKey.to ? (idByKey.get(c.parentKey.to) ?? null) : null } : {}),
            ...(c.position ? { position: c.position.to } : {}),
            ...(c.reactivate ? { status: 'ACTIVE' } : {}),
            ...(c.templateVersionId ? { templateVersionId: c.templateVersionId.to } : {}),
            version: { increment: 1 },
          },
        });
      }
      // obsoletos (nunca apagados) e remoções (sem dados vinculados)
      if (p.diff.obsolete.length) await tx.wbsNode.updateMany({ where: { projectId, id: { in: p.diff.obsolete.map((o) => o.id) } }, data: { status: 'OBSOLETE', version: { increment: 1 } } });
      if (p.diff.remove.length) {
        const ids = new Set(p.diff.remove.map((r) => r.id));
        const ordered = p.existing.filter((e) => ids.has(e.id)).sort((a, b) => b.depth - a.depth);
        for (let i = 0; i < ordered.length; i += 2000) await tx.wbsNode.deleteMany({ where: { projectId, id: { in: ordered.slice(i, i + 2000).map((e) => e.id) } } });
      }
      await recomputeWbsTree(tx, projectId);
      const resultHash = stableHash(p.desired.map((d) => [d.key, d.title, d.parentKey, d.position]));
      const summary = this.planDto(p).totals;
      const run = await tx.wbsGenerationRun.create({ data: { organizationId: actor.organizationId, projectId, selections: p.selections, factsHash: p.factsHash, resultHash, summary, createdById: actor.userId } });
      await this.audit.record(tx, actor, {
        projectId,
        entityType: 'WbsGenerationRun',
        entityId: run.id,
        action: 'APPLY',
        after: { selections: p.selections, summary, factsHash: p.factsHash, resultHash, removed: p.diff.remove.map((r) => r.title).slice(0, 200), obsolete: p.diff.obsolete.slice(0, 200) },
      });
      return { runId: run.id, summary };
    }, TX);
  }

  // ---------------- edição manual ----------------

  private async node(tx: Tx, projectId: string, id: string) {
    const n = await tx.wbsNode.findFirst({ where: { id, projectId } });
    if (!n) throw notFound('Nó da EAP');
    return n;
  }

  private async parentFor(tx: Tx, projectId: string, parentId: string | null) {
    if (!parentId) return null;
    const p = await this.node(tx, projectId, parentId);
    if (p.archivedAt) throw conflict('NODE_ARCHIVED', 'Não é possível incluir itens sob um nó excluído.');
    if (p.nodeType === 'ITEM') throw new AppError(422, 'INVALID_HIERARCHY', 'Hierarquia inválida', `"${p.title}" é item quantificável e não pode ter subnós.`);
    return p;
  }

  async createNode(actor: Actor, projectId: string, input: { parentId: string | null; title: string; nodeType: 'GROUP' | 'ITEM' }) {
    return this.prisma.$transaction(async (tx) => {
      await assertProjectEditable(tx, actor.organizationId, projectId);
      await lock(tx, projectId);
      await this.parentFor(tx, projectId, input.parentId);
      const last = await tx.wbsNode.aggregate({ where: { projectId, parentId: input.parentId }, _max: { position: true } });
      const id = randomUUID();
      await tx.wbsNode.create({ data: { id, organizationId: actor.organizationId, projectId, parentId: input.parentId, title: input.title, code: '', depth: 0, position: (last._max.position ?? 0) + 1, path: id, nodeType: input.nodeType, origin: 'MANUAL' } });
      await recomputeWbsTree(tx, projectId);
      const n = await tx.wbsNode.findUniqueOrThrow({ where: { id } });
      await this.audit.record(tx, actor, { projectId, entityType: 'WbsNode', entityId: id, action: 'CREATE', after: { title: n.title, code: n.code, nodeType: n.nodeType, parentId: n.parentId } });
      return { id, code: n.code };
    }, TX);
  }

  async updateNode(actor: Actor, projectId: string, id: string, version: number, input: { title?: string; nodeType?: 'GROUP' | 'ITEM' }) {
    return this.prisma.$transaction(async (tx) => {
      await assertProjectEditable(tx, actor.organizationId, projectId);
      const cur = await this.node(tx, projectId, id);
      if (cur.archivedAt) throw conflict('NODE_ARCHIVED', 'Nó excluído não pode ser editado.');
      if (cur.version !== version) throw versionConflict();
      if (input.nodeType === 'ITEM' && cur.nodeType === 'GROUP' && (await tx.wbsNode.count({ where: { parentId: id, archivedAt: null } }))) {
        throw new AppError(422, 'INVALID_HIERARCHY', 'Hierarquia inválida', 'Um agrupador com subnós não pode virar item quantificável.');
      }
      if (input.nodeType === 'GROUP' && cur.nodeType === 'ITEM' && (await tx.wbsNodeService.count({ where: { wbsNodeId: id } }))) {
        throw conflict('HAS_SERVICES', 'Remova os serviços do item antes de transformá-lo em agrupador.');
      }
      const res = await tx.wbsNode.updateMany({
        where: { id, version },
        data: {
          ...(input.title ? { title: input.title, ...(cur.origin === 'GENERATED' && input.title !== cur.title ? { titleOverridden: true } : {}) } : {}),
          ...(input.nodeType ? { nodeType: input.nodeType } : {}),
          version: { increment: 1 },
        },
      });
      if (res.count !== 1) throw versionConflict();
      await this.audit.record(tx, actor, { projectId, entityType: 'WbsNode', entityId: id, action: 'UPDATE', before: { title: cur.title, nodeType: cur.nodeType }, after: input });
    }, TX);
  }

  async moveNode(actor: Actor, projectId: string, id: string, version: number, input: { parentId: string | null; position?: number }) {
    return this.prisma.$transaction(async (tx) => {
      await assertProjectEditable(tx, actor.organizationId, projectId);
      await lock(tx, projectId);
      const cur = await this.node(tx, projectId, id);
      if (cur.archivedAt) throw conflict('NODE_ARCHIVED', 'Nó excluído não pode ser movido.');
      if (cur.version !== version) throw versionConflict();
      const parent = await this.parentFor(tx, projectId, input.parentId);
      if (parent && (parent.id === id || parent.path.startsWith(`${cur.path}/`))) throw new AppError(422, 'INVALID_HIERARCHY', 'Hierarquia inválida', 'Um nó não pode ser movido para dentro de si mesmo.');
      const sibs = await tx.wbsNode.findMany({ where: { projectId, parentId: input.parentId, NOT: { id } }, orderBy: [{ position: 'asc' }, { id: 'asc' }], select: { id: true } });
      const idx = Math.min(Math.max((input.position ?? sibs.length + 1) - 1, 0), sibs.length);
      const ordered = [...sibs.map((s) => s.id)];
      ordered.splice(idx, 0, id);
      // posições temporárias espaçadas preservam a ordem pedida; recomputeWbsTree renumera
      for (const [i, sid] of ordered.entries()) await tx.wbsNode.update({ where: { id: sid }, data: { position: (i + 1) * 10, ...(sid === id ? { parentId: input.parentId, placementOverridden: cur.origin === 'GENERATED' ? true : cur.placementOverridden, version: { increment: 1 } } : {}) } });
      await recomputeWbsTree(tx, projectId);
      const after = await tx.wbsNode.findUniqueOrThrow({ where: { id } });
      await this.audit.record(tx, actor, { projectId, entityType: 'WbsNode', entityId: id, action: 'MOVE', before: { parentId: cur.parentId, code: cur.code }, after: { parentId: after.parentId, code: after.code } });
      return { id, code: after.code };
    }, TX);
  }

  async duplicate(actor: Actor, projectId: string, id: string) {
    return this.prisma.$transaction(async (tx) => {
      await assertProjectEditable(tx, actor.organizationId, projectId);
      await lock(tx, projectId);
      const root = await this.node(tx, projectId, id);
      if (root.archivedAt) throw conflict('NODE_ARCHIVED', 'Nó excluído não pode ser duplicado.');
      const sub = await tx.wbsNode.findMany({ where: { projectId, archivedAt: null, OR: [{ id }, { path: { startsWith: `${root.path}/` } }] }, include: { services: true }, orderBy: { depth: 'asc' } });
      if (sub.length > 5000) throw conflict('TOO_LARGE', 'A duplicação está limitada a 5000 nós.');
      const ids = new Map(sub.map((n) => [n.id, randomUUID()]));
      await tx.wbsNode.createMany({
        data: sub.map((n) => ({
          id: ids.get(n.id)!, organizationId: actor.organizationId, projectId, parentId: n.id === id ? n.parentId : ids.get(n.parentId!)!, title: n.id === id ? `${n.title} (cópia)`.slice(0, 200) : n.title,
          code: '', depth: 0, position: n.id === id ? n.position : n.position, path: ids.get(n.id)!, nodeType: n.nodeType, origin: 'MANUAL',
          bindingKind: n.bindingKind, bindingId: n.bindingId,
        })),
      });
      // a cópia fica logo após o original
      await tx.wbsNode.update({ where: { id: ids.get(id)! }, data: { position: root.position, createdAt: new Date() } });
      await tx.wbsNodeService.createMany({ data: sub.flatMap((n) => n.services.map((s) => ({ wbsNodeId: ids.get(n.id)!, projectId, organizationId: actor.organizationId, serviceId: s.serviceId, fromTemplate: false }))) });
      await recomputeWbsTree(tx, projectId);
      await this.audit.record(tx, actor, { projectId, entityType: 'WbsNode', entityId: ids.get(id)!, action: 'DUPLICATE', after: { sourceId: id, items: sub.length } });
      return { id: ids.get(id)!, items: sub.length };
    }, TX);
  }

  /** Exclusão controlada: arquiva o nó e os subnós (a regeneração não os recria). */
  async setArchived(actor: Actor, projectId: string, id: string, version: number, archived: boolean, reason: string | null) {
    return this.prisma.$transaction(async (tx) => {
      await assertProjectEditable(tx, actor.organizationId, projectId);
      await lock(tx, projectId);
      const cur = await this.node(tx, projectId, id);
      if (cur.version !== version) throw versionConflict();
      if (!!cur.archivedAt === archived) throw conflict('NO_CHANGE', archived ? 'Nó já excluído.' : 'Nó já está ativo.');
      let items: number;
      if (archived) {
        items = await tx.$executeRaw`UPDATE wbs_node SET "archivedAt" = now(), version = version + 1 WHERE "projectId" = ${projectId}::uuid AND "archivedAt" IS NULL AND (id = ${id}::uuid OR path LIKE ${`${cur.path}/%`})`;
      } else {
        if (cur.parentId && (await tx.wbsNode.findUniqueOrThrow({ where: { id: cur.parentId } })).archivedAt) throw conflict('PARENT_ARCHIVED', 'Restaure primeiro o nó superior.');
        items = await tx.$executeRaw`UPDATE wbs_node SET "archivedAt" = NULL, version = version + 1 WHERE "projectId" = ${projectId}::uuid AND "archivedAt" = ${cur.archivedAt} AND (id = ${id}::uuid OR path LIKE ${`${cur.path}/%`})`;
      }
      await recomputeWbsTree(tx, projectId);
      await this.audit.record(tx, actor, { projectId, entityType: 'WbsNode', entityId: id, action: archived ? 'ARCHIVE' : 'UNARCHIVE', before: { title: cur.title, code: cur.code }, after: { items }, reason });
      return { items };
    }, TX);
  }

  async setServices(actor: Actor, projectId: string, id: string, serviceIds: string[]) {
    return this.prisma.$transaction(async (tx) => {
      await assertProjectEditable(tx, actor.organizationId, projectId);
      const n = await this.node(tx, projectId, id);
      if (n.archivedAt) throw conflict('NODE_ARCHIVED', 'Nó excluído.');
      if (n.nodeType !== 'ITEM') throw new AppError(422, 'NOT_ITEM', 'Nó não quantificável', 'Somente itens quantificáveis recebem serviços.');
      const wanted = [...new Set(serviceIds)];
      const ok = await tx.service.findMany({ where: { id: { in: wanted }, organizationId: actor.organizationId, archivedAt: null, OR: [{ projectId: null }, { projectId }] }, select: { id: true } });
      if (ok.length !== wanted.length) throw notFound('Um ou mais serviços');
      const cur = await tx.wbsNodeService.findMany({ where: { wbsNodeId: id } });
      const removed = cur.filter((c) => !wanted.includes(c.serviceId)).map((c) => c.serviceId);
      const added = wanted.filter((w) => !cur.some((c) => c.serviceId === w));
      if (removed.length) await tx.wbsNodeService.deleteMany({ where: { wbsNodeId: id, serviceId: { in: removed } } });
      if (added.length) await tx.wbsNodeService.createMany({ data: added.map((serviceId) => ({ wbsNodeId: id, projectId, organizationId: actor.organizationId, serviceId, fromTemplate: false })) });
      // uma alteração manual nos serviços torna os vínculos do item "do usuário" (protege na regeneração)
      if (removed.length || added.length) await tx.wbsNodeService.updateMany({ where: { wbsNodeId: id }, data: { fromTemplate: false } });
      await this.audit.record(tx, actor, { projectId, entityType: 'WbsNode', entityId: id, action: 'SET_SERVICES', before: { serviceIds: cur.map((c) => c.serviceId) }, after: { serviceIds: wanted } });
      return { serviceIds: wanted };
    }, TX);
  }
}
