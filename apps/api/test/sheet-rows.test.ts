import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SCENARIO_A_VERTICAL } from '@eapq/domain';
import type { MeasurementDetailDto, SheetDetailDto, SheetTemplateDto, StructureDto, TemplateDto, WbsDto, WbsNodeDto, WbsPlanDto } from '@eapq/contracts';
import { bootApp, newProject, signup, type Client } from './helpers.js';

const { app, prisma } = await bootApp();
afterAll(() => app.close());
const ifm = (v: number) => ({ 'If-Match': String(v) });
const byKindCode: Record<string, string> = { VERTICAL_RESIDENTIAL: 'EAP-VERT', HORIZONTAL_RESIDENTIAL: 'EAP-HORIZ', LAND_SUBDIVISION: 'EAP-LOT', COMMON_AREAS: 'EAP-AREAS', INFRASTRUCTURE: 'EAP-INFRA' };
const pathTitles = (w: WbsDto, n: WbsNodeDto) => { const t: string[] = []; let cur: WbsNodeDto | undefined = n; while (cur) { t.unshift(cur.title); cur = w.nodes.find((x) => x.id === cur!.parentId); } return t.join(' › '); };
const row = (o: Record<string, string>) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, { v }]));

describe('ficha com destino por linha (paredes de concreto por pavimento)', () => {
  let c: Client;
  let p: string;
  let id: string;
  let s: StructureDto;
  const node = (name: string, parent?: string) => s.nodes.find((n) => n.name === name && (!parent || s.nodes.find((x) => x.id === n.parentId)?.name === parent))!;
  const base = () => `/api/projects/${p}/sheets`;
  const detail = async () => (await c.get(`${base()}/${id}`).expect(200)).body as SheetDetailDto;
  const st = (n: { id: string }) => ({ kind: 'STRUCTURE_NODE', id: n.id });
  const rows = [row({ elemento: 'Paredes 1º', comprimento: '32,5', altura: '2,7', desconto: '4,56', espessura: '10' }), row({ elemento: 'Paredes 2º', comprimento: '30', altura: '2,7', espessura: '10' }), row({ elemento: 'Platibanda', comprimento: '27,76', altura: '0,7', espessura: '10' })];

  beforeAll(async () => {
    c = await signup(app, 'Org Destino por Linha');
    p = (await c.post('/api/projects', newProject()).expect(201)).body.id;
    await c.post(`/api/projects/${p}/structure/wizard/apply`, SCENARIO_A_VERTICAL).expect(201);
    s = (await c.get(`/api/projects/${p}/structure`).expect(200)).body;
    const tpls = (await c.get('/api/wbs-templates').expect(200)).body as TemplateDto[];
    const sel = s.modules.map((m) => ({ moduleId: m.id, templateVersionId: tpls.find((x) => x.code === byKindCode[m.kind])!.versions.find((v) => v.status === 'PUBLISHED')!.id }));
    const plan = (await c.post(`/api/projects/${p}/wbs/preview`, { selections: sel }).expect(200)).body as WbsPlanDto;
    await c.post(`/api/projects/${p}/wbs/apply`, { selections: sel, planHash: plan.planHash }).expect(200);
    const w = (await c.get(`/api/projects/${p}/wbs`).expect(200)).body as WbsDto;
    const item = w.nodes.find((n) => n.title === 'Estrutura de concreto armado' && pathTitles(w, n).includes('Torre A › Estrutura › 1º pavimento'))!;
    const conc = ((await c.get('/api/sheet-templates').expect(200)).body as SheetTemplateDto[]).find((t) => t.code === 'CONC')!;
    id = (await c.post(base(), { templateVersionId: conc.versions[0]!.id, title: 'Paredes de concreto — Torre A', wbsNodeId: item.id }).expect(201)).body.id;
  });

  it('sem âncora da ficha, linha sem destino bloqueia o lançamento', async () => {
    let d = await detail();
    await c.patch(`${base()}/${id}`, { rows, rowAnchors: [st(node('1º pavimento', 'Torre A')), st(node('2º pavimento', 'Torre A')), null] }, ifm(d.version)).expect(204);
    d = await detail();
    expect(d.rowAnchors.map((a) => (a ? 'x' : null))).toEqual(['x', 'x', null]);
    expect(d.rowAnchorLabels[0]).toContain('1º pavimento');
    const r = await c.post(`${base()}/${id}/launch`, {}, ifm(d.version)).expect(422);
    expect(r.body.detail).toMatch(/linha 3 \(Platibanda\) não tem destino/);
  });

  it('lança uma medição por saída × destino, com a memória só das linhas do destino', async () => {
    let d = await detail();
    await c.patch(`${base()}/${id}`, { anchor: st(node('Cobertura', 'Torre A') ?? node('Térreo', 'Torre A')) }, ifm(d.version)).expect(204);
    d = await detail();
    const res = (await c.post(`${base()}/${id}/launch`, {}, ifm(d.version)).expect(200)).body;
    expect(res).toMatchObject({ created: 6 });
    d = await detail();
    const conc = d.measurements.filter((m) => m.serviceCode === 'EST.001').map((m) => m.quantity).sort();
    expect(conc).toEqual(['1.9432', '8.1', '8.319']); // 27,76×0,7×0,1 · 30×2,7×0,1 · (32,5×2,7−4,56)×0,1
    const m1 = d.measurements.find((m) => m.serviceCode === 'EST.001' && m.quantity === '8.319')!;
    expect(m1.outputKey).toMatch(/^concreto@[0-9a-f]{16}$/);
    const det = (await c.get(`/api/projects/${p}/measurements/${m1.measurementId}`).expect(200)).body as MeasurementDetailDto;
    expect(det.anchor.label).toContain('1º pavimento');
    expect(det.current.memory.sheet).toMatchObject({ destination: expect.stringContaining('1º pavimento'), rows: [{ index: 1, label: 'Paredes 1º', value: '8.319' }] });
    expect(d.measurements.find((m) => m.serviceCode === 'EST.001' && m.quantity === '1.9432')!.outputKey).toBe('concreto');
  });

  it('destinos sobrepostos no mesmo item e serviço: dupla contagem bloqueada', async () => {
    let d = await detail();
    await c.patch(`${base()}/${id}`, { rows, rowAnchors: [st(node('1º pavimento', 'Torre A')), st(node('2º pavimento', 'Torre A')), st(node('Torre A'))] }, ifm(d.version)).expect(204);
    d = await detail();
    const r = await c.post(`${base()}/${id}/launch`, {}, ifm(d.version)).expect(409);
    expect(r.body.code).toBe('MEASUREMENT_OVERLAP');
  });

  it('tirar os destinos por linha volta a uma medição por saída (as por destino são arquivadas)', async () => {
    let d = await detail();
    await c.patch(`${base()}/${id}`, { rows }, ifm(d.version)).expect(204);
    d = await detail();
    expect(d.rowAnchors).toEqual([null, null, null]);
    const res = (await c.post(`${base()}/${id}/launch`, {}, ifm(d.version)).expect(200)).body;
    expect(res).toMatchObject({ archived: 4, revised: 2 });
    d = await detail();
    expect(d.measurements.filter((m) => !m.archived).map((m) => [m.outputKey, m.quantity]).sort()).toEqual([['concreto', '18.3622'], ['forma', '367.244']]);
  });

  it('âncora inexistente ou de outro empreendimento na linha é recusada', async () => {
    const d = await detail();
    await c.patch(`${base()}/${id}`, { rows, rowAnchors: [{ kind: 'STRUCTURE_NODE', id: '01a00000-0000-7000-8000-000000000000' }] }, ifm(d.version)).expect(404);
    const other = (await c.post('/api/projects', newProject()).expect(201)).body.id;
    await c.post(`/api/projects/${other}/structure/wizard/apply`, SCENARIO_A_VERTICAL).expect(201);
    const os = (await c.get(`/api/projects/${other}/structure`).expect(200)).body as StructureDto;
    await c.patch(`${base()}/${id}`, { rows, rowAnchors: [st(os.nodes[0]!)] }, ifm(d.version)).expect(404);
    expect(await prisma.sheet.count({ where: { id, rowAnchors: { not: [] } } })).toBe(0);
  });
});
