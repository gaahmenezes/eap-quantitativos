import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { consolidate, SCENARIO_B_HORIZONTAL, SCENARIO_C_LOTEAMENTO, CONSOLIDATION_DIMENSIONS, type ConsolidationDimension, type ConsolidationFilters } from '@eapq/domain';
import { CONSOLIDATION_DIMENSION_KEYS, type ConsolidationLinesDto, type ConsolidationResultDto, type ServiceDto, type StructureDto, type TypologyDto } from '@eapq/contracts';
import { ConsolidationService } from '../src/modules/consolidation/consolidation.service.js';
import { referenceLines } from '../src/modules/consolidation/reference.js';
import { bootApp, newProject, signup, type Client } from './helpers.js';

const { app, prisma } = await bootApp();
afterAll(() => app.close());
const svcRows = app.get(ConsolidationService);

const svc = async (c: Client, code: string) => ((await c.get(`/api/catalog/services?q=${code}`).expect(200)).body.items as ServiceDto[]).find((s) => s.code === code)!;
async function item(c: Client, p: string, title: string, serviceIds: string[]) {
  const n = (await c.post(`/api/projects/${p}/wbs/nodes`, { parentId: null, title, nodeType: 'ITEM' }).expect(201)).body;
  await c.put(`/api/projects/${p}/wbs/nodes/${n.id}/services`, { serviceIds }).expect(200);
  return n.id as string;
}
const manual = (value: string, unit: string) => ({ method: 'MANUAL', value, unit });

/** SQL × referência do domínio: mesmas linhas, mesmos totais. */
async function expectEquivalent(projectId: string, groupBy: ConsolidationDimension[], filters: ConsolidationFilters = {}) {
  const sql = await svcRows.rawRows(projectId, groupBy, filters as never);
  const lines = await referenceLines(prisma, projectId);
  const refFilters = Object.fromEntries(Object.entries(filters).map(([k, v]) => [k, v]));
  const nullable = Object.fromEntries(Object.entries(filters).filter(([, v]) => v?.includes('none')));
  // a referência não conhece "none": aplica-o à parte
  const ref = consolidate(lines.filter((l) => Object.keys(nullable).every((k) => (l.attrs[k as ConsolidationDimension] ?? null) === null || (filters[k as ConsolidationDimension] ?? []).includes(l.attrs[k as ConsolidationDimension]!))),
    groupBy, Object.fromEntries(Object.entries(refFilters).filter(([k]) => !nullable[k])) as ConsolidationFilters);
  expect(sql.truncated).toBe(false);
  expect(sql.rows, `agrupamento ${groupBy.join(',')}`).toEqual(ref);
  return sql.rows;
}

it('dimensões do contrato e do domínio são as mesmas', () => {
  expect([...CONSOLIDATION_DIMENSION_KEYS]).toEqual([...CONSOLIDATION_DIMENSIONS]);
});

describe('consolidação — cenário B (tipologias, particularidades, substituições)', () => {
  let c: Client;
  let p: string;
  let s: StructureDto;
  let typA: TypologyDto;
  let pisos: string;
  let muros: string;
  let piso: ServiceDto; let rodape: ServiceDto; let alv: ServiceDto;
  const unitsA = () => s.nodes.filter((n) => n.kind === 'DWELLING_UNIT' && n.typologyId === typA.id);
  const base = () => `/api/projects/${p}/measurements`;

  beforeAll(async () => {
    c = await signup(app, 'Org Consolidação B');
    p = (await c.post('/api/projects', { ...newProject(), classification: 'HORIZONTAL' }).expect(201)).body.id;
    await c.post(`/api/projects/${p}/structure/wizard/apply`, SCENARIO_B_HORIZONTAL).expect(201);
    typA = ((await c.get(`/api/projects/${p}/typologies`).expect(200)).body as TypologyDto[]).find((t) => t.code === 'A')!;
    const types = (await c.get('/api/catalog/element-types').expect(200)).body as { id: string; code: string }[];
    const T = (code: string) => types.find((t) => t.code === code)!.id;
    const tA = `/api/projects/${p}/typologies/${typA.id}`;
    const r1 = (await c.post(`${tA}/revisions`, {}).expect(201)).body;
    const sala = (await c.post(`${tA}/revisions/${r1.id}/elements`, { name: 'Sala', elementTypeId: T('AMBIENTE'), attributes: { area: '18.40' } }).expect(201)).body;
    const pisoEl = (await c.post(`${tA}/revisions/${r1.id}/elements`, { name: 'Piso da sala', elementTypeId: T('REVESTIMENTO'), attributes: { local: 'Piso' }, parentId: sala.id }).expect(201)).body;
    await c.post(`${tA}/revisions/${r1.id}/publish`, {}).expect(200);
    s = (await c.get(`/api/projects/${p}/structure`).expect(200)).body;
    await c.post(`${tA}/propagation`, { unitIds: unitsA().map((u) => u.id) }).expect(200);
    [piso, rodape, alv] = await Promise.all([svc(c, 'REV.004'), svc(c, 'REV.005'), svc(c, 'ALV.001')]);
    pisos = await item(c, p, 'Pisos e rodapés', [piso.id, rodape.id]);
    muros = await item(c, p, 'Muros de divisa', [alv.id]);
    const [u0, u1, u2, u3] = unitsA();
    const anchorPiso = { kind: 'TYPOLOGY_ELEMENT', typologyId: typA.id, elementKey: pisoEl.stableKey };
    await c.post(base(), { wbsNodeId: pisos, serviceId: piso.id, anchor: anchorPiso, calc: manual('18.40', 'm²') }).expect(201);
    await c.post(base(), { wbsNodeId: pisos, serviceId: piso.id, anchor: { ...anchorPiso, unitId: u0!.id }, calc: manual('20', 'm²') }).expect(201);
    await c.post(base(), { wbsNodeId: pisos, serviceId: rodape.id, anchor: { kind: 'TYPOLOGY_ELEMENT', typologyId: typA.id, elementKey: sala.stableKey }, calc: manual('1250', 'cm') }).expect(201);
    // u1 exclui a sala (e o piso, que é filho); u2 ganha uma varanda medida só nela
    await c.post(`/api/projects/${p}/units/${u1!.id}/overrides`, { op: 'EXCLUDE_ELEMENT', targetStableKey: sala.stableKey, reason: 'Planta modificada' }).expect(201);
    const add = (await c.post(`/api/projects/${p}/units/${u2!.id}/overrides`, { op: 'ADD_ELEMENT', parentStableKey: sala.stableKey, elementTypeId: T('REVESTIMENTO'), name: 'Piso da varanda', attributes: { local: 'Piso' }, reason: 'Opção do cliente' }).expect(201)).body;
    await c.post(base(), { wbsNodeId: pisos, serviceId: piso.id, anchor: { kind: 'TYPOLOGY_ELEMENT', typologyId: typA.id, elementKey: `unit:${add.id}`, unitId: u2!.id }, calc: manual('4.5', 'm²') }).expect(201);
    // u3 sai do cadastro
    const n3 = s.nodes.find((n) => n.id === u3!.id)!;
    await c.post(`/api/projects/${p}/structure/nodes/${n3.id}/archive`, { reason: 'Lote desmembrado' }, { 'If-Match': String(n3.version) }).expect(200);
    // muros: um lote da quadra 1 e a quadra 3 inteira
    const q1 = s.nodes.find((n) => n.kind === 'BLOCK_QUADRA' && n.name === 'Quadra 1')!;
    const q3 = s.nodes.find((n) => n.kind === 'BLOCK_QUADRA' && n.name === 'Quadra 3')!;
    const lot = s.nodes.find((n) => n.kind === 'LOT' && n.parentId === q1.id)!;
    await c.post(base(), { wbsNodeId: muros, serviceId: alv.id, anchor: { kind: 'STRUCTURE_NODE', id: lot.id }, calc: manual('33.3', 'm²') }).expect(201);
    await c.post(base(), { wbsNodeId: muros, serviceId: alv.id, anchor: { kind: 'STRUCTURE_NODE', id: q3.id }, calc: manual('50', 'm²') }).expect(201);
  });

  it('totais conhecidos: substituição não soma, particularidade e unidade arquivada saem da conta', async () => {
    const r = (await c.post(`/api/projects/${p}/consolidation`, { groupBy: ['service'] }).expect(200)).body as ConsolidationResultDto;
    const by = (code: string) => r.rows.find((x) => x.key.service!.label.startsWith(code))!;
    // 60 casas A − u1 (excluiu) − u3 (arquivada) − u0 (própria) = 57 × 18,40 + 20 + 4,5 (varanda de u2)
    expect(by('REV.004')).toMatchObject({ unit: 'm²', total: '1073.3', lines: 59, measurements: 3 });
    // rodapé 12,50 m em 58 casas (u0 conta; u1 e u3 não)
    expect(by('REV.005')).toMatchObject({ unit: 'm', total: '725', lines: 58 });
    expect(by('ALV.001')).toMatchObject({ unit: 'm²', total: '83.3', lines: 2 });
    expect(r.totals).toEqual([{ unit: 'm', total: '725' }, { unit: 'm²', total: '1156.6' }]);
  });

  it('total por tipologia × unidades = total geral (sem dupla contagem)', async () => {
    const r = (await c.post(`/api/projects/${p}/consolidation`, { groupBy: ['typology'], filters: { service: [piso.id] } }).expect(200)).body as ConsolidationResultDto;
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]).toMatchObject({ key: { typology: { id: typA.id, label: 'A — Casa tipo A' } }, total: '1073.3' });
    const perUnit = (await c.post(`/api/projects/${p}/consolidation`, { groupBy: ['unit'], filters: { service: [piso.id] } }).expect(200)).body as ConsolidationResultDto;
    expect(perUnit.rows).toHaveLength(58); // 57 pela medição geral + u0 pela própria
    expect(perUnit.totals).toEqual(r.totals);
    const u0 = perUnit.rows.find((x) => x.key.unit!.id === unitsA()[0]!.id)!;
    expect(u0.total).toBe('20');
    expect(perUnit.rows.find((x) => x.key.unit!.id === unitsA()[2]!.id)!.total).toBe('22.9'); // 18,40 + 4,50
  });

  it('equivalência SQL × referência do domínio em vários agrupamentos e filtros', async () => {
    const u0 = unitsA()[0]!.id;
    await expectEquivalent(p, []);
    await expectEquivalent(p, ['typology']);
    await expectEquivalent(p, ['service', 'typology']);
    await expectEquivalent(p, ['BLOCK_QUADRA', 'LOT']);
    await expectEquivalent(p, ['unit', 'service']);
    await expectEquivalent(p, ['wbs1', 'wbsItem', 'category']);
    await expectEquivalent(p, ['module', 'TOWER']);
    await expectEquivalent(p, ['typology'], { typology: [typA.id] });
    await expectEquivalent(p, ['service'], { unit: [u0] });
    await expectEquivalent(p, ['BLOCK_QUADRA'], { typology: ['none'] });
  });

  it('troca da unidade do serviço: mesma grandeza converte; outra grandeza é bloqueada', async () => {
    const cm = ((await c.get('/api/catalog/units').expect(200)).body as { id: string; symbol: string }[]).find((u) => u.symbol === 'cm')!;
    const m2 = ((await c.get('/api/catalog/units').expect(200)).body as { id: string; symbol: string }[]).find((u) => u.symbol === 'm²')!;
    const cur = (await c.get(`/api/catalog/services/${rodape.id}`).expect(200)).body;
    const bad = await c.patch(`/api/catalog/services/${rodape.id}`, { unitId: m2.id }, { 'If-Match': String(cur.version) }).expect(409);
    expect(bad.body.code).toBe('SERVICE_MEASURED');
    await c.patch(`/api/catalog/services/${rodape.id}`, { unitId: cm.id }, { 'If-Match': String(cur.version) }).expect(200);
    const r = (await c.post(`/api/projects/${p}/consolidation`, { groupBy: ['service'], filters: { service: [rodape.id] } }).expect(200)).body as ConsolidationResultDto;
    expect(r.rows[0]).toMatchObject({ unit: 'cm', total: '72500' });
    await expectEquivalent(p, ['service']);
  });

  it('detalhamento até a medição; isolamento entre organizações', async () => {
    const d = (await c.post(`/api/projects/${p}/consolidation/lines`, { filters: { service: [piso.id], unit: [unitsA()[2]!.id] } }).expect(200)).body as ConsolidationLinesDto;
    expect(d.total).toBe(2);
    expect(d.lines.map((l) => l.quantity).sort()).toEqual(['18.4', '4.5']);
    expect(d.lines[0]!.anchorLabel).toContain('Tipologia A');
    const other = await signup(app, 'Org Consolidação Intrusa');
    await other.post(`/api/projects/${p}/consolidation`, { groupBy: [] }).expect(404);
    await other.post(`/api/projects/${p}/consolidation/lines`, { filters: {} }).expect(404);
    await c.post(`/api/projects/${p}/consolidation`, { groupBy: ['service', 'service'] }).expect(422);
    await c.post(`/api/projects/${p}/consolidation`, { groupBy: ['drop table'] }).expect(422);
    await c.post(`/api/projects/${p}/consolidation`, { groupBy: [], filters: { service: ["x' OR 1=1"] } }).expect(422);
  });
});

describe('consolidação — cenário C (infraestrutura)', () => {
  it('por sistema, rede, rua e fase; equivalência com a referência', async () => {
    const c = await signup(app, 'Org Consolidação C');
    const p = (await c.post('/api/projects', { ...newProject(), classification: 'LOTEAMENTO' }).expect(201)).body.id as string;
    await c.post(`/api/projects/${p}/structure/wizard/apply`, SCENARIO_C_LOTEAMENTO).expect(201);
    const s = (await c.get(`/api/projects/${p}/structure`).expect(200)).body as StructureDto;
    const st = (await c.get('/api/catalog/system-types').expect(200)).body as { id: string; code: string }[];
    const types = (await c.get('/api/catalog/element-types').expect(200)).body as { id: string; code: string }[];
    const T = (code: string) => types.find((t) => t.code === code)!.id;
    const S = (code: string) => st.find((t) => t.code === code)!.id;
    const sections = s.nodes.filter((n) => n.kind === 'STREET_SECTION');
    const dren = (await c.post(`/api/projects/${p}/infrastructure/systems`, { systemTypeId: S('DRENAGEM'), name: 'Drenagem' }).expect(201)).body.id;
    const net = (await c.post(`/api/projects/${p}/infrastructure/systems/${dren}/networks`, { code: 'D-01', name: 'Av. Principal' }).expect(201)).body.id;
    const pv = async (code: string) => (await c.post(`/api/projects/${p}/infrastructure/networks/${net}/nodes`, { elementTypeId: T('PV-DREN'), code, coverElevation: '100', bottomElevation: '98.5', locationNodeId: sections[0]!.id, attributes: {} }).expect(201)).body.id as string;
    const [a, b] = [await pv('PV-01'), await pv('PV-02')];
    const seg = (await c.post(`/api/projects/${p}/infrastructure/networks/${net}/segments`, { elementTypeId: T('TUBO-DREN'), code: 'T-01', fromNodeId: a, toNodeId: b, length: '50', streetSectionId: sections[1]!.id, attributes: {} }).expect(201)).body.id;
    const guias = (await c.post(`/api/projects/${p}/infrastructure/systems`, { systemTypeId: S('GUIAS_SARJETAS'), name: 'Guias' }).expect(201)).body.id;
    const guia = (await c.post(`/api/projects/${p}/elements`, { elementTypeId: T('GUIA'), name: 'Guia da rua 1', systemId: guias, structureNodeId: sections[0]!.id, attributes: { comprimento: '120' } }).expect(201)).body.id;
    const [tubo, poco, guiaSvc] = await Promise.all([svc(c, 'DRE.002'), svc(c, 'DRE.003'), svc(c, 'GUI.001').catch(() => null)]);
    const svcIds = [tubo.id, poco.id, ...(guiaSvc ? [guiaSvc.id] : [])];
    const w = await item(c, p, 'Infraestrutura', svcIds);
    const base = `/api/projects/${p}/measurements`;
    await c.post(base, { wbsNodeId: w, serviceId: tubo.id, anchor: { kind: 'NETWORK_SEGMENT', id: seg }, calc: manual('50', 'm') }).expect(201);
    await c.post(base, { wbsNodeId: w, serviceId: poco.id, anchor: { kind: 'NETWORK_NODE', id: a }, calc: manual('1', 'un') }).expect(201);
    await c.post(base, { wbsNodeId: w, serviceId: poco.id, anchor: { kind: 'NETWORK_NODE', id: b }, calc: manual('1', 'un') }).expect(201);
    if (guiaSvc) await c.post(base, { wbsNodeId: w, serviceId: guiaSvc.id, anchor: { kind: 'PHYSICAL_ELEMENT', id: guia }, calc: manual('120', guiaSvc.unitSymbol) }).expect(201);
    const r = (await c.post(`/api/projects/${p}/consolidation`, { groupBy: ['system', 'service'] }).expect(200)).body as ConsolidationResultDto;
    expect(r.rows.find((x) => x.key.service!.label.startsWith('DRE.003'))).toMatchObject({ key: { system: { id: dren, label: 'Drenagem' } }, total: '2', unit: 'un' });
    await expectEquivalent(p, ['system', 'network']);
    await expectEquivalent(p, ['STREET', 'service']);
    await expectEquivalent(p, ['PHASE', 'BLOCK_QUADRA']);
    await expectEquivalent(p, ['network'], { network: ['none'] });
  });
});
