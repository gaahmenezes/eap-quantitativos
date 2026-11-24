import { Injectable } from '@nestjs/common';
import type {
  CreateElementInput,
  CreateNetworkNodeInput,
  CreateSegmentInput,
  NetworkDto,
  NetworkNodeDto,
  PhysicalElementDto,
  SegmentDto,
  SystemDetailDto,
  SystemDto,
  UpdateElementInput,
  UpdateNetworkNodeInput,
  UpdateSegmentInput,
} from '@eapq/contracts';
import { segmentGeometry, sumDecimals } from '@eapq/domain';
import type { Actor } from '../../common/auth/auth-context.js';
import { AppError, conflict, notFound, versionConflict } from '../../common/errors.js';
import { assertProjectEditable, checkAttributes, decimalOrNull } from '../../common/project-guard.js';
import { PrismaService, type Tx } from '../../prisma/prisma.service.js';
import { Prisma, type NetworkNode, type NetworkSegment, type PhysicalElement } from '../../generated/prisma/client.js';
import { AuditService } from '../audit/audit.service.js';
import { loadElementType } from '../catalog/catalog.service.js';

const D = (v: string | null | undefined) => (v == null ? null : new Prisma.Decimal(v));
const attrs = (v: Prisma.JsonValue) => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, string | boolean>) : {});
const iso = (d: Date | null) => d?.toISOString() ?? null;

const nodeDto = (n: NetworkNode): NetworkNodeDto => ({
  id: n.id,
  networkId: n.networkId,
  elementTypeId: n.elementTypeId,
  code: n.code,
  locationNodeId: n.locationNodeId,
  coverElevation: decimalOrNull(n.coverElevation),
  bottomElevation: decimalOrNull(n.bottomElevation),
  attributes: attrs(n.attributes),
  archivedAt: iso(n.archivedAt),
  version: n.version,
});

function segmentDto(s: NetworkSegment, nodes: Map<string, NetworkNode>): SegmentDto {
  const from = nodes.get(s.fromNodeId);
  const to = nodes.get(s.toNodeId);
  return {
    id: s.id,
    networkId: s.networkId,
    elementTypeId: s.elementTypeId,
    code: s.code,
    fromNodeId: s.fromNodeId,
    toNodeId: s.toNodeId,
    streetSectionId: s.streetSectionId,
    length: s.length.toString(),
    diameter: decimalOrNull(s.diameter),
    material: s.material,
    upstreamInvert: decimalOrNull(s.upstreamInvert),
    downstreamInvert: decimalOrNull(s.downstreamInvert),
    attributes: attrs(s.attributes),
    archivedAt: iso(s.archivedAt),
    version: s.version,
    geometry: segmentGeometry({
      length: s.length.toString(),
      upstreamInvert: decimalOrNull(s.upstreamInvert),
      downstreamInvert: decimalOrNull(s.downstreamInvert),
      fromNode: from ? { coverElevation: decimalOrNull(from.coverElevation), bottomElevation: decimalOrNull(from.bottomElevation) } : null,
      toNode: to ? { coverElevation: decimalOrNull(to.coverElevation), bottomElevation: decimalOrNull(to.bottomElevation) } : null,
    }),
  };
}

export const elementDto = (e: PhysicalElement): PhysicalElementDto => ({
  id: e.id,
  elementTypeId: e.elementTypeId,
  systemId: e.systemId,
  structureNodeId: e.structureNodeId,
  name: e.name,
  attributes: attrs(e.attributes),
  archivedAt: iso(e.archivedAt),
  version: e.version,
});

const TX = { timeout: 30_000 } as const;

@Injectable()
export class InfrastructureService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // ---------------- leitura ----------------

  async listSystems(organizationId: string, projectId: string): Promise<SystemDto[]> {
    const rows = await this.prisma.infrastructureSystem.findMany({
      where: { organizationId, projectId },
      orderBy: [{ archivedAt: { sort: 'asc', nulls: 'first' } }, { createdAt: 'asc' }],
      include: {
        _count: { select: { networks: { where: { archivedAt: null } }, elements: { where: { archivedAt: null } } } },
      },
    });
    return rows.map((s) => ({
      id: s.id,
      systemTypeId: s.systemTypeId,
      name: s.name,
      scopeNodeId: s.scopeNodeId,
      archivedAt: iso(s.archivedAt),
      version: s.version,
      networkCount: s._count.networks,
      elementCount: s._count.elements,
    }));
  }

  async getSystem(organizationId: string, projectId: string, systemId: string): Promise<SystemDetailDto> {
    const s = await this.prisma.infrastructureSystem.findFirst({
      where: { id: systemId, projectId, organizationId },
      include: {
        networks: { orderBy: { code: 'asc' }, include: { nodes: { orderBy: { code: 'asc' } }, segments: { orderBy: { code: 'asc' } } } },
        elements: { orderBy: [{ createdAt: 'asc' }] },
      },
    });
    if (!s) throw notFound('Sistema de infraestrutura');
    const networks: NetworkDto[] = s.networks.map((n) => {
      const nodes = new Map(n.nodes.map((x) => [x.id, x]));
      const activeSegments = n.segments.filter((x) => !x.archivedAt);
      const nodesByType: Record<string, number> = {};
      for (const x of n.nodes) if (!x.archivedAt) nodesByType[x.elementTypeId] = (nodesByType[x.elementTypeId] ?? 0) + 1;
      return {
        id: n.id,
        systemId: n.systemId,
        code: n.code,
        name: n.name,
        archivedAt: iso(n.archivedAt),
        version: n.version,
        nodes: n.nodes.map(nodeDto),
        segments: n.segments.map((x) => segmentDto(x, nodes)),
        totals: { segments: activeSegments.length, length: sumDecimals(activeSegments.map((x) => x.length.toString())), nodesByType },
      };
    });
    return {
      id: s.id,
      systemTypeId: s.systemTypeId,
      name: s.name,
      scopeNodeId: s.scopeNodeId,
      archivedAt: iso(s.archivedAt),
      version: s.version,
      networkCount: networks.filter((n) => !n.archivedAt).length,
      elementCount: s.elements.filter((e) => !e.archivedAt).length,
      networks,
      elements: s.elements.map(elementDto),
    };
  }

  // ---------------- apoio ----------------

  private async structureNode(tx: Tx, projectId: string, id: string | null | undefined, allowedKinds?: string[]) {
    if (!id) return null;
    const n = await tx.structureNode.findFirst({ where: { id, projectId } });
    if (!n) throw notFound('Item do cadastro físico');
    if (n.archivedAt) throw conflict('NODE_ARCHIVED', `O item ${n.name} está arquivado.`);
    if (allowedKinds && !allowedKinds.includes(n.kind)) {
      throw new AppError(422, 'VALIDATION_FAILED', 'Dados inválidos', `${n.name} não é um local válido para este campo.`);
    }
    return n;
  }

  private async activeSystem(tx: Tx, projectId: string, systemId: string) {
    const s = await tx.infrastructureSystem.findFirst({ where: { id: systemId, projectId }, include: { systemType: true } });
    if (!s) throw notFound('Sistema de infraestrutura');
    if (s.archivedAt) throw conflict('SYSTEM_ARCHIVED', 'Sistema arquivado não pode ser alterado.');
    return s;
  }

  private async activeNetwork(tx: Tx, projectId: string, networkId: string) {
    const n = await tx.infrastructureNetwork.findFirst({ where: { id: networkId, projectId }, include: { system: { include: { systemType: true } } } });
    if (!n) throw notFound('Rede');
    if (n.archivedAt || n.system.archivedAt) throw conflict('NETWORK_ARCHIVED', 'Rede arquivada não pode ser alterada.');
    return n;
  }

  private bump<T extends { count: number }>(res: T) {
    if (res.count !== 1) throw versionConflict();
  }

  // ---------------- sistemas ----------------

  async createSystem(actor: Actor, projectId: string, input: { systemTypeId: string; name: string; scopeNodeId?: string | null }) {
    return this.prisma.$transaction(async (tx) => {
      await assertProjectEditable(tx, actor.organizationId, projectId);
      const st = await tx.infrastructureSystemType.findFirst({ where: { id: input.systemTypeId, organizationId: actor.organizationId } });
      if (!st) throw notFound('Tipo de sistema');
      if (st.archivedAt) throw conflict('SYSTEM_TYPE_ARCHIVED', `O tipo ${st.name} está arquivado.`);
      await this.structureNode(tx, projectId, input.scopeNodeId);
      const s = await tx.infrastructureSystem.create({
        data: { organizationId: actor.organizationId, projectId, systemTypeId: st.id, name: input.name, scopeNodeId: input.scopeNodeId ?? null },
      });
      await this.audit.record(tx, actor, { projectId, entityType: 'InfrastructureSystem', entityId: s.id, action: 'CREATE', after: { type: st.code, name: s.name, scopeNodeId: s.scopeNodeId } });
      return { id: s.id };
    }, TX);
  }

  async updateSystem(actor: Actor, projectId: string, id: string, version: number, input: { name?: string; scopeNodeId?: string | null }) {
    return this.prisma.$transaction(async (tx) => {
      await assertProjectEditable(tx, actor.organizationId, projectId);
      const s = await this.activeSystem(tx, projectId, id);
      if (input.scopeNodeId !== undefined) await this.structureNode(tx, projectId, input.scopeNodeId);
      this.bump(await tx.infrastructureSystem.updateMany({ where: { id, version }, data: { ...input, version: { increment: 1 } } }));
      await this.audit.record(tx, actor, { projectId, entityType: 'InfrastructureSystem', entityId: id, action: 'UPDATE', before: { name: s.name, scopeNodeId: s.scopeNodeId }, after: input });
    }, TX);
  }

  /** Arquivar sistema arquiva redes, dispositivos, trechos e elementos ativos do sistema. */
  async archiveSystem(actor: Actor, projectId: string, id: string, version: number, reason: string) {
    return this.prisma.$transaction(async (tx) => {
      await assertProjectEditable(tx, actor.organizationId, projectId);
      await this.activeSystem(tx, projectId, id);
      const at = new Date();
      this.bump(await tx.infrastructureSystem.updateMany({ where: { id, version }, data: { archivedAt: at, version: { increment: 1 } } }));
      const nets = await tx.infrastructureNetwork.findMany({ where: { systemId: id }, select: { id: true } });
      const netIds = nets.map((n) => n.id);
      const counts = {
        networks: (await tx.infrastructureNetwork.updateMany({ where: { systemId: id, archivedAt: null }, data: { archivedAt: at } })).count,
        segments: (await tx.networkSegment.updateMany({ where: { networkId: { in: netIds }, archivedAt: null }, data: { archivedAt: at } })).count,
        nodes: (await tx.networkNode.updateMany({ where: { networkId: { in: netIds }, archivedAt: null }, data: { archivedAt: at } })).count,
        elements: (await tx.physicalElement.updateMany({ where: { systemId: id, archivedAt: null }, data: { archivedAt: at } })).count,
      };
      await this.audit.record(tx, actor, { projectId, entityType: 'InfrastructureSystem', entityId: id, action: 'ARCHIVE', after: counts, reason });
      return counts;
    }, TX);
  }

  // ---------------- redes ----------------

  async createNetwork(actor: Actor, projectId: string, systemId: string, input: { code: string; name: string }) {
    return this.prisma.$transaction(async (tx) => {
      await assertProjectEditable(tx, actor.organizationId, projectId);
      const s = await this.activeSystem(tx, projectId, systemId);
      if (!s.systemType.networkBased) {
        throw new AppError(422, 'NOT_NETWORK_SYSTEM', 'Sistema sem redes', `${s.systemType.name} não é organizado em redes. Cadastre elementos no sistema.`);
      }
      const dup = await tx.infrastructureNetwork.findUnique({ where: { systemId_code: { systemId, code: input.code } } });
      if (dup) throw conflict('CODE_IN_USE', `Já existe a rede ${input.code} neste sistema.`);
      const n = await tx.infrastructureNetwork.create({ data: { organizationId: actor.organizationId, projectId, systemId, code: input.code, name: input.name } });
      await this.audit.record(tx, actor, { projectId, entityType: 'InfrastructureNetwork', entityId: n.id, action: 'CREATE', after: input });
      return { id: n.id };
    }, TX);
  }

  async updateNetwork(actor: Actor, projectId: string, id: string, version: number, input: { code?: string; name?: string }) {
    return this.prisma.$transaction(async (tx) => {
      await assertProjectEditable(tx, actor.organizationId, projectId);
      const n = await this.activeNetwork(tx, projectId, id);
      if (input.code && input.code !== n.code) {
        const dup = await tx.infrastructureNetwork.findUnique({ where: { systemId_code: { systemId: n.systemId, code: input.code } } });
        if (dup) throw conflict('CODE_IN_USE', `Já existe a rede ${input.code} neste sistema.`);
      }
      this.bump(await tx.infrastructureNetwork.updateMany({ where: { id, version }, data: { ...input, version: { increment: 1 } } }));
      await this.audit.record(tx, actor, { projectId, entityType: 'InfrastructureNetwork', entityId: id, action: 'UPDATE', before: { code: n.code, name: n.name }, after: input });
    }, TX);
  }

  async archiveNetwork(actor: Actor, projectId: string, id: string, version: number, reason: string) {
    return this.prisma.$transaction(async (tx) => {
      await assertProjectEditable(tx, actor.organizationId, projectId);
      await this.activeNetwork(tx, projectId, id);
      const at = new Date();
      this.bump(await tx.infrastructureNetwork.updateMany({ where: { id, version }, data: { archivedAt: at, version: { increment: 1 } } }));
      const segments = (await tx.networkSegment.updateMany({ where: { networkId: id, archivedAt: null }, data: { archivedAt: at } })).count;
      const nodes = (await tx.networkNode.updateMany({ where: { networkId: id, archivedAt: null }, data: { archivedAt: at } })).count;
      await this.audit.record(tx, actor, { projectId, entityType: 'InfrastructureNetwork', entityId: id, action: 'ARCHIVE', after: { nodes, segments }, reason });
      return { nodes, segments };
    }, TX);
  }

  // ---------------- dispositivos ----------------

  async createNode(actor: Actor, projectId: string, networkId: string, input: CreateNetworkNodeInput): Promise<NetworkNodeDto> {
    return this.prisma.$transaction(async (tx) => {
      await assertProjectEditable(tx, actor.organizationId, projectId);
      const net = await this.activeNetwork(tx, projectId, networkId);
      const { defs } = await loadElementType(tx, actor.organizationId, input.elementTypeId, { category: 'NETWORK_NODE', systemTypeId: net.system.systemTypeId });
      const attributes = checkAttributes(defs, input.attributes);
      await this.structureNode(tx, projectId, input.locationNodeId);
      const dup = await tx.networkNode.findUnique({ where: { networkId_code: { networkId, code: input.code } } });
      if (dup) throw conflict('CODE_IN_USE', `Já existe o dispositivo ${input.code} nesta rede.`);
      const n = await tx.networkNode.create({
        data: {
          organizationId: actor.organizationId,
          projectId,
          networkId,
          elementTypeId: input.elementTypeId,
          code: input.code,
          locationNodeId: input.locationNodeId ?? null,
          coverElevation: D(input.coverElevation),
          bottomElevation: D(input.bottomElevation),
          attributes,
        },
      });
      this.checkElevations(n);
      await this.audit.record(tx, actor, { projectId, entityType: 'NetworkNode', entityId: n.id, action: 'CREATE', after: nodeDto(n) });
      return nodeDto(n);
    }, TX);
  }

  private checkElevations(n: { coverElevation: Prisma.Decimal | null; bottomElevation: Prisma.Decimal | null }) {
    if (n.coverElevation && n.bottomElevation && n.bottomElevation.gt(n.coverElevation)) {
      throw new AppError(422, 'VALIDATION_FAILED', 'Dados inválidos', 'A cota de fundo não pode ser maior que a cota de tampa.', [{ path: 'bottomElevation', message: 'Cota de fundo acima da tampa.' }]);
    }
  }

  async updateNode(actor: Actor, projectId: string, id: string, version: number, input: UpdateNetworkNodeInput): Promise<NetworkNodeDto> {
    return this.prisma.$transaction(async (tx) => {
      await assertProjectEditable(tx, actor.organizationId, projectId);
      const cur = await tx.networkNode.findFirst({ where: { id, projectId } });
      if (!cur) throw notFound('Dispositivo');
      if (cur.archivedAt) throw conflict('ARCHIVED', 'Dispositivo arquivado não pode ser editado.');
      await this.activeNetwork(tx, projectId, cur.networkId);
      const { defs } = await loadElementType(tx, actor.organizationId, cur.elementTypeId, {});
      const attributes = input.attributes !== undefined ? checkAttributes(defs, input.attributes) : undefined;
      if (input.locationNodeId !== undefined) await this.structureNode(tx, projectId, input.locationNodeId);
      if (input.code && input.code !== cur.code) {
        const dup = await tx.networkNode.findUnique({ where: { networkId_code: { networkId: cur.networkId, code: input.code } } });
        if (dup) throw conflict('CODE_IN_USE', `Já existe o dispositivo ${input.code} nesta rede.`);
      }
      this.bump(
        await tx.networkNode.updateMany({
          where: { id, version },
          data: {
            ...(input.code ? { code: input.code } : {}),
            ...(input.locationNodeId !== undefined ? { locationNodeId: input.locationNodeId } : {}),
            ...(input.coverElevation !== undefined ? { coverElevation: D(input.coverElevation) } : {}),
            ...(input.bottomElevation !== undefined ? { bottomElevation: D(input.bottomElevation) } : {}),
            ...(attributes ? { attributes } : {}),
            version: { increment: 1 },
          },
        }),
      );
      const after = await tx.networkNode.findUniqueOrThrow({ where: { id } });
      this.checkElevations(after);
      await this.audit.record(tx, actor, { projectId, entityType: 'NetworkNode', entityId: id, action: 'UPDATE', before: nodeDto(cur), after: nodeDto(after) });
      return nodeDto(after);
    }, TX);
  }

  async archiveNode(actor: Actor, projectId: string, id: string, version: number, reason: string) {
    return this.prisma.$transaction(async (tx) => {
      await assertProjectEditable(tx, actor.organizationId, projectId);
      const cur = await tx.networkNode.findFirst({ where: { id, projectId } });
      if (!cur) throw notFound('Dispositivo');
      if (cur.archivedAt) throw conflict('NO_CHANGE', 'Dispositivo já está arquivado.');
      const linked = await tx.networkSegment.count({ where: { archivedAt: null, OR: [{ fromNodeId: id }, { toNodeId: id }] } });
      if (linked) throw conflict('NODE_IN_USE', `O dispositivo está ligado a ${linked} trecho(s) ativo(s). Arquive os trechos antes.`);
      this.bump(await tx.networkNode.updateMany({ where: { id, version }, data: { archivedAt: new Date(), version: { increment: 1 } } }));
      await this.audit.record(tx, actor, { projectId, entityType: 'NetworkNode', entityId: id, action: 'ARCHIVE', before: { code: cur.code }, reason });
    }, TX);
  }

  // ---------------- trechos ----------------

  private async segmentEnds(tx: Tx, networkId: string, fromNodeId: string, toNodeId: string) {
    if (fromNodeId === toNodeId) throw new AppError(422, 'VALIDATION_FAILED', 'Dados inválidos', 'O trecho precisa ligar dois dispositivos diferentes.', [{ path: 'toNodeId', message: 'Igual ao dispositivo de montante.' }]);
    const ends = await tx.networkNode.findMany({ where: { id: { in: [fromNodeId, toNodeId] }, networkId } });
    if (ends.length !== 2) throw new AppError(422, 'VALIDATION_FAILED', 'Dados inválidos', 'Os dois dispositivos devem pertencer a esta rede.');
    if (ends.some((e) => e.archivedAt)) throw conflict('ARCHIVED', 'Um dos dispositivos está arquivado.');
  }

  async createSegment(actor: Actor, projectId: string, networkId: string, input: CreateSegmentInput): Promise<{ id: string }> {
    return this.prisma.$transaction(async (tx) => {
      await assertProjectEditable(tx, actor.organizationId, projectId);
      const net = await this.activeNetwork(tx, projectId, networkId);
      const { defs } = await loadElementType(tx, actor.organizationId, input.elementTypeId, { category: 'NETWORK_SEGMENT', systemTypeId: net.system.systemTypeId });
      const attributes = checkAttributes(defs, input.attributes);
      await this.segmentEnds(tx, networkId, input.fromNodeId, input.toNodeId);
      await this.structureNode(tx, projectId, input.streetSectionId, ['STREET', 'STREET_SECTION']);
      const dupCode = await tx.networkSegment.findUnique({ where: { networkId_code: { networkId, code: input.code } } });
      if (dupCode) throw conflict('CODE_IN_USE', `Já existe o trecho ${input.code} nesta rede.`);
      const dupPair = await tx.networkSegment.findFirst({ where: { networkId, fromNodeId: input.fromNodeId, toNodeId: input.toNodeId, archivedAt: null } });
      if (dupPair) throw conflict('SEGMENT_EXISTS', `Já existe o trecho ${dupPair.code} ligando estes dispositivos.`);
      const s = await tx.networkSegment.create({
        data: {
          organizationId: actor.organizationId,
          projectId,
          networkId,
          elementTypeId: input.elementTypeId,
          code: input.code,
          fromNodeId: input.fromNodeId,
          toNodeId: input.toNodeId,
          streetSectionId: input.streetSectionId ?? null,
          length: new Prisma.Decimal(input.length),
          diameter: D(input.diameter),
          material: input.material ?? null,
          upstreamInvert: D(input.upstreamInvert),
          downstreamInvert: D(input.downstreamInvert),
          attributes,
        },
      });
      await this.audit.record(tx, actor, { projectId, entityType: 'NetworkSegment', entityId: s.id, action: 'CREATE', after: { ...input, attributes } });
      return { id: s.id };
    }, TX);
  }

  async updateSegment(actor: Actor, projectId: string, id: string, version: number, input: UpdateSegmentInput) {
    return this.prisma.$transaction(async (tx) => {
      await assertProjectEditable(tx, actor.organizationId, projectId);
      const cur = await tx.networkSegment.findFirst({ where: { id, projectId } });
      if (!cur) throw notFound('Trecho');
      if (cur.archivedAt) throw conflict('ARCHIVED', 'Trecho arquivado não pode ser editado.');
      await this.activeNetwork(tx, projectId, cur.networkId);
      const { defs } = await loadElementType(tx, actor.organizationId, cur.elementTypeId, {});
      const attributes = input.attributes !== undefined ? checkAttributes(defs, input.attributes) : undefined;
      const from = input.fromNodeId ?? cur.fromNodeId;
      const to = input.toNodeId ?? cur.toNodeId;
      if (input.fromNodeId || input.toNodeId) await this.segmentEnds(tx, cur.networkId, from, to);
      if (input.streetSectionId !== undefined) await this.structureNode(tx, projectId, input.streetSectionId, ['STREET', 'STREET_SECTION']);
      if (input.code && input.code !== cur.code) {
        const dup = await tx.networkSegment.findUnique({ where: { networkId_code: { networkId: cur.networkId, code: input.code } } });
        if (dup) throw conflict('CODE_IN_USE', `Já existe o trecho ${input.code} nesta rede.`);
      }
      const data: Prisma.NetworkSegmentUncheckedUpdateManyInput = { version: { increment: 1 } };
      if (input.code) data.code = input.code;
      if (input.fromNodeId) data.fromNodeId = input.fromNodeId;
      if (input.toNodeId) data.toNodeId = input.toNodeId;
      if (input.streetSectionId !== undefined) data.streetSectionId = input.streetSectionId;
      if (input.length) data.length = new Prisma.Decimal(input.length);
      if (input.diameter !== undefined) data.diameter = D(input.diameter);
      if (input.material !== undefined) data.material = input.material ?? null;
      if (input.upstreamInvert !== undefined) data.upstreamInvert = D(input.upstreamInvert);
      if (input.downstreamInvert !== undefined) data.downstreamInvert = D(input.downstreamInvert);
      if (attributes) data.attributes = attributes;
      this.bump(await tx.networkSegment.updateMany({ where: { id, version }, data }));
      const after = await tx.networkSegment.findUniqueOrThrow({ where: { id } });
      await this.audit.record(tx, actor, {
        projectId,
        entityType: 'NetworkSegment',
        entityId: id,
        action: 'UPDATE',
        before: { code: cur.code, length: cur.length.toString(), diameter: decimalOrNull(cur.diameter), upstreamInvert: decimalOrNull(cur.upstreamInvert), downstreamInvert: decimalOrNull(cur.downstreamInvert) },
        after: { code: after.code, length: after.length.toString(), diameter: decimalOrNull(after.diameter), upstreamInvert: decimalOrNull(after.upstreamInvert), downstreamInvert: decimalOrNull(after.downstreamInvert) },
      });
    }, TX);
  }

  async archiveSegment(actor: Actor, projectId: string, id: string, version: number, reason: string) {
    return this.prisma.$transaction(async (tx) => {
      await assertProjectEditable(tx, actor.organizationId, projectId);
      const cur = await tx.networkSegment.findFirst({ where: { id, projectId } });
      if (!cur) throw notFound('Trecho');
      if (cur.archivedAt) throw conflict('NO_CHANGE', 'Trecho já está arquivado.');
      this.bump(await tx.networkSegment.updateMany({ where: { id, version }, data: { archivedAt: new Date(), version: { increment: 1 } } }));
      await this.audit.record(tx, actor, { projectId, entityType: 'NetworkSegment', entityId: id, action: 'ARCHIVE', before: { code: cur.code, length: cur.length.toString() }, reason });
    }, TX);
  }

  // ---------------- elementos físicos ----------------

  async listElements(organizationId: string, projectId: string, filter: { structureNodeId?: string; systemId?: string }) {
    const rows = await this.prisma.physicalElement.findMany({
      where: { organizationId, projectId, ...(filter.structureNodeId ? { structureNodeId: filter.structureNodeId } : {}), ...(filter.systemId ? { systemId: filter.systemId } : {}) },
      orderBy: [{ archivedAt: { sort: 'asc', nulls: 'first' } }, { createdAt: 'asc' }],
    });
    return rows.map(elementDto);
  }

  async createElement(actor: Actor, projectId: string, input: CreateElementInput): Promise<PhysicalElementDto> {
    return this.prisma.$transaction(async (tx) => {
      await assertProjectEditable(tx, actor.organizationId, projectId);
      const { type, defs } = await loadElementType(tx, actor.organizationId, input.elementTypeId, { category: 'ELEMENT' });
      if (type.domain === 'INFRA') {
        if (!input.systemId) throw new AppError(422, 'VALIDATION_FAILED', 'Dados inválidos', 'Elementos de infraestrutura pertencem a um sistema.', [{ path: 'systemId', message: 'Informe o sistema.' }]);
        const s = await this.activeSystem(tx, projectId, input.systemId);
        if (s.systemTypeId !== type.systemTypeId) throw new AppError(422, 'ELEMENT_TYPE_MISMATCH', 'Tipo incompatível', `${type.name} não pertence ao sistema ${s.systemType.name}.`);
      } else {
        if (input.systemId) throw new AppError(422, 'VALIDATION_FAILED', 'Dados inválidos', 'Elementos construtivos não pertencem a sistemas de infraestrutura.');
        if (!input.structureNodeId) throw new AppError(422, 'VALIDATION_FAILED', 'Dados inválidos', 'Informe o item do cadastro físico onde o elemento está.', [{ path: 'structureNodeId', message: 'Obrigatório.' }]);
      }
      await this.structureNode(tx, projectId, input.structureNodeId);
      const attributes = checkAttributes(defs, input.attributes);
      const e = await tx.physicalElement.create({
        data: {
          organizationId: actor.organizationId,
          projectId,
          elementTypeId: type.id,
          systemId: input.systemId ?? null,
          structureNodeId: input.structureNodeId ?? null,
          name: input.name,
          attributes,
        },
      });
      await this.audit.record(tx, actor, { projectId, entityType: 'PhysicalElement', entityId: e.id, action: 'CREATE', after: elementDto(e) });
      return elementDto(e);
    }, TX);
  }

  async updateElement(actor: Actor, projectId: string, id: string, version: number, input: UpdateElementInput): Promise<PhysicalElementDto> {
    return this.prisma.$transaction(async (tx) => {
      await assertProjectEditable(tx, actor.organizationId, projectId);
      const cur = await tx.physicalElement.findFirst({ where: { id, projectId } });
      if (!cur) throw notFound('Elemento');
      if (cur.archivedAt) throw conflict('ARCHIVED', 'Elemento arquivado não pode ser editado.');
      const { type, defs } = await loadElementType(tx, actor.organizationId, cur.elementTypeId, {});
      const attributes = input.attributes !== undefined ? checkAttributes(defs, input.attributes) : undefined;
      if (input.structureNodeId !== undefined) {
        if (input.structureNodeId === null && type.domain === 'CONSTRUTIVO') throw new AppError(422, 'VALIDATION_FAILED', 'Dados inválidos', 'Elementos construtivos precisam de um local no cadastro.');
        await this.structureNode(tx, projectId, input.structureNodeId);
      }
      this.bump(
        await tx.physicalElement.updateMany({
          where: { id, version },
          data: {
            ...(input.name ? { name: input.name } : {}),
            ...(input.structureNodeId !== undefined ? { structureNodeId: input.structureNodeId } : {}),
            ...(attributes ? { attributes } : {}),
            version: { increment: 1 },
          },
        }),
      );
      const after = await tx.physicalElement.findUniqueOrThrow({ where: { id } });
      await this.audit.record(tx, actor, { projectId, entityType: 'PhysicalElement', entityId: id, action: 'UPDATE', before: elementDto(cur), after: elementDto(after) });
      return elementDto(after);
    }, TX);
  }

  async archiveElement(actor: Actor, projectId: string, id: string, version: number, reason: string) {
    return this.prisma.$transaction(async (tx) => {
      await assertProjectEditable(tx, actor.organizationId, projectId);
      const cur = await tx.physicalElement.findFirst({ where: { id, projectId } });
      if (!cur) throw notFound('Elemento');
      if (cur.archivedAt) throw conflict('NO_CHANGE', 'Elemento já está arquivado.');
      this.bump(await tx.physicalElement.updateMany({ where: { id, version }, data: { archivedAt: new Date(), version: { increment: 1 } } }));
      await this.audit.record(tx, actor, { projectId, entityType: 'PhysicalElement', entityId: id, action: 'ARCHIVE', before: { name: cur.name }, reason });
    }, TX);
  }
}
