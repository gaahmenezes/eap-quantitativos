import { Injectable } from '@nestjs/common';
import type { CreateSheetTemplateInput, SheetDefInput, SheetTemplateDto, UpdateSheetTemplateVersionInput } from '@eapq/contracts';
import { compileSheet, DEFAULT_SHEET_TEMPLATES, type SheetDef } from '@eapq/domain';
import type { Actor } from '../../common/auth/auth-context.js';
import { AppError, conflict, notFound, versionConflict } from '../../common/errors.js';
import { PrismaService, type Tx } from '../../prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { loadUnits } from '../formulas/units.js';

const TX = { timeout: 30_000 } as const;
export const sheetInvalid = (issues: { path: string; message: string }[]) =>
  new AppError(422, 'SHEET_INVALID', 'Ficha inválida', issues.map((i) => i.message).join(' '), issues);

@Injectable()
export class SheetTemplatesService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService) {}

  /** Instala os modelos padrão que a organização ainda não tem (por código; arquivados contam como existentes). */
  async ensureDefaults(tx: Tx, organizationId: string) {
    const have = new Set((await tx.sheetTemplate.findMany({ where: { organizationId }, select: { code: true } })).map((t) => t.code));
    const missing = DEFAULT_SHEET_TEMPLATES.filter((t) => !have.has(t.code));
    if (!missing.length) return;
    // duas requisições simultâneas não instalam o mesmo modelo duas vezes
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`sheet-defaults:${organizationId}`}, 0))`;
    const again = new Set((await tx.sheetTemplate.findMany({ where: { organizationId }, select: { code: true } })).map((t) => t.code));
    if (missing.every((t) => again.has(t.code))) return;
    const units = await loadUnits(tx, organizationId);
    if (!units.length) return;
    for (const t of missing.filter((m) => !again.has(m.code))) {
      if (compileSheet(t.definition, units).issues.length) continue; // unidade padrão removida pela organização
      const row = await tx.sheetTemplate.create({ data: { organizationId, code: t.code, name: t.name, description: t.description } });
      await tx.sheetTemplateVersion.create({ data: { organizationId, templateId: row.id, number: 1, status: 'PUBLISHED', publishedAt: new Date(), definition: t.definition as object, notes: 'Modelo inicial (exemplo editável).' } });
    }
  }

  async list(organizationId: string): Promise<SheetTemplateDto[]> {
    const codes = new Set((await this.prisma.sheetTemplate.findMany({ where: { organizationId }, select: { code: true } })).map((t) => t.code));
    if (DEFAULT_SHEET_TEMPLATES.some((t) => !codes.has(t.code))) await this.prisma.$transaction((tx) => this.ensureDefaults(tx, organizationId), TX);
    const [rows, units, usage] = await Promise.all([
      this.prisma.sheetTemplate.findMany({ where: { organizationId }, orderBy: [{ archivedAt: { sort: 'asc', nulls: 'first' } }, { code: 'asc' }], include: { versions: { orderBy: { number: 'desc' } } } }),
      loadUnits(this.prisma, organizationId),
      this.prisma.sheet.groupBy({ by: ['templateVersionId'], where: { organizationId, archivedAt: null }, _count: { _all: true } }),
    ]);
    const used = new Map(usage.map((u) => [u.templateVersionId, u._count._all]));
    return rows.map((t) => ({
      id: t.id, code: t.code, name: t.name, description: t.description, archivedAt: t.archivedAt?.toISOString() ?? null, version: t.version,
      versions: t.versions.map((v) => ({
        id: v.id, number: v.number, status: v.status, definition: v.definition as unknown as SheetDefInput, notes: v.notes,
        publishedAt: v.publishedAt?.toISOString() ?? null, createdAt: v.createdAt.toISOString(), sheetCount: used.get(v.id) ?? 0,
        issues: v.status === 'DRAFT' ? compileSheet(v.definition as unknown as SheetDef, units).issues : [],
      })),
    }));
  }

  private async template(tx: Tx, organizationId: string, id: string) {
    const t = await tx.sheetTemplate.findFirst({ where: { id, organizationId } });
    if (!t) throw notFound('Modelo de ficha');
    return t;
  }

  private async draft(tx: Tx, organizationId: string, templateId: string, versionId: string) {
    const v = await tx.sheetTemplateVersion.findFirst({ where: { id: versionId, templateId, organizationId } });
    if (!v) throw notFound('Versão do modelo');
    if (v.status !== 'DRAFT') throw conflict('VERSION_PUBLISHED', `A R${v.number} já foi publicada e não pode ser alterada. Crie uma nova versão.`);
    return v;
  }

  async create(actor: Actor, input: CreateSheetTemplateInput) {
    return this.prisma.$transaction(async (tx) => {
      const dup = await tx.sheetTemplate.findUnique({ where: { organizationId_code: { organizationId: actor.organizationId, code: input.code } } });
      if (dup) throw conflict('CODE_IN_USE', `Já existe o modelo de ficha ${input.code}.`);
      const t = await tx.sheetTemplate.create({ data: { organizationId: actor.organizationId, code: input.code, name: input.name, description: input.description ?? null } });
      const v = await tx.sheetTemplateVersion.create({ data: { organizationId: actor.organizationId, templateId: t.id, number: 1, definition: input.definition as object } });
      await this.audit.record(tx, actor, { entityType: 'SheetTemplate', entityId: t.id, action: 'CREATE', after: { code: input.code, name: input.name } });
      return { id: t.id, versionId: v.id };
    });
  }

  async update(actor: Actor, id: string, version: number, input: { name?: string; description?: string | null }) {
    await this.prisma.$transaction(async (tx) => {
      const t = await this.template(tx, actor.organizationId, id);
      const r = await tx.sheetTemplate.updateMany({ where: { id, version }, data: { ...input, version: { increment: 1 } } });
      if (r.count === 0) throw versionConflict();
      await this.audit.record(tx, actor, { entityType: 'SheetTemplate', entityId: id, action: 'UPDATE', before: { name: t.name, description: t.description }, after: input });
    });
  }

  async setArchived(actor: Actor, id: string, version: number, archived: boolean) {
    await this.prisma.$transaction(async (tx) => {
      await this.template(tx, actor.organizationId, id);
      const r = await tx.sheetTemplate.updateMany({ where: { id, version }, data: { archivedAt: archived ? new Date() : null, version: { increment: 1 } } });
      if (r.count === 0) throw versionConflict();
      await this.audit.record(tx, actor, { entityType: 'SheetTemplate', entityId: id, action: archived ? 'ARCHIVE' : 'UNARCHIVE' });
    });
  }

  async newVersion(actor: Actor, templateId: string) {
    return this.prisma.$transaction(async (tx) => {
      const t = await this.template(tx, actor.organizationId, templateId);
      if (t.archivedAt) throw conflict('ARCHIVED', 'Modelo arquivado. Reative-o antes de criar uma versão.');
      const last = await tx.sheetTemplateVersion.findFirst({ where: { templateId }, orderBy: { number: 'desc' } });
      if (last?.status === 'DRAFT') throw conflict('DRAFT_EXISTS', `Já existe a R${last.number} em elaboração.`);
      const v = await tx.sheetTemplateVersion.create({ data: { organizationId: actor.organizationId, templateId, number: (last?.number ?? 0) + 1, definition: (last?.definition ?? { columns: [], params: [], tables: [], outputs: [] }) as object } });
      await this.audit.record(tx, actor, { entityType: 'SheetTemplateVersion', entityId: v.id, action: 'CREATE', after: { templateId, number: v.number } });
      return { id: v.id };
    });
  }

  async updateVersion(actor: Actor, templateId: string, versionId: string, input: UpdateSheetTemplateVersionInput) {
    await this.prisma.$transaction(async (tx) => {
      await this.template(tx, actor.organizationId, templateId);
      const v = await this.draft(tx, actor.organizationId, templateId, versionId);
      await tx.sheetTemplateVersion.update({ where: { id: v.id }, data: { ...(input.definition && { definition: input.definition as object }), ...(input.notes !== undefined && { notes: input.notes }) } });
      await this.audit.record(tx, actor, { entityType: 'SheetTemplateVersion', entityId: v.id, action: 'UPDATE', before: { definition: v.definition }, after: input });
    });
  }

  async discard(actor: Actor, templateId: string, versionId: string) {
    await this.prisma.$transaction(async (tx) => {
      await this.template(tx, actor.organizationId, templateId);
      const v = await this.draft(tx, actor.organizationId, templateId, versionId);
      if (!(await tx.sheetTemplateVersion.count({ where: { templateId, status: 'PUBLISHED' } }))) throw conflict('LAST_VERSION', 'O modelo ainda não tem versão publicada; edite o rascunho ou arquive o modelo.');
      await tx.sheetTemplateVersion.delete({ where: { id: v.id } });
      await this.audit.record(tx, actor, { entityType: 'SheetTemplateVersion', entityId: v.id, action: 'DELETE', before: { number: v.number } });
    });
  }

  async publish(actor: Actor, templateId: string, versionId: string) {
    await this.prisma.$transaction(async (tx) => {
      await this.template(tx, actor.organizationId, templateId);
      const v = await this.draft(tx, actor.organizationId, templateId, versionId);
      const c = compileSheet(v.definition as unknown as SheetDef, await loadUnits(tx, actor.organizationId));
      if (c.issues.length) throw sheetInvalid(c.issues);
      await tx.sheetTemplateVersion.update({ where: { id: v.id }, data: { status: 'PUBLISHED', publishedAt: new Date(), publishedById: actor.userId } });
      await this.audit.record(tx, actor, { entityType: 'SheetTemplateVersion', entityId: v.id, action: 'PUBLISH', after: { number: v.number } });
    }, TX);
  }
}
