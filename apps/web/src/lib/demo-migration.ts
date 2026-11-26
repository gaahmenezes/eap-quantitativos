/**
 * Demonstração: migração de planilhas que funciona de verdade no navegador. A planilha enviada é lida aqui
 * (mesmo leitor da API, exceljs), e sugestão, montagem e conferência usam o mesmo planejador do domínio que a API
 * usa (`packages/domain/src/migration/planner.ts`). Nada sai do navegador e nada é gravado: aplicar só valida e
 * mostra o que seria criado. Carregado apenas no build de demonstração.
 */
import type { SheetTemplateDto, WorkbookApplyResultDto, WorkbookImportDto, WorkbookImportListItemDto, WorkbookPreviewDto, WorkbookSheetDto, WorkbookSheetPlan } from '@eapq/contracts';
import {
  buildSchedulePlan, buildSheetPlan, DEFAULT_UNITS, EXTRACT_LIMITS, extractSheets, headerLabels, planProblems, previewOf, suggestHeaderRow, suggestPlan,
  type ActiveMigrationPlan, type MigrationPlan, type PlannerTemplate, type SheetDef, type WorksheetLike, type XSheet,
} from '@eapq/domain';
import { demoFind, demoLookup } from './demo';

/** Erro no formato problem+json; o cliente da API converte em ApiError. */
export class DemoProblem extends Error {
  constructor(readonly status: number, readonly code: string, readonly title: string, readonly detail: string, readonly errors?: { path: string; message: string }[]) { super(detail); }
}
const invalid = (detail: string, errors?: { path: string; message: string }[]) => new DemoProblem(422, 'VALIDATION_FAILED', 'Dados inválidos', detail, errors ?? [{ path: 'file', message: detail }]);
const MAX_BYTES = 20 * 1024 * 1024;

interface Local { projectId: string; dto: WorkbookImportDto; sheets: XSheet[] }
const imports = new Map<string, Local>();
let seq = 0;
export const isLocalImport = (id: string) => id.startsWith('local-');

const units = DEFAULT_UNITS;
function templates() {
  const list = (demoLookup('GET', '/sheet-templates')?.body ?? []) as SheetTemplateDto[];
  const byCode = new Map<string, PlannerTemplate>(); const byId = new Map<string, PlannerTemplate>();
  for (const t of list) {
    if (t.archivedAt) continue;
    for (const v of [...t.versions].sort((a, b) => b.number - a.number)) {
      if (v.status !== 'PUBLISHED') continue;
      const p = { versionId: v.id, templateId: t.id, code: t.code, def: v.definition as unknown as SheetDef };
      byId.set(v.id, p);
      if (!byCode.has(t.code)) byCode.set(t.code, p);
    }
  }
  return { byCode, byId };
}
const me = () => ((demoLookup('GET', '/auth/me')?.body as { user?: { name?: string } } | undefined)?.user?.name ?? 'Você');

/** Envio da planilha: leitura no navegador e plano sugerido por aba. */
export async function demoUpload(projectId: string, file: File): Promise<WorkbookImportDto> {
  if (!/\.xlsx$/i.test(file.name)) throw invalid('Tipo não aceito: envie uma planilha .xlsx.');
  if (file.size > MAX_BYTES) throw invalid('Arquivo maior que 20 MB.');
  const { default: ExcelJS } = await import('exceljs');
  const wb = new ExcelJS.Workbook();
  try { await wb.xlsx.load(await file.arrayBuffer()); } catch { throw new DemoProblem(422, 'INVALID_FILE', 'Arquivo inválido', 'Não foi possível ler a planilha.'); }
  if (!wb.worksheets.length) throw new DemoProblem(422, 'INVALID_FILE', 'Arquivo inválido', 'A planilha não tem abas.');
  if (wb.worksheets.length > EXTRACT_LIMITS.sheets) throw new DemoProblem(422, 'INVALID_FILE', 'Arquivo inválido', `A planilha tem mais de ${EXTRACT_LIMITS.sheets} abas.`);
  const sheets = extractSheets(wb.worksheets as unknown as WorksheetLike[]);
  const { byCode } = templates();
  const plan = sheets.map((s) => suggestPlan(s, byCode, units)) as WorkbookSheetPlan[];
  const id = `local-${++seq}`;
  const dto: WorkbookImportDto = {
    id, fileName: file.name, documentId: id, status: 'DRAFT', version: 1, createdAt: new Date().toISOString(), createdBy: me(),
    sheets: sheets.map((s) => ({ index: s.index, name: s.name, rowCount: s.rows.length, colCount: Math.max(0, ...s.rows.map((r) => r.length)), truncated: !!s.truncated })),
    plan, result: null, updatable: [],
  };
  imports.set(id, { projectId, dto, sheets });
  return dto;
}

const RE = {
  list: /^\/projects\/([^/]+)\/workbook-imports$/,
  one: /^\/projects\/([^/]+)\/workbook-imports\/([^/]+)$/,
  sheet: /^\/projects\/([^/]+)\/workbook-imports\/([^/]+)\/sheets\/(\d+)(?:\?headerRow=(\d+))?$/,
  plan: /^\/projects\/([^/]+)\/workbook-imports\/([^/]+)\/plan$/,
  preview: /^\/projects\/([^/]+)\/workbook-imports\/([^/]+)\/preview$/,
  apply: /^\/projects\/([^/]+)\/workbook-imports\/([^/]+)\/apply$/,
  cancel: /^\/projects\/([^/]+)\/workbook-imports\/([^/]+)\/cancel$/,
};
const local = (p: string, id: string) => {
  const l = imports.get(id);
  if (!l || l.projectId !== p) throw new DemoProblem(404, 'NOT_FOUND', 'Não encontrado', 'Migração não encontrada.');
  return l;
};
/** Extrato de uma aba: da planilha enviada aqui, ou o gravado na demonstração (para verificar com outro mapeamento). */
function sheetOf(p: string, id: string, index: number): XSheet | null {
  if (isLocalImport(id)) return local(p, id).sheets.find((s) => s.index === index) ?? null;
  const rec = demoFind(`GET /projects/${p}/workbook-imports/${id}/sheets/${index}`)?.body as WorkbookSheetDto | undefined;
  return rec ? { index: rec.index, name: rec.name, rows: rec.rows, truncated: rec.truncated } : null;
}

function verify(s: XSheet, plan: ActiveMigrationPlan): WorkbookPreviewDto {
  const { byId } = templates();
  if (plan.target === 'sheet') {
    const tpl = byId.get(plan.templateVersionId);
    const problems = planProblems(plan, units, tpl);
    if (problems.length || !tpl) return { ...previewOf(plan, { kind: 'sheet', problems: [], built: null, rec: null }, problems), update: null } as WorkbookPreviewDto;
    const b = buildSheetPlan(s, plan, tpl, units);
    return { ...previewOf(plan, b, b.problems), update: null } as WorkbookPreviewDto;
  }
  const problems = planProblems(plan, units);
  if (problems.length) return { ...previewOf(plan, { kind: 'schedule', problems: [], built: null }, problems), update: null } as WorkbookPreviewDto;
  const b = buildSchedulePlan(s, plan, units);
  return { ...previewOf(plan, b, b.problems), update: null } as WorkbookPreviewDto;
}

/**
 * Responde às rotas da migração no modo demonstração. `undefined` = não é desta parte (segue a gravação).
 * Para migrações gravadas, só a verificação com um mapeamento diferente do gravado é calculada aqui.
 */
export function demoMigration(method: string, path: string, body: unknown): { body: unknown } | undefined {
  let m: RegExpExecArray | null;
  if (method === 'GET' && (m = RE.list.exec(path))) {
    const rec = (demoLookup('GET', path)?.body ?? []) as WorkbookImportListItemDto[];
    const mine = [...imports.values()].filter((l) => l.projectId === m![1]).reverse().map((l): WorkbookImportListItemDto => ({
      id: l.dto.id, fileName: l.dto.fileName, status: l.dto.status, sheetCount: l.dto.sheets.length, planned: l.dto.plan.filter((x) => x.target !== 'ignore').length, createdAt: l.dto.createdAt, createdBy: l.dto.createdBy,
    }));
    return { body: [...mine, ...rec] };
  }
  if (method === 'GET' && (m = RE.sheet.exec(path)) && isLocalImport(m[2]!)) {
    const l = local(m[1]!, m[2]!);
    const s = l.sheets.find((x) => x.index === Number(m![3]));
    if (!s) throw new DemoProblem(404, 'NOT_FOUND', 'Não encontrado', 'Aba não encontrada.');
    const suggested = suggestHeaderRow(s);
    const info = l.dto.sheets.find((x) => x.index === s.index)!;
    return { body: { ...info, rows: s.rows, suggestedHeaderRow: suggested, labels: headerLabels(s, m[4] !== undefined ? Number(m[4]) : suggested) } satisfies WorkbookSheetDto };
  }
  if (method === 'GET' && (m = RE.sheet.exec(path)) && !demoLookup(method, path)) {
    // aba gravada, com outra linha de cabeçalho: rótulos recalculados sobre o extrato gravado
    const rec = demoFind(`GET /projects/${m[1]}/workbook-imports/${m[2]}/sheets/${m[3]}`)?.body as WorkbookSheetDto | undefined;
    if (!rec) return undefined;
    const s: XSheet = { index: rec.index, name: rec.name, rows: rec.rows, truncated: rec.truncated };
    return { body: { ...rec, labels: headerLabels(s, m[4] !== undefined ? Number(m[4]) : rec.suggestedHeaderRow) } satisfies WorkbookSheetDto };
  }
  if (method === 'GET' && (m = RE.one.exec(path)) && isLocalImport(m[2]!)) return { body: local(m[1]!, m[2]!).dto };
  if (method === 'PUT' && (m = RE.plan.exec(path)) && isLocalImport(m[2]!)) {
    const l = local(m[1]!, m[2]!);
    if (l.dto.status !== 'DRAFT') throw new DemoProblem(409, 'IMPORT_CLOSED', 'Conflito', 'Esta migração já foi aplicada ou cancelada.');
    const plan = (body as { sheets: WorkbookSheetPlan[] }).sheets;
    l.dto = { ...l.dto, plan, version: l.dto.version + 1 };
    return { body: undefined };
  }
  if (method === 'POST' && (m = RE.preview.exec(path))) {
    const plan = (body as { plan: MigrationPlan }).plan;
    if (plan.target === 'ignore') throw invalid('Aba ignorada não tem prévia.', [{ path: 'plan', message: 'Aba ignorada não tem prévia.' }]);
    // migração gravada com exatamente este plano: a resposta real (inclui diferenças de atualização)
    if (!isLocalImport(m[2]!) && demoLookup(method, path, JSON.stringify(body))) return undefined;
    const s = sheetOf(m[1]!, m[2]!, plan.sheetIndex);
    if (!s) return undefined;
    return { body: verify(s, plan) };
  }
  if (method === 'POST' && (m = RE.apply.exec(path)) && isLocalImport(m[2]!)) {
    const l = local(m[1]!, m[2]!);
    const plans = (l.dto.plan as MigrationPlan[]).filter((p): p is ActiveMigrationPlan => p.target !== 'ignore');
    if (!plans.length) throw invalid('Escolha ao menos uma aba para migrar.', [{ path: 'plan', message: 'Escolha ao menos uma aba para migrar.' }]);
    const errors: { path: string; message: string }[] = [];
    const result: WorkbookApplyResultDto = { appliedAt: new Date().toISOString(), created: [] };
    for (const p of plans) {
      const s = l.sheets.find((x) => x.index === p.sheetIndex)!;
      const r = verify(s, p);
      for (const msg of r.problems) errors.push({ path: `sheets.${p.sheetIndex}`, message: `${s.name}: ${msg}` });
      result.created.push({ sheetIndex: p.sheetIndex, sheetName: s.name, kind: p.target, id: `local-${l.dto.id}-${p.sheetIndex}`, title: p.title, rows: r.rowCount, skipped: r.skipped.length, checksOk: r.checks.length ? r.checks.every((c) => c.ok) : null, action: 'created' });
    }
    if (errors.length) throw new DemoProblem(422, 'WORKBOOK_PLAN_INVALID', 'Plano de migração com problemas', `Corrija ${errors.length} problema(s) antes de aplicar.`, errors.slice(0, 50));
    l.dto = { ...l.dto, status: 'APPLIED', version: l.dto.version + 1, result };
    return { body: l.dto };
  }
  if (method === 'POST' && (m = RE.cancel.exec(path)) && isLocalImport(m[2]!)) {
    const l = local(m[1]!, m[2]!);
    l.dto = { ...l.dto, status: 'CANCELLED', version: l.dto.version + 1 };
    return { body: undefined };
  }
  return undefined;
}
