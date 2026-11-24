import { Injectable } from '@nestjs/common';
import type {
  AnchorInput,
  AnchorOptionsDto,
  CalcInput,
  CalcPreviewDto,
  CreateMeasurementInput,
  FormulaVariableInput,
  MeasurementDetailDto,
  MeasurementDto,
  MeasurementRevisionDto,
  MeasurementSummaryDto,
  MemoryDto,
  ReviseMeasurementInput,
  RevisionListItemDto,
} from '@eapq/contracts';
import { evaluateFormula, expandMeasurements, findCoverageConflicts, FormulaError, manualQuantity, sumBy, type ExpandMeasurement } from '@eapq/domain';
import type { Actor } from '../../common/auth/auth-context.js';
import { AppError, conflict, notFound, versionConflict } from '../../common/errors.js';
import { assertProjectEditable } from '../../common/project-guard.js';
import type { Measurement, MeasurementRevision, Prisma } from '../../generated/prisma/client.js';
import { PrismaService, type Tx } from '../../prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { toRevisionElements } from '../constructive/constructive.service.js';
import { formulaInvalid } from '../formulas/formulas.service.js';
import { loadUnits, type OrgUnit } from '../formulas/units.js';
import { anchorLabel, coverageOf, expandUnits, loadContext, replacementKeys, type AnchorFields, type MeasurementCtx } from './context.js';

const TX = { timeout: 30_000 } as const;
/** Mesmo lock da EAP: medições e regeneração da EAP do empreendimento não correm em paralelo. */
const lock = (tx: Tx, projectId: string) => tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`wbs:${projectId}`}, 0))`;
const invalid = (detail: string, path = 'anchor') => new AppError(422, 'VALIDATION_FAILED', 'Dados inválidos', detail, [{ path, message: detail }]);

type Row = Measurement & { revisions: MeasurementRevision[] };

interface Computed {
  method: 'MANUAL' | 'FORMULA';
  formulaVersionId: string | null;
  inputs: Prisma.InputJsonValue;
  memory: MemoryDto;
  quantity: string;
}

@Injectable()
export class MeasurementsService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService) {}

  // ---------- cálculo ----------
  private async compute(tx: Tx, organizationId: string, target: OrgUnit, calc: CalcInput, units?: OrgUnit[]): Promise<Computed> {
    const all = units ?? (await loadUnits(tx, organizationId));
    try {
      if (calc.method === 'MANUAL') {
        const r = manualQuantity({ value: calc.value, unit: calc.unit }, all, target);
        return { method: 'MANUAL', formulaVersionId: null, inputs: { value: calc.value, unit: calc.unit }, memory: { ...r.memory, formula: null }, quantity: r.quantity };
      }
      const v = await tx.formulaVersion.findFirst({ where: { id: calc.formulaVersionId, organizationId }, include: { formula: true } });
      if (!v) throw notFound('Versão da fórmula');
      if (v.status !== 'PUBLISHED') throw invalid('Use uma versão publicada da fórmula.', 'calc.formulaVersionId');
      if (v.formula.archivedAt) throw invalid(`A fórmula ${v.formula.code} está arquivada.`, 'calc.formulaVersionId');
      const r = evaluateFormula({ expression: v.expression, variables: v.variables as unknown as FormulaVariableInput[] }, calc.inputs, all, target);
      return {
        method: 'FORMULA', formulaVersionId: v.id, inputs: calc.inputs,
        memory: { ...r.memory, formula: { code: v.formula.code, name: v.formula.name, versionNumber: v.number } }, quantity: r.quantity,
      };
    } catch (e) {
      if (e instanceof FormulaError) throw formulaInvalid(e.issues);
      throw e;
    }
  }

  private async serviceWithUnit(tx: Tx, organizationId: string, projectId: string, serviceId: string) {
    const s = await tx.service.findFirst({ where: { id: serviceId, organizationId, OR: [{ projectId: null }, { projectId }] }, include: { unit: true } });
    if (!s) throw notFound('Serviço');
    const units = await loadUnits(tx, organizationId);
    return { service: s, target: units.find((u) => u.id === s.unitId)!, units };
  }

  async preview(organizationId: string, projectId: string, input: { serviceId: string; calc: CalcInput }): Promise<CalcPreviewDto> {
    const { target, units } = await this.serviceWithUnit(this.prisma, organizationId, projectId, input.serviceId);
    const c = await this.compute(this.prisma, organizationId, target, input.calc, units);
    return { quantity: c.quantity, unit: target.symbol, memory: c.memory };
  }

  // ---------- âncoras ----------
  private anchorFields(a: AnchorInput): AnchorFields {
    const base: AnchorFields = { anchorKind: a.kind, structureNodeId: null, networkSegmentId: null, networkNodeId: null, physicalElementId: null, typologyId: null, elementKey: null, dwellingUnitId: null };
    switch (a.kind) {
      case 'STRUCTURE_NODE': return { ...base, structureNodeId: a.id };
      case 'NETWORK_SEGMENT': return { ...base, networkSegmentId: a.id };
      case 'NETWORK_NODE': return { ...base, networkNodeId: a.id };
      case 'PHYSICAL_ELEMENT': return { ...base, physicalElementId: a.id };
      case 'TYPOLOGY_ELEMENT': return { ...base, typologyId: a.typologyId, elementKey: a.elementKey, dwellingUnitId: a.unitId ?? null };
    }
  }

  private async checkAnchor(tx: Tx, projectId: string, f: AnchorFields, ctx: MeasurementCtx) {
    const archived = (x: { archivedAt: Date | null } | undefined, what: string) => {
      if (!x) throw notFound(what);
      if (x.archivedAt) throw invalid(`${what} está arquivado(a).`);
    };
    switch (f.anchorKind) {
      case 'STRUCTURE_NODE': return archived(ctx.nodes.get(f.structureNodeId!), 'Item do cadastro físico');
      case 'NETWORK_SEGMENT': return archived(ctx.segments.get(f.networkSegmentId!), 'Trecho');
      case 'NETWORK_NODE': return archived(ctx.netNodes.get(f.networkNodeId!), 'Dispositivo');
      case 'PHYSICAL_ELEMENT': return archived(ctx.physical.get(f.physicalElementId!), 'Elemento físico');
      case 'TYPOLOGY_ELEMENT': {
        if (!ctx.typologies.has(f.typologyId!)) throw notFound('Tipologia');
        const key = f.elementKey!;
        if (key.startsWith('unit:')) {
          if (!f.dwellingUnitId) throw invalid('Elemento incluído numa unidade só pode ser medido naquela unidade.');
          const o = await tx.unitOverride.findFirst({ where: { id: key.slice(5), projectId, unitId: f.dwellingUnitId, op: 'ADD_ELEMENT', archivedAt: null } });
          if (!o) throw notFound('Elemento incluído na unidade');
        } else {
          const exists = await tx.typologyElement.count({ where: { stableKey: key, revision: { typologyId: f.typologyId!, projectId } } });
          if (!exists) throw notFound('Elemento da tipologia');
        }
        if (f.dwellingUnitId) {
          const u = ctx.units.get(f.dwellingUnitId);
          if (!u) throw notFound('Unidade');
          if (u.typologyId !== f.typologyId) throw invalid('A unidade não pertence a esta tipologia.');
          if (!u.elements?.some((e) => e.stableKey === key)) throw invalid('O elemento não existe nesta unidade (revisão fixada e particularidades).');
        }
        return;
      }
    }
  }

  /** RN-DUP: nenhuma sobreposição de âncoras entre medições ativas do mesmo item da EAP e serviço. */
  private async checkOverlap(tx: Tx, projectId: string, wbsNodeId: string, serviceId: string, f: AnchorFields, ctx: MeasurementCtx, ignoreId?: string) {
    const others = (await tx.measurement.findMany({ where: { projectId, wbsNodeId, serviceId, archivedAt: null } })).filter((m) => m.id !== ignoreId);
    const repl = replacementKeys([...others, f]);
    const candidate = coverageOf(f, ctx, repl);
    if (f.anchorKind === 'TYPOLOGY_ELEMENT' && candidate.length === 0) {
      throw invalid('Nenhuma unidade com revisão fixada contém este elemento; não há o que medir.');
    }
    const conflicts = findCoverageConflicts(others.map((m) => ({ id: m.id, paths: coverageOf(m, ctx, repl) })), candidate);
    if (conflicts.length) {
      const labels = [...new Set(conflicts.map((c) => c.measurementId))].map((id) => anchorLabel(others.find((o) => o.id === id)!, ctx).label);
      throw new AppError(409, 'MEASUREMENT_OVERLAP', 'Dupla contagem', `Este serviço já é medido neste item da EAP numa âncora que se sobrepõe: ${labels.join('; ')}. Meça partes disjuntas ou revise a medição existente.`,
        [...new Set(conflicts.map((c) => c.measurementId))].map((id) => ({ path: `measurements.${id}`, message: anchorLabel(others.find((o) => o.id === id)!, ctx).label })));
    }
  }

  private async checkWbsService(tx: Tx, organizationId: string, projectId: string, wbsNodeId: string, serviceId: string) {
    const node = await tx.wbsNode.findFirst({ where: { id: wbsNodeId, projectId, organizationId } });
    if (!node) throw notFound('Item da EAP');
    if (node.archivedAt) throw invalid('O item da EAP está arquivado.', 'wbsNodeId');
    if (node.nodeType !== 'ITEM') throw invalid('Medições só em itens quantificáveis da EAP (não em agrupadores).', 'wbsNodeId');
    const link = await tx.wbsNodeService.findUnique({ where: { wbsNodeId_serviceId: { wbsNodeId, serviceId } } });
    if (!link) throw invalid('Vincule o serviço a este item da EAP antes de medir.', 'serviceId');
    return node;
  }

  // ---------- gravação ----------
  async create(actor: Actor, projectId: string, input: CreateMeasurementInput) {
    return this.prisma.$transaction(async (tx) => {
      await assertProjectEditable(tx, actor.organizationId, projectId);
      await lock(tx, projectId);
      await this.checkWbsService(tx, actor.organizationId, projectId, input.wbsNodeId, input.serviceId);
      const { service, target, units } = await this.serviceWithUnit(tx, actor.organizationId, projectId, input.serviceId);
      if (service.archivedAt) throw invalid('O serviço está arquivado.', 'serviceId');
      const ctx = await loadContext(tx, projectId);
      const f = this.anchorFields(input.anchor);
      await this.checkAnchor(tx, projectId, f, ctx);
      await this.checkOverlap(tx, projectId, input.wbsNodeId, input.serviceId, f, ctx);
      const c = await this.compute(tx, actor.organizationId, target, input.calc, units);
      const m = await tx.measurement.create({ data: { organizationId: actor.organizationId, projectId, wbsNodeId: input.wbsNodeId, serviceId: input.serviceId, ...f, quantity: c.quantity } });
      await tx.measurementRevision.create({ data: this.revisionData(actor, projectId, m.id, 1, c, target.id, input) });
      await this.audit.record(tx, actor, { projectId, entityType: 'Measurement', entityId: m.id, action: 'CREATE', after: { wbsNodeId: input.wbsNodeId, serviceId: input.serviceId, anchor: input.anchor, quantity: c.quantity, unit: target.symbol, method: c.method } });
      return { id: m.id };
    }, TX);
  }

  private revisionData(actor: Actor, projectId: string, measurementId: string, number: number, c: Computed, unitId: string, input: { sourceReference?: string | null; notes?: string | null; reason?: string | null }): Prisma.MeasurementRevisionUncheckedCreateInput {
    return {
      organizationId: actor.organizationId, projectId, measurementId, number, method: c.method, formulaVersionId: c.formulaVersionId,
      inputs: c.inputs, memory: c.memory as unknown as Prisma.InputJsonValue, quantity: c.quantity, unitId,
      sourceReference: input.sourceReference ?? null, notes: input.notes ?? null, reason: input.reason ?? null, createdById: actor.userId,
    };
  }

  /** Nova revisão (correção ou recálculo). A anterior permanece na memória de cálculo. */
  async revise(actor: Actor, projectId: string, id: string, version: number, input: ReviseMeasurementInput) {
    await this.prisma.$transaction(async (tx) => {
      await assertProjectEditable(tx, actor.organizationId, projectId);
      await lock(tx, projectId);
      const m = await tx.measurement.findFirst({ where: { id, projectId, organizationId: actor.organizationId } });
      if (!m) throw notFound('Medição');
      if (m.archivedAt) throw conflict('ARCHIVED', 'Medição arquivada não pode ser revisada. Restaure-a antes.');
      const { target, units } = await this.serviceWithUnit(tx, actor.organizationId, projectId, m.serviceId);
      const c = await this.compute(tx, actor.organizationId, target, input.calc, units);
      const r = await tx.measurement.updateMany({ where: { id, version }, data: { quantity: c.quantity, currentNumber: { increment: 1 }, version: { increment: 1 } } });
      if (r.count === 0) throw versionConflict();
      await tx.measurementRevision.create({ data: this.revisionData(actor, projectId, id, m.currentNumber + 1, c, target.id, input) });
      await this.audit.record(tx, actor, { projectId, entityType: 'Measurement', entityId: id, action: 'UPDATE', reason: input.reason, before: { quantity: m.quantity.toString(), revision: m.currentNumber }, after: { quantity: c.quantity, revision: m.currentNumber + 1, method: c.method } });
    }, TX);
  }

  async setArchived(actor: Actor, projectId: string, id: string, version: number, archived: boolean, reason?: string) {
    await this.prisma.$transaction(async (tx) => {
      await assertProjectEditable(tx, actor.organizationId, projectId);
      await lock(tx, projectId);
      const m = await tx.measurement.findFirst({ where: { id, projectId, organizationId: actor.organizationId } });
      if (!m) throw notFound('Medição');
      if (!archived) {
        if (!m.archivedAt) return;
        await this.checkWbsService(tx, actor.organizationId, projectId, m.wbsNodeId, m.serviceId);
        const ctx = await loadContext(tx, projectId);
        await this.checkOverlap(tx, projectId, m.wbsNodeId, m.serviceId, m, ctx, m.id);
      }
      const r = await tx.measurement.updateMany({ where: { id, version }, data: { archivedAt: archived ? new Date() : null, archiveReason: archived ? reason ?? null : null, version: { increment: 1 } } });
      if (r.count === 0) throw versionConflict();
      await this.audit.record(tx, actor, { projectId, entityType: 'Measurement', entityId: id, action: archived ? 'ARCHIVE' : 'UNARCHIVE', reason });
    }, TX);
  }

  // ---------- leitura ----------
  private async build(organizationId: string, projectId: string, rows: Row[], allActive?: Measurement[]): Promise<MeasurementDetailDto[]> {
    if (!rows.length) return [];
    const ctx = await loadContext(this.prisma, projectId);
    const active = allActive ?? (await this.prisma.measurement.findMany({ where: { projectId, archivedAt: null } }));
    const expanded = expandMeasurements(active.map(toExpand), expandUnits(ctx));
    const [nodes, services, users, latest] = await Promise.all([
      this.prisma.wbsNode.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.wbsNodeId))] } }, select: { id: true, code: true, title: true } }),
      this.prisma.service.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.serviceId))] } }, select: { id: true, code: true, description: true, unit: { select: { symbol: true } } } }),
      this.prisma.user.findMany({ where: { id: { in: [...new Set(rows.flatMap((r) => r.revisions.map((v) => v.createdById)))] } }, select: { id: true, name: true } }),
      this.latestFormulaVersions(organizationId),
    ]);
    const unitIds = [...new Set(rows.flatMap((r) => r.revisions.map((v) => v.unitId)))];
    const unitSym = new Map((await this.prisma.unitOfMeasure.findMany({ where: { id: { in: unitIds } }, select: { id: true, symbol: true } })).map((u) => [u.id, u.symbol]));
    const nodeById = new Map(nodes.map((n) => [n.id, n]));
    const svcById = new Map(services.map((s) => [s.id, s]));
    const userById = new Map(users.map((u) => [u.id, u.name]));
    const versionFormula = await this.versionFormulaIds(rows);
    const revDto = (v: MeasurementRevision): MeasurementRevisionDto => ({
      id: v.id, number: v.number, method: v.method, formulaVersionId: v.formulaVersionId, inputs: v.inputs, memory: v.memory as unknown as MemoryDto,
      quantity: v.quantity.toString(), unit: unitSym.get(v.unitId) ?? '', sourceReference: v.sourceReference, notes: v.notes, reason: v.reason,
      createdAt: v.createdAt.toISOString(), createdBy: userById.get(v.createdById) ?? '—',
    });
    return rows.map((m) => {
      const current = m.revisions.find((v) => v.number === m.currentNumber)!;
      const e = expanded.byMeasurement.get(m.id);
      const a = anchorLabel(m, ctx);
      const fv = current.formulaVersionId ? versionFormula.get(current.formulaVersionId) : undefined;
      const newest = fv ? latest.get(fv.formulaId) : undefined;
      const node = nodeById.get(m.wbsNodeId)!;
      const svc = svcById.get(m.serviceId)!;
      return {
        id: m.id, wbsNodeId: m.wbsNodeId, wbsCode: node.code, wbsTitle: node.title, serviceId: m.serviceId, serviceCode: svc.code, serviceDescription: svc.description, unit: svc.unit.symbol,
        anchor: { kind: m.anchorKind, label: a.label, archived: a.archived, ...(m.typologyId && { typologyId: m.typologyId, elementKey: m.elementKey!, unitId: m.dwellingUnitId }) },
        quantity: m.quantity.toString(), multiplier: e?.count ?? 0, effectiveTotal: e?.total ?? '0', replacedUnits: e?.replacedUnits ?? 0,
        warnings: expanded.warnings.filter((w) => w.measurementId === m.id).map((w) => w.message),
        current: revDto(current),
        formulaOutdated: fv && newest && newest.number > fv.number ? { latestVersionId: newest.id, latestNumber: newest.number } : null,
        archivedAt: m.archivedAt?.toISOString() ?? null, archiveReason: m.archiveReason, version: m.version,
        revisions: m.revisions.sort((x, y) => y.number - x.number).map(revDto),
      };
    });
  }

  private async latestFormulaVersions(organizationId: string) {
    const vs = await this.prisma.formulaVersion.findMany({ where: { organizationId, status: 'PUBLISHED' }, select: { id: true, formulaId: true, number: true }, orderBy: { number: 'desc' } });
    const out = new Map<string, { id: string; number: number }>();
    for (const v of vs) if (!out.has(v.formulaId)) out.set(v.formulaId, v);
    return out;
  }

  private async versionFormulaIds(rows: Row[]) {
    const ids = [...new Set(rows.flatMap((r) => r.revisions.map((v) => v.formulaVersionId).filter((x): x is string => !!x)))];
    const vs = await this.prisma.formulaVersion.findMany({ where: { id: { in: ids } }, select: { id: true, formulaId: true, number: true } });
    return new Map(vs.map((v) => [v.id, v]));
  }

  async list(organizationId: string, projectId: string, q: { wbsNodeId?: string; serviceId?: string; outdated?: 'true' | 'false'; archived?: 'true' | 'false' }): Promise<MeasurementDto[]> {
    const rows = await this.prisma.measurement.findMany({
      where: { projectId, organizationId, ...(q.wbsNodeId && { wbsNodeId: q.wbsNodeId }), ...(q.serviceId && { serviceId: q.serviceId }), ...(q.archived !== 'true' && { archivedAt: null }) },
      include: { revisions: true }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    const built = await this.build(organizationId, projectId, rows);
    const out = q.outdated === 'true' ? built.filter((m) => m.formulaOutdated) : built;
    return out.map(({ revisions: _r, ...m }) => m);
  }

  async detail(organizationId: string, projectId: string, id: string): Promise<MeasurementDetailDto> {
    const m = await this.prisma.measurement.findFirst({ where: { id, projectId, organizationId }, include: { revisions: true } });
    if (!m) throw notFound('Medição');
    return (await this.build(organizationId, projectId, [m]))[0]!;
  }

  /** Totais efetivos (replicação por tipologia aplicada) por item da EAP × serviço. */
  async summary(organizationId: string, projectId: string): Promise<MeasurementSummaryDto> {
    const active = await this.prisma.measurement.findMany({ where: { projectId, organizationId, archivedAt: null } });
    const ctx = await loadContext(this.prisma, projectId);
    const ex = expandMeasurements(active.map(toExpand), expandUnits(ctx));
    const totals = sumBy(ex.lines, (l) => `${l.wbsNodeId}|${l.serviceId}`);
    const counts = new Map<string, number>();
    for (const m of active) counts.set(`${m.wbsNodeId}|${m.serviceId}`, (counts.get(`${m.wbsNodeId}|${m.serviceId}`) ?? 0) + 1);
    const services = new Map((await this.prisma.service.findMany({ where: { id: { in: [...new Set(active.map((m) => m.serviceId))] } }, select: { id: true, unit: { select: { symbol: true } } } })).map((s) => [s.id, s.unit.symbol]));
    return {
      items: [...counts].map(([k, count]) => {
        const [wbsNodeId, serviceId] = k.split('|') as [string, string];
        return { wbsNodeId, serviceId, count, total: totals.get(k) ?? '0', unit: services.get(serviceId) ?? '' };
      }),
    };
  }

  async revisions(organizationId: string, projectId: string, q: { q?: string; limit: number; offset: number }): Promise<{ total: number; items: RevisionListItemDto[] }> {
    const where: Prisma.MeasurementRevisionWhereInput = {
      projectId, organizationId,
      ...(q.q && { OR: [
        { measurement: { service: { code: { contains: q.q, mode: 'insensitive' } } } },
        { measurement: { service: { description: { contains: q.q, mode: 'insensitive' } } } },
        { measurement: { wbsNode: { title: { contains: q.q, mode: 'insensitive' } } } },
        { measurement: { wbsNode: { code: { startsWith: q.q } } } },
        { sourceReference: { contains: q.q, mode: 'insensitive' } },
      ] }),
    };
    const [total, revs] = await Promise.all([
      this.prisma.measurementRevision.count({ where }),
      this.prisma.measurementRevision.findMany({ where, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: q.limit, skip: q.offset, include: { measurement: { include: { wbsNode: { select: { code: true, title: true } }, service: { select: { code: true, description: true } } } }, unit: { select: { symbol: true } } } }),
    ]);
    const ctx = await loadContext(this.prisma, projectId);
    const users = new Map((await this.prisma.user.findMany({ where: { id: { in: [...new Set(revs.map((r) => r.createdById))] } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]));
    return {
      total,
      items: revs.map((v) => ({
        id: v.id, number: v.number, method: v.method, formulaVersionId: v.formulaVersionId, inputs: v.inputs, memory: v.memory as unknown as MemoryDto,
        quantity: v.quantity.toString(), unit: v.unit.symbol, sourceReference: v.sourceReference, notes: v.notes, reason: v.reason,
        createdAt: v.createdAt.toISOString(), createdBy: users.get(v.createdById) ?? '—',
        measurementId: v.measurementId, wbsCode: v.measurement.wbsNode.code, wbsTitle: v.measurement.wbsNode.title,
        serviceCode: v.measurement.service.code, serviceDescription: v.measurement.service.description, anchorLabel: anchorLabel(v.measurement, ctx).label,
      })),
    };
  }

  /** Opções de âncora para a tela de medição. */
  async anchors(projectId: string): Promise<AnchorOptionsDto> {
    const ctx = await loadContext(this.prisma, projectId);
    const revisions = await this.prisma.typologyRevision.findMany({ where: { projectId }, include: { elements: true }, orderBy: { number: 'desc' } });
    const typologies = [...ctx.typologies.values()].sort((a, b) => a.code.localeCompare(b.code, 'pt-BR')).map((t) => {
      // elementos de todas as revisões (a mais recente define o rótulo e a ordem)
      const seen = new Map<string, { key: string; label: string; depth: number }>();
      for (const r of revisions.filter((x) => x.typologyId === t.id)) {
        const tree = toRevisionElements(r.elements); // ordem de árvore, determinística
        const parentOf = new Map(tree.map((e) => [e.stableKey, e.parentStableKey]));
        const depth = (k: string) => { let d = 0; let p = parentOf.get(k) ?? null; while (p) { d++; p = parentOf.get(p) ?? null; } return d; };
        for (const e of tree) if (!seen.has(e.stableKey)) seen.set(e.stableKey, { key: e.stableKey, label: e.name, depth: depth(e.stableKey) });
      }
      const units = [...ctx.units.values()].filter((u) => u.typologyId === t.id).sort((a, b) => a.label.localeCompare(b.label, 'pt-BR', { numeric: true })).map((u) => ({
        id: u.id, label: u.label, extraElements: (u.elements ?? []).filter((e) => e.source === 'UNIT').map((e) => ({ key: e.stableKey, label: e.name })),
      }));
      return { id: t.id, code: t.code, name: t.name, elements: [...seen.values()], units };
    });
    return {
      structure: [...ctx.nodes.values()].sort((a, b) => a.code.localeCompare(b.code, 'pt-BR', { numeric: true })).map((n) => ({ id: n.id, label: `${n.code} ${n.name}`, kind: n.kind, path: n.path, archived: !!n.archivedAt })),
      typologies,
      segments: [...ctx.segments.values()].filter((s) => !s.archivedAt).map((s) => ({ id: s.id, label: s.label })).sort((a, b) => a.label.localeCompare(b.label, 'pt-BR', { numeric: true })),
      networkNodes: [...ctx.netNodes.values()].filter((s) => !s.archivedAt).map((s) => ({ id: s.id, label: s.label })).sort((a, b) => a.label.localeCompare(b.label, 'pt-BR', { numeric: true })),
      physicalElements: [...ctx.physical.values()].filter((p) => !p.archivedAt).map((p) => ({ id: p.id, label: anchorLabel({ anchorKind: 'PHYSICAL_ELEMENT', physicalElementId: p.id, structureNodeId: null, networkSegmentId: null, networkNodeId: null, typologyId: null, elementKey: null, dwellingUnitId: null }, ctx).label })),
    };
  }
}

function toExpand(m: Measurement): ExpandMeasurement {
  return {
    id: m.id, wbsNodeId: m.wbsNodeId, serviceId: m.serviceId, quantity: m.quantity.toString(),
    anchor: m.anchorKind === 'TYPOLOGY_ELEMENT' ? { kind: 'TYPOLOGY_ELEMENT', typologyId: m.typologyId!, elementKey: m.elementKey!, unitId: m.dwellingUnitId } : { kind: 'OTHER' },
  };
}
