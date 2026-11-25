import { Injectable } from '@nestjs/common';
import type { WorkbookApplyResultDto, WorkbookImportDto, WorkbookImportListItemDto, WorkbookPreviewDto, WorkbookSheetDto, WorkbookSheetPlan } from '@eapq/contracts';
import {
  buildScheduleRows, buildSheetRows, compileSheet, detectDimensionPair, detectUnitColumn, headerLabels, reconcileSheet, suggestColumns, suggestHeaderRow, suggestTarget,
  type SchedulePlanInput, type SheetDef, type SheetPlan, type XSheet,
} from '@eapq/domain';
import type { Actor } from '../../common/auth/auth-context.js';
import { AppError, conflict, notFound, versionConflict } from '../../common/errors.js';
import { assertProjectEditable } from '../../common/project-guard.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { PrismaService, type Tx } from '../../prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { DocumentsService, type UploadedFile } from '../documents/documents.service.js';
import { loadUnits, type OrgUnit } from '../formulas/units.js';
import { SheetTemplatesService } from '../sheets/sheet-templates.service.js';
import { SheetsService } from '../sheets/sheets.service.js';
import { extractWorkbook } from './extract.js';

const TX = { timeout: 120_000 } as const;
const invalid = (detail: string, errors: { path: string; message: string }[] = []) => new AppError(422, 'VALIDATION_FAILED', 'Dados inválidos', detail, errors.length ? errors : [{ path: 'plan', message: detail }]);
const MAX_SHEET_ROWS = 2000;
const MAX_SCHEDULE_ROWS = 1500;

type Templates = Map<string, { versionId: string; code: string; def: SheetDef }>;

@Injectable()
export class WorkbooksService {
  constructor(
    private readonly prisma: PrismaService, private readonly audit: AuditService, private readonly docs: DocumentsService,
    private readonly templates: SheetTemplatesService, private readonly sheets: SheetsService,
  ) {}

  /** Versões publicadas mais recentes dos modelos de ficha da organização, por código e por id. */
  private async publishedTemplates(tx: Tx, organizationId: string) {
    await this.templates.ensureDefaults(tx, organizationId);
    const vs = await tx.sheetTemplateVersion.findMany({ where: { organizationId, status: 'PUBLISHED', template: { archivedAt: null } }, include: { template: { select: { code: true } } }, orderBy: { number: 'desc' } });
    const byCode: Templates = new Map(); const byId: Templates = new Map();
    for (const v of vs) {
      const t = { versionId: v.id, code: v.template.code, def: v.definition as unknown as SheetDef };
      byId.set(v.id, t);
      if (!byCode.has(t.code)) byCode.set(t.code, t);
    }
    return { byCode, byId };
  }

  /** Plano sugerido para uma aba: destino pelo nome e cabeçalhos; colunas pelos rótulos. */
  private suggest(s: XSheet, byCode: Templates, units: OrgUnit[]): WorkbookSheetPlan {
    const headerRow = suggestHeaderRow(s);
    const labels = headerLabels(s, headerRow);
    const t = suggestTarget(s.name, labels);
    const base = { sheetIndex: s.index, headerRow, firstRow: headerRow + 1, lastRow: null, title: s.name };
    if (t.target === 'sheet') {
      const tpl = byCode.get(t.templateCode);
      if (!tpl) return { sheetIndex: s.index, target: 'ignore' };
      const map: Record<string, { col: number; unit?: string | null }> = {};
      // dimensões "L x A": peça da cerâmica (em m na planilha) ou pano do telhado
      const pair = detectDimensionPair(s, headerRow + 1);
      const pairKeys = t.templateCode === 'CER' ? ['peca_l', 'peca_c'] : t.templateCode === 'TELHADO' ? ['comprimento', 'largura'] : null;
      if (pair && pairKeys) { map[pairKeys[0]!] = { col: pair[0], ...(t.templateCode === 'CER' && { unit: 'm' }) }; map[pairKeys[1]!] = { col: pair[1], ...(t.templateCode === 'CER' && { unit: 'm' }) }; }
      const taken = new Set(Object.values(map).map((m) => m.col));
      const inputs = suggestColumns(labels.map((l, i) => (taken.has(i) ? '' : l)), tpl.def.columns.filter((c) => c.kind === 'input' && !(c.key in map)));
      for (const [k, col] of Object.entries(inputs)) map[k] = { col };
      const used = new Set(Object.values(map).map((m) => m.col));
      // conferência só com cabeçalho bem parecido (evita divergências falsas)
      const calcs = suggestColumns(labels.map((l, i) => (used.has(i) ? '' : l)), tpl.def.columns.filter((c) => c.kind === 'calc'), 0.8);
      return { ...base, target: 'sheet', templateVersionId: tpl.versionId, map, checks: Object.fromEntries(Object.entries(calcs).map(([k, col]) => [k, { col }])), params: {} };
    }
    if (t.target === 'schedule') {
      const m = suggestColumns(labels, [{ key: 'code', label: 'Id' }, { key: 'description', label: 'Descrição' }, { key: 'spec', label: 'Especificação' }, { key: 'unit', label: 'Unidade' }, { key: 'width', label: 'Largura' }, { key: 'height', label: 'Altura' }]);
      const pair = detectDimensionPair(s, headerRow + 1);
      if (pair && m['width'] === undefined && m['height'] === undefined) { m['width'] = pair[0]; m['height'] = pair[1]; }
      if (m['unit'] === undefined) { const u = detectUnitColumn(s, headerRow + 1, units, new Set(Object.values(m))); if (u !== null) m['unit'] = u; }
      const used = new Set(Object.values(m));
      const q = suggestColumns(labels.map((l, i) => (used.has(i) ? '' : l)), [{ key: 'qty', label: 'Quantidade' }]);
      if (m['description'] === undefined || q['qty'] === undefined) return { sheetIndex: s.index, target: 'ignore' };
      return { ...base, target: 'schedule', scheduleKind: t.scheduleKind, map: m as { description: number }, dimUnit: 'm', defaultUnit: 'un', quantities: [{ col: q['qty'], label: 'Unidade' }], check: null };
    }
    return { sheetIndex: s.index, target: 'ignore' };
  }

  async create(actor: Actor, projectId: string, file: UploadedFile | undefined): Promise<WorkbookImportDto> {
    const id = await this.prisma.$transaction(async (tx) => {
      await assertProjectEditable(tx, actor.organizationId, projectId);
      const doc = await this.docs.store(tx, actor, projectId, file, ['XLSX']);
      const sheets = await extractWorkbook(file!.buffer);
      const { byCode } = await this.publishedTemplates(tx, actor.organizationId);
      const units = await loadUnits(tx, actor.organizationId);
      const plan = sheets.map((s) => this.suggest(s, byCode, units));
      const w = await tx.workbookImport.create({ data: { organizationId: actor.organizationId, projectId, documentId: doc.id, plan: plan as unknown as Prisma.InputJsonValue, createdById: actor.userId } });
      await tx.workbookImportSheet.createMany({ data: sheets.map((s) => ({ importId: w.id, organizationId: actor.organizationId, index: s.index, name: s.name, rowCount: s.rows.length, colCount: Math.max(0, ...s.rows.map((r) => r.length)), truncated: !!s.truncated, cells: s.rows as unknown as Prisma.InputJsonValue })) });
      await this.audit.record(tx, actor, { projectId, entityType: 'WorkbookImport', entityId: w.id, action: 'CREATE', after: { fileName: doc.fileName, sheets: sheets.length, suggested: plan.filter((p) => p.target !== 'ignore').length } });
      return w.id;
    }, TX);
    return this.get(actor.organizationId, projectId, id);
  }

  private async load(tx: Tx, organizationId: string, projectId: string, id: string) {
    const w = await tx.workbookImport.findFirst({ where: { id, organizationId, projectId }, include: { document: { select: { fileName: true } }, sheets: { select: { index: true, name: true, rowCount: true, colCount: true, truncated: true }, orderBy: { index: 'asc' } } } });
    if (!w) throw notFound('Migração');
    return w;
  }

  async list(organizationId: string, projectId: string): Promise<WorkbookImportListItemDto[]> {
    const ws = await this.prisma.workbookImport.findMany({ where: { organizationId, projectId }, include: { document: { select: { fileName: true } }, _count: { select: { sheets: true } } }, orderBy: { createdAt: 'desc' } });
    const users = new Map((await this.prisma.user.findMany({ where: { id: { in: [...new Set(ws.map((w) => w.createdById))] } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]));
    return ws.map((w) => ({ id: w.id, fileName: w.document.fileName, status: w.status, sheetCount: w._count.sheets, planned: (w.plan as unknown as WorkbookSheetPlan[]).filter((p) => p.target !== 'ignore').length, createdAt: w.createdAt.toISOString(), createdBy: users.get(w.createdById) ?? '—' }));
  }

  async get(organizationId: string, projectId: string, id: string): Promise<WorkbookImportDto> {
    const w = await this.load(this.prisma, organizationId, projectId, id);
    const u = await this.prisma.user.findUnique({ where: { id: w.createdById }, select: { name: true } });
    return {
      id: w.id, fileName: w.document.fileName, documentId: w.documentId, status: w.status, version: w.version, createdAt: w.createdAt.toISOString(), createdBy: u?.name ?? '—',
      sheets: w.sheets, plan: w.plan as unknown as WorkbookSheetPlan[], result: (w.result as unknown as WorkbookApplyResultDto | null) ?? null,
    };
  }

  private async extract(tx: Tx, organizationId: string, id: string, index: number): Promise<XSheet> {
    const s = await tx.workbookImportSheet.findFirst({ where: { importId: id, organizationId, index } });
    if (!s) throw notFound('Aba');
    return { index: s.index, name: s.name, rows: s.cells as unknown as XSheet['rows'], truncated: s.truncated };
  }

  async sheet(organizationId: string, projectId: string, id: string, index: number, headerRow?: number): Promise<WorkbookSheetDto> {
    const w = await this.load(this.prisma, organizationId, projectId, id);
    const s = await this.extract(this.prisma, organizationId, w.id, index);
    const suggested = suggestHeaderRow(s);
    const info = w.sheets.find((x) => x.index === index)!;
    return { ...info, rows: s.rows, suggestedHeaderRow: suggested, labels: headerLabels(s, headerRow ?? suggested) };
  }

  async savePlan(actor: Actor, projectId: string, id: string, version: number, plan: WorkbookSheetPlan[]) {
    await this.prisma.$transaction(async (tx) => {
      await assertProjectEditable(tx, actor.organizationId, projectId);
      const w = await this.load(tx, actor.organizationId, projectId, id);
      if (w.status !== 'DRAFT') throw conflict('IMPORT_CLOSED', 'Esta migração já foi aplicada ou cancelada.');
      const indexes = new Set(w.sheets.map((s) => s.index));
      const seen = new Set<number>();
      const { byId } = await this.publishedTemplates(tx, actor.organizationId);
      for (const p of plan) {
        if (!indexes.has(p.sheetIndex)) throw invalid(`Aba inexistente: ${p.sheetIndex}.`);
        if (seen.has(p.sheetIndex)) throw invalid('Aba repetida no plano.');
        seen.add(p.sheetIndex);
        if (p.target === 'sheet' && !byId.has(p.templateVersionId)) throw notFound('Versão publicada do modelo de ficha');
      }
      const r = await tx.workbookImport.updateMany({ where: { id, version }, data: { plan: plan as unknown as Prisma.InputJsonValue, version: { increment: 1 } } });
      if (r.count === 0) throw versionConflict();
      await this.audit.record(tx, actor, { projectId, entityType: 'WorkbookImport', entityId: id, action: 'UPDATE', after: { planned: plan.filter((p) => p.target !== 'ignore').map((p) => p.sheetIndex) } });
    });
  }

  /** Monta e confere uma aba conforme o plano, sem gravar nada. */
  private async build(tx: Tx, organizationId: string, id: string, plan: Exclude<WorkbookSheetPlan, { target: 'ignore' }>, units: OrgUnit[], byId: Templates) {
    const s = await this.extract(tx, organizationId, id, plan.sheetIndex);
    const problems: string[] = [];
    if (plan.firstRow <= plan.headerRow) problems.push('A primeira linha de dados deve vir depois do cabeçalho.');
    if (plan.target === 'sheet') {
      const tpl = byId.get(plan.templateVersionId);
      if (!tpl) throw notFound('Versão publicada do modelo de ficha');
      const issues = compileSheet(tpl.def, units).issues;
      if (issues.length) problems.push(...issues.map((i) => i.message));
      const sp: SheetPlan = { headerRow: plan.headerRow, firstRow: plan.firstRow, lastRow: plan.lastRow ?? null, map: plan.map, checks: plan.checks };
      for (const k of Object.keys(plan.map)) if (!tpl.def.columns.some((c) => c.key === k && c.kind === 'input')) problems.push(`Coluna de entrada inexistente no modelo: ${k}.`);
      for (const k of Object.keys(plan.checks)) if (!tpl.def.columns.some((c) => c.key === k && c.kind === 'calc')) problems.push(`Coluna calculada inexistente no modelo: ${k}.`);
      for (const r of [...Object.values(plan.map), ...Object.values(plan.checks)]) if (r.unit && !units.some((u) => u.symbol === r.unit)) problems.push(`Unidade não cadastrada: ${r.unit}.`);
      if (problems.length) return { kind: 'sheet' as const, sheet: s, problems, built: null, rec: null, tpl };
      const built = buildSheetRows(s, sp, tpl.def, units);
      const rec = reconcileSheet(s, sp, built, tpl.def, units, plan.params);
      if (!built.rows.length) problems.push('Nenhuma linha de dados encontrada com o mapeamento escolhido.');
      if (built.rows.length > MAX_SHEET_ROWS) problems.push(`A aba gera mais de ${MAX_SHEET_ROWS} linhas.`);
      return { kind: 'sheet' as const, sheet: s, problems, built, rec, tpl };
    }
    if (!units.some((u) => u.symbol === plan.defaultUnit)) problems.push(`Unidade não cadastrada: ${plan.defaultUnit}.`);
    if (plan.dimUnit && !units.some((u) => u.symbol === plan.dimUnit)) problems.push(`Unidade não cadastrada: ${plan.dimUnit}.`);
    if (problems.length) return { kind: 'schedule' as const, sheet: s, problems, built: null, rec: null, tpl: null };
    const sp: SchedulePlanInput = { headerRow: plan.headerRow, firstRow: plan.firstRow, lastRow: plan.lastRow ?? null, map: plan.map, dimUnit: plan.dimUnit ?? 'm', defaultUnit: plan.defaultUnit, quantities: plan.quantities, check: plan.check ?? null };
    const built = buildScheduleRows(s, sp, units);
    if (!built.rows.length) problems.push('Nenhum item encontrado com o mapeamento escolhido.');
    if (built.rows.length > MAX_SCHEDULE_ROWS) problems.push(`A aba gera mais de ${MAX_SCHEDULE_ROWS} itens.`);
    return { kind: 'schedule' as const, sheet: s, problems, built, rec: null, tpl: null };
  }

  private report(plan: Exclude<WorkbookSheetPlan, { target: 'ignore' }>, b: Awaited<ReturnType<WorkbooksService['build']>>): WorkbookPreviewDto {
    const base = { sheetIndex: plan.sheetIndex, target: plan.target, problems: b.problems };
    if (b.kind === 'sheet') {
      return {
        ...base, rowCount: b.built?.rows.length ?? 0,
        sample: (b.built?.rows ?? []).slice(0, 50).map((r, i) => ({ row: b.built!.sourceRows[i]!, cells: Object.fromEntries(Object.entries(r).map(([k, c]) => [k, c?.v ?? ''])) })),
        skipped: b.built?.skipped ?? [], rowErrors: b.rec?.rowErrors ?? [], checks: b.rec?.checks ?? [], totals: b.rec?.totals ?? [],
      };
    }
    const sb = b.built as ReturnType<typeof buildScheduleRows> | null;
    return {
      ...base, rowCount: sb?.rows.length ?? 0,
      sample: (sb?.rows ?? []).slice(0, 50).map((r) => ({ row: r.sourceRow, cells: { code: r.code ?? '', description: r.description, spec: r.spec ?? '', unit: r.unit, width: r.width ?? '', height: r.height ?? '', ...r.cells } })),
      skipped: sb?.skipped ?? [], rowErrors: [], checks: sb?.check ? [sb.check] : [], totals: [],
    };
  }

  async preview(organizationId: string, projectId: string, id: string, plan: WorkbookSheetPlan): Promise<WorkbookPreviewDto> {
    if (plan.target === 'ignore') throw invalid('Aba ignorada não tem prévia.');
    const w = await this.load(this.prisma, organizationId, projectId, id);
    const [units, { byId }] = await Promise.all([loadUnits(this.prisma, organizationId), this.prisma.$transaction((tx) => this.publishedTemplates(tx, organizationId))]);
    return this.report(plan, await this.build(this.prisma, organizationId, w.id, plan, units, byId));
  }

  /** Cria as fichas e quadros do plano numa transação; nada é lançado em quantitativos. */
  async apply(actor: Actor, projectId: string, id: string, version: number): Promise<WorkbookImportDto> {
    await this.prisma.$transaction(async (tx) => {
      await assertProjectEditable(tx, actor.organizationId, projectId);
      const w = await this.load(tx, actor.organizationId, projectId, id);
      if (w.version !== version) throw versionConflict();
      if (w.status !== 'DRAFT') throw conflict('IMPORT_CLOSED', 'Esta migração já foi aplicada ou cancelada.');
      const plans = (w.plan as unknown as WorkbookSheetPlan[]).filter((p): p is Exclude<WorkbookSheetPlan, { target: 'ignore' }> => p.target !== 'ignore');
      if (!plans.length) throw invalid('Escolha ao menos uma aba para migrar.');
      const units = await loadUnits(tx, actor.organizationId);
      const { byId } = await this.publishedTemplates(tx, actor.organizationId);
      const built = [];
      const errors: { path: string; message: string }[] = [];
      for (const p of plans) {
        const b = await this.build(tx, actor.organizationId, w.id, p, units, byId);
        for (const m of b.problems) errors.push({ path: `sheets.${p.sheetIndex}`, message: `${b.sheet.name}: ${m}` });
        built.push({ p, b });
      }
      if (errors.length) throw new AppError(422, 'WORKBOOK_PLAN_INVALID', 'Plano de migração com problemas', `Corrija ${errors.length} problema(s) antes de aplicar.`, errors.slice(0, 50));
      const unitId = new Map(units.map((u) => [u.symbol, u.id]));
      const result: WorkbookApplyResultDto = { appliedAt: new Date().toISOString(), created: [] };
      for (const { p, b } of built) {
        const source = `${w.document.fileName} › ${b.sheet.name}`.slice(0, 300);
        if (b.kind === 'sheet') {
          const tpl = b.tpl!;
          const outputMap = await this.sheets.suggestedMap(tx, actor.organizationId, projectId, tpl.def);
          const sh = await tx.sheet.create({ data: { organizationId: actor.organizationId, projectId, templateVersionId: tpl.versionId, title: p.title, params: p.target === 'sheet' ? p.params : {}, outputMap, rows: b.built!.rows as unknown as Prisma.InputJsonValue, sourceReference: source, documentId: w.documentId, createdById: actor.userId } });
          await this.audit.record(tx, actor, { projectId, entityType: 'Sheet', entityId: sh.id, action: 'CREATE', reason: `Migração da planilha ${source}`.slice(0, 500), after: { title: p.title, template: tpl.code, rows: b.built!.rows.length } });
          result.created.push({ sheetIndex: p.sheetIndex, sheetName: b.sheet.name, kind: 'sheet', id: sh.id, title: p.title, rows: b.built!.rows.length, skipped: b.built!.skipped.length, checksOk: b.rec!.checks.length ? b.rec!.checks.every((c) => c.ok) : null });
        } else {
          const sp = p as Extract<WorkbookSheetPlan, { target: 'schedule' }>;
          const sb = b.built as ReturnType<typeof buildScheduleRows>;
          const sc = await tx.schedule.create({ data: { organizationId: actor.organizationId, projectId, kind: sp.scheduleKind, title: sp.title, sourceReference: source, documentId: w.documentId, createdById: actor.userId } });
          await tx.scheduleColumn.createMany({ data: sp.quantities.map((q, i) => ({ organizationId: actor.organizationId, projectId, scheduleId: sc.id, key: `d${i + 1}`, position: i, label: q.label })) });
          await tx.scheduleRow.createMany({ data: sb.rows.map((r, i) => ({ organizationId: actor.organizationId, projectId, scheduleId: sc.id, key: r.key, position: i, code: r.code?.slice(0, 30) ?? null, description: r.description, spec: r.spec, unitId: unitId.get(r.unit)!, width: r.width, height: r.height, cells: r.cells })) });
          await this.audit.record(tx, actor, { projectId, entityType: 'Schedule', entityId: sc.id, action: 'CREATE', reason: `Migração da planilha ${source}`.slice(0, 500), after: { kind: sp.scheduleKind, title: sp.title, rows: sb.rows.length } });
          result.created.push({ sheetIndex: p.sheetIndex, sheetName: b.sheet.name, kind: 'schedule', id: sc.id, title: sp.title, rows: sb.rows.length, skipped: sb.skipped.length, checksOk: sb.check ? sb.check.ok : null });
        }
      }
      await tx.workbookImport.update({ where: { id }, data: { status: 'APPLIED', result: result as unknown as Prisma.InputJsonValue, version: { increment: 1 } } });
      await this.audit.record(tx, actor, { projectId, entityType: 'WorkbookImport', entityId: id, action: 'APPLY', after: { created: result.created.map((c) => ({ kind: c.kind, id: c.id, rows: c.rows, checksOk: c.checksOk })) } });
    }, TX);
    return this.get(actor.organizationId, projectId, id);
  }

  async cancel(actor: Actor, projectId: string, id: string) {
    await this.prisma.$transaction(async (tx) => {
      await assertProjectEditable(tx, actor.organizationId, projectId);
      const w = await this.load(tx, actor.organizationId, projectId, id);
      if (w.status !== 'DRAFT') throw conflict('IMPORT_CLOSED', 'Esta migração já foi aplicada ou cancelada.');
      await tx.workbookImport.update({ where: { id }, data: { status: 'CANCELLED', version: { increment: 1 } } });
      await this.audit.record(tx, actor, { projectId, entityType: 'WorkbookImport', entityId: id, action: 'CANCEL' });
    });
  }
}
