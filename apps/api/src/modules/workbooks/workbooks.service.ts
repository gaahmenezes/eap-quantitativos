import { Injectable } from '@nestjs/common';
import type { AnchorInput, WorkbookApplyResultDto, WorkbookImportDto, WorkbookImportListItemDto, WorkbookPreviewDto, WorkbookSheetDto, WorkbookSheetPlan, WorkbookUpdatableDto, WorkbookUpdateDiffDto } from '@eapq/contracts';
import {
  blockEnd, buildScheduleRows, buildSheetRows, compileSheet, computeSheet, diffRows, scheduleKeyed, sheetKeyed, sheetLabels, detectDimensionPair, detectUnitColumn, FRACTION, hasNumbers, headerCandidates, headerLabels, looksLikeFraction, reconcileSheet, suggestColumns, suggestHeaderRow, suggestTarget,
  type RowsDiff, type ScheduleItem, type SchedulePlanInput, type SheetDef, type SheetPlan, type SheetRowInput, type XSheet,
} from '@eapq/domain';
import type { Actor } from '../../common/auth/auth-context.js';
import { AppError, conflict, notFound, versionConflict } from '../../common/errors.js';
import { assertProjectEditable } from '../../common/project-guard.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { PrismaService, type Tx } from '../../prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { DocumentsService, type UploadedFile } from '../documents/documents.service.js';
import { loadUnits, type OrgUnit } from '../formulas/units.js';
import { SchedulesService } from '../schedules/schedules.service.js';
import { SheetTemplatesService } from '../sheets/sheet-templates.service.js';
import { SheetsService } from '../sheets/sheets.service.js';
import { extractWorkbook } from './extract.js';

const TX = { timeout: 120_000 } as const;
const invalid = (detail: string, errors: { path: string; message: string }[] = []) => new AppError(422, 'VALIDATION_FAILED', 'Dados inválidos', detail, errors.length ? errors : [{ path: 'plan', message: detail }]);
const MAX_SHEET_ROWS = 2000;
const MAX_SCHEDULE_ROWS = 1500;

type Templates = Map<string, { versionId: string; templateId: string; code: string; def: SheetDef }>;
type ActivePlan = Exclude<WorkbookSheetPlan, { target: 'ignore' }>;
const MAX_DIFF_ROWS = 200;
/** Rótulo legível de uma linha de ficha (as colunas de texto) ou de um item de quadro. */
const sheetRowLabel = (def: SheetDef, r: SheetRowInput | undefined) => (r ? def.columns.filter((c) => c.kind === 'input' && c.type !== 'number').map((c) => r[c.key]?.v ?? '').filter(Boolean).join(' · ') : '') || '(sem texto)';
const itemLabel = (r: ScheduleItem | undefined) => (r ? [r.code, r.description, r.spec].filter(Boolean).join(' · ') : '');

@Injectable()
export class WorkbooksService {
  constructor(
    private readonly prisma: PrismaService, private readonly audit: AuditService, private readonly docs: DocumentsService,
    private readonly templates: SheetTemplatesService, private readonly sheets: SheetsService, private readonly schedules: SchedulesService,
  ) {}

  /** Versões publicadas mais recentes dos modelos de ficha da organização, por código e por id. */
  private async publishedTemplates(tx: Tx, organizationId: string) {
    await this.templates.ensureDefaults(tx, organizationId);
    const vs = await tx.sheetTemplateVersion.findMany({ where: { organizationId, status: 'PUBLISHED', template: { archivedAt: null } }, include: { template: { select: { code: true } } }, orderBy: { number: 'desc' } });
    const byCode: Templates = new Map(); const byId: Templates = new Map();
    for (const v of vs) {
      const t = { versionId: v.id, templateId: v.templateId, code: v.template.code, def: v.definition as unknown as SheetDef };
      byId.set(v.id, t);
      if (!byCode.has(t.code)) byCode.set(t.code, t);
    }
    return { byCode, byId };
  }

  /** Plano sugerido para uma aba: destino pelo nome e cabeçalhos; colunas pelos rótulos. */
  private suggest(s: XSheet, byCode: Templates, units: OrgUnit[]): WorkbookSheetPlan {
    const headerRow = suggestHeaderRow(s);
    const labels = headerLabels(s, headerRow);
    const t = suggestTarget(s.name, labels, { unitColumn: detectUnitColumn(s, headerRow + 1, units) !== null });
    if (t.target === 'sheet') {
      const tpl = byCode.get(t.templateCode);
      // aba com mais de um bloco: o cabeçalho é o que mais casa com o modelo
      const options = tpl ? headerCandidates(s).map((h) => this.suggestSheet(s, h, tpl, units)) : [];
      const best = options.reduce<(typeof options)[number] | null>((b, o) => (!b || o.mapped > b.mapped ? o : b), null);
      if (best && best.mapped >= 2) return best.plan;
      // poucas colunas reconhecidas: talvez seja uma lista de materiais
      const list = this.suggestSchedule(s, headerRow, labels, 'OUTROS', units);
      return list ?? { sheetIndex: s.index, target: 'ignore' };
    }
    if (t.target === 'schedule') return this.suggestSchedule(s, headerRow, labels, t.scheduleKind, units) ?? { sheetIndex: s.index, target: 'ignore' };
    return { sheetIndex: s.index, target: 'ignore' };
  }

  private suggestSheet(s: XSheet, headerRow: number, tpl: { versionId: string; templateId: string; code: string; def: SheetDef }, units: OrgUnit[]) {
    const labels = headerLabels(s, headerRow);
    const first = headerRow + 1;
    const map: Record<string, { col: number; unit?: string | null }> = {};
    // dimensões "L x A": peça da cerâmica (em m na planilha), pano do telhado, peça de mármore
    const pair = detectDimensionPair(s, first);
    const pairKeys = tpl.code === 'CER' ? ['peca_l', 'peca_c'] : tpl.code === 'TELHADO' || tpl.code === 'MARM' ? ['comprimento', 'largura'] : null;
    if (pair && pairKeys) { map[pairKeys[0]!] = { col: pair[0], ...(tpl.code === 'CER' && { unit: 'm' }) }; map[pairKeys[1]!] = { col: pair[1], ...(tpl.code === 'CER' && { unit: 'm' }) }; }
    const taken = new Set(Object.values(map).map((m) => m.col));
    const inputs = suggestColumns(labels.map((l, i) => (taken.has(i) ? '' : l)), tpl.def.columns.filter((c) => c.kind === 'input' && !(c.key in map)));
    for (const [k, col] of Object.entries(inputs)) map[k] = { col };
    // porcentagem escrita como fração (cabeçalho "(%)" ou "m/m" com valores 0,35 = 35%)
    for (const c of tpl.def.columns) {
      const m = map[c.key];
      if (c.kind === 'input' && c.unit === '%' && m && !m.unit && /%|m\/m/.test(labels[m.col] ?? '') && looksLikeFraction(s, m.col, first)) map[c.key] = { ...m, unit: FRACTION };
    }
    const used = new Set(Object.values(map).map((m) => m.col));
    // conferência só com cabeçalho bem parecido (evita divergências falsas)
    const calcs = suggestColumns(labels.map((l, i) => (used.has(i) || !hasNumbers(s, i, first) ? '' : l)), tpl.def.columns.filter((c) => c.kind === 'calc'), 0.8);
    // superfícies sem medidas (perímetro × altura): a área de parede da planilha é a entrada, não a conferência
    if (tpl.code === 'SUP' && calcs['parede_liq'] !== undefined && (!map['perimetro'] || !hasNumbers(s, map['perimetro'].col, first))) { map['parede_inf'] = { col: calcs['parede_liq'] }; delete calcs['parede_liq']; }
    // pontuação: colunas numéricas reconhecidas + campos obrigatórios presentes; zero se não sai nenhuma linha
    const numeric = Object.values(map).filter((m) => hasNumbers(s, m.col, first)).length;
    const required = tpl.def.columns.filter((c) => c.kind === 'input' && c.required).every((c) => c.key in map) ? 1 : 0;
    const lastRow = blockEnd(s, headerRow);
    const rows = numeric ? buildSheetRows(s, { headerRow, firstRow: first, lastRow, map }, tpl.def, units).rows.length : 0;
    const mapped = rows ? numeric + required : 0;
    const plan: WorkbookSheetPlan = {
      sheetIndex: s.index, headerRow, firstRow: first, lastRow, title: s.name, target: 'sheet', templateVersionId: tpl.versionId, map,
      checks: Object.fromEntries(Object.entries(calcs).map(([k, col]) => [k, { col }])), params: {},
    };
    return { plan, mapped };
  }

  private suggestSchedule(s: XSheet, headerRow: number, labels: string[], scheduleKind: Extract<WorkbookSheetPlan, { target: 'schedule' }>['scheduleKind'], units: OrgUnit[]): WorkbookSheetPlan | null {
    const m = suggestColumns(labels, [{ key: 'code', label: 'Id' }, { key: 'description', label: 'Descrição' }, { key: 'spec', label: 'Especificação' }, { key: 'unit', label: 'Unidade' }, { key: 'width', label: 'Largura' }, { key: 'height', label: 'Altura' }]);
    const pair = detectDimensionPair(s, headerRow + 1);
    if (pair && m['width'] === undefined && m['height'] === undefined) { m['width'] = pair[0]; m['height'] = pair[1]; }
    if (m['unit'] === undefined) { const u = detectUnitColumn(s, headerRow + 1, units, new Set(Object.values(m))); if (u !== null) m['unit'] = u; }
    // sem coluna "Descrição": a primeira coluna de texto (ex.: "Tipologia", "Elemento")
    if (m['description'] === undefined) {
      const used0 = new Set(Object.values(m));
      const first = labels.findIndex((l, i) => !!l && !used0.has(i) && s.rows.slice(headerRow + 1, headerRow + 30).some((r) => r[i] && !r[i]!.num && r[i]!.v.trim()));
      if (first >= 0) m['description'] = first;
    }
    const used = new Set(Object.values(m));
    const q = suggestColumns(labels.map((l, i) => (used.has(i) || !hasNumbers(s, i, headerRow + 1) ? '' : l)), [{ key: 'qty', label: 'Quantidade' }]);
    if (m['description'] === undefined || q['qty'] === undefined) return null;
    return { sheetIndex: s.index, headerRow, firstRow: headerRow + 1, lastRow: null, title: s.name, target: 'schedule', scheduleKind, map: m as { description: number }, dimUnit: 'm', defaultUnit: 'un', quantities: [{ col: q['qty'], label: 'Unidade' }], check: null };
  }

  async create(actor: Actor, projectId: string, file: UploadedFile | undefined): Promise<WorkbookImportDto> {
    const id = await this.prisma.$transaction(async (tx) => {
      await assertProjectEditable(tx, actor.organizationId, projectId);
      const doc = await this.docs.store(tx, actor, projectId, file, ['XLSX']);
      const sheets = await extractWorkbook(file!.buffer);
      const { byCode } = await this.publishedTemplates(tx, actor.organizationId);
      const units = await loadUnits(tx, actor.organizationId);
      const plan = sheets.map((s) => this.suggest(s, byCode, units));
      await this.suggestUpdates(tx, actor.organizationId, projectId, sheets, plan, byCode);
      const w = await tx.workbookImport.create({ data: { organizationId: actor.organizationId, projectId, documentId: doc.id, plan: plan as unknown as Prisma.InputJsonValue, createdById: actor.userId } });
      await tx.workbookImportSheet.createMany({ data: sheets.map((s) => ({ importId: w.id, organizationId: actor.organizationId, index: s.index, name: s.name, rowCount: s.rows.length, colCount: Math.max(0, ...s.rows.map((r) => r.length)), truncated: !!s.truncated, cells: s.rows as unknown as Prisma.InputJsonValue })) });
      await this.audit.record(tx, actor, { projectId, entityType: 'WorkbookImport', entityId: w.id, action: 'CREATE', after: { fileName: doc.fileName, sheets: sheets.length, suggested: plan.filter((p) => p.target !== 'ignore').length } });
      return w.id;
    }, TX);
    return this.get(actor.organizationId, projectId, id);
  }

  /** Fichas e quadros ativos do empreendimento que uma aba pode atualizar. */
  private async updatable(tx: Tx, organizationId: string, projectId: string): Promise<WorkbookUpdatableDto[]> {
    const [sheets, schedules] = await Promise.all([
      tx.sheet.findMany({ where: { organizationId, projectId, archivedAt: null }, select: { id: true, title: true, version: true, templateVersionId: true, sourceSheetName: true, launchedHash: true, updatedAt: true, templateVersion: { select: { templateId: true, template: { select: { code: true } } } } }, orderBy: { updatedAt: 'desc' } }),
      tx.schedule.findMany({ where: { organizationId, projectId, archivedAt: null }, select: { id: true, title: true, version: true, sourceSheetName: true, launchedHash: true, columns: { select: { label: true, position: true }, orderBy: { position: 'asc' } } }, orderBy: { updatedAt: 'desc' } }),
    ]);
    return [
      ...sheets.map((x) => ({ kind: 'sheet' as const, id: x.id, title: x.title, version: x.version, templateId: x.templateVersion.templateId, templateVersionId: x.templateVersionId, templateCode: x.templateVersion.template.code, columns: [], sourceSheetName: x.sourceSheetName, launched: !!x.launchedHash })),
      ...schedules.map((x) => ({ kind: 'schedule' as const, id: x.id, title: x.title, version: x.version, templateId: null, templateVersionId: null, templateCode: null, columns: x.columns.map((c) => c.label), sourceSheetName: x.sourceSheetName, launched: !!x.launchedHash })),
    ];
  }

  /**
   * Nova versão da mesma planilha: a aba que já originou uma ficha (mesmo modelo) ou um quadro (mesmo número de
   * colunas de quantidade) passa a atualizá-lo em vez de criar outro. O usuário pode trocar para "criar novo".
   */
  private async suggestUpdates(tx: Tx, organizationId: string, projectId: string, sheets: XSheet[], plan: WorkbookSheetPlan[], byCode: Templates) {
    const all = (await this.updatable(tx, organizationId, projectId)).filter((u) => u.sourceSheetName);
    if (!all.length) return;
    const templateOf = new Map([...byCode.values()].map((t) => [t.versionId, t.templateId]));
    plan.forEach((p, i) => {
      if (p.target === 'ignore') return;
      const name = sheets.find((s) => s.index === p.sheetIndex)?.name;
      if (p.target === 'sheet') {
        const u = all.find((x) => x.kind === 'sheet' && x.sourceSheetName === name && x.templateId === templateOf.get(p.templateVersionId));
        if (u) plan[i] = { ...p, title: u.title, templateVersionId: u.templateVersionId!, updateOf: { id: u.id, version: u.version } };
      } else {
        const u = all.find((x) => x.kind === 'schedule' && x.sourceSheetName === name && x.columns.length === p.quantities.length);
        if (u) plan[i] = { ...p, title: u.title, quantities: p.quantities.map((q, k) => ({ ...q, label: u.columns[k]! })), updateOf: { id: u.id, version: u.version } };
      }
    });
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
      updatable: w.status === 'DRAFT' ? await this.updatable(this.prisma, organizationId, projectId) : [],
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

  /** Monta e confere uma aba conforme o plano, sem gravar nada (e, se atualiza algo, compara com o atual). */
  private async build(tx: Tx, organizationId: string, projectId: string, id: string, plan: ActivePlan, units: OrgUnit[], byId: Templates) {
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
      for (const r of [...Object.values(plan.map), ...Object.values(plan.checks)]) if (r.unit && r.unit !== FRACTION && !units.some((u) => u.symbol === r.unit)) problems.push(`Unidade não cadastrada: ${r.unit}.`);
      if (problems.length) return { kind: 'sheet' as const, sheet: s, problems, built: null, rec: null, tpl, target: null, diff: null, params: plan.params };
      // atualização: a ficha atual (mesmo modelo) e seus parâmetros, que valem também para a nova versão
      const target = plan.updateOf ? await tx.sheet.findFirst({ where: { id: plan.updateOf.id, projectId, organizationId }, include: { templateVersion: { select: { templateId: true, definition: true } } } }) : null;
      if (plan.updateOf) {
        if (!target) problems.push('A ficha a atualizar não existe neste empreendimento.');
        else if (target.archivedAt) problems.push(`A ficha "${target.title}" está arquivada; restaure-a ou crie uma ficha nova.`);
        else if (target.templateVersion.templateId !== tpl.templateId) problems.push(`A ficha "${target.title}" usa outro modelo; escolha o mesmo modelo ou crie uma ficha nova.`);
        else if (target.version !== plan.updateOf.version) problems.push(`A ficha "${target.title}" foi alterada depois que a atualização foi planejada; confira as diferenças e confirme de novo.`);
      }
      const params = { ...((target?.params as Record<string, string> | undefined) ?? {}), ...plan.params };
      if (plan.updateOf && (!target || target.archivedAt || target.templateVersion.templateId !== tpl.templateId)) return { kind: 'sheet' as const, sheet: s, problems, built: null, rec: null, tpl, target: null, diff: null, params };
      const built = buildSheetRows(s, sp, tpl.def, units);
      const rec = reconcileSheet(s, sp, built, tpl.def, units, params);
      if (!built.rows.length) problems.push('Nenhuma linha de dados encontrada com o mapeamento escolhido.');
      if (built.rows.length > MAX_SHEET_ROWS) problems.push(`A aba gera mais de ${MAX_SHEET_ROWS} linhas.`);
      const diff = target ? diffRows(sheetKeyed(tpl.def, target.rows as SheetRowInput[]), sheetKeyed(tpl.def, built.rows), sheetLabels(tpl.def)) : null;
      return { kind: 'sheet' as const, sheet: s, problems, built, rec, tpl, target, diff, params };
    }
    if (!units.some((u) => u.symbol === plan.defaultUnit)) problems.push(`Unidade não cadastrada: ${plan.defaultUnit}.`);
    if (plan.dimUnit && !units.some((u) => u.symbol === plan.dimUnit)) problems.push(`Unidade não cadastrada: ${plan.dimUnit}.`);
    if (problems.length) return { kind: 'schedule' as const, sheet: s, problems, built: null, rec: null, tpl: null, current: null, items: null, diff: null };
    let current: Awaited<ReturnType<SchedulesService['currentContent']>> | null = null;
    if (plan.updateOf) {
      current = await this.schedules.currentContent(tx, organizationId, projectId, plan.updateOf.id).catch(() => null);
      if (!current) problems.push('O quadro a atualizar não existe neste empreendimento.');
      else if (current.schedule.archivedAt) problems.push(`O quadro "${current.schedule.title}" está arquivado; restaure-o ou crie um quadro novo.`);
      else if (current.columns.length !== plan.quantities.length) problems.push(`O quadro "${current.schedule.title}" tem ${current.columns.length} destino(s); escolha ${current.columns.length} coluna(s) de quantidade, na mesma ordem.`);
      else if (current.schedule.version !== plan.updateOf.version) problems.push(`O quadro "${current.schedule.title}" foi alterado depois que a atualização foi planejada; confira as diferenças e confirme de novo.`);
    }
    const sp: SchedulePlanInput = { headerRow: plan.headerRow, firstRow: plan.firstRow, lastRow: plan.lastRow ?? null, map: plan.map, dimUnit: plan.dimUnit ?? 'm', defaultUnit: plan.defaultUnit, quantities: plan.quantities, check: plan.check ?? null };
    if (plan.updateOf && (!current || current.schedule.archivedAt)) return { kind: 'schedule' as const, sheet: s, problems, built: null, rec: null, tpl: null, current: null, items: null, diff: null };
    const built = buildScheduleRows(s, sp, units);
    if (!built.rows.length) problems.push('Nenhum item encontrado com o mapeamento escolhido.');
    if (built.rows.length > MAX_SCHEDULE_ROWS) problems.push(`A aba gera mais de ${MAX_SCHEDULE_ROWS} itens.`);
    // células da aba (d1, d2…) nas colunas do quadro atual, pela ordem
    const colKeys = current && current.columns.length === plan.quantities.length ? current.columns.map((c) => c.key) : plan.quantities.map((_, i) => `d${i + 1}`);
    const items: ScheduleItem[] = built.rows.map((r) => ({ code: r.code, description: r.description, spec: r.spec, unit: r.unit, width: r.width, height: r.height, cells: Object.fromEntries(Object.entries(r.cells).map(([k, v]) => [colKeys[Number(k.slice(1)) - 1]!, v])) }));
    const diff = current ? diffRows(scheduleKeyed(current.rows), scheduleKeyed(items), { code: 'Id', description: 'Descrição', spec: 'Especificação', unit: 'Unidade', width: 'Largura', height: 'Altura', ...Object.fromEntries(current.columns.map((c) => [`cell:${c.key}`, `Quantidade — ${c.label}`])) }) : null;
    return { kind: 'schedule' as const, sheet: s, problems, built, rec: null, tpl: null, current, items, diff };
  }

  private updateReport(b: Awaited<ReturnType<WorkbooksService['build']>>, units: OrgUnit[]): WorkbookUpdateDiffDto | null {
    const diffRowsOut = (d: RowsDiff, label: (status: string, before: number | null, after: number | null) => string, sourceRow: (after: number) => number) => d.rows.filter((r) => r.status !== 'unchanged').slice(0, MAX_DIFF_ROWS).map((r) => ({
      status: r.status as Exclude<typeof r.status, 'unchanged'>, label: label(r.status, r.before, r.after), row: r.after !== null ? sourceRow(r.after) : null, changes: r.changes,
    }));
    if (b.kind === 'sheet') {
      const t = b.target; const d = b.diff;
      if (!t || !d || !b.built) return null;
      const oldRows = t.rows as SheetRowInput[];
      const oldDef = t.templateVersion.definition as unknown as SheetDef;
      const compiled = compileSheet(oldDef, units);
      const beforeTotals = compiled.issues.length ? [] : computeSheet(compiled, oldRows, t.params as Record<string, string>).totals;
      const anchors = t.rowAnchors as (AnchorInput | null)[];
      const kept = d.matches.filter((m) => m !== null && anchors[m]).length;
      return {
        kind: 'sheet', id: t.id, title: t.title, currentVersion: t.version, stale: !!b.problems.find((p) => p.includes('foi alterada depois')), launched: !!t.launchedHash, counts: d.counts,
        rows: diffRowsOut(d, (st, bi, ai) => (st === 'removed' ? sheetRowLabel(oldDef, oldRows[bi!]) : sheetRowLabel(b.tpl.def, b.built!.rows[ai!])), (ai) => b.built!.sourceRows[ai]!),
        totals: (b.rec?.totals ?? []).map((x) => ({ key: x.key, label: x.label, unit: x.unit, after: x.total, before: beforeTotals.find((y) => y.key === x.key)?.total ?? '0' })),
        keptLinks: kept, lostLinks: anchors.filter(Boolean).length - kept,
      };
    }
    const c = b.current; const d = b.diff;
    if (!c || !d || !b.items) return null;
    const kept = d.matches.filter((m) => m !== null && c.rows[m]!.serviceIds.length).length;
    return {
      kind: 'schedule', id: c.schedule.id, title: c.schedule.title, currentVersion: c.schedule.version, stale: !!b.problems.find((p) => p.includes('foi alterado depois')), launched: c.launched, counts: d.counts,
      rows: diffRowsOut(d, (st, bi, ai) => (st === 'removed' ? itemLabel(c.rows[bi!]) : itemLabel(b.items![ai!])), (ai) => b.built!.rows[ai]!.sourceRow),
      totals: [], keptLinks: kept, lostLinks: c.rows.filter((r) => r.serviceIds.length).length - kept,
    };
  }

  private report(plan: ActivePlan, b: Awaited<ReturnType<WorkbooksService['build']>>, units: OrgUnit[]): WorkbookPreviewDto {
    const base = { sheetIndex: plan.sheetIndex, target: plan.target, problems: b.problems, update: this.updateReport(b, units) };
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
    return this.report(plan, await this.build(this.prisma, organizationId, projectId, w.id, plan, units, byId), units);
  }

  /**
   * Cria as fichas e quadros do plano — ou atualiza os existentes pela nova versão da aba — numa transação.
   * Nada é lançado em quantitativos; o que já foi lançado fica "alterado desde o lançamento" até ser relançado.
   */
  async apply(actor: Actor, projectId: string, id: string, version: number): Promise<WorkbookImportDto> {
    await this.prisma.$transaction(async (tx) => {
      await assertProjectEditable(tx, actor.organizationId, projectId);
      const w = await this.load(tx, actor.organizationId, projectId, id);
      if (w.version !== version) throw versionConflict();
      if (w.status !== 'DRAFT') throw conflict('IMPORT_CLOSED', 'Esta migração já foi aplicada ou cancelada.');
      const plans = (w.plan as unknown as WorkbookSheetPlan[]).filter((p): p is ActivePlan => p.target !== 'ignore');
      if (!plans.length) throw invalid('Escolha ao menos uma aba para migrar.');
      const targets = plans.filter((p) => p.updateOf).map((p) => p.updateOf!.id);
      if (new Set(targets).size !== targets.length) throw invalid('Duas abas atualizam a mesma ficha ou o mesmo quadro.');
      const units = await loadUnits(tx, actor.organizationId);
      const { byId } = await this.publishedTemplates(tx, actor.organizationId);
      const built = [];
      const errors: { path: string; message: string }[] = [];
      for (const p of plans) {
        const b = await this.build(tx, actor.organizationId, projectId, w.id, p, units, byId);
        for (const m of b.problems) errors.push({ path: `sheets.${p.sheetIndex}`, message: `${b.sheet.name}: ${m}` });
        built.push({ p, b });
      }
      if (errors.length) throw new AppError(422, 'WORKBOOK_PLAN_INVALID', 'Plano de migração com problemas', `Corrija ${errors.length} problema(s) antes de aplicar.`, errors.slice(0, 50));
      const unitId = new Map(units.map((u) => [u.symbol, u.id]));
      const result: WorkbookApplyResultDto = { appliedAt: new Date().toISOString(), created: [] };
      for (const { p, b } of built) {
        const source = `${w.document.fileName} › ${b.sheet.name}`.slice(0, 300);
        const reason = `${p.updateOf ? 'Atualização pela planilha' : 'Migração da planilha'} ${source}`.slice(0, 500);
        if (b.kind === 'sheet') {
          const tpl = b.tpl!;
          const sp = p as Extract<WorkbookSheetPlan, { target: 'sheet' }>;
          const rows = b.built!.rows;
          if (b.target && b.diff) {
            // destino por linha segue a linha casada; parâmetros da ficha valem (a aba só sobrepõe os que define)
            const anchors = b.target.rowAnchors as (AnchorInput | null)[];
            const rowAnchors = b.diff.matches.map((m) => (m !== null ? anchors[m] ?? null : null));
            await this.sheets.updateIn(tx, actor, projectId, b.target.id, b.target.version, {
              rows: rows as never, rowAnchors, ...(Object.keys(sp.params).length && { params: b.params }),
              ...(sp.templateVersionId !== b.target.templateVersionId && { templateVersionId: sp.templateVersionId }),
              sourceReference: source, documentId: w.documentId,
            }, reason);
            await tx.sheet.update({ where: { id: b.target.id }, data: { sourceSheetName: b.sheet.name } });
            result.created.push({ sheetIndex: p.sheetIndex, sheetName: b.sheet.name, kind: 'sheet', id: b.target.id, title: b.target.title, rows: rows.length, skipped: b.built!.skipped.length, checksOk: b.rec!.checks.length ? b.rec!.checks.every((c) => c.ok) : null, action: 'updated', counts: b.diff.counts });
            continue;
          }
          const outputMap = await this.sheets.suggestedMap(tx, actor.organizationId, projectId, tpl.def);
          const sh = await tx.sheet.create({ data: { organizationId: actor.organizationId, projectId, templateVersionId: tpl.versionId, title: p.title, params: sp.params, outputMap, rows: rows as unknown as Prisma.InputJsonValue, sourceReference: source, sourceSheetName: b.sheet.name, documentId: w.documentId, createdById: actor.userId } });
          await this.audit.record(tx, actor, { projectId, entityType: 'Sheet', entityId: sh.id, action: 'CREATE', reason, after: { title: p.title, template: tpl.code, rows: rows.length } });
          result.created.push({ sheetIndex: p.sheetIndex, sheetName: b.sheet.name, kind: 'sheet', id: sh.id, title: p.title, rows: rows.length, skipped: b.built!.skipped.length, checksOk: b.rec!.checks.length ? b.rec!.checks.every((c) => c.ok) : null, action: 'created' });
        } else {
          const sp = p as Extract<WorkbookSheetPlan, { target: 'schedule' }>;
          const sb = b.built as ReturnType<typeof buildScheduleRows>;
          if (b.current && b.diff && b.items) {
            // itens casados mantêm a chave e os serviços; os novos entram sem serviço
            const used = new Set(b.current.rows.map((r) => r.key));
            let n = 1;
            const fresh = () => { while (used.has(`m${n}`)) n++; used.add(`m${n}`); return `m${n}`; };
            const rows = b.items.map((it, i) => {
              const m = b.diff!.matches[i];
              const old = m !== null && m !== undefined ? b.current!.rows[m]! : null;
              return { key: old?.key ?? fresh(), code: it.code?.slice(0, 30) ?? null, description: it.description, spec: it.spec, unit: it.unit, width: it.width, height: it.height, serviceIds: old?.serviceIds ?? [], cells: it.cells };
            });
            await this.schedules.saveIn(tx, actor, projectId, b.current.schedule.id, b.current.schedule.version, { sourceReference: source, documentId: w.documentId, columns: b.current.columns, rows }, reason);
            await tx.schedule.update({ where: { id: b.current.schedule.id }, data: { sourceSheetName: b.sheet.name } });
            result.created.push({ sheetIndex: p.sheetIndex, sheetName: b.sheet.name, kind: 'schedule', id: b.current.schedule.id, title: b.current.schedule.title, rows: rows.length, skipped: sb.skipped.length, checksOk: sb.check ? sb.check.ok : null, action: 'updated', counts: b.diff.counts });
            continue;
          }
          const sc = await tx.schedule.create({ data: { organizationId: actor.organizationId, projectId, kind: sp.scheduleKind, title: sp.title, sourceReference: source, sourceSheetName: b.sheet.name, documentId: w.documentId, createdById: actor.userId } });
          await tx.scheduleColumn.createMany({ data: sp.quantities.map((q, i) => ({ organizationId: actor.organizationId, projectId, scheduleId: sc.id, key: `d${i + 1}`, position: i, label: q.label })) });
          await tx.scheduleRow.createMany({ data: sb.rows.map((r, i) => ({ organizationId: actor.organizationId, projectId, scheduleId: sc.id, key: r.key, position: i, code: r.code?.slice(0, 30) ?? null, description: r.description, spec: r.spec, unitId: unitId.get(r.unit)!, width: r.width, height: r.height, cells: r.cells })) });
          await this.audit.record(tx, actor, { projectId, entityType: 'Schedule', entityId: sc.id, action: 'CREATE', reason, after: { kind: sp.scheduleKind, title: sp.title, rows: sb.rows.length } });
          result.created.push({ sheetIndex: p.sheetIndex, sheetName: b.sheet.name, kind: 'schedule', id: sc.id, title: sp.title, rows: sb.rows.length, skipped: sb.skipped.length, checksOk: sb.check ? sb.check.ok : null, action: 'created' });
        }
      }
      await tx.workbookImport.update({ where: { id }, data: { status: 'APPLIED', result: result as unknown as Prisma.InputJsonValue, version: { increment: 1 } } });
      await this.audit.record(tx, actor, { projectId, entityType: 'WorkbookImport', entityId: id, action: 'APPLY', after: { created: result.created.map((c) => ({ kind: c.kind, id: c.id, action: c.action, rows: c.rows, checksOk: c.checksOk })) } });
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
