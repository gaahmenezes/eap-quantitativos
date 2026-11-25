import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import type {
  AnchorInput,
  CreateSheetInput,
  MemoryDto,
  SheetDefInput,
  SheetDetailDto,
  SheetLaunchResultDto,
  SheetListItemDto,
  SheetMemoryDto,
  UpdateSheetInput,
} from '@eapq/contracts';
import { baseUnitSymbol, compileSheet, computeSheet, outputInUnit, rowLabel, type SheetDef, type SheetRowInput } from '@eapq/domain';
import type { Actor } from '../../common/auth/auth-context.js';
import { AppError, conflict, notFound, versionConflict } from '../../common/errors.js';
import { assertProjectEditable } from '../../common/project-guard.js';
import type { Prisma, Sheet } from '../../generated/prisma/client.js';
import { PrismaService, type Tx } from '../../prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { loadUnits } from '../formulas/units.js';
import { anchorLabel, loadContext, type AnchorFields, type MeasurementCtx } from '../measurements/context.js';
import { documentsById, invalid, lock, MeasurementsService } from '../measurements/measurements.service.js';
import { sheetInvalid } from './sheet-templates.service.js';
import { syncOwnedMeasurements, type OwnedPlan } from '../measurements/owned.js';

const TX = { timeout: 60_000 } as const;
const ANCHOR_COLS = ['anchorKind', 'structureNodeId', 'networkSegmentId', 'networkNodeId', 'physicalElementId', 'typologyId', 'elementKey', 'dwellingUnitId'] as const;
const NO_ANCHOR: AnchorFields = { anchorKind: null as unknown as AnchorFields['anchorKind'], structureNodeId: null, networkSegmentId: null, networkNodeId: null, physicalElementId: null, typologyId: null, elementKey: null, dwellingUnitId: null };

const anchorOf = (s: Pick<Sheet, (typeof ANCHOR_COLS)[number]>): AnchorFields | null => (s.anchorKind ? Object.fromEntries(ANCHOR_COLS.map((k) => [k, s[k]])) as AnchorFields : null);
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

/** Impressão digital do que o lançamento grava: destino, versão do modelo, parâmetros, serviços e linhas. */
function contentHash(s: Pick<Sheet, 'templateVersionId' | 'wbsNodeId' | 'params' | 'outputMap' | 'rows' | 'rowAnchors' | (typeof ANCHOR_COLS)[number]>) {
  const ra = s.rowAnchors as unknown[];
  return createHash('sha256').update(JSON.stringify([s.templateVersionId, s.wbsNodeId, ANCHOR_COLS.map((k) => s[k] ?? null), s.params, s.outputMap, s.rows, ...(ra.some(Boolean) ? [ra] : [])])).digest('hex');
}
/** Chave curta e estável de uma âncora (para a chave da medição por destino). */
const anchorKey = (f: AnchorFields) => createHash('sha256').update(JSON.stringify(ANCHOR_COLS.map((k) => f[k] ?? null))).digest('hex').slice(0, 16);

/** Mantém só colunas de entrada do modelo e descarta células vazias. */
function cleanRows(def: SheetDef, rows: UpdateSheetInput['rows'] & object, anchors: (AnchorInput | null)[] = []) {
  const inputs = new Set(def.columns.filter((c) => c.kind === 'input').map((c) => c.key));
  const out = rows.map((r) => Object.fromEntries(Object.entries(r).filter(([k, c]) => inputs.has(k) && ((c.v ?? '').trim() || (c.ref ?? '').trim())).map(([k, c]) => [k, { ...((c.v ?? '').trim() && { v: c.v!.trim() }), ...((c.ref ?? '').trim() && { ref: c.ref!.trim() }) }])));
  const dest = out.map((_, i) => anchors[i] ?? null);
  // linhas vazias (e sem destino próprio) no fim não são gravadas
  while (out.length && Object.keys(out[out.length - 1]!).length === 0 && !dest[out.length - 1]) { out.pop(); dest.pop(); }
  return { rows: out, rowAnchors: dest.some(Boolean) ? dest : [] };
}

/**
 * O que a medição registra de cada linha (rótulo e valor). Relançar só cria revisão quando a quantidade
 * ou essa contribuição muda — parâmetros que não alteram a saída não geram revisão.
 */
const contribution = (m: MemoryDto) => JSON.stringify([m.method, m.sheet?.template.versionNumber ?? null, m.sheet?.column.key ?? null, (m.sheet?.rows ?? []).map((r) => [r.index, r.label, r.value])]);

type Full = Sheet & { templateVersion: { id: string; number: number; definition: Prisma.JsonValue; templateId: string; template: { code: string; name: string } } };

@Injectable()
export class SheetsService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService, private readonly measurements: MeasurementsService) {}

  private async sheet(tx: Tx, organizationId: string, projectId: string, id: string): Promise<Full> {
    const s = await tx.sheet.findFirst({ where: { id, projectId, organizationId }, include: { templateVersion: { select: { id: true, number: true, definition: true, templateId: true, template: { select: { code: true, name: true } } } } } });
    if (!s) throw notFound('Ficha');
    return s;
  }

  private async publishedVersion(tx: Tx, organizationId: string, id: string) {
    const v = await tx.sheetTemplateVersion.findFirst({ where: { id, organizationId }, include: { template: true } });
    if (!v) throw notFound('Versão do modelo de ficha');
    if (v.status !== 'PUBLISHED') throw invalid('Use uma versão publicada do modelo.', 'templateVersionId');
    if (v.template.archivedAt) throw invalid(`O modelo ${v.template.code} está arquivado.`, 'templateVersionId');
    return v;
  }

  private async checkWbs(tx: Tx, organizationId: string, projectId: string, wbsNodeId: string) {
    const node = await tx.wbsNode.findFirst({ where: { id: wbsNodeId, projectId, organizationId } });
    if (!node) throw notFound('Item da EAP');
    if (node.archivedAt) throw invalid('O item da EAP está arquivado.', 'wbsNodeId');
    if (node.nodeType !== 'ITEM') throw invalid('Fichas lançam em itens quantificáveis da EAP (não em agrupadores).', 'wbsNodeId');
    return node;
  }

  /** Serviços sugeridos pelo modelo (por código), se existirem no catálogo ou no empreendimento. */
  async suggestedMap(tx: Tx, organizationId: string, projectId: string, def: SheetDef, current: Record<string, string | null> = {}) {
    const codes = def.outputs.map((o) => o.suggestedService).filter((c): c is string => !!c);
    const svcs = codes.length ? await tx.service.findMany({ where: { organizationId, code: { in: codes }, archivedAt: null, OR: [{ projectId: null }, { projectId }] }, select: { id: true, code: true, projectId: true } }) : [];
    const byCode = new Map<string, string>();
    for (const s of svcs.sort((a, b) => (a.projectId ? 0 : 1) - (b.projectId ? 0 : 1))) if (!byCode.has(s.code)) byCode.set(s.code, s.id);
    return Object.fromEntries(def.outputs.map((o) => [o.key, o.key in current ? current[o.key] ?? null : (o.suggestedService && byCode.get(o.suggestedService)) || null]));
  }

  private async checkServices(tx: Tx, organizationId: string, projectId: string, map: Record<string, string | null>, def: SheetDef) {
    const keys = new Set(def.outputs.map((o) => o.key));
    for (const k of Object.keys(map)) if (!keys.has(k)) throw invalid(`Saída inexistente no modelo: ${k}.`, `outputMap.${k}`);
    const ids = [...new Set(Object.values(map).filter((x): x is string => !!x))];
    const n = ids.length ? await tx.service.count({ where: { id: { in: ids }, organizationId, OR: [{ projectId: null }, { projectId }] } }) : 0;
    if (n !== ids.length) throw notFound('Serviço');
  }

  // ---------- gravação ----------
  async create(actor: Actor, projectId: string, input: CreateSheetInput) {
    return this.prisma.$transaction(async (tx) => {
      await assertProjectEditable(tx, actor.organizationId, projectId);
      const v = await this.publishedVersion(tx, actor.organizationId, input.templateVersionId);
      const def = v.definition as unknown as SheetDef;
      if (input.wbsNodeId) await this.checkWbs(tx, actor.organizationId, projectId, input.wbsNodeId);
      const f = input.anchor ? this.measurements.anchorFields(input.anchor) : NO_ANCHOR;
      if (input.anchor) await this.measurements.checkAnchor(tx, projectId, f, await loadContext(tx, projectId));
      const outputMap = await this.suggestedMap(tx, actor.organizationId, projectId, def);
      const s = await tx.sheet.create({ data: { organizationId: actor.organizationId, projectId, templateVersionId: v.id, title: input.title, wbsNodeId: input.wbsNodeId ?? null, ...f, outputMap, rows: [], createdById: actor.userId } });
      await this.audit.record(tx, actor, { projectId, entityType: 'Sheet', entityId: s.id, action: 'CREATE', after: { title: input.title, template: v.template.code, versionNumber: v.number, wbsNodeId: input.wbsNodeId ?? null, anchor: input.anchor ?? null } });
      return { id: s.id };
    });
  }

  async update(actor: Actor, projectId: string, id: string, version: number, input: UpdateSheetInput) {
    await this.prisma.$transaction(async (tx) => {
      await assertProjectEditable(tx, actor.organizationId, projectId);
      const s = await this.sheet(tx, actor.organizationId, projectId, id);
      if (s.archivedAt) throw conflict('ARCHIVED', 'Ficha arquivada não pode ser alterada. Restaure-a antes.');
      let def = s.templateVersion.definition as unknown as SheetDef;
      const data: Prisma.SheetUncheckedUpdateManyInput = {};
      if (input.templateVersionId && input.templateVersionId !== s.templateVersionId) {
        const v = await this.publishedVersion(tx, actor.organizationId, input.templateVersionId);
        if (v.templateId !== s.templateVersion.templateId) throw invalid('A nova versão precisa ser do mesmo modelo de ficha.', 'templateVersionId');
        def = v.definition as unknown as SheetDef;
        data.templateVersionId = v.id;
        data.outputMap = await this.suggestedMap(tx, actor.organizationId, projectId, def, (input.outputMap ?? s.outputMap) as Record<string, string | null>);
        const paramKeys = new Set(def.params.map((p) => p.key));
        data.params = Object.fromEntries(Object.entries((input.params ?? s.params) as Record<string, string>).filter(([k]) => paramKeys.has(k)));
        if (!input.rows) Object.assign(data, cleanRows(def, s.rows as UpdateSheetInput['rows'] & object, s.rowAnchors as (AnchorInput | null)[]));
      }
      if (input.title !== undefined) data.title = input.title;
      if (input.wbsNodeId !== undefined) {
        if (input.wbsNodeId) await this.checkWbs(tx, actor.organizationId, projectId, input.wbsNodeId);
        data.wbsNodeId = input.wbsNodeId;
      }
      if (input.anchor !== undefined) {
        const f = input.anchor ? this.measurements.anchorFields(input.anchor) : NO_ANCHOR;
        if (input.anchor) await this.measurements.checkAnchor(tx, projectId, f, await loadContext(tx, projectId));
        Object.assign(data, f);
      }
      if (input.params) {
        const keys = new Set(def.params.map((p) => p.key));
        for (const k of Object.keys(input.params)) if (!keys.has(k)) throw invalid(`Parâmetro inexistente no modelo: ${k}.`, `params.${k}`);
        data.params = input.params;
      }
      if (input.outputMap) {
        await this.checkServices(tx, actor.organizationId, projectId, input.outputMap, def);
        data.outputMap = { ...((data.outputMap ?? s.outputMap) as Record<string, string | null>), ...input.outputMap };
      }
      if (input.rows || input.rowAnchors) {
        const rows = input.rows ?? (s.rows as UpdateSheetInput['rows'] & object);
        const anchors = input.rowAnchors ?? (input.rows ? [] : (s.rowAnchors as (AnchorInput | null)[]));
        if (anchors.length > rows.length) throw invalid('Há mais destinos por linha do que linhas.', 'rowAnchors');
        const unique = new Map(anchors.filter((a): a is AnchorInput => !!a).map((a) => [JSON.stringify(a), a]));
        if (unique.size) {
          const ctx = await loadContext(tx, projectId);
          for (const a of unique.values()) await this.measurements.checkAnchor(tx, projectId, this.measurements.anchorFields(a), ctx);
        }
        Object.assign(data, cleanRows(def, rows, anchors));
      }
      if (input.sourceReference !== undefined) data.sourceReference = input.sourceReference;
      if (input.documentId !== undefined) {
        if (input.documentId) await this.measurements.checkDocument(tx, actor.organizationId, projectId, input.documentId);
        data.documentId = input.documentId;
      }
      const r = await tx.sheet.updateMany({ where: { id, version }, data: { ...data, version: { increment: 1 } } });
      if (r.count === 0) throw versionConflict();
      const summary = (x: { rows?: unknown }) => (Array.isArray(x.rows) ? { rowCount: x.rows.length } : {});
      const { rows: _r, rowAnchors: ra, ...after } = data;
      const destCount = Array.isArray(ra) ? { rowDestinations: (ra as unknown[]).filter(Boolean).length } : {};
      await this.audit.record(tx, actor, { projectId, entityType: 'Sheet', entityId: id, action: 'UPDATE', before: { title: s.title, ...summary(s) }, after: { ...after, ...summary(data), ...destCount } });
    }, TX);
  }

  async setArchived(actor: Actor, projectId: string, id: string, version: number, archived: boolean, reason?: string) {
    await this.prisma.$transaction(async (tx) => {
      await assertProjectEditable(tx, actor.organizationId, projectId);
      await lock(tx, projectId);
      const s = await this.sheet(tx, actor.organizationId, projectId, id);
      const r = await tx.sheet.updateMany({ where: { id, version }, data: { archivedAt: archived ? new Date() : null, version: { increment: 1 } } });
      if (r.count === 0) throw versionConflict();
      let measurementsArchived = 0;
      if (archived && !s.archivedAt) {
        // os quantitativos lançados saem junto (ficam no histórico); restaurar a ficha não os relança
        const active = await tx.measurement.findMany({ where: { sheetId: id, archivedAt: null }, select: { id: true } });
        if (active.length) {
          await tx.measurement.updateMany({ where: { id: { in: active.map((m) => m.id) } }, data: { archivedAt: new Date(), archiveReason: `Ficha arquivada: ${reason ?? ''}`.slice(0, 500), version: { increment: 1 } } });
          await this.audit.recordMany(tx, actor, active.map((m) => ({ projectId, entityType: 'Measurement', entityId: m.id, action: 'ARCHIVE', reason: `Ficha "${s.title}" arquivada` })));
        }
        measurementsArchived = active.length;
        await tx.sheet.update({ where: { id }, data: { launchedAt: null, launchedHash: null } });
      }
      await this.audit.record(tx, actor, { projectId, entityType: 'Sheet', entityId: id, action: archived ? 'ARCHIVE' : 'UNARCHIVE', reason, after: archived ? { measurementsArchived } : undefined });
    }, TX);
  }

  /**
   * Lança os totais da ficha como medições (uma por saída com serviço): cria, revisa (nova revisão na
   * memória de cálculo) ou arquiva. Tudo numa transação, com o lock da EAP e a regra de dupla contagem.
   */
  async launch(actor: Actor, projectId: string, id: string, version: number, reason?: string | null): Promise<SheetLaunchResultDto> {
    return this.prisma.$transaction(async (tx) => {
      await assertProjectEditable(tx, actor.organizationId, projectId);
      await lock(tx, projectId);
      const s = await this.sheet(tx, actor.organizationId, projectId, id);
      if (s.version !== version) throw versionConflict();
      if (s.archivedAt) throw conflict('ARCHIVED', 'Ficha arquivada não pode ser lançada.');
      if (!s.wbsNodeId) throw invalid('Escolha o item da EAP que recebe os quantitativos da ficha.', 'wbsNodeId');
      const anchor = anchorOf(s);
      await this.checkWbs(tx, actor.organizationId, projectId, s.wbsNodeId);
      const ctx = await loadContext(tx, projectId);
      if (anchor) await this.measurements.checkAnchor(tx, projectId, anchor, ctx);
      const rowAnchors = (s.rowAnchors as (AnchorInput | null)[]).map((a) => (a ? this.measurements.anchorFields(a) : null));
      for (const f of new Map(rowAnchors.filter((f): f is AnchorFields => !!f).map((f) => [anchorKey(f), f])).values()) await this.measurements.checkAnchor(tx, projectId, f, ctx);

      const def = s.templateVersion.definition as unknown as SheetDef;
      const units = await loadUnits(tx, actor.organizationId);
      const compiled = compileSheet(def, units);
      if (compiled.issues.length) throw sheetInvalid(compiled.issues);
      const rows = s.rows as unknown as SheetRowInput[];
      const params = s.params as Record<string, string>;
      const result = computeSheet(compiled, rows, params);
      if (result.errorCount) {
        const errs = result.rows.flatMap((r, i) => r.errors.map((m) => ({ path: `rows.${i}`, message: `Linha ${i + 1} (${rowLabel(def, rows[i]!, i)}): ${m}` })));
        throw new AppError(422, 'SHEET_ROW_ERRORS', 'Ficha com erros', `Corrija ${result.errorCount} linha(s) antes de lançar.`, errs.slice(0, 50));
      }
      const filled = result.rows.filter((r) => !r.blank).length;
      if (!filled) throw invalid('A ficha não tem linhas preenchidas.', 'rows');
      // grupos de linhas por destino (destino da linha ou, na falta, o da ficha)
      const groups = new Map<string, { anchor: AnchorFields; isDefault: boolean; idx: number[] }>();
      for (const [i, r] of result.rows.entries()) {
        if (r.blank) continue;
        const f = rowAnchors[i] ?? anchor;
        if (!f) throw invalid(`A linha ${i + 1} (${rowLabel(def, rows[i]!, i)}) não tem destino: escolha a âncora da ficha ou da linha.`, `rows.${i}`);
        const isDefault = !rowAnchors[i] || (!!anchor && anchorKey(rowAnchors[i]!) === anchorKey(anchor));
        const k = isDefault ? '' : anchorKey(f);
        const g = groups.get(k) ?? { anchor: f, isDefault, idx: [] };
        g.idx.push(i);
        groups.set(k, g);
      }

      const outputMap = s.outputMap as Record<string, string | null>;
      const params_ = def.params.map((p) => ({ key: p.key, label: p.label, unit: p.unit, value: params[p.key] ?? p.value }));
      const plans: OwnedPlan[] = [];
      for (const [gk, g] of groups) {
        const subset = g.idx.map((i) => rows[i]!);
        const gres = groups.size === 1 ? result : computeSheet(compiled, subset, params);
        const rowIdx = groups.size === 1 ? result.rows.map((_, i) => i) : g.idx;
        const destination = groups.size > 1 ? anchorLabel(g.anchor, ctx).label : null;
        for (const o of def.outputs) {
          const serviceId = outputMap[o.key] ?? null;
          if (!serviceId) continue;
          const { service, target } = await this.measurements.serviceWithUnit(tx, actor.organizationId, projectId, serviceId);
          if (service.archivedAt) throw invalid(`O serviço ${service.code} está arquivado.`, `outputMap.${o.key}`);
          const total = gres.totals.find((t) => t.key === o.key)!;
          const quantity = outputInUnit(total, target);
          if (quantity === null) throw invalid(`A saída "${o.label}" está em ${total.unit}, mas o serviço ${service.code} é medido em ${target.symbol}.`, `outputMap.${o.key}`);
          if (/^-?0(\.0+)?$/.test(quantity)) continue;
          const col = def.columns.find((c) => c.key === o.column)!;
          const sheetMemory: SheetMemoryDto = {
            sheetId: s.id, title: s.title, destination,
            template: { code: s.templateVersion.template.code, name: s.templateVersion.template.name, versionNumber: s.templateVersion.number },
            output: { key: o.key, label: o.label }, column: { key: col.key, label: col.label, expression: col.expression ?? null },
            params: params_,
            rows: gres.rows.flatMap((r, j) => { const i = rowIdx[j]!; return r.blank ? [] : [{ index: i + 1, label: rowLabel(def, rows[i]!, i), value: r.cells[o.column]?.value ?? '0' }]; }),
            skippedRows: groups.size === 1 ? result.rows.length - filled : 0, total: total.total, totalUnit: total.unit,
          };
          const memory: MemoryDto = { method: 'SHEET', expression: col.expression ?? null, inputs: [], substituted: null, resultBase: total.base, resultBaseUnit: baseUnitSymbol(total.dim), result: quantity, unit: target.symbol, formula: null, sheet: sheetMemory };
          plans.push({ key: g.isDefault ? o.key : `${o.key}@${gk}`, label: destination ? `${o.label} — ${destination}` : o.label, wbsNodeId: s.wbsNodeId, serviceId, anchor: g.anchor, quantity, unitId: target.id, memory });
        }
      }
      const out: SheetLaunchResultDto = await syncOwnedMeasurements(tx, actor, projectId,
        { kind: 'sheet', id: s.id, title: s.title, sourceReference: s.sourceReference, documentId: s.documentId, inputs: { sheetId: s.id, templateVersionId: s.templateVersionId, params, rows: s.rows, rowAnchors: s.rowAnchors } as Prisma.InputJsonValue },
        plans, { ctx, measurements: this.measurements, audit: this.audit, reason: (reason ?? '').trim() || `Relançamento da ficha "${s.title}"`, fingerprint: contribution });
      const done = await tx.sheet.updateMany({ where: { id, version }, data: { launchedAt: new Date(), launchedHash: contentHash(s), version: { increment: 1 } } });
      if (done.count === 0) throw versionConflict();
      await this.audit.record(tx, actor, { projectId, entityType: 'Sheet', entityId: id, action: 'LAUNCH', reason: reason ?? undefined, after: out });
      return out;
    }, TX);
  }

  // ---------- leitura ----------
  private async items(organizationId: string, projectId: string, sheets: Full[], ctx: MeasurementCtx): Promise<SheetListItemDto[]> {
    const wbs = new Map((await this.prisma.wbsNode.findMany({ where: { id: { in: sheets.map((s) => s.wbsNodeId).filter((x): x is string => !!x) } }, select: { id: true, code: true, title: true } })).map((n) => [n.id, n]));
    const counts = new Map((await this.prisma.measurement.groupBy({ by: ['sheetId'], where: { projectId, organizationId, sheetId: { in: sheets.map((s) => s.id) }, archivedAt: null }, _count: { _all: true } })).map((c) => [c.sheetId!, c._count._all]));
    return sheets.map((s) => {
      const a = anchorOf(s);
      const n = s.wbsNodeId ? wbs.get(s.wbsNodeId) : undefined;
      return {
        id: s.id, title: s.title, templateId: s.templateVersion.templateId, templateCode: s.templateVersion.template.code, templateName: s.templateVersion.template.name, versionNumber: s.templateVersion.number,
        wbsNodeId: s.wbsNodeId, wbsCode: n?.code ?? null, wbsTitle: n?.title ?? null, anchorLabel: a ? anchorLabel(a, ctx).label : null,
        rowCount: (s.rows as unknown[]).length, status: !s.launchedHash ? 'DRAFT' : s.launchedHash === contentHash(s) ? 'LAUNCHED' : 'PENDING',
        launchedAt: s.launchedAt?.toISOString() ?? null, measurementCount: counts.get(s.id) ?? 0, archivedAt: s.archivedAt?.toISOString() ?? null, version: s.version, updatedAt: s.updatedAt.toISOString(),
      };
    });
  }

  async list(organizationId: string, projectId: string, q: { archived?: 'true' | 'false' }): Promise<SheetListItemDto[]> {
    const sheets = await this.prisma.sheet.findMany({
      where: { projectId, organizationId, ...(q.archived !== 'true' && { archivedAt: null }) },
      include: { templateVersion: { select: { id: true, number: true, definition: true, templateId: true, template: { select: { code: true, name: true } } } } },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    return this.items(organizationId, projectId, sheets, await loadContext(this.prisma, projectId));
  }

  async detail(organizationId: string, projectId: string, id: string): Promise<SheetDetailDto> {
    const s = await this.sheet(this.prisma, organizationId, projectId, id);
    const ctx = await loadContext(this.prisma, projectId);
    const [item] = await this.items(organizationId, projectId, [s], ctx);
    const [newest, ms, units, docs] = await Promise.all([
      this.prisma.sheetTemplateVersion.findFirst({ where: { templateId: s.templateVersion.templateId, status: 'PUBLISHED' }, orderBy: { number: 'desc' }, select: { id: true, number: true } }),
      this.prisma.measurement.findMany({ where: { sheetId: id, projectId }, include: { service: { select: { code: true, description: true, unit: { select: { symbol: true } } } } }, orderBy: [{ archivedAt: { sort: 'asc', nulls: 'first' } }, { createdAt: 'desc' }] }),
      loadUnits(this.prisma, organizationId),
      documentsById(this.prisma, [s.documentId]),
    ]);
    return {
      ...item!, templateVersionId: s.templateVersionId, definition: s.templateVersion.definition as unknown as SheetDefInput,
      newerVersion: newest && newest.number > s.templateVersion.number ? newest : null,
      anchor: toAnchorInput(anchorOf(s)), params: s.params as Record<string, string>, outputMap: s.outputMap as Record<string, string | null>,
      rows: s.rows as SheetDetailDto['rows'],
      rowAnchors: (s.rows as unknown[]).map((_, i) => (s.rowAnchors as (AnchorInput | null)[])[i] ?? null),
      rowAnchorLabels: (s.rows as unknown[]).map((_, i) => { const a = (s.rowAnchors as (AnchorInput | null)[])[i]; return a ? anchorLabel(this.measurements.anchorFields(a), ctx).label : null; }),
      sourceReference: s.sourceReference, document: s.documentId ? docs.get(s.documentId) ?? null : null,
      measurements: ms.map((m) => ({ outputKey: m.sheetOutputKey!, measurementId: m.id, serviceId: m.serviceId, serviceCode: m.service.code, serviceDescription: m.service.description, quantity: m.quantity.toString(), unit: m.service.unit.symbol, revision: m.currentNumber, archived: !!m.archivedAt })),
      units: units.map((u) => ({ symbol: u.symbol, dimension: u.dimension, factor: u.factor })),
    };
  }
}
