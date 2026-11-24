import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { Decimal } from 'decimal.js';
import type { CONSOLIDATION_DIMENSION_KEYS as DIM_KEYS, FrozenMeasurementDto, IssueRevisionInput, MemoryDto, ProjectRevisionDto, RevisionCompareDto, RevisionSummary } from '@eapq/contracts';
import { CONSOLIDATION_DIMENSIONS, diffByKey, expandMeasurements, grandTotals, quantityDeltas, revisionCode, type ExpandMeasurement } from '@eapq/domain';
import type { Actor } from '../../common/auth/auth-context.js';
import { notFound } from '../../common/errors.js';
import { assertProjectEditable } from '../../common/project-guard.js';
import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService, type Tx } from '../../prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { ConsolidationService } from '../consolidation/consolidation.service.js';
import { enrichedCte } from '../consolidation/sql.js';
import { anchorLabel, expandUnits, loadContext } from '../measurements/context.js';
import { documentsById } from '../measurements/measurements.service.js';

const TX = { timeout: 120_000 } as const;
const MAX_LIST = 500;
type Dim = (typeof DIM_KEYS)[number];
const lock = (tx: Tx, projectId: string) => tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`wbs:${projectId}`}, 0))`;
const LINE_COLS = Prisma.raw(['"mid"', '"qty"', '"unit_symbol"', '"wbsItem"', '"wbs1"', '"wbs2"', '"wbs3"', '"service"', '"category"', '"module"', '"PHASE"', '"STAGE"', '"SECTOR"', '"BLOCK_QUADRA"', '"LOT"', '"STREET"', '"TOWER"', '"BUILDING_BLOCK"', '"FLOOR"', '"typology"', '"unit"', '"system"', '"network"'].join(', '));

interface Frozen {
  wbs: { id: string; parentId: string | null; code: string; title: string; nodeType: string }[];
  structure: { id: string; code: string; name: string; kind: string }[];
  measurements: { id: string; label: string; quantity: string; unit: string; revisionNumber: number; effectiveTotal: string }[];
  quantities: { key: string; unit: string; total: string }[];
  wbsLabel: (id: string) => string;
  serviceLabel: (id: string) => string;
}

@Injectable()
export class RevisionsService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService, private readonly consolidation: ConsolidationService) {}

  private dto(r: { id: string; number: number; code: string; title: string; notes: string | null; summary: Prisma.JsonValue; issuedAt: Date; issuedById: string }, users: Map<string, string>): ProjectRevisionDto {
    return { id: r.id, number: r.number, code: r.code, title: r.title, notes: r.notes, summary: r.summary as unknown as RevisionSummary, issuedAt: r.issuedAt.toISOString(), issuedBy: users.get(r.issuedById) ?? '—' };
  }

  async list(projectId: string): Promise<ProjectRevisionDto[]> {
    const rows = await this.prisma.projectRevision.findMany({ where: { projectId }, orderBy: { number: 'desc' } });
    const users = new Map((await this.prisma.user.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.issuedById))] } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]));
    return rows.map((r) => this.dto(r, users));
  }

  /** Emite a próxima revisão: fotografia completa e imutável, gravada numa única transação. */
  async issue(actor: Actor, projectId: string, input: IssueRevisionInput): Promise<ProjectRevisionDto> {
    const rev = await this.prisma.$transaction(async (tx) => {
      await assertProjectEditable(tx, actor.organizationId, projectId);
      await lock(tx, projectId);
      const last = await tx.projectRevision.findFirst({ where: { projectId }, orderBy: { number: 'desc' }, select: { number: true } });
      const number = last ? last.number + 1 : 0;
      const id = randomUUID();
      const [wbs, structure, ms, ctx, totalsRows] = await Promise.all([
        tx.wbsNode.findMany({ where: { projectId, archivedAt: null } }),
        tx.structureNode.findMany({ where: { projectId, archivedAt: null } }),
        tx.measurement.findMany({ where: { projectId, archivedAt: null }, include: { revisions: { select: { id: true, number: true } }, service: { select: { code: true, unit: { select: { symbol: true } } } } } }),
        loadContext(tx, projectId),
        this.consolidation.rawRows(projectId, [], {}, null, tx),
      ]);
      const ex = expandMeasurements(ms.map((m): ExpandMeasurement => ({
        id: m.id, wbsNodeId: m.wbsNodeId, serviceId: m.serviceId, quantity: m.quantity.toString(),
        anchor: m.anchorKind === 'TYPOLOGY_ELEMENT' ? { kind: 'TYPOLOGY_ELEMENT', typologyId: m.typologyId!, elementKey: m.elementKey!, unitId: m.dwellingUnitId } : { kind: 'OTHER' },
      })), expandUnits(ctx));
      const lines = totalsRows.rows.reduce((a, r) => a + r.lines, 0);
      const summary: RevisionSummary = {
        wbsNodes: wbs.length, items: wbs.filter((w) => w.nodeType === 'ITEM').length, structureNodes: structure.length,
        measurements: ms.length, lines, totals: grandTotals(totalsRows.rows),
      };
      const r = await tx.projectRevision.create({ data: { id, organizationId: actor.organizationId, projectId, number, code: revisionCode(number), title: input.title, notes: input.notes ?? null, summary: summary as unknown as Prisma.InputJsonValue, issuedById: actor.userId } });
      if (wbs.length) await tx.revisionWbsNode.createMany({ data: wbs.map((w) => ({ revisionId: id, wbsNodeId: w.id, parentId: w.parentId, code: w.code, title: w.title, nodeType: w.nodeType, status: w.status, depth: w.depth, position: w.position })) });
      if (structure.length) await tx.revisionStructureNode.createMany({ data: structure.map((n) => ({ revisionId: id, structureNodeId: n.id, parentId: n.parentId, kind: n.kind, code: n.code, name: n.name, depth: n.depth, position: n.position })) });
      if (ms.length) await tx.revisionMeasurement.createMany({ data: ms.map((m) => {
        const cur = m.revisions.find((v) => v.number === m.currentNumber)!;
        const e = ex.byMeasurement.get(m.id);
        return { revisionId: id, measurementId: m.id, measurementRevisionId: cur.id, revisionNumber: cur.number, wbsNodeId: m.wbsNodeId, serviceId: m.serviceId, serviceCode: m.service.code, anchorLabel: anchorLabel(m, ctx).label.slice(0, 400), quantity: m.quantity, unit: m.service.unit.symbol, multiplier: e?.count ?? 0, effectiveTotal: e?.total ?? '0' };
      }) });
      // linhas efetivas: a mesma consulta da consolidação, gravada
      await tx.$executeRaw`${enrichedCte(projectId)} INSERT INTO revision_line ("revisionId", ${LINE_COLS}) SELECT ${id}::uuid, ${LINE_COLS} FROM enriched`;
      // rótulos de tudo o que as linhas referenciam (e dos nós da EAP), como estão agora
      const wanted: { dim: Dim; ids: string[] }[] = [];
      for (const d of CONSOLIDATION_DIMENSIONS) {
        const c = Prisma.raw(`"${d}"`);
        const vals = await tx.$queryRaw<{ v: string }[]>`SELECT DISTINCT ${c}::text AS v FROM revision_line WHERE "revisionId" = ${id}::uuid AND ${c} IS NOT NULL`;
        wanted.push({ dim: d, ids: vals.map((x) => x.v) });
      }
      wanted.push({ dim: 'wbsItem', ids: wbs.map((w) => w.id) });
      const labels = await this.consolidation.labels(tx, actor.organizationId, projectId, wanted);
      if (labels.size) await tx.revisionLabel.createMany({ data: [...labels].map(([entityId, label]) => ({ revisionId: id, entityId, label: label.slice(0, 400) })) });
      await this.audit.record(tx, actor, { projectId, entityType: 'ProjectRevision', entityId: id, action: 'ISSUE', after: { code: r.code, title: r.title, summary } });
      return r;
    }, TX);
    const users = new Map([[actor.userId, (await this.prisma.user.findUniqueOrThrow({ where: { id: actor.userId } })).name]]);
    return this.dto(rev, users);
  }

  private async revision(projectId: string, id: string) {
    const r = await this.prisma.projectRevision.findFirst({ where: { id, projectId } });
    if (!r) throw notFound('Revisão');
    return r;
  }

  async get(projectId: string, id: string): Promise<ProjectRevisionDto> {
    const r = await this.revision(projectId, id);
    const users = new Map([[r.issuedById, (await this.prisma.user.findUnique({ where: { id: r.issuedById } }))?.name ?? '—']]);
    return this.dto(r, users);
  }

  /** Medição como estava na revisão (memória de cálculo congelada). */
  async frozenMeasurement(projectId: string, id: string, measurementId: string): Promise<FrozenMeasurementDto> {
    const r = await this.revision(projectId, id);
    const m = await this.prisma.revisionMeasurement.findUnique({ where: { revisionId_measurementId: { revisionId: id, measurementId } }, include: { measurementRevision: { include: { unit: { select: { symbol: true } } } } } });
    if (!m) throw notFound('Medição na revisão');
    const w = await this.prisma.revisionWbsNode.findUnique({ where: { revisionId_wbsNodeId: { revisionId: id, wbsNodeId: m.wbsNodeId } } });
    const v = m.measurementRevision;
    const author = await this.prisma.user.findUnique({ where: { id: v.createdById }, select: { name: true } });
    return {
      revisionCode: r.code, measurementId, wbsCode: w?.code ?? '', wbsTitle: w?.title ?? '', serviceCode: m.serviceCode, anchorLabel: m.anchorLabel, multiplier: m.multiplier, effectiveTotal: new Decimal(m.effectiveTotal.toString()).toFixed(),
      revision: {
        id: v.id, number: v.number, method: v.method, formulaVersionId: v.formulaVersionId, inputs: v.inputs, memory: v.memory as unknown as MemoryDto,
        quantity: new Decimal(v.quantity.toString()).toFixed(), unit: v.unit.symbol, sourceReference: v.sourceReference, notes: v.notes, reason: v.reason,
        createdAt: v.createdAt.toISOString(), createdBy: author?.name ?? '—',
        document: v.documentId ? (await documentsById(this.prisma, [v.documentId])).get(v.documentId) ?? null : null,
      },
    };
  }

  private async frozen(organizationId: string, projectId: string, revisionId: string | null): Promise<Frozen> {
    const q = (await this.consolidation.rawRows(projectId, ['wbsItem', 'service'], {}, revisionId)).rows.map((r) => ({ key: `${r.key['wbsItem']}|${r.key['service']}`, unit: r.unit, total: r.total }));
    if (revisionId) {
      const [wbs, structure, ms, labels] = await Promise.all([
        this.prisma.revisionWbsNode.findMany({ where: { revisionId } }),
        this.prisma.revisionStructureNode.findMany({ where: { revisionId } }),
        this.prisma.revisionMeasurement.findMany({ where: { revisionId } }),
        this.prisma.revisionLabel.findMany({ where: { revisionId } }),
      ]);
      const lab = new Map(labels.map((l) => [l.entityId, l.label]));
      return {
        wbs: wbs.map((w) => ({ id: w.wbsNodeId, parentId: w.parentId, code: w.code, title: w.title, nodeType: w.nodeType })),
        structure: structure.map((n) => ({ id: n.structureNodeId, code: n.code, name: n.name, kind: n.kind })),
        measurements: ms.map((m) => ({ id: m.measurementId, label: `${lab.get(m.wbsNodeId) ?? ''} · ${m.serviceCode} · ${m.anchorLabel}`, quantity: new Decimal(m.quantity.toString()).toFixed(), unit: m.unit, revisionNumber: m.revisionNumber, effectiveTotal: new Decimal(m.effectiveTotal.toString()).toFixed() })),
        quantities: q, wbsLabel: (id) => lab.get(id) ?? '—', serviceLabel: (id) => lab.get(id) ?? '—',
      };
    }
    const [wbs, structure, ms, ctx] = await Promise.all([
      this.prisma.wbsNode.findMany({ where: { projectId, archivedAt: null } }),
      this.prisma.structureNode.findMany({ where: { projectId, archivedAt: null } }),
      this.prisma.measurement.findMany({ where: { projectId, archivedAt: null }, include: { service: { select: { code: true, unit: { select: { symbol: true } } } } } }),
      loadContext(this.prisma, projectId),
    ]);
    const ex = expandMeasurements(ms.map((m): ExpandMeasurement => ({ id: m.id, wbsNodeId: m.wbsNodeId, serviceId: m.serviceId, quantity: m.quantity.toString(), anchor: m.anchorKind === 'TYPOLOGY_ELEMENT' ? { kind: 'TYPOLOGY_ELEMENT', typologyId: m.typologyId!, elementKey: m.elementKey!, unitId: m.dwellingUnitId } : { kind: 'OTHER' } })), expandUnits(ctx));
    const labels = await this.consolidation.labels(this.prisma, organizationId, projectId, [{ dim: 'wbsItem', ids: [...new Set([...wbs.map((w) => w.id), ...q.map((x) => x.key.split('|')[0]!)])] }, { dim: 'service', ids: [...new Set(q.map((x) => x.key.split('|')[1]!))] }]);
    return {
      wbs: wbs.map((w) => ({ id: w.id, parentId: w.parentId, code: w.code, title: w.title, nodeType: w.nodeType })),
      structure: structure.map((n) => ({ id: n.id, code: n.code, name: n.name, kind: n.kind })),
      measurements: ms.map((m) => ({ id: m.id, label: `${labels.get(m.wbsNodeId) ?? ''} · ${m.service.code} · ${anchorLabel(m, ctx).label}`, quantity: m.quantity.toString(), unit: m.service.unit.symbol, revisionNumber: m.currentNumber, effectiveTotal: ex.byMeasurement.get(m.id)?.total ?? '0' })),
      quantities: q, wbsLabel: (id) => labels.get(id) ?? '—', serviceLabel: (id) => labels.get(id) ?? '—',
    };
  }

  /** Compara uma revisão com outra (ou com o estado atual): inclusões, exclusões e alterações com delta. */
  async compare(organizationId: string, projectId: string, fromId: string, to: string): Promise<RevisionCompareDto> {
    const from = await this.revision(projectId, fromId);
    const toRev = to === 'current' ? null : await this.revision(projectId, to);
    const [a, b] = await Promise.all([this.frozen(organizationId, projectId, from.id), this.frozen(organizationId, projectId, toRev?.id ?? null)]);
    const label = (f: Frozen, key: string) => { const [w, s] = key.split('|') as [string, string]; return { wbs: f.wbsLabel(w), service: f.serviceLabel(s) }; };
    const q = quantityDeltas(a.quantities, b.quantities).map((d) => ({ ...label(d.kind === 'removed' ? a : b, d.key), unit: d.unit, before: d.before, after: d.after, delta: d.delta, kind: d.kind }));
    const md = diffByKey(a.measurements, b.measurements, (m) => m.id, ['quantity', 'unit', 'revisionNumber']);
    const wd = diffByKey(a.wbs, b.wbs, (w) => w.id, ['code', 'title', 'parentId', 'nodeType']);
    const sd = diffByKey(a.structure, b.structure, (n) => n.id, ['code', 'name']);
    const cap = <T>(xs: T[]) => xs.slice(0, MAX_LIST);
    return {
      from: { id: from.id, code: from.code },
      to: { id: toRev?.id ?? null, code: toRev?.code ?? 'Estado atual' },
      quantities: cap(q),
      measurements: {
        added: cap(md.added.map((m) => ({ id: m.id, label: m.label, quantity: m.effectiveTotal, unit: m.unit }))),
        removed: cap(md.removed.map((m) => ({ id: m.id, label: m.label, quantity: m.effectiveTotal, unit: m.unit }))),
        changed: cap(md.changed.map((c) => ({ id: c.after.id, label: c.after.label, before: c.before.quantity, after: c.after.quantity, delta: new Decimal(c.after.quantity).minus(c.before.quantity).toFixed(), unit: c.after.unit, fromRevision: c.before.revisionNumber, toRevision: c.after.revisionNumber }))),
      },
      wbs: {
        added: cap(wd.added.map((w) => ({ id: w.id, code: w.code, title: w.title }))),
        removed: cap(wd.removed.map((w) => ({ id: w.id, code: w.code, title: w.title }))),
        changed: cap(wd.changed.map((c) => ({ id: c.after.id, code: c.after.code, title: c.after.title, before: `${c.before.code} ${c.before.title}`, fields: c.fields }))),
      },
      structure: {
        added: cap(sd.added.map((n) => ({ id: n.id, label: `${n.code} ${n.name}` }))),
        removed: cap(sd.removed.map((n) => ({ id: n.id, label: `${n.code} ${n.name}` }))),
        changed: cap(sd.changed.map((c) => ({ id: c.after.id, label: `${c.after.code} ${c.after.name}`, before: `${c.before.code} ${c.before.name}`, fields: c.fields }))),
      },
      truncated: [q, md.added, md.removed, md.changed, wd.added, wd.removed, wd.changed, sd.added, sd.removed, sd.changed].some((x) => x.length > MAX_LIST),
    };
  }
}
