import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SCENARIO_B_HORIZONTAL } from '@eapq/domain';
import type { ElementTypeDto, PropagationPreviewDto, RevisionDetailDto, StructureDto, TypologyDto, UnitElementsDto } from '@eapq/contracts';
import { bootApp, newProject, signup, type Client } from './helpers.js';

const { app, prisma } = await bootApp();
afterAll(() => app.close());

let c: Client;
let projectId: string;
let types: ElementTypeDto[];
let typA: TypologyDto;
let typB: TypologyDto;
let s: StructureDto;
const T = (code: string) => types.find((t) => t.code === code)!.id;
const base = () => `/api/projects/${projectId}`;
const tA = () => `${base()}/typologies/${typA.id}`;

beforeAll(async () => {
  c = await signup(app, 'Org Construtivo');
  projectId = (await c.post('/api/projects', { ...newProject(), classification: 'HORIZONTAL' }).expect(201)).body.id;
  await c.post(`${base()}/structure/wizard/apply`, SCENARIO_B_HORIZONTAL).expect(201);
  types = (await c.get('/api/catalog/element-types').expect(200)).body;
  const typs = (await c.get(`${base()}/typologies`).expect(200)).body as TypologyDto[];
  typA = typs.find((t) => t.code === 'A')!;
  typB = typs.find((t) => t.code === 'B')!;
  s = (await c.get(`${base()}/structure`).expect(200)).body;
});

const unitsOf = (typologyId: string) => s.nodes.filter((n) => n.kind === 'DWELLING_UNIT' && n.typologyId === typologyId);

describe('cenário B — replicação por tipologia com particularidades', () => {
  let r1: { id: string };
  let el: Record<string, { id: string; stableKey: string }>;
  let unit: string;

  it('monta a revisão R1 da casa tipo A e publica', async () => {
    r1 = (await c.post(`${tA()}/revisions`, {}).expect(201)).body;
    const add = async (name: string, code: string, attributes: Record<string, string> = {}, parentId?: string) =>
      (await c.post(`${tA()}/revisions/${r1.id}/elements`, { name, elementTypeId: T(code), attributes, parentId }).expect(201)).body as { id: string; stableKey: string };
    el = {};
    el.sala = await add('Sala', 'AMBIENTE', { area: '18.40', peDireito: '2.60' });
    el.quarto = await add('Quarto 1', 'AMBIENTE', { area: '9.00' });
    el.piso = await add('Piso da sala', 'REVESTIMENTO', { local: 'Piso', material: 'Porcelanato' }, el.sala!.id);
    el.fund = await add('Fundação', 'FUNDACAO', { tipo: 'Radier' });
    await c.post(`${tA()}/revisions/${r1.id}/elements`, { name: 'X', elementTypeId: T('PV-DREN'), attributes: {} }).expect(422); // tipo de infraestrutura
    await c.post(`${tA()}/revisions/${r1.id}/publish`, { notes: 'Projeto executivo rev. 0' }).expect(200);
    const det = (await c.get(`${tA()}/revisions/${r1.id}`).expect(200)).body as RevisionDetailDto;
    expect(det).toMatchObject({ number: 1, status: 'PUBLISHED', elementCount: 4 });
  });

  it('publicar não altera as unidades; a prévia mostra as 60 casas pendentes', async () => {
    const prev = (await c.get(`${tA()}/propagation`).expect(200)).body as PropagationPreviewDto;
    expect(prev.targetRevision?.number).toBe(1);
    expect(prev.units).toHaveLength(60);
    expect(prev.units.every((u) => u.pinnedRevisionNumber === null && !u.upToDate)).toBe(true);
    expect(prev.diffByRevision.none).toEqual({ added: 4, removed: 0, changed: 0 });
  });

  it('propaga para as 60 casas A sem tocar nas tipologias B e C', async () => {
    const res = await c.post(`${tA()}/propagation`, { unitIds: unitsOf(typA.id).map((u) => u.id) }).expect(200);
    expect(res.body).toMatchObject({ revision: 1, updated: 60, withConflicts: 0 });
    const pinnedB = await prisma.dwellingUnit.count({ where: { typologyId: typB.id, pinnedRevisionId: { not: null } } });
    expect(pinnedB).toBe(0);
    // não aceita unidades de outra tipologia
    await c.post(`${tA()}/propagation`, { unitIds: [unitsOf(typB.id)[0]!.id] }).expect(404);
  });

  it('unidade herda os elementos e recebe particularidades próprias (exclusão e inclusão)', async () => {
    unit = unitsOf(typA.id)[0]!.id;
    await c.post(`${base()}/units/${unit}/overrides`, { op: 'EXCLUDE_ELEMENT', targetStableKey: el.quarto!.stableKey, reason: 'Cliente uniu quarto à sala' }).expect(201);
    await c.post(`${base()}/units/${unit}/overrides`, { op: 'EXCLUDE_ELEMENT', targetStableKey: el.quarto!.stableKey, reason: 'dup' }).expect(409);
    await c.post(`${base()}/units/${unit}/overrides`, { op: 'ADD_ELEMENT', parentStableKey: el.sala!.stableKey, elementTypeId: T('EQUIP'), name: 'Armário sob medida', attributes: { quantidade: '1' }, reason: 'Opção de personalização' }).expect(201);
    const view = (await c.get(`${base()}/units/${unit}/elements`).expect(200)).body as UnitElementsDto;
    expect(view.pinnedRevision?.number).toBe(1);
    expect(view.elements.map((e) => e.name)).toEqual(['Sala', 'Piso da sala', 'Fundação', 'Armário sob medida']);
    expect(view.excluded.map((e) => e.name)).toEqual(['Quarto 1']);
    const other = (await c.get(`${base()}/units/${unitsOf(typA.id)[1]!.id}/elements`).expect(200)).body as UnitElementsDto;
    expect(other.elements).toHaveLength(4);
  });

  it('revisão publicada é imutável (serviço e banco)', async () => {
    const edit = await c.patch(`${tA()}/revisions/${r1.id}/elements/${el.sala!.id}`, { name: 'Living' }).expect(409);
    expect(edit.body.code).toBe('REVISION_PUBLISHED');
    await expect(prisma.$executeRaw`UPDATE typology_element SET name = 'x' WHERE id = ${el.sala!.id}::uuid`).rejects.toThrow(/imutáveis/);
    await expect(prisma.$executeRaw`DELETE FROM typology_revision WHERE id = ${r1.id}::uuid`).rejects.toThrow(/imutável/);
  });

  it('nova revisão preserva chaves estáveis; atualização exige confirmação quando há conflito e mantém a particularidade', async () => {
    const r2 = (await c.post(`${tA()}/revisions`, {}).expect(201)).body;
    await c.post(`${tA()}/revisions`, {}).expect(409); // um rascunho por vez
    const draft = (await c.get(`${tA()}/revisions/${r2.id}`).expect(200)).body as RevisionDetailDto;
    expect(draft.elements.map((e) => e.stableKey).sort()).toEqual(Object.values(el).map((e) => e.stableKey).sort());
    const quarto = draft.elements.find((e) => e.stableKey === el.quarto!.stableKey)!;
    const sala = draft.elements.find((e) => e.stableKey === el.sala!.stableKey)!;
    await c.del(`${tA()}/revisions/${r2.id}/elements/${quarto.id}`).expect(204);
    await c.patch(`${tA()}/revisions/${r2.id}/elements/${sala.id}`, { attributes: { area: '27.40', peDireito: '2.60' } }).expect(200);
    await c.post(`${tA()}/revisions/${r2.id}/elements`, { name: 'Lavabo', elementTypeId: T('AMBIENTE'), attributes: { area: '2.10' } }).expect(201);
    await c.post(`${tA()}/revisions/${r2.id}/publish`, {}).expect(200);
    const detail = (await c.get(`${tA()}/revisions/${r2.id}`).expect(200)).body as RevisionDetailDto;
    expect(detail.diff).toEqual({ added: 1, removed: 1, changed: 1 });

    // R2 publicada: unidades continuam na R1 até a propagação explícita
    expect((await c.get(`${base()}/units/${unit}/elements`).expect(200)).body.pinnedRevision.number).toBe(1);
    const prev = (await c.get(`${tA()}/propagation`).expect(200)).body as PropagationPreviewDto;
    expect(prev.units.filter((u) => u.conflicts.length)).toHaveLength(1);
    expect(prev.units.find((u) => u.unitId === unit)!.conflicts[0]!.reason).toMatch(/não existe na revisão fixada/);

    const all = unitsOf(typA.id).map((u) => u.id);
    const blocked = await c.post(`${tA()}/propagation`, { unitIds: all }).expect(409);
    expect(blocked.body.code).toBe('PROPAGATION_CONFLICTS');
    expect(blocked.body.errors[0].path).toBe(unit);
    const ok = await c.post(`${tA()}/propagation`, { unitIds: all, acknowledgeConflicts: true }).expect(200);
    expect(ok.body).toMatchObject({ revision: 2, updated: 60, withConflicts: 1 });

    const view = (await c.get(`${base()}/units/${unit}/elements`).expect(200)).body as UnitElementsDto;
    expect(view.pinnedRevision?.number).toBe(2);
    expect(view.elements.map((e) => e.name)).toEqual(expect.arrayContaining(['Lavabo', 'Armário sob medida']));
    const exclude = view.overrides.find((o) => o.op === 'EXCLUDE_ELEMENT')!;
    expect(exclude.archivedAt).toBeNull(); // nunca apagada
    expect(exclude.orphanReason).toMatch(/não existe/);
    expect(view.elements.find((e) => e.name === 'Sala')!.attributes).toMatchObject({ area: '27.4' });
  });

  it('particularidade só é removida por arquivamento com motivo; o banco impede apagar', async () => {
    const view = (await c.get(`${base()}/units/${unit}/elements`).expect(200)).body as UnitElementsDto;
    const add = view.overrides.find((o) => o.op === 'ADD_ELEMENT')!;
    await expect(prisma.$executeRaw`DELETE FROM unit_override WHERE id = ${add.id}::uuid`).rejects.toThrow(/não pode ser apagada/);
    await c.post(`${base()}/units/${unit}/overrides/${add.id}/archive`, {}).expect(422);
    await c.post(`${base()}/units/${unit}/overrides/${add.id}/archive`, { reason: 'Cliente desistiu do armário' }).expect(204);
    const after = (await c.get(`${base()}/units/${unit}/elements`).expect(200)).body as UnitElementsDto;
    expect(after.elements.map((e) => e.name)).not.toContain('Armário sob medida');
    expect(after.overrides.find((o) => o.id === add.id)!.archivedAt).not.toBeNull();
  });

  it('unidade criada depois com a tipologia já nasce na última revisão publicada', async () => {
    const lot = s.nodes.find((n) => n.kind === 'LOT')!;
    const blockNode = s.nodes.find((n) => n.id === lot.parentId)!;
    const newLot = (await c.post(`${base()}/structure/nodes`, { moduleId: lot.moduleId, parentId: blockNode.id, kind: 'LOT', name: 'Lote 99' }).expect(201)).body;
    const house = (await c.post(`${base()}/structure/nodes`, { moduleId: lot.moduleId, parentId: newLot.id, kind: 'DWELLING_UNIT', name: 'Casa nova', typologyId: typA.id }).expect(201)).body;
    const view = (await c.get(`${base()}/units/${house.id}/elements`).expect(200)).body as UnitElementsDto;
    expect(view.pinnedRevision?.number).toBe(2);
  });

  it('auditoria registra publicação, propagação e particularidades', async () => {
    const audit = (await c.get(`${base()}/audit`).expect(200)).body as { entityType: string; action: string }[];
    const actions = audit.map((a) => `${a.entityType}:${a.action}`);
    expect(actions).toEqual(expect.arrayContaining(['TypologyRevision:PUBLISH', 'DwellingTypology:PROPAGATE', 'UnitOverride:CREATE', 'UnitOverride:ARCHIVE']));
  });
});
