/**
 * Atualização de fichas e quadros por uma nova versão da planilha (ADR-025): a aba que já originou uma ficha/quadro
 * é sugerida como atualização; a prévia mostra o que entra, sai e muda; aplicar preserva destino por linha e serviços;
 * o lançado fica pendente até ser relançado.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import { SCENARIO_A_VERTICAL } from '@eapq/domain';
import type { ScheduleDetailDto, SheetDetailDto, StructureDto, TemplateDto, WbsDto, WbsNodeDto, WbsPlanDto, WorkbookImportDto, WorkbookPreviewDto, WorkbookSheetPlan } from '@eapq/contracts';
import { bootApp, newProject, signup, upload, type Client } from './helpers.js';

const { app, prisma } = await bootApp();
afterAll(() => app.close());
const ifm = (v: number) => ({ 'If-Match': String(v) });
const byKindCode: Record<string, string> = { VERTICAL_RESIDENTIAL: 'EAP-VERT', HORIZONTAL_RESIDENTIAL: 'EAP-HORIZ', LAND_SUBDIVISION: 'EAP-LOT', COMMON_AREAS: 'EAP-AREAS', INFRASTRUCTURE: 'EAP-INFRA' };
const pathTitles = (w: WbsDto, n: WbsNodeDto) => { const t: string[] = []; let cur: WbsNodeDto | undefined = n; while (cur) { t.unshift(cur.title); cur = w.nodes.find((x) => x.id === cur!.parentId); } return t.join(' › '); };
type SheetP = Extract<WorkbookSheetPlan, { target: 'sheet' }>;
type SchedP = Extract<WorkbookSheetPlan, { target: 'schedule' }>;

/** Duas versões da mesma planilha: na R01 uma parede mudou, a platibanda saiu, entrou o 3º pavimento e mudou uma janela. */
async function workbook(rev: 0 | 1): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const pc = wb.addWorksheet('Paredes concreto');
  pc.addRow(['Elemento', 'Comprimento', 'Altura', 'Desconto', 'Espessura']);
  const paredes = rev === 0
    ? [['Paredes 1º', 32.5, 2.7, 4.56, 10], ['Paredes 2º', 30, 2.7, null, 10], ['Platibanda', 27.76, 0.7, null, 10]]
    : [['Paredes 1º', 32.5, 2.7, 4.56, 10], ['Paredes 2º', 31, 2.7, null, 10], ['Paredes 3º', 20, 2.7, null, 10]];
  for (const r of paredes) pc.addRow(r);
  const esq = wb.addWorksheet('Esquadrias');
  esq.addRow(['Id', 'Descrição', 'Unidade', 'Quantidade']);
  esq.addRow(['J01', 'Janela maxim-ar', 'und', rev === 0 ? 2 : 3]);
  esq.addRow(['P01', 'Porta de madeira', 'und', 4]);
  if (rev === 1) esq.addRow(['J02', 'Janela de correr', 'und', 1]);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

describe('atualização pela nova versão da planilha', () => {
  let c: Client;
  let p: string;
  let s: StructureDto;
  let sheetId: string;
  let schedId: string;
  let w2: WorkbookImportDto;
  const base = () => `/api/projects/${p}/workbook-imports`;
  const node = (name: string, parent: string) => s.nodes.find((n) => n.name === name && s.nodes.find((x) => x.id === n.parentId)?.name === parent)!;
  const st = (n: { id: string }) => ({ kind: 'STRUCTURE_NODE', id: n.id });
  const sheet = async () => (await c.get(`/api/projects/${p}/sheets/${sheetId}`).expect(200)).body as SheetDetailDto;
  const sched = async () => (await c.get(`/api/projects/${p}/schedules/${schedId}`).expect(200)).body as ScheduleDetailDto;
  const preview = async (pl: WorkbookSheetPlan) => (await c.post(`${base()}/${w2.id}/preview`, { plan: pl }).expect(200)).body as WorkbookPreviewDto;
  const planOf = (w: WorkbookImportDto, name: string) => w.plan.find((x) => x.sheetIndex === w.sheets.find((sh) => sh.name === name)!.index)!;

  beforeAll(async () => {
    c = await signup(app, 'Org Atualização');
    p = (await c.post('/api/projects', newProject()).expect(201)).body.id;
    await c.post(`/api/projects/${p}/structure/wizard/apply`, SCENARIO_A_VERTICAL).expect(201);
    s = (await c.get(`/api/projects/${p}/structure`).expect(200)).body;
    const tpls = (await c.get('/api/wbs-templates').expect(200)).body as TemplateDto[];
    const sel = s.modules.map((m) => ({ moduleId: m.id, templateVersionId: tpls.find((x) => x.code === byKindCode[m.kind])!.versions.find((v) => v.status === 'PUBLISHED')!.id }));
    const plan = (await c.post(`/api/projects/${p}/wbs/preview`, { selections: sel }).expect(200)).body as WbsPlanDto;
    await c.post(`/api/projects/${p}/wbs/apply`, { selections: sel, planHash: plan.planHash }).expect(200);

    // R00: migra, configura destinos (inclusive por linha) e lança
    const w1 = (await upload(c, base(), {}, 'Levantamento R00.xlsx', await workbook(0)).expect(201)).body as WorkbookImportDto;
    expect(planOf(w1, 'Paredes concreto')).toMatchObject({ target: 'sheet' });
    expect((planOf(w1, 'Paredes concreto') as SheetP).updateOf).toBeUndefined();
    const r1 = (await c.post(`${base()}/${w1.id}/apply`, {}, ifm(w1.version)).expect(200)).body as WorkbookImportDto;
    sheetId = r1.result!.created.find((x) => x.kind === 'sheet')!.id;
    schedId = r1.result!.created.find((x) => x.kind === 'schedule')!.id;
    expect(await prisma.sheet.findUniqueOrThrow({ where: { id: sheetId } })).toMatchObject({ sourceSheetName: 'Paredes concreto' });
    const wbs = (await c.get(`/api/projects/${p}/wbs`).expect(200)).body as WbsDto;
    const item = wbs.nodes.find((n) => n.title === 'Estrutura de concreto armado' && pathTitles(wbs, n).includes('Torre A › Estrutura › 1º pavimento'))!;
    let d = await sheet();
    await c.patch(`/api/projects/${p}/sheets/${sheetId}`, { wbsNodeId: item.id, anchor: st(node('Cobertura', 'Torre A') ?? node('Térreo', 'Torre A')), rows: d.rows, rowAnchors: [st(node('1º pavimento', 'Torre A')), st(node('2º pavimento', 'Torre A')), null] }, ifm(d.version)).expect(204);
    d = await sheet();
    expect((await c.post(`/api/projects/${p}/sheets/${sheetId}/launch`, {}, ifm(d.version)).expect(200)).body).toMatchObject({ created: 6 });
    // quadro: serviço na janela J01
    const q = await sched();
    const svc = (await c.get('/api/catalog/services?q=ESQ.001').expect(200)).body.items[0];
    await c.put(`/api/projects/${p}/schedules/${schedId}`, { columns: q.columns.map((x) => ({ key: x.key, label: x.label })), rows: q.rows.map((r) => ({ ...r, serviceIds: r.code === 'J01' ? [svc.id] : [] })) }).set(ifm(q.version)).expect(204);
  });

  it('nova versão: as abas já migradas são sugeridas como atualização (mesmo modelo / mesmas colunas)', async () => {
    w2 = (await upload(c, base(), {}, 'Levantamento R01.xlsx', await workbook(1)).expect(201)).body as WorkbookImportDto;
    const d = await sheet(); const q = await sched();
    expect(planOf(w2, 'Paredes concreto')).toMatchObject({ target: 'sheet', title: d.title, updateOf: { id: sheetId, version: d.version } });
    expect(planOf(w2, 'Esquadrias')).toMatchObject({ target: 'schedule', updateOf: { id: schedId, version: q.version }, quantities: [{ label: q.columns[0]!.label }] });
    expect(w2.updatable.find((u) => u.id === sheetId)).toMatchObject({ kind: 'sheet', templateCode: 'CONC', sourceSheetName: 'Paredes concreto', launched: true });
  });

  it('prévia: o que entra, sai e muda; totais antes e depois; destinos por linha preservados', async () => {
    const r = await preview(planOf(w2, 'Paredes concreto'));
    expect(r.problems).toEqual([]);
    const u = r.update!;
    expect(u).toMatchObject({ kind: 'sheet', id: sheetId, stale: false, launched: true, counts: { unchanged: 1, changed: 1, added: 1, removed: 1 }, keptLinks: 2, lostLinks: 0 });
    expect(u.rows).toEqual([
      { status: 'changed', label: 'Paredes 2º', row: 3, changes: [{ field: 'Comprimento', before: '30', after: '31' }] },
      { status: 'added', label: 'Paredes 3º', row: 4, changes: [] },
      { status: 'removed', label: 'Platibanda', row: null, changes: [] },
    ]);
    // concreto: (32,5×2,7−4,56)×0,1 + 30×2,7×0,1 + 27,76×0,7×0,1 → … + 31×2,7×0,1 + 20×2,7×0,1
    expect(u.totals.find((t) => t.key === 'concreto')).toMatchObject({ before: '18.3622', after: '22.089', unit: 'm³' });
    const rq = await preview(planOf(w2, 'Esquadrias'));
    expect(rq.update).toMatchObject({ kind: 'schedule', counts: { unchanged: 1, changed: 1, added: 1, removed: 0 }, keptLinks: 1, lostLinks: 0 });
    expect(rq.update!.rows[0]).toMatchObject({ status: 'changed', label: 'J01 · Janela maxim-ar', changes: [{ before: '2', after: '3' }] });
  });

  it('ficha alterada depois do plano: a prévia avisa e aplicar é bloqueado até confirmar de novo', async () => {
    const d = await sheet();
    await c.patch(`/api/projects/${p}/sheets/${sheetId}`, { title: 'Paredes de concreto — Torre A' }, ifm(d.version)).expect(204);
    const r = await preview(planOf(w2, 'Paredes concreto'));
    expect(r.update!.stale).toBe(true);
    expect(r.problems[0]).toMatch(/foi alterada depois/);
    const bad = await c.post(`${base()}/${w2.id}/apply`, {}, ifm(w2.version)).expect(422);
    expect(bad.body.errors[0].message).toMatch(/Paredes concreto: .*foi alterada depois/);
    // confirma a atualização sobre a versão atual
    const cur = await sheet();
    const next = w2.plan.map((x) => (x.target === 'sheet' && x.updateOf ? { ...x, updateOf: { id: sheetId, version: cur.version } } : x));
    await c.put(`${base()}/${w2.id}/plan`, { sheets: next }).set(ifm(w2.version)).expect(204);
    w2 = (await c.get(`${base()}/${w2.id}`).expect(200)).body;
  });

  it('aplica: atualiza no lugar, preserva destinos e serviços; o lançado fica pendente e o relançamento revisa', async () => {
    const before = await sheet();
    const r = (await c.post(`${base()}/${w2.id}/apply`, {}, ifm(w2.version)).expect(200)).body as WorkbookImportDto;
    expect(r.result!.created.map((x) => [x.sheetName, x.kind, x.action, x.id])).toEqual([['Paredes concreto', 'sheet', 'updated', sheetId], ['Esquadrias', 'schedule', 'updated', schedId]]);
    expect(r.result!.created[0]!.counts).toEqual({ unchanged: 1, changed: 1, added: 1, removed: 1 });
    const d = await sheet();
    expect(d).toMatchObject({ id: sheetId, title: 'Paredes de concreto — Torre A', status: 'PENDING', sourceReference: 'Levantamento R01.xlsx › Paredes concreto', wbsNodeId: before.wbsNodeId });
    expect(d.rows.map((x) => x['elemento']!.v)).toEqual(['Paredes 1º', 'Paredes 2º', 'Paredes 3º']);
    expect(d.rows[1]!['comprimento']).toEqual({ v: '31', ref: 'Paredes concreto!B3' });
    expect(d.rowAnchors).toEqual([before.rowAnchors[0], before.rowAnchors[1], null]);
    expect(d.document?.fileName).toBe('Levantamento R01.xlsx');
    expect(await prisma.auditLog.count({ where: { entityType: 'Sheet', entityId: sheetId, action: 'UPDATE', reason: 'Atualização pela planilha Levantamento R01.xlsx › Paredes concreto' } })).toBe(1);
    // nada muda nos quantitativos até relançar; relançar revisa por destino
    expect(d.measurements.filter((m) => m.serviceCode === 'EST.001').map((m) => m.quantity).sort()).toEqual(['1.9432', '8.1', '8.319']);
    const res = (await c.post(`/api/projects/${p}/sheets/${sheetId}/launch`, { reason: 'Planilha R01' }, ifm(d.version)).expect(200)).body;
    expect(res).toMatchObject({ created: 0, revised: 4 });
    const after = await sheet();
    expect(after.measurements.filter((m) => m.serviceCode === 'EST.001').map((m) => m.quantity).sort()).toEqual(['5.4', '8.319', '8.37']);
    const q = await sched();
    expect(q.rows.map((x) => [x.code, x.cells[q.columns[0]!.key], x.serviceIds.length])).toEqual([['J01', '3', 1], ['P01', '4', 0], ['J02', '1', 0]]);
    expect(q.sourceReference).toBe('Levantamento R01.xlsx › Esquadrias');
  });

  it('duas abas não atualizam o mesmo destino; outro empreendimento/organização não é alvo', async () => {
    const w3 = (await upload(c, base(), {}, 'Levantamento R02.xlsx', await workbook(1)).expect(201)).body as WorkbookImportDto;
    const pc = planOf(w3, 'Paredes concreto') as SheetP;
    const dup = w3.plan.map((x) => (x.target === 'schedule' ? { ...pc, sheetIndex: x.sheetIndex } : x));
    await c.put(`${base()}/${w3.id}/plan`, { sheets: dup }).set(ifm(w3.version)).expect(204);
    const v = ((await c.get(`${base()}/${w3.id}`).expect(200)).body as WorkbookImportDto).version;
    const r = await c.post(`${base()}/${w3.id}/apply`, {}, ifm(v)).expect(422);
    expect(r.body.detail).toMatch(/mesma ficha/);
    // intruso aponta a sua migração para a ficha desta organização: tratada como inexistente
    const intruder = await signup(app, 'Org Intrusa Atualização');
    const ip = (await intruder.post('/api/projects', newProject()).expect(201)).body.id;
    const wi = (await upload(intruder, `/api/projects/${ip}/workbook-imports`, {}, 'x.xlsx', await workbook(1)).expect(201)).body as WorkbookImportDto;
    const ipl = planOf(wi, 'Paredes concreto') as SheetP;
    expect(ipl.updateOf).toBeUndefined();
    const pr = (await intruder.post(`/api/projects/${ip}/workbook-imports/${wi.id}/preview`, { plan: { ...ipl, updateOf: { id: sheetId, version: 1 } } }).expect(200)).body as WorkbookPreviewDto;
    expect(pr.problems).toEqual(['A ficha a atualizar não existe neste empreendimento.']);
    expect(pr.update).toBeNull();
    const sp = planOf(wi, 'Esquadrias') as SchedP;
    const pq = (await intruder.post(`/api/projects/${ip}/workbook-imports/${wi.id}/preview`, { plan: { ...sp, updateOf: { id: schedId, version: 1 } } }).expect(200)).body as WorkbookPreviewDto;
    expect(pq.problems).toEqual(['O quadro a atualizar não existe neste empreendimento.']);
    expect(wi.updatable).toEqual([]);
  });
});
