import ExcelJS from 'exceljs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parseCsv, SCENARIO_B_HORIZONTAL } from '@eapq/domain';
import type { ConsolidationResultDto, DocumentDto, ImportJobDto, MeasurementDetailDto, ServiceDto, StructureDto, TypologyDto } from '@eapq/contracts';
import { binary, bootApp, newProject, signup, upload, type Client } from './helpers.js';

const { app, prisma } = await bootApp();
afterAll(() => app.close());

async function xlsx(rows: (string | number | null)[][], sheet = 'Dados') {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(sheet);
  for (const r of rows) ws.addRow(r);
  return Buffer.from(await wb.xlsx.writeBuffer());
}
async function readXlsx(buf: Buffer) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as unknown as ArrayBuffer);
  const out: unknown[][] = [];
  wb.worksheets[0]!.eachRow((r) => out.push((r.values as unknown[]).slice(1)));
  return out;
}
const svc = async (c: Client, code: string) => ((await c.get(`/api/catalog/services?q=${code}`).expect(200)).body.items as ServiceDto[]).find((s) => s.code === code)!;

describe('documentos: envio seguro e anexo na medição', () => {
  let c: Client;
  let p: string;
  beforeAll(async () => {
    c = await signup(app, 'Org Documentos');
    p = (await c.post('/api/projects', newProject()).expect(201)).body.id;
  });

  it('aceita PDF pela assinatura, devolve o mesmo conteúdo com cabeçalhos seguros', async () => {
    const pdf = Buffer.from('%PDF-1.4\n% prancha ARQ-03\n%%EOF');
    const d = (await upload(c, `/api/projects/${p}/documents`, {}, 'ARQ-03 rev B.pdf', pdf).expect(201)).body as DocumentDto;
    expect(d).toMatchObject({ fileName: 'ARQ-03 rev B.pdf', kind: 'PDF', mime: 'application/pdf', size: pdf.length });
    const res = await binary(c.get(`/api/projects/${p}/documents/${d.id}`)).expect(200);
    expect(Buffer.compare(res.body as Buffer, pdf)).toBe(0);
    expect(res.headers['content-disposition']).toContain('attachment');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    const row = await prisma.document.findUniqueOrThrow({ where: { id: d.id } });
    expect(row.storageKey).not.toContain('ARQ');
    await expect(prisma.$executeRaw`DELETE FROM document WHERE id = ${d.id}::uuid`).rejects.toThrow(/imutáveis/);
  });

  it('recusa executável disfarçado, tipo não suportado e planilha com zip bomb', async () => {
    const exe = await upload(c, `/api/projects/${p}/documents`, {}, 'planta.pdf', Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03, 0, 0, 0])).expect(422);
    expect(exe.body.code).toBe('INVALID_FILE');
    await upload(c, `/api/projects/${p}/documents`, {}, 'dados.csv', Buffer.from([0x61, 0x00, 0x62])).expect(422);
    const bomb = await xlsx([['x'], ...Array.from({ length: 400 }, (_, i) => [`${i}${'a'.repeat(32_000)}`])]);
    const r = await upload(c, `/api/projects/${p}/documents`, {}, 'bomba.xlsx', bomb).expect(422);
    expect(r.body.detail).toMatch(/compressão suspeita|grande demais/);
    await upload(c, `/api/projects/${p}/documents`, {}, 'vazio.pdf', Buffer.alloc(0)).expect(422);
  });

  it('isolamento: outra organização não baixa o documento', async () => {
    const d = (await upload(c, `/api/projects/${p}/documents`, {}, 'x.pdf', Buffer.from('%PDF-1.4 x')).expect(201)).body as DocumentDto;
    const other = await signup(app, 'Org Documentos Intrusa');
    await other.get(`/api/projects/${p}/documents/${d.id}`).expect(404);
    await upload(other, `/api/projects/${p}/documents`, {}, 'x.pdf', Buffer.from('%PDF-1.4 x')).expect(404);
  });
});

describe('importação de serviços (catálogo) em etapas', () => {
  let c: Client;
  beforeAll(async () => { c = await signup(app, 'Org Importação'); });

  it('mapeia, valida, não grava antes da confirmação, aplica as válidas e neutraliza fórmula na exportação', async () => {
    const file = await xlsx([
      ['Cód.', 'Descrição do serviço', 'UN', 'Categoria', 'Critério'],
      ['ins.010', 'Eletroduto PVC 25 mm', 'm', 'CON-INS', 'Comprimento instalado'],
      ['INS.011', '=HYPERLINK("http://x","clique")', 'un', 'CON-INS', null],
      ['INS.010', 'Repetido na planilha', 'm', 'CON-INS', null],
      ['ALV.001', 'Já existe no catálogo', 'm²', 'CON-ALV', null],
      ['INS.012', 'Unidade errada', 'polegada', 'CON-INS', null],
      ['INS.013', 'Categoria errada', 'm', 'NAO-EXISTE', null],
    ], 'Serviços');
    const job = (await upload(c, '/api/imports', { kind: 'SERVICES' }, 'servicos.xlsx', file).expect(201)).body as ImportJobDto;
    expect(job).toMatchObject({ kind: 'SERVICES', status: 'UPLOADED', sheets: ['Serviços'], rowCount: 6, mapping: { code: 0, description: 1, unit: 2, category: 3, criterion: 4, technical: null } });
    const before = await prisma.service.count();
    const v = (await c.agent.put(`/api/imports/${job.id}/mapping`).set({ 'X-CSRF-Token': c.csrf, 'If-Match': String(job.version) }).send({ mapping: job.mapping }).expect(200)).body as ImportJobDto;
    expect(v).toMatchObject({ status: 'VALIDATED', summary: { valid: 2, warning: 0, error: 4 } });
    const errs = (await c.get(`/api/imports/${job.id}/rows?status=ERROR`).expect(200)).body;
    expect(errs.rows.map((r: { rowNumber: number; messages: string[] }) => [r.rowNumber, r.messages[0]])).toEqual([
      [4, 'Código INS.010 repetido na planilha (linha 2).'],
      [5, 'O código ALV.001 já existe no catálogo da organização.'],
      [6, 'Unidade não cadastrada: polegada.'],
      [7, 'Categoria não cadastrada: NAO-EXISTE.'],
    ]);
    expect(await prisma.service.count()).toBe(before); // nada gravado antes da confirmação
    const blocked = await c.post(`/api/imports/${job.id}/apply`, { skipInvalid: false }, { 'If-Match': String(v.version) }).expect(422);
    expect(blocked.body.code).toBe('IMPORT_HAS_ERRORS');
    expect(await prisma.service.count()).toBe(before);
    const done = (await c.post(`/api/imports/${job.id}/apply`, { skipInvalid: true }, { 'If-Match': String(v.version) }).expect(200)).body as ImportJobDto;
    expect(done).toMatchObject({ status: 'APPLIED', summary: { created: 2, skipped: 4 } });
    expect(await prisma.service.count()).toBe(before + 2);
    await c.post(`/api/imports/${job.id}/apply`, { skipInvalid: true }, { 'If-Match': String(done.version) }).expect(409);
    const ins = await svc(c, 'INS.011');
    expect(ins.description).toBe('=HYPERLINK("http://x","clique")'); // guardado como texto
    const audit = await prisma.auditLog.count({ where: { entityType: 'Service', entityId: ins.id, action: 'CREATE' } });
    expect(audit).toBe(1);
    // exportar: CSV neutraliza; XLSX também; reimportar o CSV preserva códigos (e acusa que já existem)
    const csv = (await binary(c.post('/api/exports', { report: 'services', format: 'csv' })).expect(200)).body as Buffer;
    const rows = parseCsv(csv.toString('utf8'));
    expect(rows[0]).toEqual(['Código', 'Descrição', 'Unidade', 'Código da categoria', 'Critério de medição', 'Descrição técnica']);
    expect(rows.find((r) => r[0] === 'INS.011')![1]).toBe('\'=HYPERLINK("http://x","clique")');
    const x = await readXlsx((await binary(c.post('/api/exports', { report: 'services', format: 'xlsx' })).expect(200)).body as Buffer);
    expect(x.find((r) => r[0] === 'INS.011')![1]).toBe('\'=HYPERLINK("http://x","clique")');
    const again = (await upload(c, '/api/imports', { kind: 'SERVICES' }, 'servicos.csv', csv).expect(201)).body as ImportJobDto;
    expect(again.mapping).toMatchObject({ code: 0, description: 1, unit: 2, category: 3, criterion: 4, technical: 5 });
    const va = (await c.agent.put(`/api/imports/${again.id}/mapping`).set({ 'X-CSRF-Token': c.csrf, 'If-Match': String(again.version) }).send({ mapping: again.mapping }).expect(200)).body as ImportJobDto;
    expect(va.summary).toMatchObject({ valid: 0, error: again.rowCount });
  });

  it('mapeamento incompleto, papel sem permissão e cancelamento', async () => {
    const file = Buffer.from('Código;Descrição\nA.1;x\n');
    const job = (await upload(c, '/api/imports', { kind: 'SERVICES' }, 's.csv', file).expect(201)).body as ImportJobDto;
    const bad = await c.agent.put(`/api/imports/${job.id}/mapping`).set({ 'X-CSRF-Token': c.csrf, 'If-Match': String(job.version) }).send({ mapping: job.mapping }).expect(422);
    expect(bad.body.detail).toContain('Indique a coluna de "Unidade"');
    await upload(c, '/api/imports', { kind: 'STRUCTURE' }, 's.csv', file).expect(422);
    await c.post(`/api/imports/${job.id}/cancel`, {}).expect(204);
    await c.post(`/api/imports/${job.id}/cancel`, {}).expect(409);
    const other = await signup(app, 'Org Importação Intrusa');
    await other.get(`/api/imports/${job.id}`).expect(404);
  });
});

describe('cadastro físico e medições: importação, exportação e ida e volta', () => {
  let c: Client;
  async function setupProject(name: string) {
    const p = (await c.post('/api/projects', { ...newProject(), name, classification: 'HORIZONTAL' }).expect(201)).body.id as string;
    await c.post(`/api/projects/${p}/structure/wizard/apply`, SCENARIO_B_HORIZONTAL).expect(201);
    const typA = ((await c.get(`/api/projects/${p}/typologies`).expect(200)).body as TypologyDto[]).find((t) => t.code === 'A')!;
    const types = (await c.get('/api/catalog/element-types').expect(200)).body as { id: string; code: string }[];
    const T = (code: string) => types.find((t) => t.code === code)!.id;
    const tA = `/api/projects/${p}/typologies/${typA.id}`;
    const r1 = (await c.post(`${tA}/revisions`, {}).expect(201)).body;
    const sala = (await c.post(`${tA}/revisions/${r1.id}/elements`, { name: 'Sala', elementTypeId: T('AMBIENTE'), attributes: {} }).expect(201)).body;
    const piso = (await c.post(`${tA}/revisions/${r1.id}/elements`, { name: 'Piso', elementTypeId: T('REVESTIMENTO'), attributes: { local: 'Piso' }, parentId: sala.id }).expect(201)).body;
    await c.post(`${tA}/revisions/${r1.id}/publish`, {}).expect(200);
    const s = (await c.get(`/api/projects/${p}/structure`).expect(200)).body as StructureDto;
    await c.post(`${tA}/propagation`, { unitIds: s.nodes.filter((n) => n.kind === 'DWELLING_UNIT' && n.typologyId === typA.id).map((n) => n.id) }).expect(200);
    const [rev4, alv] = await Promise.all([svc(c, 'REV.004'), svc(c, 'ALV.001')]);
    const item = (await c.post(`/api/projects/${p}/wbs/nodes`, { parentId: null, title: 'Pisos e muros', nodeType: 'ITEM' }).expect(201)).body;
    await c.put(`/api/projects/${p}/wbs/nodes/${item.id}/services`, { serviceIds: [rev4.id, alv.id] }).expect(200);
    return { p, typA, piso, s, item, rev4, alv };
  }
  const total = async (p: string) => ((await c.post(`/api/projects/${p}/consolidation`, { groupBy: ['service'] }).expect(200)).body as ConsolidationResultDto).rows.map((r) => [r.key.service!.label.split(' ')[0], r.total, r.lines]);
  const validate = async (url: string, job: ImportJobDto) =>
    (await c.agent.put(`${url}/${job.id}/mapping`).set({ 'X-CSRF-Token': c.csrf, 'If-Match': String(job.version) }).send({ mapping: job.mapping }).expect(200)).body as ImportJobDto;

  beforeAll(async () => { c = await signup(app, 'Org Ida e Volta'); });

  it('exportar medições → reimportar em outro empreendimento preserva códigos e quantidades; repetir é dupla contagem', async () => {
    const a = await setupProject('Origem');
    const u0 = a.s.nodes.find((n) => n.kind === 'DWELLING_UNIT' && n.typologyId === a.typA.id)!;
    const lot = a.s.nodes.find((n) => n.kind === 'LOT' && n.name.endsWith('30'))!;
    const doc = (await upload(c, `/api/projects/${a.p}/documents`, {}, 'ARQ-01.pdf', Buffer.from('%PDF-1.4 ok')).expect(201)).body as DocumentDto;
    const anchor = { kind: 'TYPOLOGY_ELEMENT', typologyId: a.typA.id, elementKey: a.piso.stableKey };
    const m1 = (await c.post(`/api/projects/${a.p}/measurements`, { wbsNodeId: a.item.id, serviceId: a.rev4.id, anchor, calc: { method: 'MANUAL', value: '18.4', unit: 'm²' }, sourceReference: 'ARQ-01', documentId: doc.id }).expect(201)).body;
    await c.post(`/api/projects/${a.p}/measurements`, { wbsNodeId: a.item.id, serviceId: a.rev4.id, anchor: { ...anchor, unitId: u0.id }, calc: { method: 'MANUAL', value: '20.3333333333', unit: 'm²' } }).expect(201);
    await c.post(`/api/projects/${a.p}/measurements`, { wbsNodeId: a.item.id, serviceId: a.alv.id, anchor: { kind: 'STRUCTURE_NODE', id: lot.id }, calc: { method: 'MANUAL', value: '3330', unit: 'cm²' } }).expect(201);
    const det = (await c.get(`/api/projects/${a.p}/measurements/${m1.id}`).expect(200)).body as MeasurementDetailDto;
    expect(det.current.document).toMatchObject({ id: doc.id, fileName: 'ARQ-01.pdf' });

    const file = (await binary(c.post(`/api/projects/${a.p}/exports`, { report: 'measurements', format: 'xlsx' })).expect(200)).body as Buffer;
    const sheet = await readXlsx(file);
    expect(sheet[0]!.slice(0, 9)).toEqual(['Código do item da EAP', 'Código do serviço', 'Tipo de âncora', 'Âncora', 'Unidade habitacional', 'Quantidade', 'Unidade', 'Documento de origem', 'Observações']);
    expect(sheet.slice(1).map((r) => [r[2], r[3], r[5]])).toEqual([['Tipologia', 'A › Sala › Piso', 18.4], ['Tipologia', 'A › Sala › Piso', 20.3333333333], ['Cadastro', lot.code, 0.333]]);

    const b = await setupProject('Destino');
    const url = `/api/projects/${b.p}/imports`;
    const job = (await upload(c, url, { kind: 'MEASUREMENTS' }, 'quantitativos.xlsx', file).expect(201)).body as ImportJobDto;
    const v = await validate(url, job);
    expect(v.summary).toEqual({ valid: 3, warning: 0, error: 0 });
    await c.post(`${url}/${job.id}/apply`, {}, { 'If-Match': String(v.version) }).expect(200);
    expect(await total(b.p)).toEqual(await total(a.p));
    expect(await total(b.p)).toEqual([['ALV.001', '0.333', 1], ['REV.004', '1105.9333333333', 60]]); // 59 × 18,4 + 20,3333333333
    const imported = (await c.get(`/api/projects/${b.p}/measurements`).expect(200)).body as MeasurementDetailDto[];
    expect(imported.find((m) => m.current.memory.import?.row === 2)!.current).toMatchObject({ method: 'IMPORTED', memory: { method: 'IMPORTED', import: { fileName: 'quantitativos.xlsx', row: 2 } }, sourceReference: 'ARQ-01' });

    const twice = (await upload(c, url, { kind: 'MEASUREMENTS' }, 'quantitativos.xlsx', file).expect(201)).body as ImportJobDto;
    const v2 = await validate(url, twice);
    expect(v2.summary).toEqual({ valid: 0, warning: 0, error: 3 });
    const r = (await c.get(`${url}/${twice.id}/rows?status=ERROR`).expect(200)).body;
    expect(r.rows[0].messages[0]).toContain('Dupla contagem');
  });

  it('importa cadastro físico (CSV com ;) com hierarquia, novo módulo e erros de posição e ciclo', async () => {
    const p = (await c.post('/api/projects', newProject()).expect(201)).body.id as string;
    await c.post(`/api/projects/${p}/structure/wizard/apply`, { typologies: [{ code: '2Q', name: '2 quartos', kind: 'APARTMENT' }], modules: [{ kind: 'VERTICAL_RESIDENTIAL', name: 'Torres', towers: [{ name: 'Torre A', floors: 1, unitsPerFloor: 1, groundFloor: false, unitTypologies: ['2Q'] }] }] }).expect(201);
    const csv = [
      'Referência;Referência do item superior;Módulo;Tipo do módulo;Tipo;Nome;Tipologia',
      'T2;;Torres novas;Residencial vertical;Torre;Torre B;',
      'T2P1;T2;Torres novas;;Pavimento;1º pavimento;',
      'T2P1A;T2P1;Torres novas;;Unidade habitacional;Apto 101;2Q',
      'X1;;Torres novas;;Pavimento;Pavimento solto;',
      'C1;C2;Torres novas;;Torre;Ciclo 1;',
      'C2;C1;Torres novas;;Torre;Ciclo 2;',
      'Q1;T2P1;Torres novas;;Unidade habitacional;Apto 102;XX',
    ].join('\n');
    const url = `/api/projects/${p}/imports`;
    const job = (await upload(c, url, { kind: 'STRUCTURE' }, 'cadastro.csv', Buffer.from(csv, 'utf8')).expect(201)).body as ImportJobDto;
    const v = await validate(url, job);
    expect(v.summary).toEqual({ valid: 3, warning: 0, error: 4 });
    const errs = (await c.get(`${url}/${job.id}/rows?status=ERROR`).expect(200)).body.rows.map((r: { rowNumber: number; messages: string[] }) => [r.rowNumber, r.messages.join(' ')]);
    expect(errs[0][1]).toContain('Pavimento não pode ficar na raiz do módulo');
    expect(errs[1][1]).toContain('ciclo');
    expect(errs[3][1]).toContain('Tipologia não cadastrada: XX');
    await c.post(`${url}/${job.id}/apply`, { skipInvalid: true }, { 'If-Match': String(v.version) }).expect(200);
    const s = (await c.get(`/api/projects/${p}/structure`).expect(200)).body as StructureDto;
    const mod = s.modules.find((m) => m.name === 'Torres novas')!;
    expect(mod.kind).toBe('VERTICAL_RESIDENTIAL');
    const apto = s.nodes.find((n) => n.name === 'Apto 101' && n.moduleId === mod.id)!;
    expect(apto).toMatchObject({ kind: 'DWELLING_UNIT' });
    expect(apto.typologyId).toBeTruthy();
    expect(apto.code).toBe('02.01.001.001');
    // exportar o cadastro e reimportar num empreendimento vazio recria a mesma árvore
    const out = (await binary(c.post(`/api/projects/${p}/exports`, { report: 'structure', format: 'csv' })).expect(200)).body as Buffer;
    const p2 = (await c.post('/api/projects', newProject()).expect(201)).body.id as string;
    const tA = (await c.post(`/api/projects/${p2}/typologies`, { code: '2Q', name: '2 quartos', kind: 'APARTMENT' }).expect(201)).body;
    expect(tA.code).toBe('2Q');
    const j2 = (await upload(c, `/api/projects/${p2}/imports`, { kind: 'STRUCTURE' }, 'cadastro.csv', out).expect(201)).body as ImportJobDto;
    const v2 = await validate(`/api/projects/${p2}/imports`, j2);
    expect(v2.summary?.error).toBe(0);
    await c.post(`/api/projects/${p2}/imports/${j2.id}/apply`, {}, { 'If-Match': String(v2.version) }).expect(200);
    const s2 = (await c.get(`/api/projects/${p2}/structure`).expect(200)).body as StructureDto;
    const key = (x: StructureDto) => x.nodes.filter((n) => !n.archivedAt).map((n) => `${n.code} ${n.kind} ${n.name}`).sort();
    expect(key(s2)).toEqual(key(s));
  });

  it('todas as exportações em todos os formatos', async () => {
    const a = await setupProject('Relatórios');
    const lot = a.s.nodes.find((n) => n.kind === 'LOT')!;
    await c.post(`/api/projects/${a.p}/measurements`, { wbsNodeId: a.item.id, serviceId: a.alv.id, anchor: { kind: 'STRUCTURE_NODE', id: lot.id }, calc: { method: 'MANUAL', value: '12,5', unit: 'm²' } }).expect(201);
    const rev = (await c.post(`/api/projects/${a.p}/revisions`, { title: 'R00' }).expect(201)).body;
    const reports = [
      { report: 'structure' }, { report: 'wbs' }, { report: 'measurements' }, { report: 'memories' }, { report: 'services' },
      { report: 'consolidation', groupBy: ['service', 'BLOCK_QUADRA'] }, { report: 'consolidation', revisionId: rev.id, groupBy: ['service'] },
      { report: 'revision-compare', revisionId: rev.id, compareTo: 'current' },
    ];
    for (const r of reports) for (const format of ['xlsx', 'csv', 'pdf'] as const) {
      const res = await binary(c.post(`/api/projects/${a.p}/exports`, { ...r, format })).expect(200);
      const body = res.body as Buffer;
      expect(body.length, `${r.report} ${format}`).toBeGreaterThan(20);
      if (format === 'pdf') expect(body.subarray(0, 5).toString()).toBe('%PDF-');
      if (format === 'xlsx') expect(body.subarray(0, 2).toString()).toBe('PK');
      expect(res.headers['content-disposition']).toMatch(/attachment; filename\*=UTF-8''/);
    }
    const cons = await readXlsx((await binary(c.post(`/api/projects/${a.p}/exports`, { report: 'consolidation', format: 'xlsx', groupBy: ['service'] })).expect(200)).body as Buffer);
    expect(cons[1]).toEqual(['ALV.001 Alvenaria de vedação com bloco cerâmico', 12.5, 'm²', 1, 1]);
    const tpl = await readXlsx((await binary(c.get('/api/import-templates/MEASUREMENTS?format=xlsx')).expect(200)).body as Buffer);
    expect(tpl[0]![0]).toBe('Código do item da EAP');
    const other = await signup(app, 'Org Exportação Intrusa');
    await other.post(`/api/projects/${a.p}/exports`, { report: 'wbs', format: 'csv' }).expect(404);
  });
});
