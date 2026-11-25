import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SCENARIO_B_HORIZONTAL } from '@eapq/domain';
import type { MeasurementDetailDto, ServiceDto, SheetDetailDto, SheetListItemDto, SheetTemplateDto, StructureDto, TemplateDto, TypologyDto, WbsDto, WbsNodeDto, WbsPlanDto } from '@eapq/contracts';
import { bootApp, inviteAndJoin, newProject, signup, type Client } from './helpers.js';

const { app, prisma } = await bootApp();
afterAll(() => app.close());

const byKindCode: Record<string, string> = { VERTICAL_RESIDENTIAL: 'EAP-VERT', HORIZONTAL_RESIDENTIAL: 'EAP-HORIZ', LAND_SUBDIVISION: 'EAP-LOT', COMMON_AREAS: 'EAP-AREAS', INFRASTRUCTURE: 'EAP-INFRA' };
async function generate(c: Client, p: string) {
  const s = (await c.get(`/api/projects/${p}/structure`).expect(200)).body as StructureDto;
  const tpls = (await c.get('/api/wbs-templates').expect(200)).body as TemplateDto[];
  const sel = s.modules.map((m) => ({ moduleId: m.id, templateVersionId: tpls.find((x) => x.code === byKindCode[m.kind])!.versions.find((v) => v.status === 'PUBLISHED')!.id }));
  const plan = (await c.post(`/api/projects/${p}/wbs/preview`, { selections: sel }).expect(200)).body as WbsPlanDto;
  await c.post(`/api/projects/${p}/wbs/apply`, { selections: sel, planHash: plan.planHash }).expect(200);
}
const pathTitles = (w: WbsDto, n: WbsNodeDto) => { const t: string[] = []; let cur: WbsNodeDto | undefined = n; while (cur) { t.unshift(cur.title); cur = w.nodes.find((x) => x.id === cur!.parentId); } return t.join(' › '); };
const svc = async (c: Client, code: string) => ((await c.get(`/api/catalog/services?q=${code}`).expect(200)).body.items as ServiceDto[]).find((s) => s.code === code)!;
const ifm = (v: number) => ({ 'If-Match': String(v) });

describe('modelos de ficha', () => {
  let c: Client;
  beforeAll(async () => { c = await signup(app, 'Org Modelos de Ficha'); });

  it('organização nova recebe os modelos iniciais publicados', async () => {
    const list = (await c.get('/api/sheet-templates').expect(200)).body as SheetTemplateDto[];
    expect(list.map((t) => t.code)).toEqual(['ACO', 'CER', 'CONC', 'PAREDE', 'REDE', 'TELHADO']);
    expect(list.find((t) => t.code === 'REDE')!.versions[0]).toMatchObject({ number: 1, status: 'PUBLISHED', issues: [] });
  });

  it('rascunho inválido não publica; publicada é imutável no banco; nova versão parte da anterior', async () => {
    const def = { columns: [{ key: 'a', label: 'A', kind: 'input', type: 'number', unit: 'm' }, { key: 'b', label: 'B', kind: 'input', type: 'number', unit: 'm²' }, { key: 'x', label: 'X', kind: 'calc', type: 'number', unit: 'm', expression: 'a + b' }], params: [], tables: [], outputs: [{ key: 'x', label: 'X', column: 'x' }] };
    const t = (await c.post('/api/sheet-templates', { code: 'teste', name: 'Teste', definition: def }).expect(201)).body;
    const bad = await c.post(`/api/sheet-templates/${t.id}/versions/${t.versionId}/publish`, {}).expect(422);
    expect(bad.body.code).toBe('SHEET_INVALID');
    expect(bad.body.detail).toContain('Não é possível somar');
    await c.patch(`/api/sheet-templates/${t.id}/versions/${t.versionId}`, { definition: { ...def, columns: [def.columns[0], def.columns[1], { ...def.columns[2], unit: 'm³', expression: 'a * b' }] } }).expect(204);
    await c.post(`/api/sheet-templates/${t.id}/versions/${t.versionId}/publish`, {}).expect(204);
    await c.patch(`/api/sheet-templates/${t.id}/versions/${t.versionId}`, { notes: 'x' }).expect(409);
    await expect(prisma.$executeRaw`UPDATE sheet_template_version SET notes = 'x' WHERE id = ${t.versionId}::uuid`).rejects.toThrow(/imutável/);
    const v2 = (await c.post(`/api/sheet-templates/${t.id}/versions`, {}).expect(201)).body;
    const listed = ((await c.get('/api/sheet-templates').expect(200)).body as SheetTemplateDto[]).find((x) => x.code === 'TESTE')!;
    expect(listed.versions.map((v) => [v.number, v.status])).toEqual([[2, 'DRAFT'], [1, 'PUBLISHED']]);
    expect(listed.versions[0]!.definition.columns[2]!.expression).toBe('a * b');
    await c.post(`/api/sheet-templates/${t.id}/versions`, {}).expect(409);
    await c.del(`/api/sheet-templates/${t.id}/versions/${v2.id}`).expect(204);
  });

  it('expressão com eval/código é recusada pelo parser seguro', async () => {
    const def = { columns: [{ key: 'a', label: 'A', kind: 'input', type: 'number', unit: 'm' }, { key: 'x', label: 'X', kind: 'calc', type: 'number', expression: 'constructor(a)' }], params: [], tables: [], outputs: [{ key: 'x', label: 'X', column: 'x' }] };
    const t = (await c.post('/api/sheet-templates', { code: 'MAL', name: 'Mal', definition: def }).expect(201)).body;
    const r = await c.post(`/api/sheet-templates/${t.id}/versions/${t.versionId}/publish`, {}).expect(422);
    expect(r.body.detail).toMatch(/não permitid/i);
  });

  it('membro lê e não cria; outra organização não vê nem altera', async () => {
    const m = await inviteAndJoin(app, c, 'MEMBER');
    await m.get('/api/sheet-templates').expect(200);
    await m.post('/api/sheet-templates', { code: 'X', name: 'X', definition: { columns: [{ key: 'a', label: 'A', kind: 'input', type: 'text' }], params: [], tables: [], outputs: [{ key: 'a', label: 'A', column: 'a' }] } }).expect(403);
    const other = await signup(app, 'Org Modelos B');
    const mine = ((await c.get('/api/sheet-templates').expect(200)).body as SheetTemplateDto[]).find((x) => x.code === 'TESTE')!;
    expect(((await other.get('/api/sheet-templates').expect(200)).body as SheetTemplateDto[]).find((x) => x.code === 'TESTE')).toBeUndefined();
    await other.post(`/api/sheet-templates/${mine.id}/versions`, {}).expect(404);
    await other.patch(`/api/sheet-templates/${mine.id}`, { name: 'Invadido' }, ifm(mine.version)).expect(404);
  });
});

describe('fichas do empreendimento — cerâmica da tipologia (× 60 casas)', () => {
  let c: Client;
  let p: string;
  let typA: TypologyDto;
  let key: string;
  let item: WbsNodeDto;
  let cer: SheetTemplateDto;
  let piso: ServiceDto, contrapiso: ServiceDto, rodape: ServiceDto;
  let sheetId: string;
  const base = () => `/api/projects/${p}/sheets`;
  const detail = async () => (await c.get(`${base()}/${sheetId}`).expect(200)).body as SheetDetailDto;
  const row = (o: Record<string, string>) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, { v }]));
  const vmb = row({ ambiente: 'Sala/cozinha', tipo: 'Piso + rodapé', peca_l: '67', peca_c: '67', pecas: '51', perimetro: '21,15', altura: '0,07', desconto: '0,392', paginacao: 'Sim' });

  beforeAll(async () => {
    c = await signup(app, 'Org Fichas');
    p = (await c.post('/api/projects', { ...newProject(), classification: 'HORIZONTAL' }).expect(201)).body.id;
    await c.post(`/api/projects/${p}/structure/wizard/apply`, SCENARIO_B_HORIZONTAL).expect(201);
    typA = ((await c.get(`/api/projects/${p}/typologies`).expect(200)).body as TypologyDto[]).find((t) => t.code === 'A')!;
    const types = (await c.get('/api/catalog/element-types').expect(200)).body as { id: string; code: string }[];
    const tA = `/api/projects/${p}/typologies/${typA.id}`;
    const r1 = (await c.post(`${tA}/revisions`, {}).expect(201)).body;
    const sala = (await c.post(`${tA}/revisions/${r1.id}/elements`, { name: 'Sala/cozinha', elementTypeId: types.find((t) => t.code === 'AMBIENTE')!.id, attributes: { area: '22.89' } }).expect(201)).body;
    key = sala.stableKey;
    await c.post(`${tA}/revisions/${r1.id}/publish`, {}).expect(200);
    const s = (await c.get(`/api/projects/${p}/structure`).expect(200)).body as StructureDto;
    await c.post(`${tA}/propagation`, { unitIds: s.nodes.filter((n) => n.kind === 'DWELLING_UNIT' && n.typologyId === typA.id).map((u) => u.id) }).expect(200);
    await generate(c, p);
    const w = (await c.get(`/api/projects/${p}/wbs`).expect(200)).body as WbsDto;
    item = w.nodes.find((n) => n.title === 'Contrapiso, pisos e rodapés' && pathTitles(w, n).includes('Casas A'))!;
    cer = ((await c.get('/api/sheet-templates').expect(200)).body as SheetTemplateDto[]).find((t) => t.code === 'CER')!;
    [piso, contrapiso, rodape] = await Promise.all([svc(c, 'REV.004'), svc(c, 'REV.003'), svc(c, 'REV.005')]);
  });

  it('cria a ficha com serviços sugeridos pelo modelo e destino na tipologia', async () => {
    sheetId = (await c.post(base(), { templateVersionId: cer.versions[0]!.id, title: 'Cerâmica — Casa A', wbsNodeId: item.id, anchor: { kind: 'TYPOLOGY_ELEMENT', typologyId: typA.id, elementKey: key } }).expect(201)).body.id;
    const d = await detail();
    expect(d).toMatchObject({ status: 'DRAFT', templateCode: 'CER', versionNumber: 1, wbsCode: item.code, rowCount: 0, measurementCount: 0 });
    expect(d.outputMap).toEqual({ ceramica: piso.id, contrapiso: contrapiso.id, rodape: rodape.id });
    expect(d.anchorLabel).toContain('Sala/cozinha');
    expect(d.units.find((u) => u.symbol === 'cm')).toMatchObject({ factor: '0.01' });
  });

  it('lançar sem linhas é recusado; linha com erro bloqueia tudo', async () => {
    let d = await detail();
    expect((await c.post(`${base()}/${sheetId}/launch`, {}, ifm(d.version)).expect(422)).body.detail).toContain('não tem linhas');
    await c.patch(`${base()}/${sheetId}`, { rows: [vmb, row({ ambiente: 'Banho', tipo: 'Teto', area_geo: '3' })] }, ifm(d.version)).expect(204);
    d = await detail();
    const r = await c.post(`${base()}/${sheetId}/launch`, {}, ifm(d.version)).expect(422);
    expect(r.body.code).toBe('SHEET_ROW_ERRORS');
    expect(r.body.errors[0].message).toMatch(/Linha 2 \(Banho · Teto\).*não é uma opção/);
    expect(await prisma.measurement.count({ where: { sheetId } })).toBe(0);
  });

  it('lança: três medições pelo método Ficha, × 60 unidades, memória com as linhas', async () => {
    let d = await detail();
    await c.patch(`${base()}/${sheetId}`, { rows: [vmb, row({}), row({ ambiente: 'Banho', tipo: 'Piso', area_geo: '3', paginacao: 'Não' }), row({}), row({ ambiente: ' ' })] }, ifm(d.version)).expect(204);
    d = await detail();
    expect(d.rowCount).toBe(3); // linhas vazias no fim descartadas; a do meio fica (ignorada no cálculo)
    const res = (await c.post(`${base()}/${sheetId}/launch`, {}, ifm(d.version)).expect(200)).body;
    expect(res).toMatchObject({ created: 3, revised: 0, archived: 0 });
    d = await detail();
    expect(d).toMatchObject({ status: 'LAUNCHED', measurementCount: 3 });
    // 25,18152 + 3 × 1,13 = 28,57152
    expect(d.measurements.map((m) => [m.outputKey, m.quantity, m.unit])).toEqual(expect.arrayContaining([['ceramica', '28.57152', 'm²'], ['contrapiso', '25.8939', 'm²'], ['rodape', '21.15', 'm']]));
    const mid = d.measurements.find((m) => m.outputKey === 'ceramica')!.measurementId;
    const m = (await c.get(`/api/projects/${p}/measurements/${mid}`).expect(200)).body as MeasurementDetailDto;
    expect(m).toMatchObject({ multiplier: 60, effectiveTotal: '1714.2912', sheet: { id: sheetId, outputKey: 'ceramica' }, current: { number: 1, method: 'SHEET' } });
    expect(m.current.memory.sheet).toMatchObject({ title: 'Cerâmica — Casa A', template: { code: 'CER', versionNumber: 1 }, output: { key: 'ceramica' }, total: '28.57152', totalUnit: 'm²', skippedRows: 1 });
    expect(m.current.memory.sheet!.rows).toEqual([{ index: 1, label: 'Sala/cozinha · Piso + rodapé', value: '25.18152' }, { index: 3, label: 'Banho · Piso', value: '3.39' }]);
    // serviços ainda não vinculados ao item foram vinculados pela ficha
    expect(await prisma.wbsNodeService.count({ where: { wbsNodeId: item.id, serviceId: { in: [piso.id, contrapiso.id, rodape.id] } } })).toBe(3);
    expect(await prisma.auditLog.count({ where: { entityType: 'Sheet', entityId: sheetId, action: 'LAUNCH' } })).toBe(1);
  });

  it('medição gerada pela ficha não é revisada nem arquivada à mão', async () => {
    const d = await detail();
    const mid = d.measurements[0]!.measurementId;
    const m = (await c.get(`/api/projects/${p}/measurements/${mid}`).expect(200)).body as MeasurementDetailDto;
    const r = await c.post(`/api/projects/${p}/measurements/${mid}/revisions`, { calc: { method: 'MANUAL', value: '1', unit: 'm²' }, reason: 'x' }, ifm(m.version));
    expect(r.status).toBe(409);
    expect(r.body.code).toBe('SHEET_OWNED');
    expect((await c.post(`/api/projects/${p}/measurements/${mid}/archive`, { reason: 'x' }, ifm(m.version))).body.code).toBe('SHEET_OWNED');
  });

  it('alterar a ficha deixa pendente; relançar cria nova revisão só no que mudou', async () => {
    let d = await detail();
    await c.patch(`${base()}/${sheetId}`, { params: { perda_paginada: '10' } }, ifm(d.version)).expect(204);
    d = await detail();
    expect(d.status).toBe('PENDING');
    const res = (await c.post(`${base()}/${sheetId}/launch`, { reason: 'Perda revisada pelo gestor' }, ifm(d.version)).expect(200)).body;
    expect(res).toMatchObject({ created: 0, revised: 1, unchanged: 2 });
    d = await detail();
    const cerM = d.measurements.find((m) => m.outputKey === 'ceramica')!;
    expect(cerM).toMatchObject({ quantity: '29.77064', revision: 2 }); // 23,9824 × 1,10 + 3,39
    const m = (await c.get(`/api/projects/${p}/measurements/${cerM.measurementId}`).expect(200)).body as MeasurementDetailDto;
    expect(m.revisions.map((r) => [r.number, r.quantity, r.reason])).toEqual([[2, '29.77064', 'Perda revisada pelo gestor'], [1, '28.57152', null]]);
    expect(m.current.memory.sheet!.params.find((x) => x.key === 'perda_paginada')!.value).toBe('10');
    // relançar sem mudança não grava nada
    d = await detail();
    expect((await c.post(`${base()}/${sheetId}/launch`, {}, ifm(d.version)).expect(200)).body).toMatchObject({ created: 0, revised: 0, unchanged: 3 });
  });

  it('serviço em unidade incompatível com a saída é recusado sem gravar nada', async () => {
    let d = await detail();
    await c.patch(`${base()}/${sheetId}`, { outputMap: { rodape: piso.id } }, ifm(d.version)).expect(204);
    d = await detail();
    const before = await prisma.measurementRevision.count({ where: { measurement: { sheetId } } });
    const r = await c.post(`${base()}/${sheetId}/launch`, {}, ifm(d.version)).expect(422);
    expect(r.body.detail).toContain('está em m, mas o serviço REV.004 é medido em m²');
    expect(await prisma.measurementRevision.count({ where: { measurement: { sheetId } } })).toBe(before);
    await c.patch(`${base()}/${sheetId}`, { outputMap: { rodape: null } }, ifm(d.version)).expect(204);
    d = await detail();
    expect((await c.post(`${base()}/${sheetId}/launch`, {}, ifm(d.version)).expect(200)).body).toMatchObject({ archived: 1, unchanged: 2 });
    d = await detail();
    expect(d.measurements.find((m) => m.outputKey === 'rodape')!.archived).toBe(true);
  });

  it('duas fichas na mesma âncora, item e serviço: dupla contagem bloqueada', async () => {
    const other = (await c.post(base(), { templateVersionId: cer.versions[0]!.id, title: 'Cerâmica duplicada', wbsNodeId: item.id, anchor: { kind: 'TYPOLOGY_ELEMENT', typologyId: typA.id, elementKey: key } }).expect(201)).body.id;
    let d = (await c.get(`${base()}/${other}`).expect(200)).body as SheetDetailDto;
    await c.patch(`${base()}/${other}`, { rows: [vmb] }, ifm(d.version)).expect(204);
    d = (await c.get(`${base()}/${other}`).expect(200)).body as SheetDetailDto;
    const r = await c.post(`${base()}/${other}/launch`, {}, ifm(d.version)).expect(409);
    expect(r.body.code).toBe('MEASUREMENT_OVERLAP');
    expect(await prisma.measurement.count({ where: { sheetId: other } })).toBe(0);
    expect(await prisma.wbsNodeService.count({ where: { wbsNodeId: item.id } })).toBeGreaterThan(0);
  });

  it('If-Match desatualizado ⇒ 409; ficha não é apagada no banco', async () => {
    const d = await detail();
    await c.patch(`${base()}/${sheetId}`, { title: 'X' }, ifm(d.version - 1)).expect(409);
    await c.post(`${base()}/${sheetId}/launch`, {}, ifm(d.version - 1)).expect(409);
    await expect(prisma.$executeRaw`DELETE FROM sheet WHERE id = ${sheetId}::uuid`).rejects.toThrow(/não são apagadas/);
  });

  it('acesso: leitor vê e não edita; outra organização recebe 404', async () => {
    const viewer = await inviteAndJoin(app, c, 'MEMBER');
    const org = await prisma.project.findUniqueOrThrow({ where: { id: p } });
    await prisma.projectMember.create({ data: { organizationId: org.organizationId, projectId: p, userId: viewer.userId, role: 'VIEWER' } });
    await viewer.get(`${base()}/${sheetId}`).expect(200);
    const d = await detail();
    await viewer.patch(`${base()}/${sheetId}`, { title: 'X' }, ifm(d.version)).expect(403);
    await viewer.post(`${base()}/${sheetId}/launch`, {}, ifm(d.version)).expect(403);
    const intruder = await signup(app, 'Org Intrusa Fichas');
    await intruder.get(`${base()}/${sheetId}`).expect(404);
    await intruder.get(base()).expect(404);
    const ip = (await intruder.post('/api/projects', newProject()).expect(201)).body.id;
    await intruder.get(`/api/projects/${ip}/sheets/${sheetId}`).expect(404);
    await intruder.patch(`/api/projects/${ip}/sheets/${sheetId}`, { title: 'X' }, ifm(d.version)).expect(404);
    // modelo de outra organização não pode ser usado
    const own = ((await intruder.get('/api/sheet-templates').expect(200)).body as SheetTemplateDto[])[0]!;
    await c.post(base(), { templateVersionId: own.versions[0]!.id, title: 'Y' }).expect(404);
  });

  it('arquivar a ficha arquiva seus quantitativos', async () => {
    const d = await detail();
    await c.post(`${base()}/${sheetId}/archive`, { reason: 'Projeto substituído' }, ifm(d.version)).expect(204);
    expect(await prisma.measurement.count({ where: { sheetId, archivedAt: null } })).toBe(0);
    const list = (await c.get(base()).expect(200)).body as SheetListItemDto[];
    expect(list.find((x) => x.id === sheetId)).toBeUndefined();
    expect(((await c.get(`${base()}?archived=true`).expect(200)).body as SheetListItemDto[]).find((x) => x.id === sheetId)).toMatchObject({ status: 'DRAFT', measurementCount: 0 });
  });
});
