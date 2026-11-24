import { Injectable } from '@nestjs/common';
import type {
  CategoryDto,
  CreateUnitInput,
  ListServicesQuery,
  ServiceDto,
  ServiceInput,
  ServiceSaveResult,
  SimilarServiceDto,
  UnitDto,
  UpdateServiceInput,
} from '@eapq/contracts';
import {
  convert,
  DEFAULT_SERVICE_CATEGORIES,
  DEFAULT_SERVICES,
  DEFAULT_UNITS,
  describeDimension,
  normalizeDescription,
  UnitConversionError,
  validateUnit,
} from '@eapq/domain';
import type { Actor } from '../../common/auth/auth-context.js';
import { AppError, conflict, notFound, versionConflict } from '../../common/errors.js';
import { assertProjectEditable } from '../../common/project-guard.js';
import { PrismaService, type Tx } from '../../prisma/prisma.service.js';
import { Prisma, type ServiceCategory, type UnitOfMeasure } from '../../generated/prisma/client.js';
import { AuditService } from '../audit/audit.service.js';

const SIMILARITY_MIN = 0.45;

const dimOf = (u: UnitOfMeasure) => ({ L: u.dimL, M: u.dimM, T: u.dimT, N: u.dimN });
const unitDto = (u: UnitOfMeasure, serviceCount = 0): UnitDto => ({
  id: u.id,
  symbol: u.symbol,
  name: u.name,
  dimension: dimOf(u),
  quantity: describeDimension(dimOf(u)),
  factor: u.factor.toString(),
  decimals: u.decimals,
  system: u.system,
  archivedAt: u.archivedAt?.toISOString() ?? null,
  version: u.version,
  serviceCount,
});

type ServiceRow = Prisma.ServiceGetPayload<{ include: { unit: true; derivedFrom: { select: { id: true; code: true } } } }>;
const serviceDto = (s: ServiceRow): ServiceDto => ({
  id: s.id,
  projectId: s.projectId,
  code: s.code,
  description: s.description,
  categoryId: s.categoryId,
  unitId: s.unitId,
  unitSymbol: s.unit.symbol,
  measurementCriterion: s.measurementCriterion,
  technicalDescription: s.technicalDescription,
  origin: s.origin,
  derivedFrom: s.derivedFrom,
  archivedAt: s.archivedAt?.toISOString() ?? null,
  version: s.version,
  createdAt: s.createdAt.toISOString(),
  updatedAt: s.updatedAt.toISOString(),
});
const auditView = (s: ServiceRow) => ({ code: s.code, description: s.description, categoryId: s.categoryId, unit: s.unit.symbol, measurementCriterion: s.measurementCriterion, technicalDescription: s.technicalDescription });
const include = { unit: true, derivedFrom: { select: { id: true, code: true } } } as const;

@Injectable()
export class LibraryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // ---------------- catálogo inicial ----------------

  async ensureUnits(tx: Tx, organizationId: string) {
    if ((await tx.unitOfMeasure.count({ where: { organizationId } })) > 0) return;
    await tx.unitOfMeasure.createMany({
      data: DEFAULT_UNITS.map((u) => ({
        organizationId, symbol: u.symbol, name: u.name, dimL: u.dimension.L, dimM: u.dimension.M, dimT: u.dimension.T, dimN: u.dimension.N,
        factor: new Prisma.Decimal(u.factor), decimals: u.decimals, system: true,
      })),
    });
  }

  async ensureLibrary(tx: Tx, organizationId: string) {
    await this.ensureUnits(tx, organizationId);
    if ((await tx.serviceCategory.count({ where: { organizationId } })) > 0) return;
    const catIds = new Map<string, string>();
    let pos = 0;
    for (const c of DEFAULT_SERVICE_CATEGORIES) {
      const row = await tx.serviceCategory.create({ data: { organizationId, code: c.code, name: c.name, parentId: c.parentCode ? catIds.get(c.parentCode)! : null, position: ++pos } });
      catIds.set(c.code, row.id);
    }
    const units = new Map((await tx.unitOfMeasure.findMany({ where: { organizationId } })).map((u) => [u.symbol, u.id]));
    await tx.service.createMany({
      data: DEFAULT_SERVICES.map((s) => ({
        organizationId, code: s.code, description: s.description, normalizedDescription: normalizeDescription(s.description),
        categoryId: catIds.get(s.categoryCode)!, unitId: units.get(s.unit)!, measurementCriterion: s.criterion, origin: 'CATALOG' as const,
      })),
    });
  }

  private async ready(organizationId: string) {
    const [u, c] = await Promise.all([this.prisma.unitOfMeasure.count({ where: { organizationId } }), this.prisma.serviceCategory.count({ where: { organizationId } })]);
    if (u === 0 || c === 0) await this.prisma.$transaction((tx) => this.ensureLibrary(tx, organizationId), { timeout: 30_000 });
  }

  // ---------------- unidades ----------------

  async listUnits(organizationId: string): Promise<UnitDto[]> {
    await this.ready(organizationId);
    const [rows, counts] = await Promise.all([
      this.prisma.unitOfMeasure.findMany({ where: { organizationId }, orderBy: [{ archivedAt: { sort: 'asc', nulls: 'first' } }, { dimN: 'asc' }, { dimT: 'asc' }, { dimM: 'asc' }, { dimL: 'asc' }, { factor: 'asc' }] }),
      this.prisma.service.groupBy({ by: ['unitId'], where: { organizationId, archivedAt: null }, _count: true }),
    ]);
    const n = new Map(counts.map((c) => [c.unitId, c._count]));
    return rows.map((u) => unitDto(u, n.get(u.id) ?? 0));
  }

  async createUnit(actor: Actor, input: CreateUnitInput): Promise<UnitDto> {
    const issues = validateUnit(input);
    if (issues.length) throw new AppError(422, 'VALIDATION_FAILED', 'Dados inválidos', issues.join(' '));
    return this.prisma.$transaction(async (tx) => {
      await this.ensureUnits(tx, actor.organizationId);
      const dup = await tx.unitOfMeasure.findUnique({ where: { organizationId_symbol: { organizationId: actor.organizationId, symbol: input.symbol } } });
      if (dup) throw conflict('UNIT_EXISTS', `Já existe a unidade ${input.symbol}.`);
      const u = await tx.unitOfMeasure.create({
        data: { organizationId: actor.organizationId, symbol: input.symbol, name: input.name, dimL: input.dimension.L, dimM: input.dimension.M, dimT: input.dimension.T, dimN: input.dimension.N, factor: new Prisma.Decimal(input.factor), decimals: input.decimals },
      });
      await this.audit.record(tx, actor, { entityType: 'UnitOfMeasure', entityId: u.id, action: 'CREATE', after: unitDto(u) });
      return unitDto(u);
    });
  }

  async updateUnit(actor: Actor, id: string, version: number, input: { name?: string; decimals?: number }) {
    return this.prisma.$transaction(async (tx) => {
      const cur = await tx.unitOfMeasure.findFirst({ where: { id, organizationId: actor.organizationId } });
      if (!cur) throw notFound('Unidade');
      const res = await tx.unitOfMeasure.updateMany({ where: { id, version }, data: { ...input, version: { increment: 1 } } });
      if (res.count !== 1) throw versionConflict();
      await this.audit.record(tx, actor, { entityType: 'UnitOfMeasure', entityId: id, action: 'UPDATE', before: { name: cur.name, decimals: cur.decimals }, after: input });
    });
  }

  async setUnitArchived(actor: Actor, id: string, version: number, archived: boolean) {
    return this.prisma.$transaction(async (tx) => {
      const cur = await tx.unitOfMeasure.findFirst({ where: { id, organizationId: actor.organizationId } });
      if (!cur) throw notFound('Unidade');
      if (archived) {
        const used = await tx.service.count({ where: { unitId: id, archivedAt: null } });
        if (used) throw conflict('UNIT_IN_USE', `A unidade ${cur.symbol} é usada por ${used} serviço(s) ativo(s).`);
        const attrs = await tx.elementAttributeDefinition.count({ where: { unit: cur.symbol, elementType: { organizationId: actor.organizationId, archivedAt: null } } });
        if (attrs) throw conflict('UNIT_IN_USE', `A unidade ${cur.symbol} é usada por ${attrs} atributo(s) do catálogo técnico.`);
      }
      const res = await tx.unitOfMeasure.updateMany({ where: { id, version }, data: { archivedAt: archived ? new Date() : null, version: { increment: 1 } } });
      if (res.count !== 1) throw versionConflict();
      await this.audit.record(tx, actor, { entityType: 'UnitOfMeasure', entityId: id, action: archived ? 'ARCHIVE' : 'UNARCHIVE' });
    });
  }

  async convertValue(organizationId: string, value: string, fromId: string, toId: string) {
    const [from, to] = await Promise.all([
      this.prisma.unitOfMeasure.findFirst({ where: { id: fromId, organizationId } }),
      this.prisma.unitOfMeasure.findFirst({ where: { id: toId, organizationId } }),
    ]);
    if (!from || !to) throw notFound('Unidade');
    try {
      const result = convert(value, { symbol: from.symbol, dimension: dimOf(from), factor: from.factor.toString() }, { symbol: to.symbol, dimension: dimOf(to), factor: to.factor.toString() });
      return { value, from: from.symbol, to: to.symbol, result };
    } catch (e) {
      if (e instanceof UnitConversionError) throw new AppError(422, 'INCOMPATIBLE_UNITS', 'Unidades incompatíveis', e.message);
      throw e;
    }
  }

  /** Símbolos aceitos em atributos numéricos do catálogo técnico. */
  async assertUnitSymbols(tx: Tx, organizationId: string, symbols: string[]) {
    const wanted = [...new Set(symbols.filter(Boolean))];
    if (!wanted.length) return;
    await this.ensureUnits(tx, organizationId);
    const found = await tx.unitOfMeasure.findMany({ where: { organizationId, symbol: { in: wanted }, archivedAt: null }, select: { symbol: true } });
    const missing = wanted.filter((s) => !found.some((f) => f.symbol === s));
    if (missing.length) throw new AppError(422, 'UNKNOWN_UNIT', 'Unidade inexistente', `Cadastre antes a(s) unidade(s): ${missing.join(', ')}.`);
  }

  // ---------------- categorias ----------------

  async listCategories(organizationId: string): Promise<CategoryDto[]> {
    await this.ready(organizationId);
    const [rows, counts] = await Promise.all([
      this.prisma.serviceCategory.findMany({ where: { organizationId }, orderBy: [{ position: 'asc' }, { id: 'asc' }] }),
      this.prisma.service.groupBy({ by: ['categoryId'], where: { organizationId, projectId: null, archivedAt: null }, _count: true }),
    ]);
    const n = new Map(counts.map((c) => [c.categoryId, c._count]));
    return rows.map((c: ServiceCategory) => ({ id: c.id, parentId: c.parentId, code: c.code, name: c.name, position: c.position, archivedAt: c.archivedAt?.toISOString() ?? null, version: c.version, serviceCount: n.get(c.id) ?? 0 }));
  }

  private async activeCategory(tx: Tx, organizationId: string, id: string) {
    const c = await tx.serviceCategory.findFirst({ where: { id, organizationId } });
    if (!c) throw notFound('Categoria');
    if (c.archivedAt) throw conflict('CATEGORY_ARCHIVED', `A categoria ${c.name} está arquivada.`);
    return c;
  }

  async createCategory(actor: Actor, input: { code: string; name: string; parentId?: string | null }) {
    return this.prisma.$transaction(async (tx) => {
      if (input.parentId) await this.activeCategory(tx, actor.organizationId, input.parentId);
      const dup = await tx.serviceCategory.findUnique({ where: { organizationId_code: { organizationId: actor.organizationId, code: input.code } } });
      if (dup) throw conflict('CODE_IN_USE', `Já existe a categoria ${input.code}.`);
      const last = await tx.serviceCategory.aggregate({ where: { organizationId: actor.organizationId }, _max: { position: true } });
      const c = await tx.serviceCategory.create({ data: { organizationId: actor.organizationId, code: input.code, name: input.name, parentId: input.parentId ?? null, position: (last._max.position ?? 0) + 1 } });
      await this.audit.record(tx, actor, { entityType: 'ServiceCategory', entityId: c.id, action: 'CREATE', after: input });
      return { id: c.id };
    });
  }

  async updateCategory(actor: Actor, id: string, version: number, input: { name?: string; parentId?: string | null }) {
    return this.prisma.$transaction(async (tx) => {
      const cur = await this.activeCategory(tx, actor.organizationId, id);
      if (input.parentId) {
        // impede ciclos: o novo pai não pode estar abaixo desta categoria
        let p: string | null = input.parentId;
        while (p) {
          if (p === id) throw new AppError(422, 'INVALID_HIERARCHY', 'Hierarquia inválida', 'Uma categoria não pode ficar dentro de si mesma.');
          p = (await this.activeCategory(tx, actor.organizationId, p)).parentId;
        }
      }
      const res = await tx.serviceCategory.updateMany({ where: { id, version }, data: { ...input, version: { increment: 1 } } });
      if (res.count !== 1) throw versionConflict();
      await this.audit.record(tx, actor, { entityType: 'ServiceCategory', entityId: id, action: 'UPDATE', before: { name: cur.name, parentId: cur.parentId }, after: input });
    });
  }

  async archiveCategory(actor: Actor, id: string, version: number) {
    return this.prisma.$transaction(async (tx) => {
      await this.activeCategory(tx, actor.organizationId, id);
      const [children, services] = await Promise.all([
        tx.serviceCategory.count({ where: { parentId: id, archivedAt: null } }),
        tx.service.count({ where: { categoryId: id, archivedAt: null } }),
      ]);
      if (children || services) throw conflict('CATEGORY_IN_USE', `A categoria tem ${children} subcategoria(s) e ${services} serviço(s) ativos.`);
      const res = await tx.serviceCategory.updateMany({ where: { id, version }, data: { archivedAt: new Date(), version: { increment: 1 } } });
      if (res.count !== 1) throw versionConflict();
      await this.audit.record(tx, actor, { entityType: 'ServiceCategory', entityId: id, action: 'ARCHIVE' });
    });
  }

  // ---------------- serviços ----------------

  async list(organizationId: string, projectId: string | null, q: ListServicesQuery) {
    await this.ready(organizationId);
    const scope: Prisma.ServiceWhereInput =
      projectId === null ? { projectId: null }
      : q.scope === 'CATALOG' ? { projectId: null }
      : q.scope === 'PROJECT' ? { projectId }
      : { OR: [{ projectId: null }, { projectId }] };
    const term = q.q ? normalizeDescription(q.q) : '';
    let categoryIds: string[] | undefined;
    if (q.categoryId) {
      // inclui subcategorias
      const all = await this.prisma.serviceCategory.findMany({ where: { organizationId }, select: { id: true, parentId: true } });
      const ids = new Set([q.categoryId]);
      let grew = true;
      while (grew) { grew = false; for (const c of all) if (c.parentId && ids.has(c.parentId) && !ids.has(c.id)) { ids.add(c.id); grew = true; } }
      categoryIds = [...ids];
    }
    const where: Prisma.ServiceWhereInput = {
      organizationId,
      AND: [
        scope,
        q.status === 'ALL' ? {} : q.status === 'ACTIVE' ? { archivedAt: null } : { archivedAt: { not: null } },
        categoryIds ? { categoryId: { in: categoryIds } } : {},
        q.unitId ? { unitId: q.unitId } : {},
        term ? { OR: [{ code: { contains: q.q!, mode: 'insensitive' } }, { normalizedDescription: { contains: term } }] } : {},
      ],
    };
    const [total, rows] = await Promise.all([
      this.prisma.service.count({ where }),
      this.prisma.service.findMany({ where, include, orderBy: [{ projectId: { sort: 'desc', nulls: 'last' } }, { code: 'asc' }], skip: q.offset, take: q.limit }),
    ]);
    return { total, items: rows.map(serviceDto) };
  }

  async get(organizationId: string, projectId: string | null, id: string): Promise<ServiceDto> {
    const s = await this.prisma.service.findFirst({ where: { id, organizationId, ...(projectId ? { OR: [{ projectId: null }, { projectId }] } : { projectId: null }) }, include });
    if (!s) throw notFound('Serviço');
    return serviceDto(s);
  }

  async similar(organizationId: string, projectId: string | null, description: string, excludeId?: string | null): Promise<SimilarServiceDto[]> {
    const norm = normalizeDescription(description);
    if (norm.length < 3) return [];
    const rows = await this.prisma.$queryRaw<{ id: string; code: string; description: string; symbol: string; projectId: string | null; sim: number }[]>`
      SELECT s.id, s.code, s.description, u.symbol, s."projectId", similarity(s."normalizedDescription", ${norm}) AS sim
      FROM service s JOIN unit_of_measure u ON u.id = s."unitId"
      WHERE s."organizationId" = ${organizationId}::uuid
        AND s."archivedAt" IS NULL
        AND (s."projectId" IS NULL OR s."projectId" = ${projectId}::uuid)
        AND (${excludeId ?? null}::uuid IS NULL OR s.id <> ${excludeId ?? null}::uuid)
        AND similarity(s."normalizedDescription", ${norm}) >= ${SIMILARITY_MIN}
      ORDER BY sim DESC, s.code ASC
      LIMIT 5`;
    return rows.map((r) => ({ id: r.id, code: r.code, description: r.description, unitSymbol: r.symbol, projectId: r.projectId, similarity: Math.round(Number(r.sim) * 100) / 100 }));
  }

  private async checkRefs(tx: Tx, organizationId: string, categoryId?: string, unitId?: string) {
    if (categoryId) await this.activeCategory(tx, organizationId, categoryId);
    if (unitId) {
      const u = await tx.unitOfMeasure.findFirst({ where: { id: unitId, organizationId } });
      if (!u) throw notFound('Unidade');
      if (u.archivedAt) throw conflict('UNIT_ARCHIVED', `A unidade ${u.symbol} está arquivada.`);
    }
  }

  /** Código único no catálogo; no empreendimento, único e diferente dos códigos do catálogo (evita ambiguidade). */
  private async checkCode(tx: Tx, organizationId: string, projectId: string | null, code: string, excludeId?: string) {
    const clash = await tx.service.findFirst({
      where: { organizationId, code, ...(excludeId ? { NOT: { id: excludeId } } : {}), OR: projectId ? [{ projectId: null }, { projectId }] : [{ projectId: null }] },
      select: { projectId: true },
    });
    if (clash) {
      throw conflict('SERVICE_CODE_IN_USE', clash.projectId ? `Já existe o serviço ${code} neste empreendimento.` : `O código ${code} já existe no catálogo da organização.`);
    }
  }

  async create(actor: Actor, projectId: string | null, input: ServiceInput, origin: 'CATALOG' | 'PROJECT' = projectId ? 'PROJECT' : 'CATALOG', derivedFromId: string | null = null): Promise<ServiceSaveResult> {
    const s = await this.prisma.$transaction(async (tx) => {
      if (projectId) await assertProjectEditable(tx, actor.organizationId, projectId);
      await this.checkRefs(tx, actor.organizationId, input.categoryId, input.unitId);
      await this.checkCode(tx, actor.organizationId, projectId, input.code);
      const s = await tx.service.create({
        data: {
          organizationId: actor.organizationId,
          projectId,
          code: input.code,
          description: input.description,
          normalizedDescription: normalizeDescription(input.description),
          categoryId: input.categoryId,
          unitId: input.unitId,
          measurementCriterion: input.measurementCriterion ?? null,
          technicalDescription: input.technicalDescription ?? null,
          origin: derivedFromId ? 'DUPLICATE' : origin,
          derivedFromId,
        },
        include,
      });
      await this.audit.record(tx, actor, { projectId, entityType: 'Service', entityId: s.id, action: derivedFromId ? 'DUPLICATE' : 'CREATE', after: { ...auditView(s), derivedFromId } });
      return s;
    });
    return { service: serviceDto(s), similar: await this.similar(actor.organizationId, projectId, s.description, s.id) };
  }

  async update(actor: Actor, projectId: string | null, id: string, version: number, input: UpdateServiceInput): Promise<ServiceSaveResult> {
    const { reason, ...fields } = input;
    const s = await this.prisma.$transaction(async (tx) => {
      if (projectId) await assertProjectEditable(tx, actor.organizationId, projectId);
      const cur = await tx.service.findFirst({ where: { id, organizationId: actor.organizationId, projectId }, include });
      if (!cur) throw notFound('Serviço');
      if (cur.archivedAt) throw conflict('SERVICE_ARCHIVED', 'Serviço arquivado não pode ser editado.');
      if (cur.version !== version) throw versionConflict();
      await this.checkRefs(tx, actor.organizationId, fields.categoryId, fields.unitId);
      if (fields.code && fields.code !== cur.code) await this.checkCode(tx, actor.organizationId, projectId, fields.code, id);
      if (fields.unitId && fields.unitId !== cur.unitId) {
        // Com medições, só unidade da mesma grandeza (a consolidação converte); outra grandeza invalidaria os quantitativos.
        const [from, to] = await Promise.all([tx.unitOfMeasure.findUniqueOrThrow({ where: { id: cur.unitId } }), tx.unitOfMeasure.findUniqueOrThrow({ where: { id: fields.unitId } })]);
        const same = from.dimL === to.dimL && from.dimM === to.dimM && from.dimT === to.dimT;
        if (!same && (await tx.measurement.count({ where: { serviceId: id } }))) throw conflict('SERVICE_MEASURED', `O serviço já tem medições em ${from.symbol}; só é possível trocar por uma unidade da mesma grandeza.`);
      }
      const data: Prisma.ServiceUncheckedUpdateManyInput = { version: { increment: 1 } };
      for (const k of ['code', 'categoryId', 'unitId'] as const) if (fields[k] !== undefined) data[k] = fields[k];
      if (fields.description !== undefined) { data.description = fields.description; data.normalizedDescription = normalizeDescription(fields.description); }
      if (fields.measurementCriterion !== undefined) data.measurementCriterion = fields.measurementCriterion ?? null;
      if (fields.technicalDescription !== undefined) data.technicalDescription = fields.technicalDescription ?? null;
      const res = await tx.service.updateMany({ where: { id, version }, data });
      if (res.count !== 1) throw versionConflict();
      const after = await tx.service.findUniqueOrThrow({ where: { id }, include });
      await this.audit.record(tx, actor, { projectId, entityType: 'Service', entityId: id, action: 'UPDATE', before: auditView(cur), after: auditView(after), reason: reason ?? null });
      return after;
    });
    return { service: serviceDto(s), similar: await this.similar(actor.organizationId, projectId, s.description, s.id) };
  }

  async setArchived(actor: Actor, projectId: string | null, id: string, version: number, archived: boolean, reason: string | null) {
    return this.prisma.$transaction(async (tx) => {
      if (projectId) await assertProjectEditable(tx, actor.organizationId, projectId);
      const cur = await tx.service.findFirst({ where: { id, organizationId: actor.organizationId, projectId } });
      if (!cur) throw notFound('Serviço');
      if (!!cur.archivedAt === archived) throw conflict('NO_CHANGE', archived ? 'Serviço já está arquivado.' : 'Serviço já está ativo.');
      if (!archived) await this.checkCode(tx, actor.organizationId, projectId, cur.code, id);
      const res = await tx.service.updateMany({ where: { id, version }, data: { archivedAt: archived ? new Date() : null, version: { increment: 1 } } });
      if (res.count !== 1) throw versionConflict();
      await this.audit.record(tx, actor, { projectId, entityType: 'Service', entityId: id, action: archived ? 'ARCHIVE' : 'UNARCHIVE', reason });
    });
  }

  /** Duplica um serviço (do catálogo ou do próprio empreendimento) para o catálogo ou para um empreendimento. */
  async duplicate(actor: Actor, sourceId: string, target: { projectId: string | null; code: string }): Promise<ServiceSaveResult> {
    const src = await this.prisma.service.findFirst({
      where: { id: sourceId, organizationId: actor.organizationId, ...(target.projectId ? { OR: [{ projectId: null }, { projectId: target.projectId }] } : {}) },
    });
    // Serviço específico pode ser promovido ao catálogo (rota restrita a OWNER/ADMIN); a origem fica registrada.
    if (!src) throw notFound('Serviço de origem');
    return this.create(
      actor,
      target.projectId,
      {
        code: target.code,
        description: src.description,
        categoryId: src.categoryId,
        unitId: src.unitId,
        measurementCriterion: src.measurementCriterion,
        technicalDescription: src.technicalDescription,
      },
      target.projectId ? 'PROJECT' : 'CATALOG',
      src.id,
    );
  }
}
