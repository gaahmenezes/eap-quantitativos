import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SCENARIO_B_HORIZONTAL } from '@eapq/domain';
import type { MeasurementDetailDto, ScheduleDetailDto, ScheduleListItemDto, ServiceDto, StructureDto, TemplateDto, TypologyDto, WbsDto, WbsNodeDto, WbsPlanDto } from '@eapq/contracts';
import { bootApp, inviteAndJoin, newProject, signup, type Client } from './helpers.js';

const { app, prisma } = await bootApp();
afterAll(() => app.close());

const byKindCode: Record<string, string> = { VERTICAL_RESIDENTIAL: 'EAP-VERT', HORIZONTAL_RESIDENTIAL: 'EAP-HORIZ', LAND_SUBDIVISION: 'EAP-LOT', COMMON_AREAS: 'EAP-AREAS', INFRASTRUCTURE: 'EAP-INFRA' };
const pathTitles = (w: WbsDto, n: WbsNodeDto) => { const t: string[] = []; let cur: WbsNodeDto | undefined = n; while (cur) { t.unshift(cur.title); cur = w.nodes.find((x) => x.id === cur!.parentId); } return t.join(' › '); };
const ifm = (v: number) => ({ 'If-Match': String(v) });

async function setup(c: Client) {
  const p = (await c.post('/api/projects', { ...newProject(), classification: 'HORIZONTAL' }).expect(201)).body.id as string;
  await c.post(`/api/projects/${p}/structure/wizard/apply`, SCENARIO_B_HORIZONTAL).expect(201);
  const typs = (await c.get(`/api/projects/${p}/typologies`).expect(200)).body as TypologyDto[];
  const types = (await c.get('/api/catalog/element-types').expect(200)).body as { id: string; code: string }[];
  const s0 = (await c.get(`/api/projects/${p}/structure`).expect(200)).body as StructureDto;
  const roots: Record<string, string> = {};
  for (const code of ['A', 'B']) {
    const t = typs.find((x) => x.code === code)!;
    const tp = `/api/projects/${p}/typologies/${t.id}`;
    const r1 = (await c.post(`${tp}/revisions`, {}).expect(201)).body;
    roots[code] = (await c.post(`${tp}/revisions/${r1.id}/elements`, { name: 'Casa', elementTypeId: types.find((x) => x.code === 'AMBIENTE')!.id, attributes: { area: '45' } }).expect(201)).body.stableKey;
    await c.post(`${tp}/revisions/${r1.id}/publish`, {}).expect(200);
    await c.post(`${tp}/propagation`, { unitIds: s0.nodes.filter((n) => n.kind === 'DWELLING_UNIT' && n.typologyId === t.id).map((u) => u.id) }).expect(200);
  }
  const s = (await c.get(`/api/projects/${p}/structure`).expect(200)).body as StructureDto;
  const tpls = (await c.get('/api/wbs-templates').expect(200)).body as TemplateDto[];
  const sel = s.modules.map((m) => ({ moduleId: m.id, templateVersionId: tpls.find((x) => x.code === byKindCode[m.kind])!.versions.find((v) => v.status === 'PUBLISHED')!.id }));
  const plan = (await c.post(`/api/projects/${p}/wbs/preview`, { selections: sel }).expect(200)).body as WbsPlanDto;
  await c.post(`/api/projects/${p}/wbs/apply`, { selections: sel, planHash: plan.planHash }).expect(200);
  const w = (await c.get(`/api/projects/${p}/wbs`).expect(200)).body as WbsDto;
  const esq = (casa: string) => w.nodes.find((n) => n.title === 'Esquadrias' && pathTitles(w, n).includes(`Casas ${casa}`))!;
  return { p, typs, roots, itemA: esq('A'), itemB: esq('B') };
}
const svc = async (c: Client, code: string) => ((await c.get(`/api/catalog/services?q=${code}`).expect(200)).body.items as ServiceDto[]).find((s) => s.code === code)!;

describe('quadro de esquadrias — casas tipo A (× 60) e tipo B', () => {
  let c: Client;
  let ctx: Awaited<ReturnType<typeof setup>>;
  let porta: ServiceDto, janela: ServiceDto;
  let id: string;
  const base = () => `/api/projects/${ctx.p}/schedules`;
  const detail = async () => (await c.get(`${base()}/${id}`).expect(200)).body as ScheduleDetailDto;
  const typ = (code: string) => ctx.typs.find((t) => t.code === code)!;
  const columns = () => [
    { key: 'a', label: 'Casa tipo A', wbsNodeId: ctx.itemA.id, anchor: { kind: 'TYPOLOGY_ELEMENT', typologyId: typ('A').id, elementKey: ctx.roots['A'] } },
    { key: 'b', label: 'Casa tipo B', wbsNodeId: ctx.itemB.id, anchor: { kind: 'TYPOLOGY_ELEMENT', typologyId: typ('B').id, elementKey: ctx.roots['B'] } },
  ];
  const rows = () => [
    { key: 'pa1', code: 'PA1', description: 'Porta de alumínio', unit: 'un', width: '0,8', height: '2,3', serviceIds: [porta.id, janela.id], cells: { a: '1', b: '1' } },
    { key: 'pv1', code: 'PV1', description: 'Porta de vidro de correr', unit: 'un', width: '2,6', height: '2,3', serviceIds: [porta.id, janela.id], cells: { a: '1' } },
    { key: 'j01', code: 'J01', description: 'Janela maxim-ar', unit: 'un', width: '1,6', height: '1,2', serviceIds: [janela.id], cells: { a: '2', b: '1+1' } },
    { key: 'j02', code: 'J02', description: 'Janela basculante', unit: 'un', width: '0,6', height: '0,6', serviceIds: [janela.id], cells: { a: '2' } },
    { key: 'j03', code: 'J03', description: 'Janela', unit: 'un', width: '1,2', height: '0,6', serviceIds: [janela.id], cells: { a: '1' } },
  ];

  beforeAll(async () => {
    c = await signup(app, 'Org Quadros');
    ctx = await setup(c);
    [porta, janela] = await Promise.all([svc(c, 'ESQ.001'), svc(c, 'ESQ.002')]);
    id = (await c.post(base(), { kind: 'ESQUADRIAS', title: 'Quadro de esquadrias' }).expect(201)).body.id;
  });

  it('grava a grade e calcula as repetições de cada destino', async () => {
    let d = await detail();
    await c.put(`${base()}/${id}`, { columns: columns(), rows: rows() }).set(ifm(d.version)).expect(204);
    d = await detail();
    expect(d).toMatchObject({ status: 'DRAFT', rowCount: 5, columnCount: 2 });
    expect(d.columns.map((x) => [x.key, x.multiplier, x.wbsCode])).toEqual([['a', 60, ctx.itemA.code], ['b', 40, ctx.itemB.code]]);
    expect(d.columns[0]!.anchorLabel).toContain('Casa');
    expect(d.rows[0]).toMatchObject({ code: 'PA1', width: '0.8', height: '2.3', serviceIds: [porta.id, janela.id], cells: { a: '1', b: '1' } });
  });

  it('lança o quadro de resumo: uma medição por serviço × destino, × unidades da tipologia', async () => {
    const d = await detail();
    const res = (await c.post(`${base()}/${id}/launch`, {}, ifm(d.version)).expect(200)).body;
    expect(res).toMatchObject({ created: 4, revised: 0, archived: 0 });
    const after = await detail();
    expect(after.status).toBe('LAUNCHED');
    const q = (code: string, col: string) => after.measurements.find((m) => m.serviceCode === code && m.columnKey === col)!;
    expect(q('ESQ.002', 'a').quantity).toBe('13.1'); // 1,84 + 5,98 + 3,84 + 0,72 + 0,72
    expect(q('ESQ.001', 'a').quantity).toBe('2');
    expect(q('ESQ.002', 'b').quantity).toBe('5.68'); // 1,84 + 2 × 1,92
    expect(q('ESQ.001', 'b').quantity).toBe('1');
    const m = (await c.get(`/api/projects/${ctx.p}/measurements/${q('ESQ.002', 'a').measurementId}`).expect(200)).body as MeasurementDetailDto;
    expect(m).toMatchObject({ multiplier: 60, effectiveTotal: '786', schedule: { id, title: 'Quadro de esquadrias' }, current: { method: 'SCHEDULE', number: 1 } });
    expect(m.current.memory.schedule).toMatchObject({ column: { key: 'a', label: 'Casa tipo A' }, total: '13.1', unit: 'm²', kind: 'ESQUADRIAS' });
    expect(m.current.memory.schedule!.rows.find((r) => r.code === 'J01')).toEqual({ code: 'J01', description: 'Janela maxim-ar', spec: null, entered: '2', enteredUnit: 'un', perItem: '1.92', value: '3.84' });
    expect(await prisma.wbsNodeService.count({ where: { wbsNodeId: ctx.itemA.id, serviceId: { in: [porta.id, janela.id] } } })).toBe(2);
    expect(await prisma.auditLog.count({ where: { entityType: 'Schedule', entityId: id, action: 'LAUNCH' } })).toBe(1);
  });

  it('medição do quadro não é revisada à mão', async () => {
    const d = await detail();
    const mid = d.measurements[0]!.measurementId;
    const m = (await c.get(`/api/projects/${ctx.p}/measurements/${mid}`).expect(200)).body as MeasurementDetailDto;
    const r = await c.post(`/api/projects/${ctx.p}/measurements/${mid}/revisions`, { calc: { method: 'MANUAL', value: '1', unit: 'un' }, reason: 'x' }, ifm(m.version)).expect(409);
    expect(r.body.code).toBe('SCHEDULE_OWNED');
  });

  it('alterar deixa pendente; relançar revisa só o que mudou e arquiva o que saiu', async () => {
    let d = await detail();
    const changed = rows().map((r) => (r.key === 'j01' ? { ...r, cells: { a: '3', b: '1+1' } } : r.key === 'pv1' ? { ...r, serviceIds: [janela.id] } : r));
    await c.put(`${base()}/${id}`, { columns: columns(), rows: changed }).set(ifm(d.version)).expect(204);
    d = await detail();
    expect(d.status).toBe('PENDING');
    const res = (await c.post(`${base()}/${id}/launch`, { reason: 'Projeto de esquadrias rev. 02' }, ifm(d.version)).expect(200)).body;
    // ESQ.002 em A muda (+1,92); ESQ.001 em A cai para 1 (PV1 sem porta); B igual
    expect(res).toMatchObject({ created: 0, revised: 2, unchanged: 2, archived: 0 });
    d = await detail();
    const a2 = d.measurements.find((m) => m.serviceCode === 'ESQ.002' && m.columnKey === 'a' && !m.archived)!;
    expect(a2).toMatchObject({ quantity: '15.02', revision: 2 });
    expect(d.measurements.find((m) => m.serviceCode === 'ESQ.001' && m.columnKey === 'a')!.quantity).toBe('1');
    // tirar todas as portas do destino B arquiva a medição
    d = await detail();
    const noB = changed.map((r) => (r.key === 'pa1' ? { ...r, cells: { a: '1' } } : r));
    await c.put(`${base()}/${id}`, { columns: columns(), rows: noB }).set(ifm(d.version)).expect(204);
    d = await detail();
    expect((await c.post(`${base()}/${id}/launch`, {}, ifm(d.version)).expect(200)).body).toMatchObject({ archived: 1, revised: 1 });
  });

  it('erros bloqueiam sem gravar: área sem L × A, destino sem item da EAP, chave repetida, serviço de outra organização', async () => {
    let d = await detail();
    const before = await prisma.measurementRevision.count({ where: { measurement: { scheduleId: id } } });
    await c.put(`${base()}/${id}`, { columns: columns(), rows: [...rows(), { key: 'x', description: 'Janela sem medida', unit: 'un', serviceIds: [janela.id], cells: { a: '1' } }] }).set(ifm(d.version)).expect(204);
    d = await detail();
    const r = await c.post(`${base()}/${id}/launch`, {}, ifm(d.version)).expect(422);
    expect(r.body.code).toBe('SCHEDULE_ROW_ERRORS');
    expect(r.body.errors[0].message).toMatch(/informe largura e altura/);
    await c.put(`${base()}/${id}`, { columns: [{ key: 'a', label: 'Sem destino' }], rows: rows() }).set(ifm(d.version)).expect(204);
    d = await detail();
    expect((await c.post(`${base()}/${id}/launch`, {}, ifm(d.version)).expect(422)).body.detail).toContain('item da EAP do destino "Sem destino"');
    expect(await prisma.measurementRevision.count({ where: { measurement: { scheduleId: id } } })).toBe(before);
    await c.put(`${base()}/${id}`, { columns: [...columns(), columns()[0]!], rows: rows() }).set(ifm(d.version)).expect(422);
    const other = await signup(app, 'Org Quadros Outra');
    const foreign = await svc(other, 'ESQ.001');
    await c.put(`${base()}/${id}`, { columns: columns(), rows: [{ ...rows()[0]!, serviceIds: [foreign.id] }] }).set(ifm(d.version)).expect(404);
    await c.put(`${base()}/${id}`, { columns: columns(), rows: rows() }).set(ifm(d.version)).expect(204);
  });

  it('dupla contagem com outro quadro no mesmo destino é bloqueada e nada é gravado', async () => {
    const id2 = (await c.post(base(), { kind: 'ESQUADRIAS', title: 'Quadro duplicado' }).expect(201)).body.id;
    let d = (await c.get(`${base()}/${id2}`).expect(200)).body as ScheduleDetailDto;
    await c.put(`${base()}/${id2}`, { columns: [columns()[0]!], rows: [rows()[0]!] }).set(ifm(d.version)).expect(204);
    d = (await c.get(`${base()}/${id2}`).expect(200)).body as ScheduleDetailDto;
    const r = await c.post(`${base()}/${id2}/launch`, {}, ifm(d.version)).expect(409);
    expect(r.body.code).toBe('MEASUREMENT_OVERLAP');
    expect(await prisma.measurement.count({ where: { scheduleId: id2 } })).toBe(0);
  });

  it('lista padrão: copia os itens de um quadro de outro empreendimento (sem destinos, sem quantidades)', async () => {
    const other = await setup(c);
    const r = (await c.post(`/api/projects/${other.p}/schedules`, { kind: 'ESQUADRIAS', title: 'Esquadrias — novo empreendimento', copyFromId: id }).expect(201)).body;
    expect(r.droppedServices).toBe(0);
    const d = (await c.get(`/api/projects/${other.p}/schedules/${r.id}`).expect(200)).body as ScheduleDetailDto;
    expect(d.rows.map((x) => x.code)).toEqual(['PA1', 'PV1', 'J01', 'J02', 'J03']);
    expect(d.columns).toEqual([]);
    expect(d.rows.every((x) => Object.keys(x.cells).length === 0)).toBe(true);
    const sources = (await c.get('/api/schedule-sources').expect(200)).body as { id: string }[];
    expect(sources.some((x) => x.id === id)).toBe(true);
  });

  it('acesso: leitor vê e não altera; outra organização recebe 404 (inclusive como lista padrão)', async () => {
    const viewer = await inviteAndJoin(app, c, 'MEMBER');
    const org = await prisma.project.findUniqueOrThrow({ where: { id: ctx.p } });
    await prisma.projectMember.create({ data: { organizationId: org.organizationId, projectId: ctx.p, userId: viewer.userId, role: 'VIEWER' } });
    const d = await detail();
    await viewer.get(`${base()}/${id}`).expect(200);
    await viewer.put(`${base()}/${id}`, { columns: [], rows: [] }).set(ifm(d.version)).expect(403);
    await viewer.post(`${base()}/${id}/launch`, {}, ifm(d.version)).expect(403);
    const intruder = await signup(app, 'Org Intrusa Quadros');
    await intruder.get(`${base()}/${id}`).expect(404);
    const ip = (await intruder.post('/api/projects', newProject()).expect(201)).body.id;
    await intruder.get(`/api/projects/${ip}/schedules/${id}`).expect(404);
    await intruder.post(`/api/projects/${ip}/schedules`, { kind: 'OUTROS', title: 'X', copyFromId: id }).expect(404);
    expect(((await intruder.get('/api/schedule-sources').expect(200)).body as unknown[]).length).toBe(0);
  });

  it('If-Match desatualizado ⇒ 409; quadro não é apagado; arquivar arquiva os quantitativos', async () => {
    const d = await detail();
    await c.put(`${base()}/${id}`, { columns: [], rows: [] }).set(ifm(d.version - 1)).expect(409);
    await expect(prisma.$executeRaw`DELETE FROM schedule WHERE id = ${id}::uuid`).rejects.toThrow(/não são apagados/);
    await c.post(`${base()}/${id}/archive`, { reason: 'Substituído' }, ifm(d.version)).expect(204);
    expect(await prisma.measurement.count({ where: { scheduleId: id, archivedAt: null } })).toBe(0);
    expect(((await c.get(base()).expect(200)).body as ScheduleListItemDto[]).find((x) => x.id === id)).toBeUndefined();
  });
});
