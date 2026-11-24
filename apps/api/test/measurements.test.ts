import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SCENARIO_A_VERTICAL, SCENARIO_B_HORIZONTAL } from '@eapq/domain';
import type { FormulaDto, MeasurementDetailDto, MeasurementDto, MeasurementSummaryDto, ServiceDto, StructureDto, TemplateDto, TypologyDto, WbsDto, WbsNodeDto, WbsPlanDto } from '@eapq/contracts';
import { bootApp, inviteAndJoin, newProject, signup, type Client } from './helpers.js';

const { app, prisma } = await bootApp();
afterAll(() => app.close());

const byKindCode: Record<string, string> = { VERTICAL_RESIDENTIAL: 'EAP-VERT', HORIZONTAL_RESIDENTIAL: 'EAP-HORIZ', LAND_SUBDIVISION: 'EAP-LOT', COMMON_AREAS: 'EAP-AREAS', INFRASTRUCTURE: 'EAP-INFRA' };
async function selections(c: Client, p: string) {
  const s = (await c.get(`/api/projects/${p}/structure`).expect(200)).body as StructureDto;
  const tpls = (await c.get('/api/wbs-templates').expect(200)).body as TemplateDto[];
  return s.modules.map((m) => ({ moduleId: m.id, templateVersionId: tpls.find((x) => x.code === byKindCode[m.kind])!.versions.find((v) => v.status === 'PUBLISHED')!.id }));
}
async function generate(c: Client, p: string) {
  const sel = await selections(c, p);
  const plan = (await c.post(`/api/projects/${p}/wbs/preview`, { selections: sel }).expect(200)).body as WbsPlanDto;
  await c.post(`/api/projects/${p}/wbs/apply`, { selections: sel, planHash: plan.planHash }).expect(200);
}
const wbs = async (c: Client, p: string) => (await c.get(`/api/projects/${p}/wbs`).expect(200)).body as WbsDto;
const pathTitles = (w: WbsDto, n: WbsNodeDto) => { const t: string[] = []; let cur: WbsNodeDto | undefined = n; while (cur) { t.unshift(cur.title); cur = w.nodes.find((x) => x.id === cur!.parentId); } return t.join(' › '); };
const svc = async (c: Client, code: string) => ((await c.get(`/api/catalog/services?q=${code}`).expect(200)).body.items as ServiceDto[]).find((s) => s.code === code)!;

describe('fórmulas versionadas', () => {
  let c: Client;
  beforeAll(async () => { c = await signup(app, 'Org Fórmulas'); });

  it('organização nova recebe fórmulas iniciais publicadas', async () => {
    const list = (await c.get('/api/formulas').expect(200)).body as FormulaDto[];
    expect(list.map((f) => f.code)).toEqual(['AREA-PAREDE', 'AREA-RET', 'COMP-LINEAR', 'VOL-PRISMA', 'VOL-VALA']);
    expect(list.find((f) => f.code === 'VOL-VALA')!.versions[0]).toMatchObject({ number: 1, status: 'PUBLISHED', resultDescription: 'Volume' });
  });

  it('rascunho inválido não publica; publicada é imutável; teste da fórmula sem gravar', async () => {
    const f = (await c.post('/api/formulas', { code: 'teste', name: 'Teste', expression: 'a + b', variables: [{ symbol: 'a', label: 'A', unit: 'm' }, { symbol: 'b', label: 'B', unit: 'm²' }] }).expect(201)).body;
    const bad = await c.post(`/api/formulas/${f.id}/versions/${f.versionId}/publish`, {}).expect(422);
    expect(bad.body.code).toBe('FORMULA_INVALID');
    expect(bad.body.detail).toContain('Não é possível somar comprimento e área');
    const listed = ((await c.get('/api/formulas').expect(200)).body as FormulaDto[]).find((x) => x.code === 'TESTE')!;
    expect(listed.versions[0]!.issues.length).toBeGreaterThan(0);
    await c.patch(`/api/formulas/${f.id}/versions/${f.versionId}`, { expression: 'a * b' }).expect(204);
    await c.post(`/api/formulas/${f.id}/versions/${f.versionId}/publish`, {}).expect(204);
    await c.patch(`/api/formulas/${f.id}/versions/${f.versionId}`, { expression: 'a * a * a' }).expect(409);
    await expect(prisma.$executeRaw`UPDATE formula_version SET expression = 'a' WHERE id = ${f.versionId}::uuid`).rejects.toThrow(/imutável/);
    const ev = (await c.post('/api/formulas/evaluate', { expression: 'a * b', variables: [{ symbol: 'a', label: 'A', unit: 'm' }, { symbol: 'b', label: 'B', unit: 'm²' }], inputs: [{ symbol: 'a', value: '50', unit: 'cm' }, { symbol: 'b', value: '2', unit: 'm²' }], unit: 'm³' }).expect(200)).body;
    expect(ev).toMatchObject({ quantity: '1', unit: 'm³', memory: { substituted: '0.5 m × 2 m²' } });
    await c.post('/api/formulas/evaluate', { expression: 'a', variables: [{ symbol: 'a', label: 'A', unit: 'm' }], inputs: [{ symbol: 'a', value: '1', unit: 'm' }], unit: 'kg' }).expect(422);
  });

  it('membro sem papel administrativo lê mas não cria; outra organização não vê', async () => {
    const m = await inviteAndJoin(app, c, 'MEMBER');
    await m.get('/api/formulas').expect(200);
    await m.post('/api/formulas', { code: 'X', name: 'X', expression: 'a', variables: [{ symbol: 'a', label: 'A', unit: 'm' }] }).expect(403);
    const other = await signup(app, 'Org Fórmulas B');
    const list = (await other.get('/api/formulas').expect(200)).body as FormulaDto[];
    expect(list.find((x) => x.code === 'TESTE')).toBeUndefined();
    const mine = ((await c.get('/api/formulas').expect(200)).body as FormulaDto[]).find((x) => x.code === 'TESTE')!;
    await other.post(`/api/formulas/${mine.id}/versions`, {}).expect(404);
  });
});

describe('medições — cenário A (vertical)', () => {
  let c: Client;
  let p: string;
  let w: WbsDto;
  let item: WbsNodeDto; // Estrutura de concreto armado do 1º pavimento da Torre A
  let s: StructureDto;
  let forma: ServiceDto;
  let aco: ServiceDto;
  let formulas: FormulaDto[];
  const base = () => `/api/projects/${p}/measurements`;
  const node = (name: string, parentName?: string) => s.nodes.find((n) => n.name === name && (!parentName || s.nodes.find((x) => x.id === n.parentId)?.name === parentName))!;

  beforeAll(async () => {
    c = await signup(app, 'Org Medições A');
    p = (await c.post('/api/projects', newProject()).expect(201)).body.id;
    await c.post(`/api/projects/${p}/structure/wizard/apply`, SCENARIO_A_VERTICAL).expect(201);
    await generate(c, p);
    w = await wbs(c, p);
    s = (await c.get(`/api/projects/${p}/structure`).expect(200)).body;
    item = w.nodes.find((n) => n.title === 'Estrutura de concreto armado' && pathTitles(w, n).includes('Torre A › Estrutura › 1º pavimento'))!;
    forma = await svc(c, 'EST.003');
    aco = await svc(c, 'EST.002');
    formulas = (await c.get('/api/formulas').expect(200)).body;
  });

  it('medição por fórmula com conversão de unidade e memória de cálculo', async () => {
    const areaRet = formulas.find((f) => f.code === 'AREA-RET')!.versions[0]!;
    const calc = { method: 'FORMULA', formulaVersionId: areaRet.id, inputs: [{ symbol: 'c', value: '420', unit: 'cm' }, { symbol: 'l', value: '3,00', unit: 'm' }] };
    const prev = (await c.post(`${base()}/preview`, { serviceId: forma.id, calc }).expect(200)).body;
    expect(prev).toMatchObject({ quantity: '12.6', unit: 'm²' });
    const m = (await c.post(base(), { wbsNodeId: item.id, serviceId: forma.id, anchor: { kind: 'STRUCTURE_NODE', id: node('1º pavimento', 'Torre A').id }, calc, sourceReference: 'EST-01 rev. B' }).expect(201)).body;
    const d = (await c.get(`${base()}/${m.id}`).expect(200)).body as MeasurementDetailDto;
    expect(d).toMatchObject({ quantity: '12.6', unit: 'm²', multiplier: 1, effectiveTotal: '12.6', formulaOutdated: null, current: { number: 1, method: 'FORMULA', sourceReference: 'EST-01 rev. B' } });
    expect(d.current.memory).toMatchObject({ expression: 'c * l', substituted: '4.2 m × 3 m', formula: { code: 'AREA-RET', versionNumber: 1 } });
    expect(d.anchor.label).toContain('1º pavimento');
    const audit = await prisma.auditLog.findFirst({ where: { entityType: 'Measurement', entityId: m.id, action: 'CREATE' } });
    expect(audit).not.toBeNull();
  });

  it('medição manual em t convertida para kg; unidade incompatível é rejeitada', async () => {
    const anchor = { kind: 'STRUCTURE_NODE', id: node('1º pavimento', 'Torre A').id };
    await c.post(base(), { wbsNodeId: item.id, serviceId: aco.id, anchor, calc: { method: 'MANUAL', value: '1,25', unit: 'm' } }).expect(422);
    const m = (await c.post(base(), { wbsNodeId: item.id, serviceId: aco.id, anchor, calc: { method: 'MANUAL', value: '1,25', unit: 't' } }).expect(201)).body;
    expect(((await c.get(`${base()}/${m.id}`).expect(200)).body as MeasurementDto).quantity).toBe('1250');
  });

  it('dupla contagem é bloqueada (ancestral, igual); âncora disjunta é aceita', async () => {
    const calc = { method: 'MANUAL', value: '10', unit: 'm²' };
    const torre = await c.post(base(), { wbsNodeId: item.id, serviceId: forma.id, anchor: { kind: 'STRUCTURE_NODE', id: node('Torre A').id }, calc }).expect(409);
    expect(torre.body.code).toBe('MEASUREMENT_OVERLAP');
    await c.post(base(), { wbsNodeId: item.id, serviceId: forma.id, anchor: { kind: 'STRUCTURE_NODE', id: node('1º pavimento', 'Torre A').id }, calc }).expect(409);
    await c.post(base(), { wbsNodeId: item.id, serviceId: forma.id, anchor: { kind: 'STRUCTURE_NODE', id: node('2º pavimento', 'Torre A').id }, calc }).expect(201);
    const sum = (await c.get(`${base()}/summary`).expect(200)).body as MeasurementSummaryDto;
    expect(sum.items.find((i) => i.wbsNodeId === item.id && i.serviceId === forma.id)).toMatchObject({ count: 2, total: '22.6', unit: 'm²' });
  });

  it('regras de entrada: agrupador, serviço não vinculado, âncora de outro empreendimento', async () => {
    const group = w.nodes.find((n) => n.nodeType === 'GROUP')!;
    const anchor = { kind: 'STRUCTURE_NODE', id: node('3º pavimento', 'Torre A').id };
    const calc = { method: 'MANUAL', value: '1', unit: 'm²' };
    await c.post(base(), { wbsNodeId: group.id, serviceId: forma.id, anchor, calc }).expect(422);
    await c.post(base(), { wbsNodeId: item.id, serviceId: (await svc(c, 'ALV.001')).id, anchor, calc }).expect(422);
    const p2 = (await c.post('/api/projects', newProject()).expect(201)).body.id;
    await c.post(`/api/projects/${p2}/structure/wizard/apply`, SCENARIO_A_VERTICAL).expect(201);
    const s2 = (await c.get(`/api/projects/${p2}/structure`).expect(200)).body as StructureDto;
    await c.post(base(), { wbsNodeId: item.id, serviceId: forma.id, anchor: { kind: 'STRUCTURE_NODE', id: s2.nodes[0]!.id }, calc }).expect(404);
  });

  it('revisão guarda a anterior; memória é imutável; nova versão de fórmula sinaliza recálculo explícito', async () => {
    const [m] = ((await c.get(`${base()}?wbsNodeId=${item.id}&serviceId=${forma.id}`).expect(200)).body as MeasurementDto[]).filter((x) => x.current.method === 'FORMULA');
    const f = formulas.find((x) => x.code === 'AREA-RET')!;
    const v2 = (await c.post(`/api/formulas/${f.id}/versions`, {}).expect(201)).body;
    await c.patch(`/api/formulas/${f.id}/versions/${v2.id}`, { expression: 'c * l * fator', variables: [...f.versions[0]!.variables, { symbol: 'fator', label: 'Fator de perdas', unit: '%' }] }).expect(204);
    await c.post(`/api/formulas/${f.id}/versions/${v2.id}/publish`, {}).expect(204);
    // nada muda sozinho
    const still = (await c.get(`${base()}/${m!.id}`).expect(200)).body as MeasurementDetailDto;
    expect(still).toMatchObject({ quantity: '12.6', formulaOutdated: { latestVersionId: v2.id, latestNumber: 2 } });
    const outdated = (await c.get(`${base()}?outdated=true`).expect(200)).body as MeasurementDto[];
    expect(outdated.map((x) => x.id)).toEqual([m!.id]);
    const calc = { method: 'FORMULA', formulaVersionId: v2.id, inputs: [{ symbol: 'c', value: '4.2', unit: 'm' }, { symbol: 'l', value: '3', unit: 'm' }, { symbol: 'fator', value: '105', unit: '%' }] };
    await c.post(`${base()}/${m!.id}/revisions`, { calc, reason: 'Recálculo com perdas' }).expect(428);
    await c.post(`${base()}/${m!.id}/revisions`, { calc, reason: 'Recálculo com perdas' }, { 'If-Match': String(still.version + 5) }).expect(409);
    await c.post(`${base()}/${m!.id}/revisions`, { calc }, { 'If-Match': String(still.version) }).expect(422); // motivo obrigatório
    await c.post(`${base()}/${m!.id}/revisions`, { calc, reason: 'Recálculo com perdas' }, { 'If-Match': String(still.version) }).expect(204);
    const d = (await c.get(`${base()}/${m!.id}`).expect(200)).body as MeasurementDetailDto;
    expect(d).toMatchObject({ quantity: '13.23', formulaOutdated: null, current: { number: 2, reason: 'Recálculo com perdas' } });
    expect(d.revisions.map((r) => [r.number, r.quantity])).toEqual([[2, '13.23'], [1, '12.6']]);
    await expect(prisma.$executeRaw`UPDATE measurement_revision SET quantity = 1 WHERE "measurementId" = ${m!.id}::uuid`).rejects.toThrow(/imutáveis/);
    await expect(prisma.$executeRaw`DELETE FROM measurement WHERE id = ${m!.id}::uuid`).rejects.toThrow(/não são apagadas/);
    const mem = (await c.get(`${base()}/revisions?q=EST.003`).expect(200)).body;
    expect(mem.total).toBe(3);
    expect(mem.items[0]).toMatchObject({ serviceCode: 'EST.003', wbsTitle: 'Estrutura de concreto armado' });
  });

  it('item da EAP com medição: não é excluído, serviço não é desvinculado e fica obsoleto (não removido) na regeneração', async () => {
    await c.post(`/api/projects/${p}/wbs/nodes/${item.id}/archive`, { reason: 'x' }, { 'If-Match': String(item.version) }).expect(409);
    await c.put(`/api/projects/${p}/wbs/nodes/${item.id}/services`, { serviceIds: [aco.id] }).expect(409);
    // remove o 1º pavimento da Torre A do cadastro: o item gerado deixaria de existir
    const pav = node('1º pavimento', 'Torre A');
    await c.post(`/api/projects/${p}/structure/nodes/${pav.id}/archive`, { reason: 'revisão de projeto' }, { 'If-Match': String(pav.version) }).expect(200);
    const sel = await selections(c, p);
    const plan = (await c.post(`/api/projects/${p}/wbs/preview`, { selections: sel }).expect(200)).body as WbsPlanDto;
    expect(plan.obsolete.map((o) => o.id)).toContain(item.id);
    expect(plan.remove.map((r) => r.id)).not.toContain(item.id);
    const list = (await c.get(`${base()}?wbsNodeId=${item.id}`).expect(200)).body as MeasurementDto[];
    expect(list.every((m) => m.anchor.archived || m.anchor.label.includes('2º'))).toBe(true);
  });

  it('arquivar e restaurar medição (com verificação de sobreposição); isolamento e papéis', async () => {
    const [m] = (await c.get(`${base()}?wbsNodeId=${item.id}&serviceId=${aco.id}`).expect(200)).body as MeasurementDto[];
    await c.post(`${base()}/${m!.id}/archive`, { reason: 'medido em duplicidade' }, { 'If-Match': String(m!.version) }).expect(204);
    expect(((await c.get(`${base()}?wbsNodeId=${item.id}&serviceId=${aco.id}`).expect(200)).body as MeasurementDto[])).toHaveLength(0);
    await c.post(`${base()}/${m!.id}/unarchive`, {}, { 'If-Match': String(m!.version + 1) }).expect(204);

    const other = await signup(app, 'Org Medições Intrusa');
    await other.get(`${base()}/${m!.id}`).expect(404);
    await other.get(base()).expect(404);
    await other.post(base(), { wbsNodeId: item.id, serviceId: forma.id, anchor: { kind: 'STRUCTURE_NODE', id: node('Torre B').id }, calc: { method: 'MANUAL', value: '1', unit: 'm²' } }).expect(404);

    const viewer = await inviteAndJoin(app, c, 'MEMBER');
    const org = await prisma.project.findUniqueOrThrow({ where: { id: p } });
    await prisma.projectMember.create({ data: { organizationId: org.organizationId, projectId: p, userId: viewer.userId, role: 'VIEWER' } });
    await viewer.get(`${base()}/${m!.id}`).expect(200);
    await viewer.post(base(), { wbsNodeId: item.id, serviceId: forma.id, anchor: { kind: 'STRUCTURE_NODE', id: node('Torre B').id }, calc: { method: 'MANUAL', value: '1', unit: 'm²' } }).expect(403);
  });
});

describe('medições — cenário B (replicação por tipologia)', () => {
  let c: Client;
  let p: string;
  let typA: TypologyDto;
  let s: StructureDto;
  let item: WbsNodeDto;
  let piso: ServiceDto;
  let key: string;
  const base = () => `/api/projects/${p}/measurements`;
  const unitsA = () => s.nodes.filter((n) => n.kind === 'DWELLING_UNIT' && n.typologyId === typA.id);

  beforeAll(async () => {
    c = await signup(app, 'Org Medições B');
    p = (await c.post('/api/projects', { ...newProject(), classification: 'HORIZONTAL' }).expect(201)).body.id;
    await c.post(`/api/projects/${p}/structure/wizard/apply`, SCENARIO_B_HORIZONTAL).expect(201);
    typA = ((await c.get(`/api/projects/${p}/typologies`).expect(200)).body as TypologyDto[]).find((t) => t.code === 'A')!;
    const types = (await c.get('/api/catalog/element-types').expect(200)).body as { id: string; code: string }[];
    const T = (code: string) => types.find((t) => t.code === code)!.id;
    const tA = `/api/projects/${p}/typologies/${typA.id}`;
    const r1 = (await c.post(`${tA}/revisions`, {}).expect(201)).body;
    const sala = (await c.post(`${tA}/revisions/${r1.id}/elements`, { name: 'Sala', elementTypeId: T('AMBIENTE'), attributes: { area: '18.40' } }).expect(201)).body;
    const pisoEl = (await c.post(`${tA}/revisions/${r1.id}/elements`, { name: 'Piso da sala', elementTypeId: T('REVESTIMENTO'), attributes: { local: 'Piso' }, parentId: sala.id }).expect(201)).body;
    key = pisoEl.stableKey;
    await c.post(`${tA}/revisions/${r1.id}/publish`, {}).expect(200);
    s = (await c.get(`/api/projects/${p}/structure`).expect(200)).body;
    await c.post(`${tA}/propagation`, { unitIds: unitsA().map((u) => u.id) }).expect(200);
    await generate(c, p);
    const w = await wbs(c, p);
    item = w.nodes.find((n) => n.title === 'Contrapiso, pisos e rodapés' && pathTitles(w, n).includes('Casas A'))!;
    piso = await svc(c, 'REV.004');
  });

  it('medição da tipologia vale × 60 unidades; medição própria de uma unidade substitui (não soma)', async () => {
    const anchor = { kind: 'TYPOLOGY_ELEMENT', typologyId: typA.id, elementKey: key };
    const g = (await c.post(base(), { wbsNodeId: item.id, serviceId: piso.id, anchor, calc: { method: 'MANUAL', value: '18.40', unit: 'm²' } }).expect(201)).body;
    let d = (await c.get(`${base()}/${g.id}`).expect(200)).body as MeasurementDto;
    expect(d).toMatchObject({ multiplier: 60, effectiveTotal: '1104' });
    const u0 = unitsA()[0]!;
    await c.post(base(), { wbsNodeId: item.id, serviceId: piso.id, anchor: { ...anchor, unitId: u0.id }, calc: { method: 'MANUAL', value: '20', unit: 'm²' } }).expect(201);
    await c.post(base(), { wbsNodeId: item.id, serviceId: piso.id, anchor: { ...anchor, unitId: u0.id }, calc: { method: 'MANUAL', value: '21', unit: 'm²' } }).expect(409);
    d = (await c.get(`${base()}/${g.id}`).expect(200)).body as MeasurementDto;
    expect(d).toMatchObject({ multiplier: 59, replacedUnits: 1, effectiveTotal: '1085.6' });
    const sum = (await c.get(`${base()}/summary`).expect(200)).body as MeasurementSummaryDto;
    expect(sum.items.find((i) => i.wbsNodeId === item.id)).toMatchObject({ total: '1105.6' }); // 59 × 18,40 + 20
  });

  it('medir a unidade inteira ou o lote junto com a tipologia é dupla contagem', async () => {
    const u5 = unitsA()[5]!;
    const lote = s.nodes.find((n) => n.id === u5.parentId)!;
    const calc = { method: 'MANUAL', value: '5', unit: 'm²' };
    await c.post(base(), { wbsNodeId: item.id, serviceId: piso.id, anchor: { kind: 'STRUCTURE_NODE', id: u5.id }, calc }).expect(409);
    await c.post(base(), { wbsNodeId: item.id, serviceId: piso.id, anchor: { kind: 'STRUCTURE_NODE', id: lote.id }, calc }).expect(409);
    // casa de outra tipologia não conflita
    const typB = s.nodes.find((n) => n.kind === 'DWELLING_UNIT' && n.typologyId && n.typologyId !== typA.id)!;
    await c.post(base(), { wbsNodeId: item.id, serviceId: piso.id, anchor: { kind: 'STRUCTURE_NODE', id: typB.id }, calc }).expect(201);
  });

  it('particularidade que exclui o elemento tira a unidade da conta', async () => {
    const u1 = unitsA()[1]!;
    await c.post(`/api/projects/${p}/units/${u1.id}/overrides`, { op: 'EXCLUDE_ELEMENT', targetStableKey: key, reason: 'Piso fornecido pelo cliente' }).expect(201);
    const sum = (await c.get(`${base()}/summary`).expect(200)).body as MeasurementSummaryDto;
    // 58 × 18,40 + 20 + 5 (casa tipo B)
    expect(sum.items.find((i) => i.wbsNodeId === item.id)).toMatchObject({ total: '1092.2', count: 3 });
    const anchors = (await c.get(`${base()}/anchors`).expect(200)).body;
    expect(anchors.typologies.find((t: { id: string }) => t.id === typA.id).elements.map((e: { label: string }) => e.label)).toEqual(['Sala', 'Piso da sala']);
  });
});
