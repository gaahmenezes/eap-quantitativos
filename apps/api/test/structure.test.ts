import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  SCENARIO_A_VERTICAL,
  SCENARIO_B_HORIZONTAL,
  SCENARIO_C_LOTEAMENTO,
  SCENARIO_D_MISTO,
  type StructurePlanInput,
} from '@eapq/domain';
import type { StructureDto, StructureNodeDto } from '@eapq/contracts';
import { bootApp, inviteAndJoin, newProject, signup, type Client } from './helpers.js';

const { app, prisma } = await bootApp();
afterAll(() => app.close());

async function projectWith(c: Client, input?: StructurePlanInput) {
  const p = (await c.post('/api/projects', newProject()).expect(201)).body as { id: string };
  if (input) await c.post(`/api/projects/${p.id}/structure/wizard/apply`, input).expect(201);
  return p.id;
}
const structure = async (c: Client, id: string) => (await c.get(`/api/projects/${id}/structure`).expect(200)).body as StructureDto;
const count = (s: StructureDto, kind: string) => s.nodes.filter((n) => n.kind === kind && !n.archivedAt).length;
const children = (s: StructureDto, parentId: string | null, moduleId?: string) =>
  s.nodes.filter((n) => n.parentId === parentId && (!moduleId || n.moduleId === moduleId)).sort((a, b) => a.position - b.position);

describe('assistente de estruturação — cenários de aceitação', () => {
  let c: Client;
  beforeAll(async () => {
    c = await signup(app, 'Org Cadastro');
  });

  it('prévia não grava nada e reporta as contagens do plano', async () => {
    const id = await projectWith(c);
    const res = await c.post(`/api/projects/${id}/structure/wizard/preview`, SCENARIO_A_VERTICAL).expect(200);
    expect(res.body.counts).toMatchObject({ TOWER: 2, FLOOR: 22, DWELLING_UNIT: 80 });
    expect(res.body.unitsByTypology).toEqual({ '2Q': 40, '3Q': 40 });
    expect((await structure(c, id)).nodes).toHaveLength(0);
  });

  it('cenário A: 2 torres × 10 pavimentos, organização por torre/pavimento e tipologia', async () => {
    const id = await projectWith(c, SCENARIO_A_VERTICAL);
    const s = await structure(c, id);
    expect(s.modules.map((m) => [m.kind, m.code])).toEqual([
      ['VERTICAL_RESIDENTIAL', '01'],
      ['COMMON_AREAS', '02'],
      ['INFRASTRUCTURE', '03'],
    ]);
    expect(count(s, 'TOWER')).toBe(2);
    expect(count(s, 'FLOOR')).toBe(22);
    expect(count(s, 'DWELLING_UNIT')).toBe(80);
    const [torreA] = children(s, null, s.modules[0]!.id);
    expect(torreA).toMatchObject({ name: 'Torre A', code: '01.01', depth: 0 });
    const floors = children(s, torreA!.id);
    expect(floors.map((f) => f.name).slice(0, 2)).toEqual(['Térreo', '1º pavimento']);
    const apt = children(s, floors[1]!.id)[0]!;
    expect(apt).toMatchObject({ name: 'Apto 101', code: '01.01.002.001' });
    const typ = (await c.get(`/api/projects/${id}/typologies`).expect(200)).body as { code: string; unitCount: number }[];
    expect(typ.map((t) => [t.code, t.unitCount])).toEqual([['2Q', 40], ['3Q', 40]]);
    // path materializado: unidade -> pavimento -> torre
    const row = await prisma.structureNode.findUniqueOrThrow({ where: { id: apt.id } });
    expect(row.path).toBe(`${torreA!.id}/${floors[1]!.id}/${apt.id}`);
  });

  it('cenário B: 120 casas com 60/40/20 por tipologia, cada casa em um lote', async () => {
    const id = await projectWith(c, SCENARIO_B_HORIZONTAL);
    const s = await structure(c, id);
    expect(count(s, 'BLOCK_QUADRA')).toBe(4);
    expect(count(s, 'LOT')).toBe(120);
    expect(count(s, 'DWELLING_UNIT')).toBe(120);
    expect(count(s, 'COMMON_AREA')).toBe(5);
    const typ = (await c.get(`/api/projects/${id}/typologies`).expect(200)).body as { code: string; unitCount: number }[];
    expect(Object.fromEntries(typ.map((t) => [t.code, t.unitCount]))).toEqual({ A: 60, B: 40, C: 20 });
    const lots = new Set(s.nodes.filter((n) => n.kind === 'LOT').map((n) => n.id));
    expect(s.nodes.filter((n) => n.kind === 'DWELLING_UNIT').every((n) => lots.has(n.parentId!))).toBe(true);
  });

  it('cenário C: loteamento por fase, quadra, lote, ruas e trechos', async () => {
    const id = await projectWith(c, SCENARIO_C_LOTEAMENTO);
    const s = await structure(c, id);
    expect([count(s, 'PHASE'), count(s, 'BLOCK_QUADRA'), count(s, 'LOT'), count(s, 'STREET'), count(s, 'STREET_SECTION')]).toEqual([2, 5, 100, 3, 13]);
    expect(count(s, 'GREEN_AREA') + count(s, 'INSTITUTIONAL_AREA')).toBe(3);
  });

  it('cenário D: misto com módulos independentes e tipologias de tipos distintos', async () => {
    const id = await projectWith(c, SCENARIO_D_MISTO);
    const s = await structure(c, id);
    expect(s.modules).toHaveLength(4);
    expect(count(s, 'DWELLING_UNIT')).toBe(88);
    expect(count(s, 'LOT')).toBe(12);
    const horizontal = s.modules.find((m) => m.kind === 'HORIZONTAL_RESIDENTIAL')!;
    expect(children(s, null, horizontal.id)).toHaveLength(40);
  });

  it('aplicar de novo acrescenta módulos e reutiliza tipologias de mesmo código', async () => {
    const id = await projectWith(c, SCENARIO_A_VERTICAL);
    await c.post(`/api/projects/${id}/structure/wizard/apply`, { typologies: SCENARIO_A_VERTICAL.typologies, modules: [SCENARIO_A_VERTICAL.modules[0]] }).expect(201);
    const s = await structure(c, id);
    expect(s.modules.map((m) => m.code)).toEqual(['01', '02', '03', '04']);
    const typ = (await c.get(`/api/projects/${id}/typologies`).expect(200)).body as { code: string; unitCount: number }[];
    expect(typ.map((t) => t.unitCount)).toEqual([80, 80]);
  });

  it('parâmetros inválidos retornam 422 com o caminho do campo e não gravam nada', async () => {
    const id = await projectWith(c);
    const bad = structuredClone(SCENARIO_B_HORIZONTAL);
    (bad.modules[0] as { typologyDistribution: { quantity: number }[] }).typologyDistribution[0]!.quantity = 59;
    const res = await c.post(`/api/projects/${id}/structure/wizard/apply`, bad).expect(422);
    expect(res.body.errors[0].path).toBe('modules.0.typologyDistribution');
    expect((await structure(c, id)).nodes).toHaveLength(0);
    expect(await prisma.dwellingTypology.count({ where: { projectId: id } })).toBe(0);
  });

  it('registra a aplicação do assistente na auditoria com parâmetros e contagens', async () => {
    const id = await projectWith(c, SCENARIO_C_LOTEAMENTO);
    const audit = (await c.get(`/api/projects/${id}/audit`).expect(200)).body as { entityType: string; after: { counts: Record<string, number> } }[];
    const entry = audit.find((e) => e.entityType === 'StructureWizard')!;
    expect(entry.after.counts.LOT).toBe(100);
  });
});

describe('edição da árvore', () => {
  let c: Client;
  let id: string;
  let s: StructureDto;
  const find = (pred: (n: StructureNodeDto) => boolean) => s.nodes.find(pred)!;
  beforeAll(async () => {
    c = await signup(app, 'Org Árvore');
    id = await projectWith(c, SCENARIO_A_VERTICAL);
    s = await structure(c, id);
  });
  const refresh = async () => {
    s = await structure(c, id);
  };

  it('rejeita hierarquia inválida com mensagem que lista os tipos permitidos', async () => {
    const floor = find((n) => n.kind === 'FLOOR');
    const res = await c.post(`/api/projects/${id}/structure/nodes`, { moduleId: floor.moduleId, parentId: floor.id, kind: 'TOWER', name: 'X' }).expect(422);
    expect(res.body.code).toBe('INVALID_HIERARCHY');
    expect(res.body.detail).toMatch(/Permitidos: Unidade habitacional, Área comum, Área técnica/);
    const lotInVertical = await c.post(`/api/projects/${id}/structure/nodes`, { moduleId: floor.moduleId, parentId: null, kind: 'LOT', name: 'X' });
    expect(lotInVertical.status).toBe(422);
  });

  it('cria unidade manual com tipologia compatível e rejeita tipologia de outro tipo', async () => {
    const floor = find((n) => n.kind === 'FLOOR' && n.name === '10º pavimento');
    const typ = (await c.get(`/api/projects/${id}/typologies`).expect(200)).body as { id: string; code: string }[];
    const unit = await c.post(`/api/projects/${id}/structure/nodes`, { moduleId: floor.moduleId, parentId: floor.id, kind: 'DWELLING_UNIT', name: 'Apto 1005', typologyId: typ[0]!.id }).expect(201);
    expect(unit.body).toMatchObject({ code: `${floor.code}.005`, typologyId: typ[0]!.id, origin: 'MANUAL' });
    const casa = (await c.post(`/api/projects/${id}/typologies`, { code: 'CASA', name: 'Casa', kind: 'HOUSE' }).expect(201)).body;
    const res = await c.patch(`/api/projects/${id}/structure/nodes/${unit.body.id}`, { typologyId: casa.id }, { 'If-Match': '1' }).expect(422);
    expect(res.body.code).toBe('TYPOLOGY_KIND_MISMATCH');
  });

  it('mover pavimento entre torres preserva o id, atualiza códigos, caminhos e posições', async () => {
    await refresh();
    const [torreA, torreB] = children(s, null, s.modules[0]!.id);
    const floor = children(s, torreA!.id)[1]!; // 1º pavimento da torre A
    const unitsBefore = children(s, floor.id).map((u) => u.id);
    const res = await c.post(`/api/projects/${id}/structure/nodes/${floor.id}/move`, { parentId: torreB!.id, position: 1 }, { 'If-Match': String(floor.version) }).expect(200);
    expect(res.body.id).toBe(floor.id);
    expect(res.body.code).toBe('01.02.001');
    await refresh();
    expect(children(s, torreB!.id)[0]!.id).toBe(floor.id);
    expect(children(s, torreA!.id).map((f) => f.position)).toEqual(Array.from({ length: 10 }, (_, i) => i + 1));
    const moved = children(s, floor.id);
    expect(moved.map((u) => u.id)).toEqual(unitsBefore);
    expect(moved[0]!.code).toBe('01.02.001.001');
    const row = await prisma.structureNode.findUniqueOrThrow({ where: { id: moved[0]!.id } });
    expect(row.path).toBe(`${torreB!.id}/${floor.id}/${moved[0]!.id}`);
    expect(row.depth).toBe(2);
  });

  it('impede mover um item para dentro de si e para posição incompatível', async () => {
    await refresh();
    const torre = children(s, null, s.modules[0]!.id)[0]!;
    const floor = children(s, torre.id)[0]!;
    await c.post(`/api/projects/${id}/structure/nodes/${torre.id}/move`, { parentId: floor.id }, { 'If-Match': String(torre.version) }).expect(422);
    const unit = children(s, children(s, torre.id)[1]!.id)[0]!;
    await c.post(`/api/projects/${id}/structure/nodes/${unit.id}/move`, { parentId: null }, { 'If-Match': String(unit.version) }).expect(422);
  });

  it('versão desatualizada retorna 409', async () => {
    await refresh();
    const n = find((x) => x.kind === 'COMMON_AREA');
    await c.patch(`/api/projects/${id}/structure/nodes/${n.id}`, { name: 'Portaria principal' }, { 'If-Match': String(n.version) }).expect(200);
    const stale = await c.patch(`/api/projects/${id}/structure/nodes/${n.id}`, { name: 'Outro' }, { 'If-Match': String(n.version) }).expect(409);
    expect(stale.body.code).toBe('VERSION_CONFLICT');
  });

  it('duplica uma torre inteira com unidades e tipologias, logo após a original', async () => {
    await refresh();
    const torre = children(s, null, s.modules[0]!.id)[0]!;
    const before = count(s, 'DWELLING_UNIT');
    const res = await c.post(`/api/projects/${id}/structure/nodes/${torre.id}/duplicate`).expect(201);
    await refresh();
    const roots = children(s, null, s.modules[0]!.id);
    expect(roots[1]!.id).toBe(res.body.id);
    expect(roots[1]!).toMatchObject({ name: `${torre.name} (cópia)`, code: '01.02', origin: 'DUPLICATE' });
    const copiedUnits = s.nodes.filter((n) => n.kind === 'DWELLING_UNIT' && s.nodes.find((f) => f.id === n.parentId)?.parentId === res.body.id);
    expect(count(s, 'DWELLING_UNIT')).toBe(before + copiedUnits.length);
    expect(copiedUnits.every((u) => u.typologyId)).toBe(true);
  });

  it('arquivar exige motivo, arquiva a subárvore e não apaga; reativar restaura o conjunto', async () => {
    await refresh();
    const torre = children(s, null, s.modules[0]!.id).at(-1)!;
    const sub = s.nodes.filter((n) => n.id === torre.id || n.parentId === torre.id || s.nodes.find((f) => f.id === n.parentId)?.parentId === torre.id);
    await c.post(`/api/projects/${id}/structure/nodes/${torre.id}/archive`, {}, { 'If-Match': String(torre.version) }).expect(422);
    const res = await c.post(`/api/projects/${id}/structure/nodes/${torre.id}/archive`, { reason: 'Torre excluída do projeto' }, { 'If-Match': String(torre.version) }).expect(200);
    expect(res.body.items).toBe(sub.length);
    await refresh();
    expect(s.nodes.filter((n) => sub.some((x) => x.id === n.id)).every((n) => n.archivedAt)).toBe(true);
    const floor = children(s, torre.id)[0]!;
    await c.post(`/api/projects/${id}/structure/nodes`, { moduleId: torre.moduleId, parentId: floor.id, kind: 'DWELLING_UNIT', name: 'X' }).expect(409);
    const t2 = s.nodes.find((n) => n.id === torre.id)!;
    await c.post(`/api/projects/${id}/structure/nodes/${torre.id}/unarchive`, {}, { 'If-Match': String(t2.version) }).expect(200);
    await refresh();
    expect(s.nodes.filter((n) => sub.some((x) => x.id === n.id)).every((n) => !n.archivedAt)).toBe(true);
  });

  it('tipologia vinculada a unidades ativas não pode ser arquivada', async () => {
    const typ = (await c.get(`/api/projects/${id}/typologies`).expect(200)).body as { id: string; version: number; unitCount: number }[];
    const used = typ.find((t) => t.unitCount > 0)!;
    const res = await c.post(`/api/projects/${id}/typologies/${used.id}/archive`, {}, { 'If-Match': String(used.version) }).expect(409);
    expect(res.body.code).toBe('TYPOLOGY_IN_USE');
  });

  it('lote aceita área e testada decimais exatas; valores inválidos são rejeitados', async () => {
    const lotProject = await projectWith(c, SCENARIO_C_LOTEAMENTO);
    const ls = await structure(c, lotProject);
    const lot = ls.nodes.find((n) => n.kind === 'LOT')!;
    const ok = await c.patch(`/api/projects/${lotProject}/structure/nodes/${lot.id}`, { lot: { area: '360,1250', frontage: '12.5' } }, { 'If-Match': '1' }).expect(200);
    expect(ok.body.lot).toEqual({ area: '360.125', frontage: '12.5' });
    await c.patch(`/api/projects/${lotProject}/structure/nodes/${lot.id}`, { lot: { area: '-1' } }, { 'If-Match': '2' }).expect(422);
  });

  it('auditoria registra movimentação com código anterior e novo', async () => {
    const audit = (await c.get(`/api/projects/${id}/audit`).expect(200)).body as { action: string; before: { code: string }; after: { code: string } }[];
    const move = audit.find((e) => e.action === 'MOVE')!;
    expect(move.before.code).toBe('01.01.002');
    expect(move.after.code).toBe('01.02.001');
  });
});

describe('cadastro físico — acesso e integridade', () => {
  let owner: Client;
  let viewer: Client & { userId: string };
  let projectId: string;
  beforeAll(async () => {
    owner = await signup(app, 'Org Acesso F2');
    projectId = await projectWith(owner, SCENARIO_C_LOTEAMENTO);
    viewer = await inviteAndJoin(app, owner, 'MEMBER');
    await owner.put(`/api/projects/${projectId}/members/${viewer.userId}`, { role: 'VIEWER' }).expect(204);
  });

  it('leitor consulta mas não altera o cadastro', async () => {
    const s = await structure(viewer, projectId);
    const lot = s.nodes.find((n) => n.kind === 'LOT')!;
    await viewer.patch(`/api/projects/${projectId}/structure/nodes/${lot.id}`, { name: 'x' }, { 'If-Match': '1' }).expect(403);
    await viewer.post(`/api/projects/${projectId}/structure/wizard/apply`, SCENARIO_C_LOTEAMENTO).expect(403);
  });

  it('outra organização recebe 404 no cadastro e nos itens', async () => {
    const other = await signup(app, 'Intrusa F2');
    const s = await structure(owner, projectId);
    const lot = s.nodes.find((n) => n.kind === 'LOT')!;
    await other.get(`/api/projects/${projectId}/structure`).expect(404);
    await other.patch(`/api/projects/${projectId}/structure/nodes/${lot.id}`, { name: 'x' }, { 'If-Match': '1' }).expect(404);
    // nó de outro empreendimento informado sob o projeto do intruso
    const own = await projectWith(other);
    await other.patch(`/api/projects/${own}/structure/nodes/${lot.id}`, { name: 'x' }, { 'If-Match': '1' }).expect(404);
  });

  it('empreendimento arquivado deixa o cadastro somente leitura', async () => {
    const p = (await owner.get(`/api/projects/${projectId}`).expect(200)).body;
    await owner.post(`/api/projects/${projectId}/archive`, { reason: 'teste' }, { 'If-Match': String(p.version) }).expect(200);
    const res = await owner.post(`/api/projects/${projectId}/structure/wizard/apply`, SCENARIO_C_LOTEAMENTO).expect(409);
    expect(res.body.code).toBe('PROJECT_ARCHIVED');
  });

  it('banco rejeita detalhe de unidade em nó que não é unidade e pai de outro módulo', async () => {
    const s = await structure(owner, projectId);
    const lot = s.nodes.find((n) => n.kind === 'LOT')!;
    await expect(prisma.dwellingUnit.create({ data: { structureNodeId: lot.id, projectId } })).rejects.toThrow(/DWELLING_UNIT/);
    await expect(prisma.$executeRaw`UPDATE structure_node SET kind = 'TOWER' WHERE id = ${lot.id}::uuid`).rejects.toThrow(/imutável/);
  });
});
