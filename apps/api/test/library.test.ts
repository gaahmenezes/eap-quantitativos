import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { CategoryDto, ServiceDto, ServiceSaveResult, UnitDto } from '@eapq/contracts';
import { bootApp, inviteAndJoin, newProject, signup, type Client } from './helpers.js';

const { app, prisma } = await bootApp();
afterAll(() => app.close());

let c: Client;
let units: UnitDto[];
let cats: CategoryDto[];
const U = (s: string) => units.find((u) => u.symbol === s)!;
const C = (code: string) => cats.find((x) => x.code === code)!;

beforeAll(async () => {
  c = await signup(app, 'Org Biblioteca');
  units = (await c.get('/api/catalog/units').expect(200)).body;
  cats = (await c.get('/api/catalog/service-categories').expect(200)).body;
});

describe('unidades de medida', () => {
  it('organização nova recebe as unidades padrão com dimensão e grandeza', () => {
    expect(U('m³')).toMatchObject({ dimension: { L: 3, M: 0, T: 0, N: 0 }, quantity: 'Volume', factor: '1', system: true });
    expect(U('cm')).toMatchObject({ quantity: 'Comprimento', factor: '0.01' });
    expect(U('un').quantity).toBe('Contagem');
  });

  it('converte com resultado decimal exato e rejeita grandezas diferentes', async () => {
    const r = await c.get(`/api/catalog/units/convert?value=250&from=${U('cm').id}&to=${U('m').id}`).expect(200);
    expect(r.body).toEqual({ value: '250', from: 'cm', to: 'm', result: '2.5' });
    const l = await c.get(`/api/catalog/units/convert?value=0,75&from=${U('m³').id}&to=${U('L').id}`).expect(200);
    expect(l.body.result).toBe('750');
    const bad = await c.get(`/api/catalog/units/convert?value=1&from=${U('m').id}&to=${U('m²').id}`).expect(422);
    expect(bad.body.detail).toMatch(/Comprimento.*Área/);
  });

  it('cria unidade própria; símbolo repetido e dimensão inválida são rejeitados', async () => {
    const pol = await c.post('/api/catalog/units', { symbol: 'pol', name: 'polegada', dimension: { L: 1, M: 0, T: 0, N: 0 }, factor: '0,0254', decimals: 2 }).expect(201);
    expect(pol.body).toMatchObject({ quantity: 'Comprimento', factor: '0.0254', system: false });
    const r = await c.get(`/api/catalog/units/convert?value=24&from=${pol.body.id}&to=${U('mm').id}`).expect(200);
    expect(r.body.result).toBe('609.6');
    await c.post('/api/catalog/units', { symbol: 'pol', name: 'x', dimension: { L: 1, M: 0, T: 0, N: 0 }, factor: '1', decimals: 2 }).expect(409);
    await c.post('/api/catalog/units', { symbol: 'zz', name: 'x', dimension: { L: 9, M: 0, T: 0, N: 0 }, factor: '1', decimals: 2 }).expect(422);
  });

  it('unidade em uso não é arquivada e seu fator não muda no banco', async () => {
    const m2 = U('m²');
    const res = await c.post(`/api/catalog/units/${m2.id}/archive`, {}, { 'If-Match': String(m2.version) }).expect(409);
    expect(res.body.code).toBe('UNIT_IN_USE');
    await expect(prisma.$executeRaw`UPDATE unit_of_measure SET factor = 2 WHERE id = ${m2.id}::uuid`).rejects.toThrow(/imutáveis/);
  });

  it('atributos numéricos do catálogo técnico só aceitam unidades cadastradas', async () => {
    const st = (await c.get('/api/catalog/system-types').expect(200)).body as { id: string; code: string }[];
    const r = await c.post('/api/catalog/element-types', {
      code: 'MURO-X', name: 'Muro', domain: 'INFRA', category: 'ELEMENT', systemTypeId: st.find((s) => s.code === 'CONTENCOES')!.id,
      attributes: [{ key: 'altura', label: 'Altura', dataType: 'NUMBER', unit: 'braça' }],
    }).expect(422);
    expect(r.body.code).toBe('UNKNOWN_UNIT');
  });
});

describe('biblioteca de serviços — catálogo da organização', () => {
  it('vem com categorias e serviços iniciais sem campos financeiros', async () => {
    expect(C('INF-DRE').parentId).toBe(C('INF').id);
    const list = (await c.get('/api/catalog/services?limit=200').expect(200)).body as { total: number; items: ServiceDto[] };
    expect(list.total).toBeGreaterThanOrEqual(40);
    const dre = list.items.find((s) => s.code === 'DRE.002')!;
    expect(dre).toMatchObject({ unitSymbol: 'm', origin: 'CATALOG', projectId: null });
    const keys = Object.keys(dre).join(' ').toLowerCase();
    expect(keys).not.toMatch(/pre[cç]o|price|cost|custo|bdi|valor/);
  });

  it('busca por texto sem acento e filtra por categoria (incluindo subcategorias)', async () => {
    const q = (await c.get('/api/catalog/services?q=escavacao').expect(200)).body;
    expect(q.items.map((s: ServiceDto) => s.code)).toEqual(expect.arrayContaining(['TER.002', 'DRE.001']));
    const inf = (await c.get(`/api/catalog/services?categoryId=${C('INF').id}&limit=200`).expect(200)).body;
    const dre = (await c.get(`/api/catalog/services?categoryId=${C('INF-DRE').id}`).expect(200)).body;
    expect(inf.total).toBeGreaterThan(dre.total);
    expect(dre.items.every((s: ServiceDto) => s.categoryId === C('INF-DRE').id)).toBe(true);
    const page2 = (await c.get('/api/catalog/services?limit=10&offset=10').expect(200)).body;
    expect(page2.items).toHaveLength(10);
  });

  it('código duplicado é bloqueado; descrição parecida apenas avisa', async () => {
    const dup = await c.post('/api/catalog/services', { code: 'dre.002', description: 'Outro', categoryId: C('INF-DRE').id, unitId: U('m').id }).expect(409);
    expect(dup.body.code).toBe('SERVICE_CODE_IN_USE');
    const similar = (await c.get(`/api/catalog/services/similar?description=${encodeURIComponent('Escavacao mecanizada material primeira categoria')}`).expect(200)).body;
    expect(similar[0].code).toBe('TER.002');
    const created = (await c.post('/api/catalog/services', {
      code: 'TER.010', description: 'Escavação mecanizada de material de 1ª categoria em área restrita', categoryId: C('INF-TER').id, unitId: U('m³').id,
      measurementCriterion: 'Volume no corte.',
    }).expect(201)).body as ServiceSaveResult;
    expect(created.service.code).toBe('TER.010');
    expect(created.similar.map((s) => s.code)).toContain('TER.002');
    expect(created.similar.every((s) => s.similarity >= 0.45)).toBe(true);
  });

  it('referências de outra organização ou inexistentes são rejeitadas', async () => {
    const other = await signup(app, 'Org B Biblioteca');
    const otherUnits = (await other.get('/api/catalog/units').expect(200)).body as UnitDto[];
    await c.post('/api/catalog/services', { code: 'X.1', description: 'Teste', categoryId: C('INF').id, unitId: otherUnits[0]!.id }).expect(404);
    const list = (await other.get('/api/catalog/services?q=TER.010').expect(200)).body;
    expect(list.total).toBe(0);
  });

  it('edição exige versão, audita antes/depois e arquivamento libera o código só se ninguém o usar', async () => {
    const s = (await c.get('/api/catalog/services?q=TER.010').expect(200)).body.items[0] as ServiceDto;
    const upd = await c.patch(`/api/catalog/services/${s.id}`, { measurementCriterion: 'Volume geométrico no corte, por seções.', reason: 'Revisão do critério' }, { 'If-Match': String(s.version) }).expect(200);
    expect(upd.body.service.version).toBe(2);
    await c.patch(`/api/catalog/services/${s.id}`, { description: 'x' }, { 'If-Match': '1' }).expect(409);
    await c.post(`/api/catalog/services/${s.id}/archive`, { reason: 'Substituído' }, { 'If-Match': '2' }).expect(204);
    const archived = (await c.get('/api/catalog/services?q=TER.010&status=ARCHIVED').expect(200)).body;
    expect(archived.total).toBe(1);
    const audit = await prisma.auditLog.findMany({ where: { entityId: s.id }, orderBy: { at: 'asc' } });
    expect(audit.map((a) => a.action)).toEqual(['CREATE', 'UPDATE', 'ARCHIVE']);
    expect((audit[1]!.before as { measurementCriterion: string }).measurementCriterion).toBe('Volume no corte.');
  });

  it('membro sem papel administrativo consulta mas não altera o catálogo', async () => {
    const m = await inviteAndJoin(app, c, 'MEMBER');
    await m.get('/api/catalog/services').expect(200);
    await m.post('/api/catalog/services', { code: 'Y.1', description: 'Y', categoryId: C('INF').id, unitId: U('m').id }).expect(403);
  });
});

describe('serviços específicos do empreendimento', () => {
  let p1: string;
  let p2: string;
  beforeAll(async () => {
    p1 = (await c.post('/api/projects', newProject()).expect(201)).body.id;
    p2 = (await c.post('/api/projects', newProject()).expect(201)).body.id;
  });

  it('serviço específico não aparece no catálogo nem em outro empreendimento', async () => {
    const r = (await c.post(`/api/projects/${p1}/services`, { code: 'ESP.001', description: 'Demolição de muro existente na divisa', categoryId: C('INF-TER').id, unitId: U('m²').id }).expect(201)).body as ServiceSaveResult;
    expect(r.service).toMatchObject({ projectId: p1, origin: 'PROJECT' });
    const inP1 = (await c.get(`/api/projects/${p1}/services?q=ESP.001`).expect(200)).body;
    expect(inP1.total).toBe(1);
    expect((await c.get(`/api/projects/${p2}/services?q=ESP.001`).expect(200)).body.total).toBe(0);
    expect((await c.get('/api/catalog/services?q=ESP.001').expect(200)).body.total).toBe(0);
    // lista do empreendimento traz catálogo + específicos; filtro só específicos
    const only = (await c.get(`/api/projects/${p1}/services?scope=PROJECT`).expect(200)).body;
    expect(only.items.map((s: ServiceDto) => s.code)).toEqual(['ESP.001']);
    await c.get(`/api/projects/${p2}/services/${r.service.id}`).expect(404);
  });

  it('código do empreendimento não pode repetir o do catálogo', async () => {
    const r = await c.post(`/api/projects/${p1}/services`, { code: 'DRE.002', description: 'Tubo especial', categoryId: C('INF-DRE').id, unitId: U('m').id }).expect(409);
    expect(r.body.detail).toMatch(/catálogo da organização/);
  });

  it('duplica do catálogo para o empreendimento preservando a origem', async () => {
    const src = (await c.get('/api/catalog/services?q=DRE.002').expect(200)).body.items[0] as ServiceDto;
    const r = (await c.post(`/api/projects/${p1}/services/duplicate`, { sourceId: src.id, code: 'DRE.002-A' }).expect(201)).body as ServiceSaveResult;
    expect(r.service).toMatchObject({ origin: 'DUPLICATE', projectId: p1, derivedFrom: { id: src.id, code: 'DRE.002' }, description: src.description });
    expect(r.similar.map((s) => s.code)).toContain('DRE.002');
    // não duplica serviço específico de outro empreendimento
    const otherSpecific = (await c.post(`/api/projects/${p2}/services`, { code: 'ESP.900', description: 'Serviço do P2', categoryId: C('INF').id, unitId: U('un').id }).expect(201)).body as ServiceSaveResult;
    await c.post(`/api/projects/${p1}/services/duplicate`, { sourceId: otherSpecific.service.id, code: 'ESP.901' }).expect(404);
  });

  it('editor do empreendimento cria serviço específico; leitor não; outra organização recebe 404', async () => {
    const editor = await inviteAndJoin(app, c, 'MEMBER');
    const viewer = await inviteAndJoin(app, c, 'MEMBER');
    await c.put(`/api/projects/${p1}/members/${editor.userId}`, { role: 'EDITOR' }).expect(204);
    await c.put(`/api/projects/${p1}/members/${viewer.userId}`, { role: 'VIEWER' }).expect(204);
    await editor.post(`/api/projects/${p1}/services`, { code: 'ESP.002', description: 'Proteção de árvore existente', categoryId: C('INF-PAI').id, unitId: U('un').id }).expect(201);
    await viewer.post(`/api/projects/${p1}/services`, { code: 'ESP.003', description: 'x', categoryId: C('INF-PAI').id, unitId: U('un').id }).expect(403);
    await viewer.get(`/api/projects/${p1}/services?scope=PROJECT`).expect(200);
    const outsider = await signup(app, 'Org C Biblioteca');
    await outsider.get(`/api/projects/${p1}/services`).expect(404);
  });
});

describe('categorias', () => {
  it('cria subcategoria, impede ciclo e não arquiva categoria em uso', async () => {
    const sub = (await c.post('/api/catalog/service-categories', { code: 'INF-DRE-MAC', name: 'Macrodrenagem', parentId: C('INF-DRE').id }).expect(201)).body;
    const dre = C('INF-DRE');
    await c.patch(`/api/catalog/service-categories/${dre.id}`, { parentId: sub.id }, { 'If-Match': String(dre.version) }).expect(422);
    const res = await c.post(`/api/catalog/service-categories/${dre.id}/archive`, {}, { 'If-Match': String(dre.version) }).expect(409);
    expect(res.body.code).toBe('CATEGORY_IN_USE');
  });
});
