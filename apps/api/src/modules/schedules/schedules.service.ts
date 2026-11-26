import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import type {
  AnchorInput,
  CreateScheduleInput,
  MemoryDto,
  SaveScheduleInput,
  ScheduleColumnDto,
  ScheduleCreateResultDto,
  ScheduleDetailDto,
  ScheduleKind,
  ScheduleLaunchResultDto,
  ScheduleListItemDto,
  ScheduleMemoryDto,
  ScheduleRowDto,
} from '@eapq/contracts';
import { computeSchedule, expandMeasurements, type ScheduleRowInput, type ScheduleService } from '@eapq/domain';
import type { Actor } from '../../common/auth/auth-context.js';
import { AppError, conflict, notFound, versionConflict } from '../../common/errors.js';
import { assertProjectEditable } from '../../common/project-guard.js';
import type { Prisma, Schedule, ScheduleColumn, ScheduleRow } from '../../generated/prisma/client.js';
import { PrismaService, type Tx } from '../../prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { loadUnits } from '../formulas/units.js';
import { anchorLabel, expandUnits, loadContext, type AnchorFields, type MeasurementCtx } from '../measurements/context.js';
import { invalid, lock, MeasurementsService } from '../measurements/measurements.service.js';
import { syncOwnedMeasurements, type OwnedPlan } from '../measurements/owned.js';

const TX = { timeout: 60_000 } as const;
const ANCHOR_COLS = ['anchorKind', 'structureNodeId', 'networkSegmentId', 'networkNodeId', 'physicalElementId', 'typologyId', 'elementKey', 'dwellingUnitId'] as const;
const NO_ANCHOR = Object.fromEntries(ANCHOR_COLS.map((k) => [k, null])) as unknown as AnchorFields;

type Row = ScheduleRow & { services: { serviceId: string; position: number }[]; unit: { symbol: string } };
type Full = Schedule & { columns: ScheduleColumn[]; rows: Row[] };

const anchorOf = (c: ScheduleColumn): AnchorFields | null => (c.anchorKind ? Object.fromEntries(ANCHOR_COLS.map((k) => [k, c[k]])) as AnchorFields : null);
function toAnchorInput(f: AnchorFields | null): AnchorInput | null {
  if (!f) return null;
  switch (f.anchorKind) {
    case 'STRUCTURE_NODE': return { kind: f.anchorKind, id: f.structureNodeId! };
    case 'NETWORK_SEGMENT': return { kind: f.anchorKind, id: f.networkSegmentId! };
    case 'NETWORK_NODE': return { kind: f.anchorKind, id: f.networkNodeId! };
    case 'PHYSICAL_ELEMENT': return { kind: f.anchorKind, id: f.physicalElementId! };
    case 'TYPOLOGY_ELEMENT': return { kind: f.anchorKind, typologyId: f.typologyId!, elementKey: f.elementKey!, unitId: f.dwellingUnitId };
  }
}
const sortedServices = (r: Row) => [...r.services].sort((a, b) => a.position - b.position).map((s) => s.serviceId);
const rowDto = (r: Row): ScheduleRowDto => ({
  key: r.key, code: r.code, description: r.description, spec: r.spec, unit: r.unit.symbol,
  width: r.width?.toString() ?? null, height: r.height?.toString() ?? null, serviceIds: sortedServices(r), cells: r.cells as Record<string, string>,
});
/** Impressão digital do que o lançamento grava (destinos, itens, serviços e quantidades). */
function contentHash(s: Full) {
  const cols = [...s.columns].sort((a, b) => a.position - b.position).map((c) => [c.key, c.label, c.wbsNodeId, ANCHOR_COLS.map((k) => c[k] ?? null)]);
  const rows = [...s.rows].sort((a, b) => a.position - b.position).map((r) => { const d = rowDto(r); return [d.key, d.code, d.description, d.spec, d.unit, d.width, d.height, d.serviceIds, Object.entries(d.cells).sort()]; });
  return createHash('sha256').update(JSON.stringify([cols, rows])).digest('hex');
}
const fingerprint = (m: MemoryDto) => JSON.stringify([m.method, m.schedule?.column.key ?? null, (m.schedule?.rows ?? []).map((r) => [r.code, r.description, r.spec, r.entered, r.enteredUnit, r.perItem, r.value])]);
const include = { columns: true, rows: { include: { services: { select: { serviceId: true, position: true } }, unit: { select: { symbol: true } } } } } as const;

@Injectable()
export class SchedulesService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService, private readonly measurements: MeasurementsService) {}

  private async schedule(tx: Tx, organizationId: string, projectId: string, id: string): Promise<Full> {
    const s = await tx.schedule.findFirst({ where: { id, projectId, organizationId }, include });
    if (!s) throw notFound('Quadro');
    return s;
  }

  async create(actor: Actor, projectId: string, input: CreateScheduleInput): Promise<ScheduleCreateResultDto> {
    return this.prisma.$transaction(async (tx) => {
      await assertProjectEditable(tx, actor.organizationId, projectId);
      const s = await tx.schedule.create({ data: { organizationId: actor.organizationId, projectId, kind: input.kind, title: input.title, createdById: actor.userId } });
      let dropped = 0;
      let copied = 0;
      if (input.copyFromId) {
        // lista padrão: copia os itens (sem destinos e sem quantidades) de outro quadro da organização
        const src = await tx.schedule.findFirst({ where: { id: input.copyFromId, organizationId: actor.organizationId }, include });
        if (!src) throw notFound('Quadro de origem');
        const usable = new Set((await tx.service.findMany({ where: { organizationId: actor.organizationId, archivedAt: null, id: { in: src.rows.flatMap((r) => r.services.map((x) => x.serviceId)) }, OR: [{ projectId: null }, { projectId }] }, select: { id: true } })).map((x) => x.id));
        for (const r of [...src.rows].sort((a, b) => a.position - b.position)) {
          const sids = sortedServices(r).filter((x) => usable.has(x));
          dropped += r.services.length - sids.length;
          await tx.scheduleRow.create({ data: { organizationId: actor.organizationId, projectId, scheduleId: s.id, key: r.key, position: r.position, code: r.code, description: r.description, spec: r.spec, unitId: r.unitId, width: r.width, height: r.height, cells: {}, services: { create: sids.map((serviceId, position) => ({ serviceId, position })) } } });
          copied++;
        }
      }
      await this.audit.record(tx, actor, { projectId, entityType: 'Schedule', entityId: s.id, action: 'CREATE', after: { kind: input.kind, title: input.title, copiedFrom: input.copyFromId ?? null, rowsCopied: copied, servicesDropped: dropped } });
      return { id: s.id, droppedServices: dropped };
    });
  }

  /** Grava a grade inteira (destinos e itens) com bloqueio otimista. */
  /** Conteúdo atual no formato de gravação (para atualizar os itens preservando destinos e serviços). */
  async currentContent(tx: Tx, organizationId: string, projectId: string, id: string) {
    const s = await this.schedule(tx, organizationId, projectId, id);
    return {
      schedule: s, launched: !!s.launchedHash,
      columns: [...s.columns].sort((a, b) => a.position - b.position).map((c) => ({ key: c.key, label: c.label, wbsNodeId: c.wbsNodeId, anchor: toAnchorInput(anchorOf(c)) })),
      rows: [...s.rows].sort((a, b) => a.position - b.position).map(rowDto),
    };
  }

  async save(actor: Actor, projectId: string, id: string, version: number, input: SaveScheduleInput) {
    await this.prisma.$transaction((tx) => this.saveIn(tx, actor, projectId, id, version, input), TX);
  }

  /** Mesmo caso de uso dentro de uma transação existente (ex.: atualização pela migração de planilha). */
  async saveIn(tx: Tx, actor: Actor, projectId: string, id: string, version: number, input: SaveScheduleInput, reason?: string) {
    await assertProjectEditable(tx, actor.organizationId, projectId);
    const s = await this.schedule(tx, actor.organizationId, projectId, id);
    if (s.archivedAt) throw conflict('ARCHIVED', 'Quadro arquivado não pode ser alterado. Restaure-o antes.');
    const dup = (keys: string[], what: string) => { const seen = new Set<string>(); for (const k of keys) { if (seen.has(k)) throw invalid(`${what} repetido: ${k}.`, what === 'Destino' ? 'columns' : 'rows'); seen.add(k); } };
    dup(input.columns.map((c) => c.key), 'Destino');
    dup(input.rows.map((r) => r.key), 'Item');
    const colKeys = new Set(input.columns.map((c) => c.key));
    // destinos: item da EAP quantificável e âncora válida do empreendimento
    const wbsIds = [...new Set(input.columns.map((c) => c.wbsNodeId).filter((x): x is string => !!x))];
    const nodes = new Map((await tx.wbsNode.findMany({ where: { id: { in: wbsIds }, projectId, organizationId: actor.organizationId } })).map((n) => [n.id, n]));
    for (const w of wbsIds) {
      const n = nodes.get(w);
      if (!n) throw notFound('Item da EAP');
      if (n.archivedAt) throw invalid(`O item da EAP ${n.code} está arquivado.`, 'columns');
      if (n.nodeType !== 'ITEM') throw invalid(`${n.code} é um agrupador; destinos usam itens quantificáveis da EAP.`, 'columns');
    }
    const ctx = input.columns.some((c) => c.anchor) ? await loadContext(tx, projectId) : null;
    const colAnchors: AnchorFields[] = [];
    for (const c of input.columns) {
      const f = c.anchor ? this.measurements.anchorFields(c.anchor) : NO_ANCHOR;
      if (c.anchor) await this.measurements.checkAnchor(tx, projectId, f, ctx!);
      colAnchors.push(f);
    }
    // itens: unidade e serviços da organização (catálogo ou deste empreendimento)
    const units = new Map((await loadUnits(tx, actor.organizationId)).map((u) => [u.symbol, u]));
    const sids = [...new Set(input.rows.flatMap((r) => r.serviceIds))];
    const svcs = new Map((await tx.service.findMany({ where: { id: { in: sids }, organizationId: actor.organizationId, OR: [{ projectId: null }, { projectId }] }, select: { id: true, archivedAt: true } })).map((x) => [x.id, x]));
    const before = new Set(s.rows.flatMap((r) => r.services.map((x) => x.serviceId)));
    for (const sid of sids) {
      const v = svcs.get(sid);
      if (!v) throw notFound('Serviço');
      if (v.archivedAt && !before.has(sid)) throw invalid('Serviço arquivado não pode ser incluído no quadro.', 'rows');
    }
    for (const r of input.rows) {
      if (!units.has(r.unit)) throw invalid(`Unidade não cadastrada: ${r.unit}.`, 'rows');
      if (new Set(r.serviceIds).size !== r.serviceIds.length) throw invalid(`O item ${r.code ?? r.description} repete o serviço.`, 'rows');
    }
    await tx.scheduleColumn.deleteMany({ where: { scheduleId: id } });
    await tx.scheduleRow.deleteMany({ where: { scheduleId: id } });
    if (input.columns.length) await tx.scheduleColumn.createMany({ data: input.columns.map((c, i) => ({ organizationId: actor.organizationId, projectId, scheduleId: id, key: c.key, position: i, label: c.label, wbsNodeId: c.wbsNodeId ?? null, ...colAnchors[i]! })) });
    for (const [i, r] of input.rows.entries()) {
      const cells = Object.fromEntries(Object.entries(r.cells).map(([k, v]) => [k, v.trim()]).filter(([k, v]) => colKeys.has(k!) && v));
      await tx.scheduleRow.create({ data: {
        organizationId: actor.organizationId, projectId, scheduleId: id, key: r.key, position: i, code: r.code ?? null, description: r.description, spec: r.spec ?? null,
        unitId: units.get(r.unit)!.id, width: r.width || null, height: r.height || null, cells,
        services: { create: r.serviceIds.map((serviceId, position) => ({ serviceId, position })) },
      } });
    }
    const upd = await tx.schedule.updateMany({ where: { id, version }, data: {
      version: { increment: 1 }, ...(input.title !== undefined && { title: input.title }), ...(input.sourceReference !== undefined && { sourceReference: input.sourceReference }),
      ...(input.documentId !== undefined && { documentId: input.documentId }),
    } });
    if (upd.count === 0) throw versionConflict();
    if (input.documentId) await this.measurements.checkDocument(tx, actor.organizationId, projectId, input.documentId);
    await this.audit.record(tx, actor, { projectId, entityType: 'Schedule', entityId: id, action: 'UPDATE', ...(reason && { reason }),
      before: { title: s.title, columns: s.columns.length, rows: s.rows.length }, after: { title: input.title ?? s.title, columns: input.columns.map((c) => c.label), rows: input.rows.length } });
  }

  async setArchived(actor: Actor, projectId: string, id: string, version: number, archived: boolean, reason?: string) {
    await this.prisma.$transaction(async (tx) => {
      await assertProjectEditable(tx, actor.organizationId, projectId);
      await lock(tx, projectId);
      const s = await this.schedule(tx, actor.organizationId, projectId, id);
      const r = await tx.schedule.updateMany({ where: { id, version }, data: { archivedAt: archived ? new Date() : null, version: { increment: 1 } } });
      if (r.count === 0) throw versionConflict();
      let measurementsArchived = 0;
      if (archived && !s.archivedAt) {
        const active = await tx.measurement.findMany({ where: { scheduleId: id, archivedAt: null }, select: { id: true } });
        if (active.length) {
          await tx.measurement.updateMany({ where: { id: { in: active.map((m) => m.id) } }, data: { archivedAt: new Date(), archiveReason: `Quadro arquivado: ${reason ?? ''}`.slice(0, 500), version: { increment: 1 } } });
          await this.audit.recordMany(tx, actor, active.map((m) => ({ projectId, entityType: 'Measurement', entityId: m.id, action: 'ARCHIVE', reason: `Quadro "${s.title}" arquivado`.slice(0, 500) })));
        }
        measurementsArchived = active.length;
        await tx.schedule.update({ where: { id }, data: { launchedAt: null, launchedHash: null } });
      }
      await this.audit.record(tx, actor, { projectId, entityType: 'Schedule', entityId: id, action: archived ? 'ARCHIVE' : 'UNARCHIVE', reason, after: archived ? { measurementsArchived } : undefined });
    }, TX);
  }

  private async servicesOf(tx: Tx, organizationId: string, s: Full) {
    const ids = [...new Set(s.rows.flatMap((r) => r.services.map((x) => x.serviceId)))];
    const units = await loadUnits(tx, organizationId);
    const rows = ids.length ? await tx.service.findMany({ where: { id: { in: ids } }, select: { id: true, code: true, description: true, unitId: true, archivedAt: true, unit: { select: { symbol: true } } } }) : [];
    return { units, rows, map: new Map<string, ScheduleService>(rows.filter((x) => !x.archivedAt).map((x) => [x.id, { id: x.id, code: x.code, unit: units.find((u) => u.id === x.unitId)! }])) };
  }

  private inputRows = (s: Full): ScheduleRowInput[] => [...s.rows].sort((a, b) => a.position - b.position).map((r) => { const d = rowDto(r); return { ...d, cells: d.cells }; });

  /** Lança o quadro de resumo: uma medição por serviço × destino, com os itens que contribuíram. */
  async launch(actor: Actor, projectId: string, id: string, version: number, reason?: string | null): Promise<ScheduleLaunchResultDto> {
    return this.prisma.$transaction(async (tx) => {
      await assertProjectEditable(tx, actor.organizationId, projectId);
      await lock(tx, projectId);
      const s = await this.schedule(tx, actor.organizationId, projectId, id);
      if (s.version !== version) throw versionConflict();
      if (s.archivedAt) throw conflict('ARCHIVED', 'Quadro arquivado não pode ser lançado.');
      const columns = [...s.columns].sort((a, b) => a.position - b.position);
      const { units, map } = await this.servicesOf(tx, actor.organizationId, s);
      const rows = this.inputRows(s);
      const result = computeSchedule(columns, rows, map, units);
      if (result.errorCount) {
        const errs = result.rows.flatMap((r, i) => r.errors.map((m) => ({ path: `rows.${i}`, message: `Item ${rows[i]!.code ?? i + 1} (${rows[i]!.description}): ${m}` })));
        throw new AppError(422, 'SCHEDULE_ROW_ERRORS', 'Quadro com erros', `Corrija ${result.errorCount} item(ns) antes de lançar.`, errs.slice(0, 50));
      }
      if (!result.plans.length) throw invalid('O quadro não tem quantidades a lançar.', 'rows');
      const used = new Set(result.plans.map((p) => p.columnKey));
      for (const c of columns.filter((x) => used.has(x.key))) {
        if (!c.wbsNodeId) throw invalid(`Escolha o item da EAP do destino "${c.label}".`, `columns.${c.key}`);
        if (!c.anchorKind) throw invalid(`Escolha onde o destino "${c.label}" mede (âncora).`, `columns.${c.key}`);
        const n = await tx.wbsNode.findFirst({ where: { id: c.wbsNodeId, projectId } });
        if (!n || n.archivedAt || n.nodeType !== 'ITEM') throw invalid(`O item da EAP do destino "${c.label}" não está disponível.`, `columns.${c.key}`);
      }
      const ctx = await loadContext(tx, projectId);
      for (const c of columns.filter((x) => used.has(x.key))) await this.measurements.checkAnchor(tx, projectId, anchorOf(c)!, ctx);
      const plans: OwnedPlan[] = result.plans.map((p) => {
        const c = columns.find((x) => x.key === p.columnKey)!;
        const svc = map.get(p.serviceId)!;
        const memo: ScheduleMemoryDto = { scheduleId: s.id, title: s.title, kind: s.kind as ScheduleKind, column: { key: c.key, label: c.label }, rows: p.contributions.map(({ rowKey: _k, ...r }) => r), total: p.quantity, unit: p.unit };
        const memory: MemoryDto = { method: 'SCHEDULE', expression: 'Σ quantidade × medida por peça', inputs: [], substituted: null, resultBase: p.quantity, resultBaseUnit: p.unit, result: p.quantity, unit: p.unit, formula: null, schedule: memo };
        return { key: `${p.serviceId}:${c.key}`, label: `${svc.code} — ${c.label}`, wbsNodeId: c.wbsNodeId!, serviceId: p.serviceId, anchor: anchorOf(c)!, quantity: p.quantity, unitId: units.find((u) => u.symbol === p.unit)!.id, memory };
      });
      const out = await syncOwnedMeasurements(tx, actor, projectId,
        { kind: 'schedule', id: s.id, title: s.title, sourceReference: s.sourceReference, documentId: s.documentId, inputs: { scheduleId: s.id, columns: columns.map((c) => ({ key: c.key, label: c.label })), rows } as unknown as Prisma.InputJsonValue },
        plans, { ctx, measurements: this.measurements, audit: this.audit, reason: (reason ?? '').trim() || `Relançamento do quadro "${s.title}"`, fingerprint });
      const done = await tx.schedule.updateMany({ where: { id, version }, data: { launchedAt: new Date(), launchedHash: contentHash(s), version: { increment: 1 } } });
      if (done.count === 0) throw versionConflict();
      await this.audit.record(tx, actor, { projectId, entityType: 'Schedule', entityId: id, action: 'LAUNCH', reason: reason ?? undefined, after: out });
      return out;
    }, TX);
  }

  // ---------- leitura ----------
  private async items(organizationId: string, projectId: string, list: Full[]): Promise<ScheduleListItemDto[]> {
    const counts = new Map((await this.prisma.measurement.groupBy({ by: ['scheduleId'], where: { projectId, organizationId, scheduleId: { in: list.map((s) => s.id) }, archivedAt: null }, _count: { _all: true } })).map((c) => [c.scheduleId!, c._count._all]));
    return list.map((s) => ({
      id: s.id, kind: s.kind as ScheduleKind, title: s.title, rowCount: s.rows.length, columnCount: s.columns.length,
      status: !s.launchedHash ? 'DRAFT' : s.launchedHash === contentHash(s) ? 'LAUNCHED' : 'PENDING',
      launchedAt: s.launchedAt?.toISOString() ?? null, measurementCount: counts.get(s.id) ?? 0, archivedAt: s.archivedAt?.toISOString() ?? null, version: s.version, updatedAt: s.updatedAt.toISOString(),
    }));
  }

  async list(organizationId: string, projectId: string, q: { archived?: 'true' | 'false' }) {
    const list = await this.prisma.schedule.findMany({ where: { projectId, organizationId, ...(q.archived !== 'true' && { archivedAt: null }) }, include, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
    return this.items(organizationId, projectId, list);
  }

  /** Quadros da organização (todos os empreendimentos) para servir de lista padrão. */
  async sources(organizationId: string) {
    const list = await this.prisma.schedule.findMany({ where: { organizationId, archivedAt: null }, select: { id: true, title: true, kind: true, project: { select: { code: true, name: true } }, _count: { select: { rows: true } } }, orderBy: [{ updatedAt: 'desc' }], take: 200 });
    return list.map((s) => ({ id: s.id, title: s.title, kind: s.kind, project: `${s.project.code} ${s.project.name}`, rowCount: s._count.rows }));
  }

  async detail(organizationId: string, projectId: string, id: string): Promise<ScheduleDetailDto> {
    const s = await this.schedule(this.prisma, organizationId, projectId, id);
    const [item] = await this.items(organizationId, projectId, [s]);
    const ctx = await loadContext(this.prisma, projectId);
    const columns = [...s.columns].sort((a, b) => a.position - b.position);
    const wbs = new Map((await this.prisma.wbsNode.findMany({ where: { id: { in: columns.map((c) => c.wbsNodeId).filter((x): x is string => !!x) } }, select: { id: true, code: true, title: true } })).map((n) => [n.id, n]));
    const mult = this.multipliers(columns, ctx);
    const { units, rows: svcRows } = await this.servicesOf(this.prisma, organizationId, s);
    const ms = await this.prisma.measurement.findMany({ where: { scheduleId: id, projectId }, include: { service: { select: { code: true, description: true, unit: { select: { symbol: true } } } } }, orderBy: [{ archivedAt: { sort: 'asc', nulls: 'first' } }, { createdAt: 'asc' }] });
    const cols: ScheduleColumnDto[] = columns.map((c) => {
      const a = anchorOf(c);
      const n = c.wbsNodeId ? wbs.get(c.wbsNodeId) : undefined;
      return { key: c.key, label: c.label, wbsNodeId: c.wbsNodeId, wbsCode: n?.code ?? null, wbsTitle: n?.title ?? null, anchor: toAnchorInput(a), anchorLabel: a ? anchorLabel(a, ctx).label : null, multiplier: mult.get(c.key) ?? 1 };
    });
    return {
      ...item!, sourceReference: s.sourceReference, columns: cols, rows: [...s.rows].sort((a, b) => a.position - b.position).map(rowDto),
      measurements: ms.map((m) => ({ key: m.scheduleKey!, measurementId: m.id, serviceId: m.serviceId, serviceCode: m.service.code, serviceDescription: m.service.description, columnKey: m.scheduleKey!.split(':')[1]!, quantity: m.quantity.toString(), unit: m.service.unit.symbol, revision: m.currentNumber, archived: !!m.archivedAt })),
      services: svcRows.map((x) => ({ id: x.id, code: x.code, description: x.description, unit: x.unit.symbol, archived: !!x.archivedAt })),
      units: units.map((u) => ({ symbol: u.symbol, dimension: u.dimension, factor: u.factor })),
    };
  }

  /** Quantas unidades cada destino representa (tipologia: unidades com o elemento na revisão fixada). */
  private multipliers(columns: ScheduleColumn[], ctx: MeasurementCtx) {
    const fake = columns.filter((c) => c.anchorKind).map((c) => ({
      id: c.key, wbsNodeId: c.key, serviceId: 'x', quantity: '1',
      anchor: c.anchorKind === 'TYPOLOGY_ELEMENT' ? { kind: 'TYPOLOGY_ELEMENT' as const, typologyId: c.typologyId!, elementKey: c.elementKey!, unitId: c.dwellingUnitId } : { kind: 'OTHER' as const },
    }));
    const ex = expandMeasurements(fake, expandUnits(ctx));
    return new Map(fake.map((f) => [f.id, ex.byMeasurement.get(f.id)?.count ?? 0]));
  }
}
