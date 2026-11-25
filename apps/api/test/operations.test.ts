import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SCENARIO_A_VERTICAL } from '@eapq/domain';
import type { OperationsDto, ServiceDto, SheetDetailDto, SheetTemplateDto, StructureDto, TemplateDto, WbsDto, WbsNodeDto, WbsPlanDto } from '@eapq/contracts';
import { bootApp, newProject, signup, type Client } from './helpers.js';

const { app } = await bootApp();
afterAll(() => app.close());
const ifm = (v: number) => ({ 'If-Match': String(v) });
const byKindCode: Record<string, string> = { VERTICAL_RESIDENTIAL: 'EAP-VERT', HORIZONTAL_RESIDENTIAL: 'EAP-HORIZ', LAND_SUBDIVISION: 'EAP-LOT', COMMON_AREAS: 'EAP-AREAS', INFRASTRUCTURE: 'EAP-INFRA' };
const pathTitles = (w: WbsDto, n: WbsNodeDto) => { const t: string[] = []; let cur: WbsNodeDto | undefined = n; while (cur) { t.unshift(cur.title); cur = w.nodes.find((x) => x.id === cur!.parentId); } return t.join(' › '); };

describe('centro operacional do empreendimento', () => {
  let c: Client;
  let p: string;
  let w: WbsDto;
  let s: StructureDto;
  let item: WbsNodeDto;
  const ops = async () => (await c.get(`/api/projects/${p}/operations`).expect(200)).body as OperationsDto;

  beforeAll(async () => {
    c = await signup(app, 'Org Painel');
    p = (await c.post('/api/projects', newProject()).expect(201)).body.id;
    await c.post(`/api/projects/${p}/structure/wizard/apply`, SCENARIO_A_VERTICAL).expect(201);
    s = (await c.get(`/api/projects/${p}/structure`).expect(200)).body;
    const tpls = (await c.get('/api/wbs-templates').expect(200)).body as TemplateDto[];
    const sel = s.modules.map((m) => ({ moduleId: m.id, templateVersionId: tpls.find((x) => x.code === byKindCode[m.kind])!.versions.find((v) => v.status === 'PUBLISHED')!.id }));
    const plan = (await c.post(`/api/projects/${p}/wbs/preview`, { selections: sel }).expect(200)).body as WbsPlanDto;
    await c.post(`/api/projects/${p}/wbs/apply`, { selections: sel, planHash: plan.planHash }).expect(200);
    w = (await c.get(`/api/projects/${p}/wbs`).expect(200)).body;
    item = w.nodes.find((n) => n.title === 'Estrutura de concreto armado' && pathTitles(w, n).includes('Torre A › Estrutura › 1º pavimento'))!;
  });

  it('empreendimento novo: cobertura zero por grupo e nada pendente', async () => {
    const o = await ops();
    expect(o.coverage.items).toBe(w.nodes.filter((n) => n.nodeType === 'ITEM').length);
    expect(o.coverage.measured).toBe(0);
    expect(o.coverage.groups.length).toBe(w.nodes.filter((n) => !n.parentId).length);
    expect(o.coverage.groups.reduce((a, g) => a + g.items, 0)).toBe(o.coverage.items);
    expect(o.pending).toEqual([]);
    expect(o.revision).toEqual({ last: null, since: { created: 0, revised: 0, archived: 0 } });
    expect(o.counts.unmeasuredLinks).toBeGreaterThan(0);
  });

  it('ficha incompleta aparece com os motivos; lançada, sai das pendências e conta na cobertura', async () => {
    const conc = ((await c.get('/api/sheet-templates').expect(200)).body as SheetTemplateDto[]).find((t) => t.code === 'CONC')!;
    const id = (await c.post(`/api/projects/${p}/sheets`, { templateVersionId: conc.versions[0]!.id, title: 'Paredes 1º pav.' }).expect(201)).body.id;
    let o = await ops();
    expect(o.pending.find((x) => x.id === id)).toMatchObject({ kind: 'SHEET', status: 'DRAFT', reasons: expect.arrayContaining(['sem item da EAP', 'sem âncora', 'sem linhas']) });
    let d = (await c.get(`/api/projects/${p}/sheets/${id}`).expect(200)).body as SheetDetailDto;
    const pav1 = s.nodes.find((n) => n.name === '1º pavimento' && s.nodes.find((x) => x.id === n.parentId)?.name === 'Torre A')!;
    await c.patch(`/api/projects/${p}/sheets/${id}`, { wbsNodeId: item.id, anchor: { kind: 'STRUCTURE_NODE', id: pav1.id }, rows: [{ elemento: { v: 'Paredes' }, comprimento: { v: '10' }, altura: { v: 'abc' }, espessura: { v: '10' } }] }, ifm(d.version)).expect(204);
    o = await ops();
    expect(o.pending.find((x) => x.id === id)!.reasons).toEqual(['1 linha(s) com erro']);
    d = (await c.get(`/api/projects/${p}/sheets/${id}`).expect(200)).body as SheetDetailDto;
    await c.patch(`/api/projects/${p}/sheets/${id}`, { rows: [{ elemento: { v: 'Paredes' }, comprimento: { v: '10' }, altura: { v: '2,7' }, espessura: { v: '10' } }] }, ifm(d.version)).expect(204);
    o = await ops();
    expect(o.pending.find((x) => x.id === id)!.reasons).toEqual(['pronta para lançar']);
    d = (await c.get(`/api/projects/${p}/sheets/${id}`).expect(200)).body as SheetDetailDto;
    await c.post(`/api/projects/${p}/sheets/${id}/launch`, {}, ifm(d.version)).expect(200);
    o = await ops();
    expect(o.pending.find((x) => x.id === id)).toBeUndefined();
    expect(o.counts.sheets).toMatchObject({ total: 1, launched: 1 });
    expect(o.coverage.measured).toBe(1);
    const g = o.coverage.groups.find((x) => x.measured === 1)!;
    expect(w.nodes.find((n) => n.id === g.wbsNodeId)!.parentId).toBeNull();
    // alterar depois do lançamento volta a ser pendência
    d = (await c.get(`/api/projects/${p}/sheets/${id}`).expect(200)).body as SheetDetailDto;
    await c.patch(`/api/projects/${p}/sheets/${id}`, { params: {} , rows: [{ elemento: { v: 'Paredes' }, comprimento: { v: '12' }, altura: { v: '2,7' }, espessura: { v: '10' } }] }, ifm(d.version)).expect(204);
    expect((await ops()).pending.find((x) => x.id === id)!.reasons).toEqual(['alterada após o lançamento']);
  });

  it('alterações desde a última revisão emitida e tarefas contadas', async () => {
    await c.post(`/api/projects/${p}/revisions`, { title: 'Emissão inicial' }).expect(201);
    let o = await ops();
    expect(o.revision.last).toMatchObject({ code: 'R00' });
    expect(o.revision.since).toEqual({ created: 0, revised: 0, archived: 0 });
    const forma = ((await c.get('/api/catalog/services?q=EST.003').expect(200)).body.items as ServiceDto[]).find((x) => x.code === 'EST.003')!;
    const pav2 = s.nodes.find((n) => n.name === '2º pavimento' && s.nodes.find((x) => x.id === n.parentId)?.name === 'Torre A')!;
    await c.post(`/api/projects/${p}/measurements`, { wbsNodeId: item.id, serviceId: forma.id, anchor: { kind: 'STRUCTURE_NODE', id: pav2.id }, calc: { method: 'MANUAL', value: '10', unit: 'm²' } }).expect(201);
    await c.post(`/api/projects/${p}/tasks`, { title: 'Revisar fôrmas', dueDate: '2020-01-01' }).expect(201);
    o = await ops();
    expect(o.revision.since.created).toBe(1);
    expect(o.tasks).toEqual({ byStatus: { TODO: 1, DOING: 0, REVIEW: 0, DONE: 0 }, overdue: 1, unassigned: 1 });
    expect(o.activity[0]!.entityType).toBe('WorkTask');
  });

  it('outra organização recebe 404', async () => {
    const x = await signup(app, 'Org Intrusa Painel');
    await x.get(`/api/projects/${p}/operations`).expect(404);
  });
});
