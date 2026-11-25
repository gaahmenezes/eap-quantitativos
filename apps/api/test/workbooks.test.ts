import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import type { ScheduleDetailDto, SheetDetailDto, WorkbookImportDto, WorkbookPreviewDto, WorkbookSheetDto, WorkbookSheetPlan } from '@eapq/contracts';
import { bootApp, inviteAndJoin, newProject, signup, upload, type Client } from './helpers.js';

const { app, prisma } = await bootApp();
afterAll(() => app.close());
const ifm = (v: number) => ({ 'If-Match': String(v) });

/** Pasta de trabalho parecida com as planilhas reais (valores calculados gravados junto das fórmulas). */
async function workbook(): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const geral = wb.addWorksheet('Considerações Gerais');
  geral.addRow(['Premissas do levantamento']);
  const cer = wb.addWorksheet('Cerâmica MAT');
  cer.addRow(['LEVANTAMENTO DE PISO E REVESTIMENTO']); cer.addRow([]); cer.addRow([]);
  cer.addRow(['Tipologia', 'Ambiente', 'Dimensões da peça', null, null, 'Peças / ambiente', 'Área Piso', 'Área Gemométrica', 'Desperdício', 'Perímetro', 'H parede / H rodapé', 'Área Parede', 'Área de Desconto', 'Área Parede (real)', 'Área Total p/ execução / unid', 'Utilizou paginação?', 'Área Total / unid (contando perda)']);
  cer.mergeCells('C4:E4');
  cer.addRow([]);
  const data: [string, string, number, number, number, number, number | null, number, ExcelJS.CellValue, number, number][] = [
    ['Piso + rodapé', 'Sala + Circ + Coz', 0.67, 0.67, 51, 19.81, 21.15, 0.07, { formula: '(1*2.6+1*0.8+2*0.8+1*0.6)*K6', result: 0.392 }, 23.982400000000002, 25.181520000000003],
    ['Piso + rodapé', 'Quarto 01', 0.67, 0.67, 25, 10.05, 12.71, 0.07, { formula: '1*0.8*K7', result: 0.05600000000000001 }, 12.0562, 12.65901],
    ['Piso + rodapé', 'WC Social', 0.53, 0.53, 10, 2.6, null, 0, 0, 2.8090000000000006, 2.9494500000000006],
    ['Revestimento', 'Cozinha', 0.37, 0.59, 16, 2.8, null, 1.5, 0, 3.4928, 3.66744],
  ];
  for (const [tipo, amb, l, c, pecas, geo, per, h, desc, tot, perda] of data) cer.addRow([tipo, amb, l, 'x', c, pecas, null, geo, null, per, h, null, desc, null, tot, 'Sim', perda]);
  cer.addRow([null, 'casa completa', null, null, null, { formula: 'SUBTOTAL(9,F6:F9)', result: 102 }, null, null, null, null, null, null, null, null, { formula: 'SUBTOTAL(9,O6:O9)', result: 42.34 }]);
  const hid = wb.addWorksheet('Hidraulico casa');
  hid.addRow(['Levantamento HidroSsanitario']);
  hid.addRow(['Elemento', 'tipo', 'Dimensão', 'Quantidade unitaria', 'loca de uso', 'total', 'custo unit R$']);
  hid.addRow(['SANITARIO']);
  hid.addRow(['Tubo pvc rigido branco', '100mm', 'm', 25.2, 'habitação', { formula: 'D4*362', result: 9122.4 }, 9.87]);
  hid.addRow(['Anel de borracha', '50mm', 'und', 27, 'habitação', { formula: 'D5*362', result: 9774 }, 0.49]);
  const dre = wb.addWorksheet('Drenagem');
  dre.addRow(['Trecho', 'Material', 'DN', 'Comprimento', 'Inclinação', 'Escavação']);
  dre.addRow(['PV1-PV6', 'PEAD', 600, { formula: '29.11+53.35+61.48+18.15+22.54', result: 184.63 }, 0.43, 344.1096903221999]);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

describe('migração de planilha de levantamento', () => {
  let c: Client;
  let p: string;
  let w: WorkbookImportDto;
  const base = () => `/api/projects/${p}/workbook-imports`;
  const plan = (i: number) => w.plan.find((x) => x.sheetIndex === i)!;

  beforeAll(async () => {
    c = await signup(app, 'Org Migração');
    p = (await c.post('/api/projects', newProject()).expect(201)).body.id;
  });

  it('lê as abas e sugere o destino e o mapeamento de cada uma', async () => {
    w = (await upload(c, base(), {}, 'Levantamento VMB.xlsx', await workbook()).expect(201)).body;
    expect(w).toMatchObject({ status: 'DRAFT', fileName: 'Levantamento VMB.xlsx' });
    expect(w.sheets.map((s) => s.name)).toEqual(['Considerações Gerais', 'Cerâmica MAT', 'Hidraulico casa', 'Drenagem']);
    expect(plan(0).target).toBe('ignore');
    const cer = plan(1) as Extract<WorkbookSheetPlan, { target: 'sheet' }>;
    expect(cer).toMatchObject({ target: 'sheet', headerRow: 3, firstRow: 4 });
    expect(cer.map).toMatchObject({ peca_l: { col: 2, unit: 'm' }, peca_c: { col: 4, unit: 'm' }, tipo: { col: 0 }, ambiente: { col: 1 }, pecas: { col: 5 }, area_geo: { col: 7 }, perimetro: { col: 9 }, altura: { col: 10 }, desconto: { col: 12 }, paginacao: { col: 15 } });
    expect(plan(2)).toMatchObject({ target: 'schedule', scheduleKind: 'INSTALACOES_HIDRAULICAS', map: { description: 0, spec: 1, unit: 2 }, quantities: [{ col: 3 }] });
    expect(plan(3)).toMatchObject({ target: 'sheet', map: { trecho: { col: 0 }, material: { col: 1 }, dn: { col: 2 }, comprimento: { col: 3 }, inclinacao: { col: 4 } } });
    const sh = (await c.get(`${base()}/${w.id}/sheets/1`).expect(200)).body as WorkbookSheetDto;
    expect(sh.suggestedHeaderRow).toBe(3);
    expect(sh.labels.slice(0, 6)).toEqual(['Tipologia', 'Ambiente', 'Dimensões da peça', '', '', 'Peças / ambiente']);
    expect(sh.rows[5]![12]).toEqual({ v: '0.392', num: true, f: '(1*2.6+1*0.8+2*0.8+1*0.6)*K6' });
  });

  it('prévia com conferência: peça em m convertida, subtotal ignorado, tudo confere', async () => {
    const cer = plan(1) as Extract<WorkbookSheetPlan, { target: 'sheet' }>;
    const adjusted = { ...cer, map: { ...cer.map, peca_l: { col: 2, unit: 'm' }, peca_c: { col: 4, unit: 'm' } }, checks: { area_total: { col: 14 }, area_material: { col: 16 } } };
    const r = (await c.post(`${base()}/${w.id}/preview`, { plan: adjusted }).expect(200)).body as WorkbookPreviewDto;
    expect(r).toMatchObject({ rowCount: 4, problems: [], rowErrors: [] });
    expect(r.skipped).toEqual([{ row: 10, reason: 'Linha de total da planilha' }]);
    expect(r.checks.map((x) => [x.column, x.ok, x.computedTotal])).toEqual([['area_total', true, '42.3404'], ['area_material', true, '44.45742']]);
    expect(r.sample[0]!.cells).toMatchObject({ peca_l: '67', desconto: '0.392', paginacao: 'Sim' });
    // coluna errada na conferência aparece como divergência linha a linha
    const wrong = (await c.post(`${base()}/${w.id}/preview`, { plan: { ...adjusted, checks: { area_material: { col: 14 } } } }).expect(200)).body as WorkbookPreviewDto;
    expect(wrong.checks[0]).toMatchObject({ ok: false, divergent: 4 });
    const dre = plan(3) as Extract<WorkbookSheetPlan, { target: 'sheet' }>;
    const rd = (await c.post(`${base()}/${w.id}/preview`, { plan: { ...dre, params: { comp_peca: '1' }, checks: { escavacao: { col: 5 } } } }).expect(200)).body as WorkbookPreviewDto;
    expect(rd.checks[0]).toMatchObject({ ok: true, computedTotal: '344.1096903222' });
    expect(rd.sample[0]!.cells['comprimento']).toBe('29.11+53.35+61.48+18.15+22.54');
    const hid = plan(2) as Extract<WorkbookSheetPlan, { target: 'schedule' }>;
    const rh = (await c.post(`${base()}/${w.id}/preview`, { plan: { ...hid, quantities: [{ col: 3, label: 'Casa' }], check: { col: 5, multiplier: 362 } } }).expect(200)).body as WorkbookPreviewDto;
    expect(rh).toMatchObject({ rowCount: 2, checks: [{ ok: true, computedTotal: '18896.4' }] });
    expect(rh.skipped).toEqual([{ row: 3, reason: 'Sem quantidade (título de grupo?)' }]);
    // grava o plano ajustado
    const next = w.plan.map((x) => (x.sheetIndex === 1 ? adjusted : x.sheetIndex === 3 ? { ...dre, title: 'Drenagem PEAD', params: { comp_peca: '1' }, checks: { escavacao: { col: 5 } } } : x.sheetIndex === 2 ? { ...hid, title: 'Hidráulica da casa', quantities: [{ col: 3, label: 'Casa' }], check: { col: 5, multiplier: 362 } } : x));
    await c.put(`${base()}/${w.id}/plan`, { sheets: next }).set(ifm(w.version)).expect(204);
    w = (await c.get(`${base()}/${w.id}`).expect(200)).body;
  });

  it('plano com problema não cria nada', async () => {
    const bad = w.plan.map((x) => (x.sheetIndex === 1 ? { ...x, firstRow: 1, headerRow: 2, map: { pecas: { col: 5, unit: 'xyz' } } } : x));
    await c.put(`${base()}/${w.id}/plan`, { sheets: bad }).set(ifm(w.version)).expect(204);
    const v = ((await c.get(`${base()}/${w.id}`).expect(200)).body as WorkbookImportDto).version;
    const r = await c.post(`${base()}/${w.id}/apply`, {}, ifm(v)).expect(422);
    expect(r.body.code).toBe('WORKBOOK_PLAN_INVALID');
    expect(r.body.errors[0].message).toMatch(/Cerâmica MAT: .*(primeira linha|Unidade não cadastrada)/);
    expect(await prisma.sheet.count({ where: { projectId: p } })).toBe(0);
    await c.put(`${base()}/${w.id}/plan`, { sheets: w.plan }).set(ifm(v)).expect(204);
    w = (await c.get(`${base()}/${w.id}`).expect(200)).body;
  });

  it('aplica: cria fichas e quadro com a origem de cada célula; nada é lançado', async () => {
    const r = (await c.post(`${base()}/${w.id}/apply`, {}, ifm(w.version)).expect(200)).body as WorkbookImportDto;
    expect(r.status).toBe('APPLIED');
    expect(r.result!.created.map((x) => [x.sheetName, x.kind, x.rows, x.checksOk])).toEqual([['Cerâmica MAT', 'sheet', 4, true], ['Hidraulico casa', 'schedule', 2, true], ['Drenagem', 'sheet', 1, true]]);
    const cer = (await c.get(`/api/projects/${p}/sheets/${r.result!.created[0]!.id}`).expect(200)).body as SheetDetailDto;
    expect(cer).toMatchObject({ templateCode: 'CER', rowCount: 4, status: 'DRAFT', sourceReference: 'Levantamento VMB.xlsx › Cerâmica MAT' });
    expect(cer.rows[0]!['peca_l']).toEqual({ v: '67', ref: 'Cerâmica MAT!C6' });
    expect(cer.document?.fileName).toBe('Levantamento VMB.xlsx');
    const dre = (await c.get(`/api/projects/${p}/sheets/${r.result!.created[2]!.id}`).expect(200)).body as SheetDetailDto;
    expect(dre.params).toEqual({ comp_peca: '1' });
    const hid = (await c.get(`/api/projects/${p}/schedules/${r.result!.created[1]!.id}`).expect(200)).body as ScheduleDetailDto;
    expect(hid).toMatchObject({ kind: 'INSTALACOES_HIDRAULICAS', title: 'Hidráulica da casa', columns: [{ key: 'd1', label: 'Casa', wbsNodeId: null, anchor: null }] });
    expect(hid.rows.map((x) => [x.description, x.spec, x.unit, x.cells['d1']])).toEqual([['Tubo pvc rigido branco', '100mm', 'm', '25.2'], ['Anel de borracha', '50mm', 'un', '27']]);
    expect(await prisma.measurement.count({ where: { projectId: p } })).toBe(0);
    expect(await prisma.auditLog.count({ where: { entityType: 'WorkbookImport', entityId: w.id, action: 'APPLY' } })).toBe(1);
  });

  it('migração encerrada não muda; extrato imutável no banco', async () => {
    const cur = (await c.get(`${base()}/${w.id}`).expect(200)).body as WorkbookImportDto;
    await c.post(`${base()}/${w.id}/apply`, {}, ifm(cur.version)).expect(409);
    await c.put(`${base()}/${w.id}/plan`, { sheets: [] }).set(ifm(cur.version)).expect(409);
    await c.post(`${base()}/${w.id}/cancel`, {}).expect(409);
    await expect(prisma.$executeRaw`UPDATE workbook_import_sheet SET name = 'x' WHERE "importId" = ${w.id}::uuid`).rejects.toThrow(/imutável/);
    await expect(prisma.$executeRaw`UPDATE workbook_import SET status = 'DRAFT' WHERE id = ${w.id}::uuid`).rejects.toThrow(/encerrada/);
    const list = (await c.get(base()).expect(200)).body as { id: string; planned: number }[];
    expect(list.find((x) => x.id === w.id)).toMatchObject({ planned: 3 });
  });

  it('arquivo que não é XLSX é recusado; leitor não envia; outra organização recebe 404', async () => {
    const r = await upload(c, base(), {}, 'dados.csv', Buffer.from('a;b\n1;2\n')).expect(422);
    expect(r.body.detail).toMatch(/Tipo não aceito/);
    const viewer = await inviteAndJoin(app, c, 'MEMBER');
    const org = await prisma.project.findUniqueOrThrow({ where: { id: p } });
    await prisma.projectMember.create({ data: { organizationId: org.organizationId, projectId: p, userId: viewer.userId, role: 'VIEWER' } });
    await viewer.get(`${base()}/${w.id}`).expect(200);
    await upload(viewer, base(), {}, 'x.xlsx', await workbook()).expect(403);
    const intruder = await signup(app, 'Org Intrusa Migração');
    await intruder.get(`${base()}/${w.id}`).expect(404);
    await intruder.get(`${base()}/${w.id}/sheets/1`).expect(404);
    const ip = (await intruder.post('/api/projects', newProject()).expect(201)).body.id;
    await intruder.get(`/api/projects/${ip}/workbook-imports/${w.id}`).expect(404);
    await intruder.post(`/api/projects/${ip}/workbook-imports/${w.id}/preview`, { plan: plan(1) }).expect(404);
  });
});
