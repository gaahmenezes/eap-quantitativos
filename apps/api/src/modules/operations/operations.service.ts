import { Injectable } from '@nestjs/common';
import type { OperationsDto, PendingItemDto, TaskStatus } from '@eapq/contracts';
import { compileSheet, computeSchedule, computeSheet, type ScheduleService, type SheetDef, type SheetRowInput } from '@eapq/domain';
import { PrismaService } from '../../prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { loadUnits } from '../formulas/units.js';
import { SchedulesService } from '../schedules/schedules.service.js';
import { SheetsService } from '../sheets/sheets.service.js';

@Injectable()
export class OperationsService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService, private readonly sheets: SheetsService, private readonly schedules: SchedulesService) {}

  async overview(organizationId: string, projectId: string): Promise<OperationsDto> {
    const units = await loadUnits(this.prisma, organizationId);
    const pending: PendingItemDto[] = [];

    // ---------- fichas
    const sheetList = await this.sheets.list(organizationId, projectId, {});
    const sheetRows = await this.prisma.sheet.findMany({ where: { projectId, organizationId, archivedAt: null }, select: { id: true, rows: true, params: true, outputMap: true, rowAnchors: true, anchorKind: true, templateVersion: { select: { definition: true } } } });
    const sheetById = new Map(sheetRows.map((s) => [s.id, s]));
    for (const s of sheetList) {
      const raw = sheetById.get(s.id)!;
      const reasons: string[] = [];
      if (!s.wbsNodeId) reasons.push('sem item da EAP');
      const rowAnchors = raw.rowAnchors as unknown[];
      const def = raw.templateVersion.definition as unknown as SheetDef;
      const res = computeSheet(compileSheet(def, units), raw.rows as unknown as SheetRowInput[], raw.params as Record<string, string>);
      const filled = res.rows.filter((r) => !r.blank).length;
      if (!raw.anchorKind && (!filled || res.rows.some((r, i) => !r.blank && !rowAnchors[i]))) reasons.push('sem âncora');
      if (!Object.values(raw.outputMap as Record<string, string | null>).some(Boolean)) reasons.push('nenhuma saída com serviço');
      if (!filled) reasons.push('sem linhas');
      if (res.errorCount) reasons.push(`${res.errorCount} linha(s) com erro`);
      if (s.status === 'PENDING') reasons.push('alterada após o lançamento');
      if (s.status === 'DRAFT' && !reasons.length) reasons.push('pronta para lançar');
      if (s.status !== 'LAUNCHED' || reasons.length) pending.push({ kind: 'SHEET', id: s.id, title: s.title, status: s.status, reasons, updatedAt: s.updatedAt });
    }

    // ---------- quadros
    const schedList = await this.schedules.list(organizationId, projectId, {});
    const schedRows = await this.prisma.schedule.findMany({ where: { projectId, organizationId, archivedAt: null }, include: { columns: true, rows: { include: { services: { select: { serviceId: true } }, unit: { select: { symbol: true } } } } } });
    const svcIds = [...new Set(schedRows.flatMap((s) => s.rows.flatMap((r) => r.services.map((x) => x.serviceId))))];
    const svcs = new Map<string, ScheduleService>((await this.prisma.service.findMany({ where: { id: { in: svcIds }, archivedAt: null }, select: { id: true, code: true, unitId: true } })).flatMap((x) => { const u = units.find((v) => v.id === x.unitId); return u ? [[x.id, { id: x.id, code: x.code, unit: u }] as const] : []; }));
    for (const s of schedList) {
      const raw = schedRows.find((x) => x.id === s.id)!;
      const reasons: string[] = [];
      const res = computeSchedule(raw.columns.map((c) => ({ key: c.key, label: c.label })), raw.rows.map((r) => ({ key: r.key, code: r.code, description: r.description, spec: r.spec, unit: r.unit.symbol, width: r.width?.toString() ?? null, height: r.height?.toString() ?? null, serviceIds: r.services.map((x) => x.serviceId), cells: r.cells as Record<string, string> })), svcs, units);
      const noService = raw.rows.filter((r) => !r.services.length).length;
      if (!raw.rows.length) reasons.push('sem itens');
      if (noService) reasons.push(`${noService} item(ns) sem serviço`);
      const used = new Set(Object.keys(Object.assign({}, ...raw.rows.map((r) => r.cells as Record<string, string>))));
      const incomplete = raw.columns.filter((c) => used.has(c.key) && (!c.wbsNodeId || !c.anchorKind)).length;
      if (incomplete) reasons.push(`${incomplete} destino(s) sem item da EAP ou âncora`);
      const errs = res.rows.filter((r) => r.errors.length && !r.errors.every((e) => e === 'Escolha o serviço do item.')).length;
      if (errs) reasons.push(`${errs} item(ns) com erro`);
      if (s.status === 'PENDING') reasons.push('alterado após o lançamento');
      if (s.status === 'DRAFT' && !reasons.length) reasons.push('pronto para lançar');
      if (s.status !== 'LAUNCHED' || reasons.length) pending.push({ kind: 'SCHEDULE', id: s.id, title: s.title, status: s.status, reasons, updatedAt: s.updatedAt });
    }

    // ---------- migrações em preparação
    const imports = await this.prisma.workbookImport.findMany({ where: { projectId, organizationId, status: 'DRAFT' }, include: { document: { select: { fileName: true } } } });
    for (const w of imports) pending.push({ kind: 'WORKBOOK_IMPORT', id: w.id, title: w.document.fileName, status: 'DRAFT', reasons: ['migração não aplicada'], updatedAt: w.updatedAt.toISOString() });

    // ---------- cobertura da EAP (itens quantificáveis com medição ativa), por grupo de 1º nível
    const nodes = await this.prisma.wbsNode.findMany({ where: { projectId, organizationId, archivedAt: null, status: 'ACTIVE' }, select: { id: true, parentId: true, code: true, title: true, nodeType: true, position: true } });
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const measured = new Set((await this.prisma.measurement.findMany({ where: { projectId, organizationId, archivedAt: null }, select: { wbsNodeId: true }, distinct: ['wbsNodeId'] })).map((m) => m.wbsNodeId));
    const rootOf = (id: string) => { let n = byId.get(id); while (n?.parentId && byId.has(n.parentId)) n = byId.get(n.parentId); return n; };
    const groups = new Map<string, { wbsNodeId: string; code: string; title: string; items: number; measured: number; position: number }>();
    let items = 0; let measuredItems = 0;
    for (const n of nodes.filter((x) => x.nodeType === 'ITEM')) {
      items++;
      const m = measured.has(n.id);
      if (m) measuredItems++;
      const r = rootOf(n.id)!;
      const g = groups.get(r.id) ?? { wbsNodeId: r.id, code: r.code, title: r.title, items: 0, measured: 0, position: r.position };
      g.items++; if (m) g.measured++;
      groups.set(r.id, g);
    }

    // ---------- vínculos sem medição e fórmulas desatualizadas
    const [unmeasured] = await this.prisma.$queryRaw<{ n: bigint }[]>`
      SELECT count(*) AS n FROM wbs_node_service l JOIN wbs_node w ON w.id = l."wbsNodeId" AND w."archivedAt" IS NULL AND w.status = 'ACTIVE'
      WHERE l."projectId" = ${projectId}::uuid AND NOT EXISTS (
        SELECT 1 FROM measurement m WHERE m."wbsNodeId" = l."wbsNodeId" AND m."serviceId" = l."serviceId" AND m."archivedAt" IS NULL)`;
    const [outdated] = await this.prisma.$queryRaw<{ n: bigint }[]>`
      SELECT count(*) AS n FROM measurement m
      JOIN measurement_revision r ON r."measurementId" = m.id AND r.number = m."currentNumber"
      JOIN formula_version v ON v.id = r."formulaVersionId"
      WHERE m."projectId" = ${projectId}::uuid AND m."archivedAt" IS NULL
        AND EXISTS (SELECT 1 FROM formula_version n WHERE n."formulaId" = v."formulaId" AND n.status = 'PUBLISHED' AND n.number > v.number)`;

    // ---------- revisão: o que mudou desde a última emitida
    const last = await this.prisma.projectRevision.findFirst({ where: { projectId, organizationId }, orderBy: { number: 'desc' }, select: { id: true, code: true, title: true, issuedAt: true } });
    const since = { created: 0, revised: 0, archived: 0 };
    if (last) {
      const [c] = await this.prisma.$queryRaw<{ created: bigint; revised: bigint }[]>`
        SELECT count(*) FILTER (WHERE number = 1) AS created, count(*) FILTER (WHERE number > 1) AS revised
        FROM measurement_revision WHERE "projectId" = ${projectId}::uuid AND "createdAt" > ${last.issuedAt}`;
      since.created = Number(c?.created ?? 0); since.revised = Number(c?.revised ?? 0);
      since.archived = await this.prisma.measurement.count({ where: { projectId, archivedAt: { gt: last.issuedAt } } });
    }

    // ---------- tarefas
    const tasks = await this.prisma.workTask.findMany({ where: { projectId, organizationId, archivedAt: null }, select: { status: true, dueDate: true, assigneeId: true } });
    const byStatus: Record<TaskStatus, number> = { TODO: 0, DOING: 0, REVIEW: 0, DONE: 0 };
    const today = new Date(new Date().toISOString().slice(0, 10));
    for (const t of tasks) byStatus[t.status]++;

    const sc = (l: { status: string }[]) => ({ total: l.length, draft: l.filter((x) => x.status === 'DRAFT').length, pending: l.filter((x) => x.status === 'PENDING').length, launched: l.filter((x) => x.status === 'LAUNCHED').length });
    return {
      pending: pending.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
      counts: { sheets: sc(sheetList), schedules: sc(schedList), workbookImports: imports.length, unmeasuredLinks: Number(unmeasured?.n ?? 0), outdatedFormulas: Number(outdated?.n ?? 0) },
      coverage: { items, measured: measuredItems, groups: [...groups.values()].sort((a, b) => a.code.localeCompare(b.code, 'pt-BR', { numeric: true })).map(({ position: _p, ...g }) => g) },
      revision: { last: last ? { ...last, issuedAt: last.issuedAt.toISOString() } : null, since },
      tasks: { byStatus, overdue: tasks.filter((t) => t.status !== 'DONE' && t.dueDate && t.dueDate < today).length, unassigned: tasks.filter((t) => t.status !== 'DONE' && !t.assigneeId).length },
      activity: await this.audit.listForProject(organizationId, projectId, 20),
    };
  }
}
