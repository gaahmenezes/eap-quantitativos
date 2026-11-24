import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import type {
  CreateTemplateInput,
  CreateTemplateNodeInput,
  TemplateCompareDto,
  TemplateDto,
  TemplateNodeDto,
  TemplateVersionDetailDto,
  UpdateTemplateNodeInput,
} from '@eapq/contracts';
import { DEFAULT_WBS_TEMPLATES, validateTemplate, type ModuleKind, type TemplateDef } from '@eapq/domain';
import type { Actor } from '../../common/auth/auth-context.js';
import { AppError, conflict, notFound, versionConflict } from '../../common/errors.js';
import { PrismaService, type Tx } from '../../prisma/prisma.service.js';
import type { WbsTemplateNode } from '../../generated/prisma/client.js';
import { AuditService } from '../audit/audit.service.js';

const TX = { timeout: 30_000 } as const;

const nodeDto = (n: WbsTemplateNode): TemplateNodeDto => ({
  id: n.id, parentId: n.parentId, stableKey: n.stableKey, title: n.title, nodeType: n.nodeType, condition: n.condition, repeat: n.repeat, position: n.position, serviceIds: n.serviceIds,
});

/** Converte nós persistidos para a definição usada pelo domínio. */
export function toTemplateDef(templateId: string, versionId: string, moduleKinds: string[], nodes: WbsTemplateNode[]): TemplateDef {
  const keyById = new Map(nodes.map((n) => [n.id, n.stableKey]));
  return {
    templateId,
    versionId,
    moduleKinds,
    nodes: nodes.map((n) => ({ key: n.stableKey, parentKey: n.parentId ? keyById.get(n.parentId)! : null, title: n.title, nodeType: n.nodeType, condition: n.condition, repeat: n.repeat, position: n.position, serviceIds: n.serviceIds })),
  };
}

/** Insere nós respeitando a ordem pai → filho (FK composta com a versão). */
async function insertNodes(tx: Tx, versionId: string, nodes: { id: string; parentId: string | null; stableKey: string; title: string; nodeType: 'GROUP' | 'ITEM'; condition: string | null; repeat: WbsTemplateNode['repeat']; position: number; serviceIds: string[] }[]) {
  const placed = new Set<string>();
  const pending = [...nodes];
  while (pending.length) {
    const batch = pending.filter((n) => !n.parentId || placed.has(n.parentId));
    if (!batch.length) throw new Error('Hierarquia de template inconsistente.');
    await tx.wbsTemplateNode.createMany({ data: batch.map((n) => ({ ...n, versionId })) });
    for (const n of batch) { placed.add(n.id); pending.splice(pending.indexOf(n), 1); }
  }
}

@Injectable()
export class WbsTemplatesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** Templates iniciais publicados (R1), com serviços sugeridos resolvidos pelo código da biblioteca. */
  async ensureDefaults(tx: Tx, organizationId: string) {
    if ((await tx.wbsTemplate.count({ where: { organizationId } })) > 0) return;
    const services = await tx.service.findMany({ where: { organizationId, projectId: null, archivedAt: null }, select: { id: true, code: true } });
    const byCode = new Map(services.map((s) => [s.code, s.id]));
    for (const t of DEFAULT_WBS_TEMPLATES) {
      const tpl = await tx.wbsTemplate.create({ data: { organizationId, code: t.code, name: t.name, description: t.description, moduleKinds: t.moduleKinds as ModuleKind[] } });
      const v = await tx.wbsTemplateVersion.create({ data: { organizationId, templateId: tpl.id, number: 1, notes: 'Template inicial (exemplo editável).' } });
      const ids = new Map(t.nodes.map((n) => [n.key, randomUUID()]));
      const pos = new Map<string | null, number>();
      await insertNodes(tx, v.id, t.nodes.map((n) => {
        const p = (pos.get(n.parent) ?? 0) + 1;
        pos.set(n.parent, p);
        return { id: ids.get(n.key)!, parentId: n.parent ? ids.get(n.parent)! : null, stableKey: n.key, title: n.title, nodeType: n.type, condition: n.condition ?? null, repeat: n.repeat ?? null, position: p, serviceIds: (n.services ?? []).map((c) => byCode.get(c)).filter((x): x is string => !!x) };
      }));
      await tx.wbsTemplateVersion.update({ where: { id: v.id }, data: { status: 'PUBLISHED', publishedAt: new Date() } });
    }
  }

  private async ready(organizationId: string) {
    if ((await this.prisma.wbsTemplate.count({ where: { organizationId } })) === 0) {
      await this.prisma.$transaction((tx) => this.ensureDefaults(tx, organizationId), TX);
    }
  }

  async list(organizationId: string): Promise<TemplateDto[]> {
    await this.ready(organizationId);
    const rows = await this.prisma.wbsTemplate.findMany({
      where: { organizationId },
      orderBy: [{ archivedAt: { sort: 'asc', nulls: 'first' } }, { name: 'asc' }],
      include: { versions: { orderBy: { number: 'desc' }, include: { _count: { select: { nodes: true } } } } },
    });
    const usage = await this.prisma.$queryRaw<{ templateVersionId: string; n: bigint }[]>`
      SELECT "templateVersionId", count(DISTINCT "projectId") AS n FROM wbs_node
      WHERE "organizationId" = ${organizationId}::uuid AND "templateVersionId" IS NOT NULL AND "archivedAt" IS NULL GROUP BY "templateVersionId"`;
    const used = new Map(usage.map((u) => [u.templateVersionId, Number(u.n)]));
    return rows.map((t) => ({
      id: t.id, code: t.code, name: t.name, description: t.description, moduleKinds: t.moduleKinds, archivedAt: t.archivedAt?.toISOString() ?? null, version: t.version,
      versions: t.versions.map((v) => ({ id: v.id, number: v.number, status: v.status, notes: v.notes, publishedAt: v.publishedAt?.toISOString() ?? null, createdAt: v.createdAt.toISOString(), nodeCount: v._count.nodes, projectCount: used.get(v.id) ?? 0 })),
    }));
  }

  private async template(tx: Tx, organizationId: string, id: string) {
    const t = await tx.wbsTemplate.findFirst({ where: { id, organizationId } });
    if (!t) throw notFound('Template');
    return t;
  }

  private async draft(tx: Tx, organizationId: string, templateId: string, versionId: string) {
    const v = await tx.wbsTemplateVersion.findFirst({ where: { id: versionId, templateId, organizationId } });
    if (!v) throw notFound('Versão do template');
    if (v.status !== 'DRAFT') throw conflict('VERSION_PUBLISHED', `A R${v.number} já foi publicada e não pode ser alterada. Crie uma nova versão.`);
    return v;
  }

  async getVersion(organizationId: string, templateId: string, versionId: string): Promise<TemplateVersionDetailDto> {
    const t = await this.template(this.prisma, organizationId, templateId);
    const v = await this.prisma.wbsTemplateVersion.findFirst({ where: { id: versionId, templateId }, include: { nodes: { orderBy: [{ position: 'asc' }, { id: 'asc' }] } } });
    if (!v) throw notFound('Versão do template');
    const projects = await this.prisma.wbsNode.findMany({ where: { templateVersionId: v.id, archivedAt: null }, distinct: ['projectId'], select: { projectId: true } });
    const issues = v.status === 'DRAFT' ? await this.issues(this.prisma, organizationId, toTemplateDef(t.id, v.id, t.moduleKinds, v.nodes)) : [];
    return {
      id: v.id, templateId: t.id, number: v.number, status: v.status, notes: v.notes, publishedAt: v.publishedAt?.toISOString() ?? null, createdAt: v.createdAt.toISOString(),
      nodeCount: v.nodes.length, projectCount: projects.length, nodes: v.nodes.map(nodeDto), issues,
    };
  }

  private async issues(tx: Tx, organizationId: string, def: TemplateDef) {
    const out = validateTemplate(def);
    const ids = [...new Set(def.nodes.flatMap((n) => n.serviceIds))];
    if (ids.length) {
      const ok = new Set((await tx.service.findMany({ where: { id: { in: ids }, organizationId, projectId: null, archivedAt: null }, select: { id: true } })).map((s) => s.id));
      for (const n of def.nodes) for (const sid of n.serviceIds) if (!ok.has(sid)) out.push({ path: `nodes.${n.key}.serviceIds`, message: `"${n.title}" sugere um serviço inexistente ou arquivado no catálogo.` });
    }
    for (const n of def.nodes) if (n.serviceIds.length && n.nodeType !== 'ITEM') out.push({ path: `nodes.${n.key}.serviceIds`, message: `"${n.title}" é agrupador; só itens quantificáveis recebem serviços.` });
    return out;
  }

  async create(actor: Actor, input: CreateTemplateInput) {
    return this.prisma.$transaction(async (tx) => {
      const dup = await tx.wbsTemplate.findUnique({ where: { organizationId_code: { organizationId: actor.organizationId, code: input.code } } });
      if (dup) throw conflict('CODE_IN_USE', `Já existe o template ${input.code}.`);
      const t = await tx.wbsTemplate.create({ data: { organizationId: actor.organizationId, code: input.code, name: input.name, description: input.description ?? null, moduleKinds: input.moduleKinds } });
      const v = await tx.wbsTemplateVersion.create({ data: { organizationId: actor.organizationId, templateId: t.id, number: 1 } });
      await tx.wbsTemplateNode.create({ data: { versionId: v.id, stableKey: 'raiz', title: '{modulo.nome}', nodeType: 'GROUP', position: 1, serviceIds: [] } });
      await this.audit.record(tx, actor, { entityType: 'WbsTemplate', entityId: t.id, action: 'CREATE', after: input });
      return { id: t.id, versionId: v.id };
    }, TX);
  }

  async update(actor: Actor, id: string, version: number, input: Partial<Omit<CreateTemplateInput, 'code'>>) {
    return this.prisma.$transaction(async (tx) => {
      const cur = await this.template(tx, actor.organizationId, id);
      const res = await tx.wbsTemplate.updateMany({ where: { id, version }, data: { ...input, version: { increment: 1 } } });
      if (res.count !== 1) throw versionConflict();
      await this.audit.record(tx, actor, { entityType: 'WbsTemplate', entityId: id, action: 'UPDATE', before: { name: cur.name, description: cur.description, moduleKinds: cur.moduleKinds }, after: input });
    });
  }

  async setArchived(actor: Actor, id: string, version: number, archived: boolean) {
    return this.prisma.$transaction(async (tx) => {
      await this.template(tx, actor.organizationId, id);
      const res = await tx.wbsTemplate.updateMany({ where: { id, version }, data: { archivedAt: archived ? new Date() : null, version: { increment: 1 } } });
      if (res.count !== 1) throw versionConflict();
      await this.audit.record(tx, actor, { entityType: 'WbsTemplate', entityId: id, action: archived ? 'ARCHIVE' : 'UNARCHIVE' });
    });
  }

  async createDraft(actor: Actor, templateId: string) {
    return this.prisma.$transaction(async (tx) => {
      const t = await this.template(tx, actor.organizationId, templateId);
      if (t.archivedAt) throw conflict('TEMPLATE_ARCHIVED', 'Template arquivado.');
      const existing = await tx.wbsTemplateVersion.findFirst({ where: { templateId, status: 'DRAFT' } });
      if (existing) throw conflict('DRAFT_EXISTS', `Já existe a R${existing.number} em elaboração.`);
      const last = await tx.wbsTemplateVersion.aggregate({ where: { templateId }, _max: { number: true } });
      const base = await tx.wbsTemplateVersion.findFirst({ where: { templateId, status: 'PUBLISHED' }, orderBy: { number: 'desc' }, include: { nodes: true } });
      const v = await tx.wbsTemplateVersion.create({ data: { organizationId: actor.organizationId, templateId, number: (last._max.number ?? 0) + 1 } });
      if (base) {
        const ids = new Map(base.nodes.map((n) => [n.id, randomUUID()]));
        await insertNodes(tx, v.id, base.nodes.map((n) => ({ id: ids.get(n.id)!, parentId: n.parentId ? ids.get(n.parentId)! : null, stableKey: n.stableKey, title: n.title, nodeType: n.nodeType, condition: n.condition, repeat: n.repeat, position: n.position, serviceIds: n.serviceIds })));
      }
      await this.audit.record(tx, actor, { entityType: 'WbsTemplateVersion', entityId: v.id, action: 'CREATE', after: { template: t.code, number: v.number, basedOn: base?.number ?? null } });
      return { id: v.id, number: v.number };
    }, TX);
  }

  async discardDraft(actor: Actor, templateId: string, versionId: string) {
    return this.prisma.$transaction(async (tx) => {
      const v = await this.draft(tx, actor.organizationId, templateId, versionId);
      const published = await tx.wbsTemplateVersion.count({ where: { templateId, status: 'PUBLISHED' } });
      if (published === 0) throw conflict('LAST_VERSION', 'A primeira versão de um template não pode ser descartada; arquive o template se não for usá-lo.');
      await tx.wbsTemplateVersion.delete({ where: { id: v.id } });
      await this.audit.record(tx, actor, { entityType: 'WbsTemplateVersion', entityId: v.id, action: 'DISCARD', before: { number: v.number } });
    }, TX);
  }

  async publish(actor: Actor, templateId: string, versionId: string, notes?: string) {
    return this.prisma.$transaction(async (tx) => {
      const t = await this.template(tx, actor.organizationId, templateId);
      const v = await this.draft(tx, actor.organizationId, templateId, versionId);
      const nodes = await tx.wbsTemplateNode.findMany({ where: { versionId } });
      const issues = await this.issues(tx, actor.organizationId, toTemplateDef(t.id, v.id, t.moduleKinds, nodes));
      if (issues.length) throw new AppError(422, 'TEMPLATE_INVALID', 'Template com problemas', 'Corrija os problemas apontados antes de publicar.', issues);
      await tx.wbsTemplateVersion.update({ where: { id: v.id }, data: { status: 'PUBLISHED', publishedAt: new Date(), publishedById: actor.userId, notes: notes ?? v.notes } });
      await this.audit.record(tx, actor, { entityType: 'WbsTemplateVersion', entityId: v.id, action: 'PUBLISH', after: { template: t.code, number: v.number, nodes: nodes.length }, reason: notes ?? null });
      return { id: v.id, number: v.number };
    }, TX);
  }

  // ---------------- nós do rascunho ----------------

  private async checkParent(tx: Tx, versionId: string, parentId: string | null | undefined) {
    if (!parentId) return null;
    const p = await tx.wbsTemplateNode.findFirst({ where: { id: parentId, versionId } });
    if (!p) throw notFound('Nó superior');
    if (p.nodeType === 'ITEM') throw new AppError(422, 'INVALID_HIERARCHY', 'Hierarquia inválida', `"${p.title}" é item quantificável e não pode ter subnós.`);
    return p;
  }

  async addNode(actor: Actor, templateId: string, versionId: string, input: CreateTemplateNodeInput) {
    return this.prisma.$transaction(async (tx) => {
      await this.draft(tx, actor.organizationId, templateId, versionId);
      await this.checkParent(tx, versionId, input.parentId);
      const last = await tx.wbsTemplateNode.aggregate({ where: { versionId, parentId: input.parentId ?? null }, _max: { position: true } });
      const n = await tx.wbsTemplateNode.create({
        data: { versionId, parentId: input.parentId ?? null, stableKey: randomUUID().slice(0, 13), title: input.title, nodeType: input.nodeType, condition: input.condition ?? null, repeat: input.repeat ?? null, position: (last._max.position ?? 0) + 1, serviceIds: input.serviceIds },
      });
      await this.audit.record(tx, actor, { entityType: 'WbsTemplateNode', entityId: n.id, action: 'CREATE', after: nodeDto(n) });
      return nodeDto(n);
    });
  }

  async updateNode(actor: Actor, templateId: string, versionId: string, nodeId: string, input: UpdateTemplateNodeInput) {
    return this.prisma.$transaction(async (tx) => {
      await this.draft(tx, actor.organizationId, templateId, versionId);
      const cur = await tx.wbsTemplateNode.findFirst({ where: { id: nodeId, versionId } });
      if (!cur) throw notFound('Nó do template');
      if (input.nodeType === 'ITEM' && cur.nodeType !== 'ITEM' && (await tx.wbsTemplateNode.count({ where: { parentId: nodeId } }))) {
        throw new AppError(422, 'INVALID_HIERARCHY', 'Hierarquia inválida', 'Um nó com subnós não pode virar item quantificável.');
      }
      const n = await tx.wbsTemplateNode.update({ where: { id: nodeId }, data: { ...input, condition: input.condition === undefined ? undefined : input.condition } });
      await this.audit.record(tx, actor, { entityType: 'WbsTemplateNode', entityId: n.id, action: 'UPDATE', before: nodeDto(cur), after: nodeDto(n) });
      return nodeDto(n);
    });
  }

  async removeNode(actor: Actor, templateId: string, versionId: string, nodeId: string) {
    return this.prisma.$transaction(async (tx) => {
      await this.draft(tx, actor.organizationId, templateId, versionId);
      const cur = await tx.wbsTemplateNode.findFirst({ where: { id: nodeId, versionId } });
      if (!cur) throw notFound('Nó do template');
      await tx.wbsTemplateNode.delete({ where: { id: nodeId } });
      await this.audit.record(tx, actor, { entityType: 'WbsTemplateNode', entityId: nodeId, action: 'REMOVE', before: nodeDto(cur) });
    });
  }

  async moveNode(actor: Actor, templateId: string, versionId: string, nodeId: string, input: { parentId: string | null; position?: number }) {
    return this.prisma.$transaction(async (tx) => {
      await this.draft(tx, actor.organizationId, templateId, versionId);
      const all = await tx.wbsTemplateNode.findMany({ where: { versionId } });
      const cur = all.find((n) => n.id === nodeId);
      if (!cur) throw notFound('Nó do template');
      await this.checkParent(tx, versionId, input.parentId);
      let p = input.parentId;
      while (p) {
        if (p === nodeId) throw new AppError(422, 'INVALID_HIERARCHY', 'Hierarquia inválida', 'Um nó não pode ficar dentro de si mesmo.');
        p = all.find((n) => n.id === p)?.parentId ?? null;
      }
      const sibs = all.filter((n) => n.parentId === input.parentId && n.id !== nodeId).sort((a, b) => a.position - b.position);
      const idx = Math.min(Math.max((input.position ?? sibs.length + 1) - 1, 0), sibs.length);
      sibs.splice(idx, 0, cur);
      await tx.wbsTemplateNode.update({ where: { id: nodeId }, data: { parentId: input.parentId } });
      for (const [i, s] of sibs.entries()) if (s.position !== i + 1 || s.id === nodeId) await tx.wbsTemplateNode.update({ where: { id: s.id }, data: { position: i + 1 } });
      if (cur.parentId !== input.parentId) {
        const old = all.filter((n) => n.parentId === cur.parentId && n.id !== nodeId).sort((a, b) => a.position - b.position);
        for (const [i, s] of old.entries()) if (s.position !== i + 1) await tx.wbsTemplateNode.update({ where: { id: s.id }, data: { position: i + 1 } });
      }
      await this.audit.record(tx, actor, { entityType: 'WbsTemplateNode', entityId: nodeId, action: 'MOVE', before: { parentId: cur.parentId, position: cur.position }, after: { parentId: input.parentId, position: idx + 1 } });
    });
  }

  async compare(organizationId: string, templateId: string, fromId: string, toId: string): Promise<TemplateCompareDto> {
    await this.template(this.prisma, organizationId, templateId);
    const [a, b] = await Promise.all([fromId, toId].map((id) => this.prisma.wbsTemplateVersion.findFirst({ where: { id, templateId }, include: { nodes: true } })));
    if (!a || !b) throw notFound('Versão do template');
    const key = (nodes: WbsTemplateNode[]) => { const k = new Map(nodes.map((n) => [n.id, n.stableKey])); return new Map(nodes.map((n) => [n.stableKey, { ...n, parentKey: n.parentId ? k.get(n.parentId) : null }])); };
    const A = key(a.nodes);
    const B = key(b.nodes);
    const fields = ['title', 'nodeType', 'condition', 'repeat', 'parentKey', 'position', 'serviceIds'] as const;
    return {
      added: [...B.values()].filter((n) => !A.has(n.stableKey)).map((n) => ({ stableKey: n.stableKey, title: n.title })),
      removed: [...A.values()].filter((n) => !B.has(n.stableKey)).map((n) => ({ stableKey: n.stableKey, title: n.title })),
      changed: [...B.values()].filter((n) => A.has(n.stableKey)).map((n) => {
        const o = A.get(n.stableKey)!;
        return { stableKey: n.stableKey, title: n.title, fields: fields.filter((f) => JSON.stringify(o[f]) !== JSON.stringify(n[f])) };
      }).filter((c) => c.fields.length > 0),
    };
  }

  /** Definição de uma versão PUBLICADA para geração. */
  async publishedDef(tx: Tx, organizationId: string, versionId: string) {
    const v = await tx.wbsTemplateVersion.findFirst({ where: { id: versionId, organizationId }, include: { template: true, nodes: true } });
    if (!v) throw notFound('Versão do template');
    if (v.status !== 'PUBLISHED') throw conflict('VERSION_NOT_PUBLISHED', `A R${v.number} de ${v.template.name} ainda não foi publicada.`);
    return { def: toTemplateDef(v.templateId, v.id, v.template.moduleKinds, v.nodes), template: v.template, number: v.number };
  }
}
