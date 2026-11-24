import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SCENARIO_A_VERTICAL, SCENARIO_C_LOTEAMENTO } from '@eapq/domain';
import type { StructureDto, TemplateDto, TemplateVersionDetailDto, WbsDto, WbsNodeDto, WbsPlanDto } from '@eapq/contracts';
import { bootApp, inviteAndJoin, newProject, signup, type Client } from './helpers.js';

const { app, prisma } = await bootApp();
afterAll(() => app.close());

const byKindCode: Record<string, string> = { VERTICAL_RESIDENTIAL: 'EAP-VERT', HORIZONTAL_RESIDENTIAL: 'EAP-HORIZ', LAND_SUBDIVISION: 'EAP-LOT', COMMON_AREAS: 'EAP-AREAS', INFRASTRUCTURE: 'EAP-INFRA' };

async function selections(c: Client, projectId: string) {
  const s = (await c.get(`/api/projects/${projectId}/structure`).expect(200)).body as StructureDto;
  const tpls = (await c.get('/api/wbs-templates').expect(200)).body as TemplateDto[];
  return s.modules.map((m) => {
    const t = tpls.find((x) => x.code === byKindCode[m.kind])!;
    return { moduleId: m.id, templateVersionId: t.versions.find((v) => v.status === 'PUBLISHED')!.id };
  });
}
async function generate(c: Client, projectId: string, sel?: { moduleId: string; templateVersionId: string }[]) {
  const s = sel ?? (await selections(c, projectId));
  const plan = (await c.post(`/api/projects/${projectId}/wbs/preview`, { selections: s }).expect(200)).body as WbsPlanDto;
  const res = await c.post(`/api/projects/${projectId}/wbs/apply`, { selections: s, planHash: plan.planHash }).expect(200);
  return { plan, run: res.body };
}
const wbs = async (c: Client, p: string) => (await c.get(`/api/projects/${p}/wbs`).expect(200)).body as WbsDto;
const kids = (w: WbsDto, parent: WbsNodeDto | undefined) => w.nodes.filter((n) => n.parentId === (parent?.id ?? null) && !n.archivedAt).sort((a, b) => a.position - b.position);
const find = (w: WbsDto, title: string) => w.nodes.find((n) => n.title === title && !n.archivedAt)!;

describe('templates de EAP', () => {
  let c: Client;
  beforeAll(async () => { c = await signup(app, 'Org Templates'); });

  it('organização nova recebe 5 templates publicados (R1) com serviços sugeridos', async () => {
    const list = (await c.get('/api/wbs-templates').expect(200)).body as TemplateDto[];
    expect(list.map((t) => t.code).sort()).toEqual(['EAP-AREAS', 'EAP-HORIZ', 'EAP-INFRA', 'EAP-LOT', 'EAP-VERT']);
    const vert = list.find((t) => t.code === 'EAP-VERT')!;
    expect(vert.versions).toHaveLength(1);
    expect(vert.versions[0]).toMatchObject({ number: 1, status: 'PUBLISHED' });
    const det = (await c.get(`/api/wbs-templates/${vert.id}/versions/${vert.versions[0]!.id}`).expect(200)).body as TemplateVersionDetailDto;
    expect(det.nodes.find((n) => n.stableKey === 'estr-pav-i')!.serviceIds).toHaveLength(3);
  });

  it('ciclo de vida: rascunho com validação, publicação imutável e nova versão com chaves estáveis', async () => {
    const t = (await c.post('/api/wbs-templates', { code: 'meu-vert', name: 'Vertical da empresa', moduleKinds: ['VERTICAL_RESIDENTIAL'] }).expect(201)).body;
    const base = `/api/wbs-templates/${t.id}/versions/${t.versionId}`;
    const det = (await c.get(base).expect(200)).body as TemplateVersionDetailDto;
    const root = det.nodes[0]!;
    const torre = (await c.post(`${base}/nodes`, { parentId: root.id, title: '{torre.nome}', nodeType: 'GROUP', repeat: 'TOWER' }).expect(201)).body;
    const item = (await c.post(`${base}/nodes`, { parentId: torre.id, title: 'Estrutura de {pavimento.nome}', nodeType: 'ITEM', condition: 'qtd.pavimentos >' }).expect(201)).body;
    await c.post(`${base}/nodes`, { parentId: item.id, title: 'Filho', nodeType: 'GROUP' }).expect(422);
    const bad = await c.post(`${base}/publish`, {}).expect(422);
    expect(bad.body.code).toBe('TEMPLATE_INVALID');
    expect(bad.body.errors.map((e: { message: string }) => e.message).join(' ')).toMatch(/\{pavimento.nome\} não está disponível.*|Condição inválida/);
    await c.patch(`${base}/nodes/${item.id}`, { title: 'Estrutura', condition: 'qtd.pavimentos > 0' }).expect(200);
    await c.post(`${base}/publish`, { notes: 'Primeira versão' }).expect(200);
    await c.patch(`${base}/nodes/${item.id}`, { title: 'x' }).expect(409);
    await expect(prisma.$executeRaw`UPDATE wbs_template_node SET title = 'x' WHERE id = ${item.id}::uuid`).rejects.toThrow(/imutáveis/);
    await expect(prisma.$executeRaw`DELETE FROM wbs_template_version WHERE id = ${t.versionId}::uuid`).rejects.toThrow(/imutável/);

    const v2 = (await c.post(`/api/wbs-templates/${t.id}/versions`, {}).expect(201)).body;
    await c.post(`/api/wbs-templates/${t.id}/versions`, {}).expect(409);
    const d2 = (await c.get(`/api/wbs-templates/${t.id}/versions/${v2.id}`).expect(200)).body as TemplateVersionDetailDto;
    expect(d2.nodes.map((n) => n.stableKey).sort()).toEqual(det.nodes.map((n) => n.stableKey).concat([torre.stableKey, item.stableKey]).sort());
    const it2 = d2.nodes.find((n) => n.stableKey === item.stableKey)!;
    await c.patch(`/api/wbs-templates/${t.id}/versions/${v2.id}/nodes/${it2.id}`, { title: 'Estrutura de concreto' }).expect(200);
    const cmp = (await c.get(`/api/wbs-templates/${t.id}/compare?from=${t.versionId}&to=${v2.id}`).expect(200)).body;
    expect(cmp).toEqual({ added: [], removed: [], changed: [{ stableKey: item.stableKey, title: 'Estrutura de concreto', fields: ['title'] }] });
  });

  it('membro sem papel administrativo lê mas não edita; outra organização não vê', async () => {
    const m = await inviteAndJoin(app, c, 'MEMBER');
    await m.get('/api/wbs-templates').expect(200);
    await m.post('/api/wbs-templates', { code: 'X', name: 'X', moduleKinds: ['COMMON_AREAS'] }).expect(403);
    const other = await signup(app, 'Org Templates B');
    const list = (await other.get('/api/wbs-templates').expect(200)).body as TemplateDto[];
    expect(list.find((t) => t.code === 'MEU-VERT')).toBeUndefined();
  });
});

describe('EAP do empreendimento — cenário A, regeneração controlada', () => {
  let c: Client;
  let p: string;
  beforeAll(async () => {
    c = await signup(app, 'Org EAP');
    p = (await c.post('/api/projects', newProject()).expect(201)).body.id;
    await c.post(`/api/projects/${p}/structure/wizard/apply`, SCENARIO_A_VERTICAL).expect(201);
  });

  it('prévia não grava; aplicação gera por torre, pavimento e tipologia com códigos e serviços', async () => {
    const sel = await selections(c, p);
    const plan = (await c.post(`/api/projects/${p}/wbs/preview`, { selections: sel }).expect(200)).body as WbsPlanDto;
    expect(plan.totals.create).toBeGreaterThan(100);
    expect(plan.totals).toMatchObject({ update: 0, remove: 0, obsolete: 0 });
    expect((await wbs(c, p)).nodes).toHaveLength(0);
    await c.post(`/api/projects/${p}/wbs/apply`, { selections: sel, planHash: plan.planHash }).expect(200);
    const w = await wbs(c, p);
    expect(w.nodes).toHaveLength(plan.totals.desired);
    const roots = kids(w, undefined);
    expect(roots.map((r) => [r.code, r.title])).toEqual([['01', 'Torres residenciais'], ['02', 'Áreas comuns'], ['03', 'Infraestrutura externa']]);
    const torreA = kids(w, roots[0])[0]!;
    expect([torreA.code, torreA.title]).toEqual(['01.01', 'Torre A']);
    const estrutura = kids(w, torreA).find((n) => n.title === 'Estrutura')!;
    expect(kids(w, estrutura).map((n) => n.title).slice(0, 2)).toEqual(['Térreo', '1º pavimento']);
    const item = kids(w, kids(w, estrutura)[1])[0]!;
    expect(item).toMatchObject({ nodeType: 'ITEM', origin: 'GENERATED', code: '01.01.002.002.001' });
    expect(item.serviceIds).toHaveLength(3);
    // o item herda o vínculo físico do pavimento em que está (âncora padrão das medições)
    expect(kids(w, estrutura)[1]!.binding?.kind).toBe('STRUCTURE');
    expect(item.binding).toEqual(kids(w, estrutura)[1]!.binding);
    expect(w.moduleTemplates.map((m) => m.versionNumber)).toEqual([1, 1, 1]);
    expect(w.runs).toHaveLength(1);
  });

  it('gerar de novo sem mudanças não altera nada (determinismo)', async () => {
    const before = await prisma.wbsGenerationRun.findFirstOrThrow({ where: { projectId: p } });
    const { plan } = await generate(c, p);
    expect(plan.totals).toMatchObject({ create: 0, update: 0, remove: 0, obsolete: 0 });
    const runs = await prisma.wbsGenerationRun.findMany({ where: { projectId: p }, orderBy: { createdAt: 'asc' } });
    expect(runs.at(-1)!.resultHash).toBe(before.resultHash);
    expect(runs.at(-1)!.factsHash).toBe(before.factsHash);
  });

  it('aplicação com prévia desatualizada é recusada', async () => {
    const sel = await selections(c, p);
    const plan = (await c.post(`/api/projects/${p}/wbs/preview`, { selections: sel }).expect(200)).body as WbsPlanDto;
    const s = (await c.get(`/api/projects/${p}/structure`).expect(200)).body as StructureDto;
    const torre = s.nodes.find((n) => n.kind === 'TOWER')!;
    await c.post(`/api/projects/${p}/structure/nodes`, { moduleId: torre.moduleId, parentId: torre.id, kind: 'FLOOR', name: 'Cobertura técnica' }).expect(201);
    const res = await c.post(`/api/projects/${p}/wbs/apply`, { selections: sel, planHash: plan.planHash }).expect(409);
    expect(res.body.code).toBe('PLAN_CHANGED');
  });

  it('incluir uma torre no cadastro gera só a subárvore nova; preserva edição manual e exclusões', async () => {
    let w = await wbs(c, p);
    const cobertura = w.nodes.find((n) => n.title === 'Cobertura' && n.origin === 'GENERATED')!;
    await c.patch(`/api/projects/${p}/wbs/nodes/${cobertura.id}`, { title: 'Cobertura com laje impermeabilizada' }, { 'If-Match': String(cobertura.version) }).expect(204);
    const areas = find(w, 'Áreas comuns');
    const piscina = kids(w, areas).find((n) => n.title === 'Piscina')!;
    await c.post(`/api/projects/${p}/wbs/nodes/${piscina.id}/archive`, { reason: 'Piscina orçada à parte pelo cliente' }, { 'If-Match': String(piscina.version) }).expect(200);
    const s = (await c.get(`/api/projects/${p}/structure`).expect(200)).body as StructureDto;
    const torre = s.nodes.find((n) => n.kind === 'TOWER')!;
    const tc = (await c.post(`/api/projects/${p}/structure/nodes`, { moduleId: torre.moduleId, parentId: null, kind: 'TOWER', name: 'Torre C' }).expect(201)).body;
    await c.post(`/api/projects/${p}/structure/nodes`, { moduleId: torre.moduleId, parentId: tc.id, kind: 'FLOOR', name: '1º pavimento' }).expect(201);
    const { plan } = await generate(c, p);
    expect(plan.totals.update).toBe(0); // título editado e exclusão preservados
    expect(plan.totals.keptArchived).toBeGreaterThan(0);
    expect(plan.create[0]!.title).toBe('Cobertura técnica'); // pavimento incluído no teste anterior
    expect(plan.create.map((x) => x.title)).toContain('Torre C');
    w = await wbs(c, p);
    expect(w.nodes.find((n) => n.id === cobertura.id)!.title).toBe('Cobertura com laje impermeabilizada');
    expect(kids(w, areas).map((n) => n.title)).toEqual(['Portaria', 'Salão de festas', 'Reservatório inferior']);
    expect(kids(w, find(w, 'Torres residenciais')).map((n) => n.title)).toEqual(['Torre A', 'Torre B', 'Torre C']);
  });

  it('remover torre do cadastro: nós sem dados são apagados; com serviços do usuário ou nós manuais ficam obsoletos', async () => {
    let w = await wbs(c, p);
    const torreB = find(w, 'Torre B');
    const torreC = find(w, 'Torre C');
    const manual = (await c.post(`/api/projects/${p}/wbs/nodes`, { parentId: torreB.id, title: 'Elevadores', nodeType: 'ITEM' }).expect(201)).body;
    const s = (await c.get(`/api/projects/${p}/structure`).expect(200)).body as StructureDto;
    for (const name of ['Torre B', 'Torre C']) {
      const t = s.nodes.find((n) => n.kind === 'TOWER' && n.name === name)!;
      await c.post(`/api/projects/${p}/structure/nodes/${t.id}/archive`, { reason: 'fora do escopo' }, { 'If-Match': String(t.version) }).expect(200);
    }
    const { plan } = await generate(c, p);
    expect(plan.obsolete.map((o) => o.title)).toEqual(['Torre B']);
    expect(plan.remove.map((r) => r.title)).toContain('Torre C');
    w = await wbs(c, p);
    expect(w.nodes.find((n) => n.id === torreB.id)!.status).toBe('OBSOLETE');
    expect(w.nodes.find((n) => n.id === manual.id)).toBeTruthy();
    expect(w.nodes.find((n) => n.id === torreC.id)).toBeUndefined();
  });

  it('nova versão do template não altera a EAP até a regeneração explícita', async () => {
    const tpls = (await c.get('/api/wbs-templates').expect(200)).body as TemplateDto[];
    const vert = tpls.find((t) => t.code === 'EAP-VERT')!;
    const v2 = (await c.post(`/api/wbs-templates/${vert.id}/versions`, {}).expect(201)).body;
    const det = (await c.get(`/api/wbs-templates/${vert.id}/versions/${v2.id}`).expect(200)).body as TemplateVersionDetailDto;
    const fund = det.nodes.find((n) => n.stableKey === 'fund')!;
    await c.patch(`/api/wbs-templates/${vert.id}/versions/${v2.id}/nodes/${fund.id}`, { title: 'Fundações e contenções' }).expect(200);
    await c.post(`/api/wbs-templates/${vert.id}/versions/${v2.id}/publish`, {}).expect(200);
    let w = await wbs(c, p);
    expect(w.nodes.filter((n) => n.title === 'Fundações').length).toBeGreaterThan(0);
    expect(w.moduleTemplates.find((m) => m.templateId === vert.id)).toMatchObject({ versionNumber: 1, latestVersionNumber: 2 });
    const sel = (await selections(c, p)).map((x) => (x.templateVersionId === vert.versions[0]!.id ? { ...x, templateVersionId: v2.id } : x));
    const { plan } = await generate(c, p, sel);
    expect(plan.update.every((u) => u.changes.includes('título'))).toBe(true);
    w = await wbs(c, p);
    expect(w.nodes.filter((n) => n.title === 'Fundações e contenções' && !n.archivedAt).length).toBe(1); // só a Torre A está ativa
    expect(w.moduleTemplates.find((m) => m.templateId === vert.id)!.versionNumber).toBe(2);
  });

  it('serviços só em itens quantificáveis; auditoria registra cada geração', async () => {
    const w = await wbs(c, p);
    const group = find(w, 'Torre A');
    const item = w.nodes.find((n) => n.nodeType === 'ITEM' && !n.archivedAt)!;
    await c.put(`/api/projects/${p}/wbs/nodes/${group.id}/services`, { serviceIds: item.serviceIds }).expect(422);
    await c.put(`/api/projects/${p}/wbs/nodes/${item.id}/services`, { serviceIds: item.serviceIds.slice(0, 1) }).expect(200);
    const audit = (await c.get(`/api/projects/${p}/audit`).expect(200)).body as { entityType: string; action: string }[];
    expect(audit.filter((a) => a.entityType === 'WbsGenerationRun').length).toBeGreaterThanOrEqual(5);
  });

  it('leitor consulta mas não gera; outra organização recebe 404', async () => {
    const v = await inviteAndJoin(app, c, 'MEMBER');
    await c.put(`/api/projects/${p}/members/${v.userId}`, { role: 'VIEWER' }).expect(204);
    await v.get(`/api/projects/${p}/wbs`).expect(200);
    await v.post(`/api/projects/${p}/wbs/preview`, { selections: await selections(c, p) }).expect(403);
    const other = await signup(app, 'Org EAP B');
    await other.get(`/api/projects/${p}/wbs`).expect(404);
  });
});

describe('EAP — cenário C com infraestrutura', () => {
  it('loteamento inclui fases, sistema viário por trecho e sistemas de infraestrutura por rede', async () => {
    const c = await signup(app, 'Org EAP C');
    const p = (await c.post('/api/projects', { ...newProject(), classification: 'LOTEAMENTO' }).expect(201)).body.id;
    await c.post(`/api/projects/${p}/structure/wizard/apply`, SCENARIO_C_LOTEAMENTO).expect(201);
    const st = (await c.get('/api/catalog/system-types').expect(200)).body as { id: string; code: string }[];
    const sys = (await c.post(`/api/projects/${p}/infrastructure/systems`, { systemTypeId: st.find((s) => s.code === 'DRENAGEM')!.id, name: 'Drenagem pluvial' }).expect(201)).body.id;
    await c.post(`/api/projects/${p}/infrastructure/systems/${sys}/networks`, { code: 'D-01', name: 'Av. Principal' }).expect(201);
    await generate(c, p);
    const w = await wbs(c, p);
    expect(kids(w, kids(w, undefined)[0]).map((n) => n.title)).toEqual(['Fase 1', 'Fase 2', 'Sistema viário', 'Áreas verdes e institucionais', 'Infraestrutura']);
    expect(kids(w, find(w, 'Drenagem pluvial')).map((n) => n.title)).toEqual(['Rede D-01 — Av. Principal']);
    expect(kids(w, find(w, 'Rede D-01 — Av. Principal')).map((n) => n.title)).toEqual(['Escavação e reaterro de valas', 'Tubulação de drenagem', 'Poços de visita e bocas de lobo']);
  });
});
