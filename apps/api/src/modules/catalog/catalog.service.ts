import { Injectable } from '@nestjs/common';
import type { CreateElementTypeInput, ElementTypeDto, SystemTypeDto, UpdateElementTypeInput } from '@eapq/contracts';
import {
  DEFAULT_ELEMENT_TYPES,
  DEFAULT_SYSTEM_TYPES,
  validateDefinitions,
  type AttributeDefinition,
  type ElementCategory,
  type ElementDomain,
} from '@eapq/domain';
import type { Actor } from '../../common/auth/auth-context.js';
import { AppError, conflict, notFound, versionConflict } from '../../common/errors.js';
import { PrismaService, type Tx } from '../../prisma/prisma.service.js';
import { Prisma, type ElementAttributeDefinition } from '../../generated/prisma/client.js';
import { AuditService } from '../audit/audit.service.js';

const defDto = (d: ElementAttributeDefinition) => ({
  key: d.key,
  label: d.label,
  dataType: d.dataType,
  unit: d.unit,
  required: d.required,
  enumValues: d.enumValues.length ? d.enumValues : null,
  min: d.min?.toString() ?? null,
  max: d.max?.toString() ?? null,
});

export const toDomainDefs = (defs: ElementAttributeDefinition[]): AttributeDefinition[] =>
  [...defs].sort((a, b) => a.position - b.position).map(defDto);

type ElementTypeRow = Prisma.ElementTypeGetPayload<{ include: { attributes: true } }>;
const typeDto = (t: ElementTypeRow): ElementTypeDto => ({
  id: t.id,
  code: t.code,
  name: t.name,
  domain: t.domain,
  category: t.category,
  systemTypeId: t.systemTypeId,
  attributes: toDomainDefs(t.attributes).map((d) => ({ ...d, unit: d.unit ?? null, enumValues: d.enumValues ?? null, min: d.min ?? null, max: d.max ?? null })),
  archivedAt: t.archivedAt?.toISOString() ?? null,
  version: t.version,
});

const defRows = (defs: CreateElementTypeInput['attributes']) =>
  defs.map((d, i) => ({
    key: d.key,
    label: d.label,
    dataType: d.dataType,
    unit: d.dataType === 'NUMBER' ? (d.unit ?? null) : null,
    required: d.required ?? false,
    enumValues: d.dataType === 'ENUM' ? (d.enumValues ?? []) : [],
    min: d.min != null ? new Prisma.Decimal(d.min) : null,
    max: d.max != null ? new Prisma.Decimal(d.max) : null,
    position: i + 1,
  }));

/** Tabelas que guardam valores de atributos de um tipo de elemento. */
const USAGE_TABLES = ['network_node', 'network_segment', 'physical_element', 'typology_element'] as const;

@Injectable()
export class CatalogService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** Copia o catálogo padrão para a organização (idempotente). */
  async ensureDefaults(tx: Tx, organizationId: string): Promise<void> {
    const existing = await tx.infrastructureSystemType.count({ where: { organizationId } });
    if (existing > 0) return;
    const ids = new Map<string, string>();
    for (const s of DEFAULT_SYSTEM_TYPES) {
      const row = await tx.infrastructureSystemType.create({ data: { organizationId, code: s.code, name: s.name, networkBased: s.networkBased } });
      ids.set(s.code, row.id);
    }
    for (const t of DEFAULT_ELEMENT_TYPES) {
      await tx.elementType.create({
        data: {
          organizationId,
          code: t.code,
          name: t.name,
          domain: t.domain,
          category: t.category,
          systemTypeId: t.systemCode ? ids.get(t.systemCode)! : null,
          attributes: { create: defRows(t.attributes.map((a) => ({ ...a, required: a.required, enumValues: a.enumValues ?? null }))) },
        },
      });
    }
  }

  private async ready(organizationId: string) {
    const n = await this.prisma.infrastructureSystemType.count({ where: { organizationId } });
    if (n === 0) await this.prisma.$transaction((tx) => this.ensureDefaults(tx, organizationId));
  }

  async listSystemTypes(organizationId: string): Promise<SystemTypeDto[]> {
    await this.ready(organizationId);
    const rows = await this.prisma.infrastructureSystemType.findMany({ where: { organizationId }, orderBy: [{ archivedAt: { sort: 'asc', nulls: 'first' } }, { name: 'asc' }] });
    return rows.map((r) => ({ id: r.id, code: r.code, name: r.name, networkBased: r.networkBased, archivedAt: r.archivedAt?.toISOString() ?? null, version: r.version }));
  }

  async listElementTypes(organizationId: string): Promise<ElementTypeDto[]> {
    await this.ready(organizationId);
    const rows = await this.prisma.elementType.findMany({ where: { organizationId }, include: { attributes: true }, orderBy: [{ domain: 'asc' }, { name: 'asc' }] });
    return rows.map(typeDto);
  }

  async createSystemType(actor: Actor, input: { code: string; name: string; networkBased: boolean }) {
    return this.prisma.$transaction(async (tx) => {
      const dup = await tx.infrastructureSystemType.findUnique({ where: { organizationId_code: { organizationId: actor.organizationId, code: input.code } } });
      if (dup) throw conflict('CODE_IN_USE', `Já existe um sistema com o código ${input.code}.`);
      const r = await tx.infrastructureSystemType.create({ data: { organizationId: actor.organizationId, ...input } });
      await this.audit.record(tx, actor, { entityType: 'InfrastructureSystemType', entityId: r.id, action: 'CREATE', after: input });
      return { id: r.id, code: r.code, name: r.name, networkBased: r.networkBased, archivedAt: null, version: r.version } satisfies SystemTypeDto;
    });
  }

  async updateSystemType(actor: Actor, id: string, version: number, name: string) {
    return this.prisma.$transaction(async (tx) => {
      const cur = await tx.infrastructureSystemType.findFirst({ where: { id, organizationId: actor.organizationId } });
      if (!cur) throw notFound('Tipo de sistema');
      const res = await tx.infrastructureSystemType.updateMany({ where: { id, version }, data: { name, version: { increment: 1 } } });
      if (res.count !== 1) throw versionConflict();
      await this.audit.record(tx, actor, { entityType: 'InfrastructureSystemType', entityId: id, action: 'UPDATE', before: { name: cur.name }, after: { name } });
    });
  }

  private validateDefs(defs: CreateElementTypeInput['attributes']) {
    const issues = validateDefinitions(defs.map((d) => ({ ...d, required: d.required ?? false })));
    if (issues.length) throw new AppError(422, 'VALIDATION_FAILED', 'Dados inválidos', 'Revise os atributos.', issues);
  }

  private async checkSystemForType(tx: Tx, organizationId: string, domain: ElementDomain, category: ElementCategory, systemTypeId: string | null | undefined) {
    if (domain === 'CONSTRUTIVO') {
      if (systemTypeId) throw new AppError(422, 'VALIDATION_FAILED', 'Dados inválidos', 'Elementos construtivos não pertencem a sistemas de infraestrutura.');
      if (category !== 'ELEMENT') throw new AppError(422, 'VALIDATION_FAILED', 'Dados inválidos', 'Elementos construtivos não fazem parte de redes.');
      return;
    }
    if (!systemTypeId) throw new AppError(422, 'VALIDATION_FAILED', 'Dados inválidos', 'Informe o sistema de infraestrutura do tipo de elemento.');
    const st = await tx.infrastructureSystemType.findFirst({ where: { id: systemTypeId, organizationId } });
    if (!st) throw notFound('Tipo de sistema');
    if (category !== 'ELEMENT' && !st.networkBased) {
      throw new AppError(422, 'VALIDATION_FAILED', 'Dados inválidos', `O sistema ${st.name} não é organizado em redes; use a categoria "elemento".`);
    }
  }

  async createElementType(actor: Actor, input: CreateElementTypeInput): Promise<ElementTypeDto> {
    this.validateDefs(input.attributes);
    return this.prisma.$transaction(async (tx) => {
      await this.checkSystemForType(tx, actor.organizationId, input.domain, input.category, input.systemTypeId);
      const dup = await tx.elementType.findUnique({ where: { organizationId_code: { organizationId: actor.organizationId, code: input.code } } });
      if (dup) throw conflict('CODE_IN_USE', `Já existe um tipo de elemento com o código ${input.code}.`);
      const t = await tx.elementType.create({
        data: {
          organizationId: actor.organizationId,
          code: input.code,
          name: input.name,
          domain: input.domain,
          category: input.category,
          systemTypeId: input.systemTypeId ?? null,
          attributes: { create: defRows(input.attributes) },
        },
        include: { attributes: true },
      });
      await this.audit.record(tx, actor, { entityType: 'ElementType', entityId: t.id, action: 'CREATE', after: typeDto(t) });
      return typeDto(t);
    });
  }

  private async usageCount(tx: Tx, elementTypeId: string): Promise<number> {
    const [a, b, c, d] = await Promise.all([
      tx.networkNode.count({ where: { elementTypeId } }),
      tx.networkSegment.count({ where: { elementTypeId } }),
      tx.physicalElement.count({ where: { elementTypeId } }),
      tx.typologyElement.count({ where: { elementTypeId } }),
    ]);
    return a + b + c + d;
  }

  private async keyInUse(tx: Tx, elementTypeId: string, key: string): Promise<boolean> {
    for (const table of USAGE_TABLES) {
      const rows = await tx.$queryRaw<{ n: bigint }[]>`
        SELECT count(*) AS n FROM ${Prisma.raw(`"${table}"`)} WHERE "elementTypeId" = ${elementTypeId}::uuid AND attributes ? ${key}`;
      if (Number(rows[0]?.n ?? 0) > 0) return true;
    }
    return false;
  }

  /**
   * Atualiza nome/atributos. Com elementos já cadastrados, não permite remover nem mudar o tipo
   * de atributos em uso, nem acrescentar atributo obrigatório (os registros existentes ficariam inválidos).
   */
  async updateElementType(actor: Actor, id: string, version: number, input: UpdateElementTypeInput): Promise<ElementTypeDto> {
    if (input.attributes) this.validateDefs(input.attributes);
    return this.prisma.$transaction(async (tx) => {
      const cur = await tx.elementType.findFirst({ where: { id, organizationId: actor.organizationId }, include: { attributes: true } });
      if (!cur) throw notFound('Tipo de elemento');
      if (cur.version !== version) throw versionConflict();
      if (input.attributes) {
        const used = await this.usageCount(tx, id);
        if (used > 0) {
          const next = new Map(input.attributes.map((a) => [a.key, a]));
          const prev = new Map(cur.attributes.map((a) => [a.key, a]));
          for (const old of cur.attributes) {
            const n = next.get(old.key);
            if ((!n || n.dataType !== old.dataType) && (await this.keyInUse(tx, id, old.key))) {
              throw conflict('ATTRIBUTE_IN_USE', `O atributo "${old.label}" já tem valores cadastrados e não pode ser removido nem mudar de tipo.`);
            }
          }
          for (const a of input.attributes) {
            if (a.required && !prev.get(a.key)?.required) {
              throw conflict('ATTRIBUTE_IN_USE', `Há ${used} registro(s) deste tipo: "${a.label}" não pode passar a ser obrigatório.`);
            }
          }
        }
        await tx.elementAttributeDefinition.deleteMany({ where: { elementTypeId: id } });
        await tx.elementAttributeDefinition.createMany({ data: defRows(input.attributes).map((d) => ({ ...d, elementTypeId: id })) });
      }
      await tx.elementType.update({ where: { id }, data: { ...(input.name ? { name: input.name } : {}), version: { increment: 1 } } });
      const after = await tx.elementType.findUniqueOrThrow({ where: { id }, include: { attributes: true } });
      await this.audit.record(tx, actor, { entityType: 'ElementType', entityId: id, action: 'UPDATE', before: typeDto(cur), after: typeDto(after) });
      return typeDto(after);
    });
  }

  async setElementTypeArchived(actor: Actor, id: string, version: number, archived: boolean) {
    return this.prisma.$transaction(async (tx) => {
      const cur = await tx.elementType.findFirst({ where: { id, organizationId: actor.organizationId } });
      if (!cur) throw notFound('Tipo de elemento');
      if (cur.version !== version) throw versionConflict();
      await tx.elementType.update({ where: { id }, data: { archivedAt: archived ? new Date() : null, version: { increment: 1 } } });
      await this.audit.record(tx, actor, { entityType: 'ElementType', entityId: id, action: archived ? 'ARCHIVE' : 'UNARCHIVE' });
    });
  }
}

/** Carrega um tipo de elemento da organização e valida domínio/categoria/sistema esperados. */
export async function loadElementType(
  tx: Tx,
  organizationId: string,
  id: string,
  expect: { domain?: ElementDomain; category?: ElementCategory; systemTypeId?: string | null },
) {
  const t = await tx.elementType.findFirst({ where: { id, organizationId }, include: { attributes: true } });
  if (!t) throw notFound('Tipo de elemento');
  if (t.archivedAt) throw conflict('ELEMENT_TYPE_ARCHIVED', `O tipo ${t.name} está arquivado.`);
  const labels = { NETWORK_NODE: 'dispositivo de rede', NETWORK_SEGMENT: 'trecho de rede', ELEMENT: 'elemento' } as const;
  if (expect.category && t.category !== expect.category) {
    throw new AppError(422, 'ELEMENT_TYPE_MISMATCH', 'Tipo incompatível', `${t.name} é um ${labels[t.category]}, não um ${labels[expect.category]}.`);
  }
  if (expect.domain && t.domain !== expect.domain) {
    throw new AppError(422, 'ELEMENT_TYPE_MISMATCH', 'Tipo incompatível', `${t.name} não é um elemento ${expect.domain === 'INFRA' ? 'de infraestrutura' : 'construtivo'}.`);
  }
  if (expect.systemTypeId !== undefined && t.systemTypeId !== expect.systemTypeId) {
    throw new AppError(422, 'ELEMENT_TYPE_MISMATCH', 'Tipo incompatível', `${t.name} pertence a outro sistema de infraestrutura.`);
  }
  return { type: t, defs: toDomainDefs(t.attributes) };
}
