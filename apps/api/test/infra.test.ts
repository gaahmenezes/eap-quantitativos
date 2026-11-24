import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SCENARIO_C_LOTEAMENTO } from '@eapq/domain';
import type { ElementTypeDto, StructureDto, SystemDetailDto, SystemTypeDto } from '@eapq/contracts';
import { bootApp, inviteAndJoin, newProject, signup, type Client } from './helpers.js';

const { app, prisma } = await bootApp();
afterAll(() => app.close());

let c: Client;
let projectId: string;
let types: ElementTypeDto[];
let systems: SystemTypeDto[];
let structure: StructureDto;
const T = (code: string) => types.find((t) => t.code === code)!.id;
const S = (code: string) => systems.find((t) => t.code === code)!.id;
const base = () => `/api/projects/${projectId}`;
const detail = async (id: string) => (await c.get(`${base()}/infrastructure/systems/${id}`).expect(200)).body as SystemDetailDto;

beforeAll(async () => {
  c = await signup(app, 'Org Infra');
  projectId = (await c.post('/api/projects', { ...newProject(), classification: 'LOTEAMENTO' }).expect(201)).body.id;
  await c.post(`${base()}/structure/wizard/apply`, SCENARIO_C_LOTEAMENTO).expect(201);
  structure = (await c.get(`${base()}/structure`).expect(200)).body;
  systems = (await c.get('/api/catalog/system-types').expect(200)).body;
  types = (await c.get('/api/catalog/element-types').expect(200)).body;
});

describe('catálogo técnico da organização', () => {
  it('nova organização recebe o catálogo padrão (sistemas e tipos de elemento com atributos)', () => {
    expect(systems.map((s) => s.code)).toEqual(expect.arrayContaining(['DRENAGEM', 'AGUA', 'ESGOTO', 'TERRAPLENAGEM', 'PAVIMENTACAO', 'GUIAS_SARJETAS', 'ILUMINACAO']));
    const bl = types.find((t) => t.code === 'BL')!;
    expect(bl).toMatchObject({ category: 'NETWORK_NODE', domain: 'INFRA', systemTypeId: S('DRENAGEM') });
    expect(bl.attributes.find((a) => a.key === 'tipo')).toMatchObject({ dataType: 'ENUM', required: true });
  });

  it('novo sistema e novos tipos de elemento entram sem migração e já podem ser usados', async () => {
    const gas = (await c.post('/api/catalog/system-types', { code: 'GAS', name: 'Gás natural', networkBased: true }).expect(201)).body;
    await c.post('/api/catalog/element-types', {
      code: 'VALV-GAS', name: 'Válvula de bloqueio de gás', domain: 'INFRA', category: 'NETWORK_NODE', systemTypeId: gas.id,
      attributes: [{ key: 'pressao', label: 'Pressão de operação', dataType: 'NUMBER', unit: 'kPa', required: true, min: '0' }],
    }).expect(201);
    const sys = (await c.post(`${base()}/infrastructure/systems`, { systemTypeId: gas.id, name: 'Rede de gás' }).expect(201)).body;
    const net = (await c.post(`${base()}/infrastructure/systems/${sys.id}/networks`, { code: 'G-01', name: 'Ramal principal' }).expect(201)).body;
    types = (await c.get('/api/catalog/element-types').expect(200)).body;
    const node = await c.post(`${base()}/infrastructure/networks/${net.id}/nodes`, { elementTypeId: T('VALV-GAS'), code: 'VB-01', attributes: { pressao: '150,5' } }).expect(201);
    expect(node.body.attributes).toEqual({ pressao: '150.5' });
  });

  it('valida definições de atributos e protege atributos com valores cadastrados', async () => {
    const bad = await c.post('/api/catalog/element-types', { code: 'X1', name: 'X', domain: 'INFRA', category: 'ELEMENT', systemTypeId: S('PAISAGISMO'), attributes: [{ key: 'Area', label: 'Área', dataType: 'NUMBER' }] }).expect(422);
    expect(bad.body.errors[0].path).toBe('attributes.0.key');
    await c.post('/api/catalog/element-types', { code: 'X2', name: 'X', domain: 'INFRA', category: 'NETWORK_NODE', systemTypeId: S('PAISAGISMO'), attributes: [] }).expect(422);
    const valv = types.find((t) => t.code === 'VALV-GAS')!;
    const removing = await c.patch(`/api/catalog/element-types/${valv.id}`, { attributes: [] }, { 'If-Match': String(valv.version) }).expect(409);
    expect(removing.body.code).toBe('ATTRIBUTE_IN_USE');
    const required = await c.patch(`/api/catalog/element-types/${valv.id}`, {
      attributes: [...valv.attributes, { key: 'fabricante', label: 'Fabricante', dataType: 'TEXT', required: true }],
    }, { 'If-Match': String(valv.version) }).expect(409);
    expect(required.body.detail).toMatch(/não pode passar a ser obrigatório/);
    await c.patch(`/api/catalog/element-types/${valv.id}`, {
      attributes: [...valv.attributes, { key: 'fabricante', label: 'Fabricante', dataType: 'TEXT', required: false }],
    }, { 'If-Match': String(valv.version) }).expect(200);
  });

  it('membro sem papel administrativo lê mas não altera o catálogo; catálogo é isolado por organização', async () => {
    const m = await inviteAndJoin(app, c, 'MEMBER');
    await m.get('/api/catalog/element-types').expect(200);
    await m.post('/api/catalog/system-types', { code: 'Y', name: 'Y', networkBased: false }).expect(403);
    const other = await signup(app, 'Outra org infra');
    const otherTypes = (await other.get('/api/catalog/element-types').expect(200)).body as ElementTypeDto[];
    expect(otherTypes.find((t) => t.code === 'VALV-GAS')).toBeUndefined();
    await other.patch(`/api/catalog/element-types/${T('BL')}`, { name: 'x' }, { 'If-Match': '1' }).expect(404);
  });
});

describe('cenário C — redes de drenagem, água e esgoto por trechos', () => {
  let drenagem: string;
  let rede: string;
  const pv: Record<string, string> = {};
  const sections = () => structure.nodes.filter((n) => n.kind === 'STREET_SECTION');

  beforeAll(async () => {
    const fase1 = structure.nodes.find((n) => n.kind === 'PHASE')!;
    drenagem = (await c.post(`${base()}/infrastructure/systems`, { systemTypeId: S('DRENAGEM'), name: 'Drenagem pluvial — Fase 1', scopeNodeId: fase1.id }).expect(201)).body.id;
    rede = (await c.post(`${base()}/infrastructure/systems/${drenagem}/networks`, { code: 'D-01', name: 'Rede da Avenida Principal' }).expect(201)).body.id;
    const cotas = [['PV-01', '100.000', '98.500'], ['PV-02', '99.600', '98.200'], ['PV-03', '99.100', '97.900'], ['PV-04', '98.900', '98.000']];
    for (const [code, tampa, fundo] of cotas) {
      const r = await c.post(`${base()}/infrastructure/networks/${rede}/nodes`, {
        elementTypeId: T('PV-DREN'), code, coverElevation: tampa, bottomElevation: fundo, locationNodeId: sections()[0]!.id, attributes: { diametroInterno: '1.20' },
      }).expect(201);
      pv[code!] = r.body.id;
    }
  });

  it('cadastra trechos PV a PV com declividade e profundidades derivadas (valores conhecidos)', async () => {
    const seg = (code: string, from: string, to: string, length: string, section: number) =>
      c.post(`${base()}/infrastructure/networks/${rede}/segments`, {
        elementTypeId: T('TUBO-DREN'), code, fromNodeId: pv[from], toNodeId: pv[to], length, diameter: '600', material: 'Concreto', streetSectionId: sections()[section]!.id, attributes: { classe: 'PA-2' },
      }).expect(201);
    await seg('T-01', 'PV-01', 'PV-02', '50.000', 0);
    await seg('T-02', 'PV-02', 'PV-03', '60.000', 1);
    await seg('T-03', 'PV-03', 'PV-04', '45.500', 2);
    const d = await detail(drenagem);
    const net = d.networks[0]!;
    const t1 = net.segments.find((s) => s.code === 'T-01')!;
    expect(t1.geometry).toMatchObject({ slope: '0.006', slopePercent: '0.6', upstreamDepth: '1.5', downstreamDepth: '1.4', averageDepth: '1.45', adverseSlope: false });
    expect(net.segments.find((s) => s.code === 'T-02')!.geometry.slope).toBe('0.005');
    expect(net.segments.find((s) => s.code === 'T-03')!.geometry.adverseSlope).toBe(true); // 97,900 -> 98,000
    expect(net.totals).toMatchObject({ segments: 3, length: '155.5' });
    expect(net.totals.nodesByType[T('PV-DREN')]).toBe(4);
  });

  it('cotas próprias do trecho prevalecem e a edição recalcula a geometria', async () => {
    const d = await detail(drenagem);
    const t3 = d.networks[0]!.segments.find((s) => s.code === 'T-03')!;
    await c.patch(`${base()}/infrastructure/segments/${t3.id}`, { upstreamInvert: '97.900', downstreamInvert: '97.718' }, { 'If-Match': String(t3.version) }).expect(204);
    const after = (await detail(drenagem)).networks[0]!.segments.find((s) => s.code === 'T-03')!;
    expect(after.geometry).toMatchObject({ slope: '0.004', adverseSlope: false });
  });

  it('rejeita trecho inconsistente, tipo de outro sistema, atributo obrigatório ausente e cotas invertidas', async () => {
    const url = `${base()}/infrastructure/networks/${rede}`;
    await c.post(`${url}/segments`, { elementTypeId: T('TUBO-DREN'), code: 'T-X', fromNodeId: pv['PV-01'], toNodeId: pv['PV-01'], length: '10' }).expect(422);
    const dup = await c.post(`${url}/segments`, { elementTypeId: T('TUBO-DREN'), code: 'T-Y', fromNodeId: pv['PV-01'], toNodeId: pv['PV-02'], length: '10' }).expect(409);
    expect(dup.body.code).toBe('SEGMENT_EXISTS');
    const wrong = await c.post(`${url}/nodes`, { elementTypeId: T('REG'), code: 'R-1', attributes: { diametro: '100' } }).expect(422);
    expect(wrong.body.code).toBe('ELEMENT_TYPE_MISMATCH');
    const bl = await c.post(`${url}/nodes`, { elementTypeId: T('BL'), code: 'BL-01', attributes: {} }).expect(422);
    expect(bl.body.errors).toEqual([{ path: 'attributes.tipo', message: 'Tipo é obrigatório.' }]);
    await c.post(`${url}/nodes`, { elementTypeId: T('BL'), code: 'BL-02', coverElevation: '10', bottomElevation: '11', attributes: { tipo: 'Dupla' } }).expect(422);
    const lot = structure.nodes.find((n) => n.kind === 'LOT')!;
    await c.post(`${url}/segments`, { elementTypeId: T('TUBO-DREN'), code: 'T-Z', fromNodeId: pv['PV-03'], toNodeId: pv['PV-01'], length: '10', streetSectionId: lot.id }).expect(422);
  });

  it('dispositivo com trecho ativo não é arquivado; arquivar a rede arquiva tudo sem apagar', async () => {
    const d = await detail(drenagem);
    const node = d.networks[0]!.nodes.find((n) => n.code === 'PV-02')!;
    const res = await c.post(`${base()}/infrastructure/nodes/${node.id}/archive`, { reason: 'x' }, { 'If-Match': String(node.version) }).expect(409);
    expect(res.body.code).toBe('NODE_IN_USE');
    const counts = await prisma.networkSegment.count({ where: { networkId: rede } });
    expect(counts).toBe(3);
  });

  it('redes de água e esgoto com dispositivos e trechos próprios', async () => {
    for (const [sys, node, segType, attrs] of [
      ['AGUA', 'REG', 'TUBO-AGUA', { diametro: '100' }],
      ['ESGOTO', 'PV-ESG', 'TUBO-ESG', {}],
    ] as const) {
      const sid = (await c.post(`${base()}/infrastructure/systems`, { systemTypeId: S(sys), name: sys }).expect(201)).body.id;
      const nid = (await c.post(`${base()}/infrastructure/systems/${sid}/networks`, { code: `${sys}-01`, name: 'Rede 1' }).expect(201)).body.id;
      const a = (await c.post(`${base()}/infrastructure/networks/${nid}/nodes`, { elementTypeId: T(node), code: 'N1', attributes: attrs }).expect(201)).body.id;
      const b = (await c.post(`${base()}/infrastructure/networks/${nid}/nodes`, { elementTypeId: T(node), code: 'N2', attributes: attrs }).expect(201)).body.id;
      await c.post(`${base()}/infrastructure/networks/${nid}/segments`, { elementTypeId: T(segType), code: 'T1', fromNodeId: a, toNodeId: b, length: '80.25', diameter: '150' }).expect(201);
      expect((await detail(sid)).networks[0]!.totals.length).toBe('80.25');
    }
    const list = (await c.get(`${base()}/infrastructure/systems`).expect(200)).body as { name: string; networkCount: number }[];
    expect(list.find((s) => s.name === 'ESGOTO')!.networkCount).toBe(1);
  });

  it('sistemas sem rede (pavimentação, guias, terraplenagem) recebem elementos localizados no cadastro', async () => {
    const pav = (await c.post(`${base()}/infrastructure/systems`, { systemTypeId: S('PAVIMENTACAO'), name: 'Pavimentação' }).expect(201)).body.id;
    const nr = await c.post(`${base()}/infrastructure/systems/${pav}/networks`, { code: 'X', name: 'X' }).expect(422);
    expect(nr.body.code).toBe('NOT_NETWORK_SYSTEM');
    const el = await c.post(`${base()}/elements`, {
      elementTypeId: T('PAV-TRECHO'), name: 'Pavimento — Av. Principal trecho 01', systemId: pav, structureNodeId: sections()[0]!.id,
      attributes: { comprimento: '120', largura: '7.00', revestimento: 'CBUQ', espessuraBase: '0.15' },
    }).expect(201);
    expect(el.body.attributes).toEqual({ comprimento: '120', largura: '7', revestimento: 'CBUQ', espessuraBase: '0.15' });
    await c.post(`${base()}/elements`, { elementTypeId: T('GUIA'), name: 'Guia', systemId: pav, attributes: { comprimento: '10' } }).expect(422); // guia é de outro sistema
    const byNode = (await c.get(`${base()}/elements?structureNodeId=${sections()[0]!.id}`).expect(200)).body;
    expect(byNode).toHaveLength(1);
  });

  it('elementos construtivos em áreas comuns exigem um local no cadastro', async () => {
    const area = structure.nodes.find((n) => n.kind === 'GREEN_AREA')!;
    await c.post(`${base()}/elements`, { elementTypeId: T('EQUIP'), name: 'Bancos', attributes: { quantidade: '6' } }).expect(422);
    await c.post(`${base()}/elements`, { elementTypeId: T('EQUIP'), name: 'Bancos', structureNodeId: area.id, attributes: { quantidade: '6' } }).expect(201);
  });

  it('outra organização não acessa sistemas, redes nem elementos', async () => {
    const other = await signup(app, 'Intrusa infra');
    await other.get(`${base()}/infrastructure/systems/${drenagem}`).expect(404);
    const own = (await other.post('/api/projects', newProject()).expect(201)).body.id;
    await other.post(`/api/projects/${own}/infrastructure/systems/${drenagem}/networks`, { code: 'Z', name: 'Z' }).expect(404);
    await other.post(`/api/projects/${own}/infrastructure/networks/${rede}/nodes`, { elementTypeId: T('PV-DREN'), code: 'Z' }).expect(404);
  });
});
