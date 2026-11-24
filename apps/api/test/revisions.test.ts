import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SCENARIO_B_HORIZONTAL } from '@eapq/domain';
import type { ConsolidationLinesDto, ConsolidationResultDto, FrozenMeasurementDto, MeasurementDto, ProjectRevisionDto, RevisionCompareDto, ServiceDto, StructureDto, TypologyDto } from '@eapq/contracts';
import { bootApp, inviteAndJoin, newProject, signup, type Client } from './helpers.js';

const { app, prisma } = await bootApp();
afterAll(() => app.close());

const svc = async (c: Client, code: string) => ((await c.get(`/api/catalog/services?q=${code}`).expect(200)).body.items as ServiceDto[]).find((s) => s.code === code)!;

describe('revisões formais — R00, R01 e comparação', () => {
  let c: Client;
  let p: string;
  let pisos: { id: string; version: number };
  let piso: ServiceDto; let alv: ServiceDto;
  let mPiso: string;
  let r00: ProjectRevisionDto; let r01: ProjectRevisionDto;
  let lot: string;
  const base = () => `/api/projects/${p}`;
  const total = async (revisionId?: string) => ((await c.post(`${base()}/consolidation`, { groupBy: [], ...(revisionId && { revisionId }) }).expect(200)).body as ConsolidationResultDto).totals;

  beforeAll(async () => {
    c = await signup(app, 'Org Revisões');
    p = (await c.post('/api/projects', { ...newProject(), classification: 'HORIZONTAL' }).expect(201)).body.id;
    await c.post(`${base()}/structure/wizard/apply`, SCENARIO_B_HORIZONTAL).expect(201);
    const typA = ((await c.get(`${base()}/typologies`).expect(200)).body as TypologyDto[]).find((t) => t.code === 'A')!;
    const types = (await c.get('/api/catalog/element-types').expect(200)).body as { id: string; code: string }[];
    const tA = `${base()}/typologies/${typA.id}`;
    const r1 = (await c.post(`${tA}/revisions`, {}).expect(201)).body;
    const el = (await c.post(`${tA}/revisions/${r1.id}/elements`, { name: 'Piso da sala', elementTypeId: types.find((t) => t.code === 'REVESTIMENTO')!.id, attributes: { local: 'Piso' } }).expect(201)).body;
    await c.post(`${tA}/revisions/${r1.id}/publish`, {}).expect(200);
    const s = (await c.get(`${base()}/structure`).expect(200)).body as StructureDto;
    await c.post(`${tA}/propagation`, { unitIds: s.nodes.filter((n) => n.kind === 'DWELLING_UNIT' && n.typologyId === typA.id).map((n) => n.id) }).expect(200);
    lot = s.nodes.find((n) => n.kind === 'LOT')!.id;
    [piso, alv] = await Promise.all([svc(c, 'REV.004'), svc(c, 'ALV.001')]);
    pisos = (await c.post(`${base()}/wbs/nodes`, { parentId: null, title: 'Pisos', nodeType: 'ITEM' }).expect(201)).body;
    await c.put(`${base()}/wbs/nodes/${pisos.id}/services`, { serviceIds: [piso.id, alv.id] }).expect(200);
    mPiso = (await c.post(`${base()}/measurements`, { wbsNodeId: pisos.id, serviceId: piso.id, anchor: { kind: 'TYPOLOGY_ELEMENT', typologyId: typA.id, elementKey: el.stableKey }, calc: { method: 'MANUAL', value: '18.40', unit: 'm²' } }).expect(201)).body.id;
  });

  it('emite a R00 com fotografia (somente coordenador)', async () => {
    const editor = await inviteAndJoin(app, c, 'MEMBER');
    const org = (await prisma.project.findUniqueOrThrow({ where: { id: p } })).organizationId;
    await prisma.projectMember.create({ data: { organizationId: org, projectId: p, userId: editor.userId, role: 'EDITOR' } });
    await editor.post(`${base()}/revisions`, { title: 'Projeto legal' }).expect(403);
    r00 = (await c.post(`${base()}/revisions`, { title: 'Projeto legal', notes: 'Base para aprovação' }).expect(201)).body;
    expect(r00).toMatchObject({ number: 0, code: 'R00', title: 'Projeto legal', summary: { measurements: 1, lines: 60, totals: [{ unit: 'm²', total: '1104' }] } });
    expect(r00.summary.wbsNodes).toBe(1);
    expect(r00.summary.structureNodes).toBeGreaterThan(120);
    const audit = await prisma.auditLog.findFirst({ where: { entityType: 'ProjectRevision', entityId: r00.id, action: 'ISSUE' } });
    expect(audit).not.toBeNull();
  });

  it('alterar o empreendimento depois da R00 não altera os relatórios da R00', async () => {
    const m = (await c.get(`${base()}/measurements/${mPiso}`).expect(200)).body as MeasurementDto;
    await c.post(`${base()}/measurements/${mPiso}/revisions`, { calc: { method: 'MANUAL', value: '19', unit: 'm²' }, reason: 'Revisão do projeto de arquitetura' }, { 'If-Match': String(m.version) }).expect(204);
    await c.post(`${base()}/measurements`, { wbsNodeId: pisos.id, serviceId: alv.id, anchor: { kind: 'STRUCTURE_NODE', id: lot }, calc: { method: 'MANUAL', value: '33.3', unit: 'm²' } }).expect(201);
    const node = ((await c.get(`${base()}/wbs`).expect(200)).body.nodes as { id: string; version: number }[]).find((n) => n.id === pisos.id)!;
    await c.patch(`${base()}/wbs/nodes/${pisos.id}`, { title: 'Pisos e muros' }, { 'If-Match': String(node.version) }).expect(204);
    expect(await total()).toEqual([{ unit: 'm²', total: '1173.3' }]); // 60 × 19 + 33,3
    expect(await total(r00.id)).toEqual([{ unit: 'm²', total: '1104' }]);
    const byItem = (await c.post(`${base()}/consolidation`, { revisionId: r00.id, groupBy: ['wbsItem'] }).expect(200)).body as ConsolidationResultDto;
    expect(byItem.rows[0]!.key.wbsItem!.label).toBe('01 Pisos'); // rótulo como era na emissão
    const frozen = (await c.get(`${base()}/revisions/${r00.id}/measurements/${mPiso}`).expect(200)).body as FrozenMeasurementDto;
    expect(frozen).toMatchObject({ revisionCode: 'R00', multiplier: 60, effectiveTotal: '1104', revision: { number: 1, quantity: '18.4' } });
    const lines = (await c.post(`${base()}/consolidation/lines`, { revisionId: r00.id, filters: {}, limit: 5 }).expect(200)).body as ConsolidationLinesDto;
    expect(lines.total).toBe(60);
    expect(lines.lines[0]).toMatchObject({ quantity: '18.4', measurementRevisionId: frozen.revision.id, wbsTitle: 'Pisos' });
  });

  it('comparação R00 × R01 com inclusões, alterações e deltas corretos', async () => {
    r01 = (await c.post(`${base()}/revisions`, { title: 'Projeto executivo' }).expect(201)).body;
    expect(r01).toMatchObject({ number: 1, code: 'R01', summary: { measurements: 2, totals: [{ unit: 'm²', total: '1173.3' }] } });
    const cmp = (await c.get(`${base()}/revisions/compare?from=${r00.id}&to=${r01.id}`).expect(200)).body as RevisionCompareDto;
    expect(cmp.from.code).toBe('R00');
    expect(cmp.to.code).toBe('R01');
    expect(cmp.quantities).toEqual([
      expect.objectContaining({ service: expect.stringContaining('ALV.001'), before: null, after: '33.3', delta: '33.3', kind: 'added' }),
      expect.objectContaining({ service: expect.stringContaining('REV.004'), before: '1104', after: '1140', delta: '36', kind: 'changed' }),
    ]);
    expect(cmp.measurements.changed).toEqual([expect.objectContaining({ id: mPiso, before: '18.4', after: '19', delta: '0.6', fromRevision: 1, toRevision: 2 })]);
    expect(cmp.measurements.added).toHaveLength(1);
    expect(cmp.measurements.removed).toHaveLength(0);
    expect(cmp.wbs.changed).toEqual([expect.objectContaining({ id: pisos.id, title: 'Pisos e muros', before: '01 Pisos', fields: ['title'] })]);
    expect(cmp.structure).toEqual({ added: [], removed: [], changed: [] });
  });

  it('R01 × estado atual mostra exclusões feitas depois da emissão', async () => {
    const [muro] = ((await c.get(`${base()}/measurements?serviceId=${alv.id}`).expect(200)).body as MeasurementDto[]);
    await c.post(`${base()}/measurements/${muro!.id}/archive`, { reason: 'Muro fora do escopo' }, { 'If-Match': String(muro!.version) }).expect(204);
    const cmp = (await c.get(`${base()}/revisions/compare?from=${r01.id}&to=current`).expect(200)).body as RevisionCompareDto;
    expect(cmp.to).toEqual({ id: null, code: 'Estado atual' });
    expect(cmp.measurements.removed).toEqual([expect.objectContaining({ id: muro!.id, quantity: '33.3' })]);
    expect(cmp.quantities).toEqual([expect.objectContaining({ before: '33.3', after: null, delta: '-33.3', kind: 'removed' })]);
  });

  it('revisões são imutáveis no banco; lista, histórico por entidade e isolamento', async () => {
    await expect(prisma.$executeRaw`UPDATE project_revision SET title = 'x' WHERE id = ${r00.id}::uuid`).rejects.toThrow(/imutáveis/);
    await expect(prisma.$executeRaw`DELETE FROM revision_line WHERE "revisionId" = ${r00.id}::uuid`).rejects.toThrow(/imutáveis/);
    await expect(prisma.$executeRaw`INSERT INTO revision_label ("revisionId", "entityId", label) VALUES (${r00.id}::uuid, gen_random_uuid(), 'x')`).rejects.toThrow(/apenas na emissão/);
    const list = (await c.get(`${base()}/revisions`).expect(200)).body as ProjectRevisionDto[];
    expect(list.map((r) => r.code)).toEqual(['R01', 'R00']);
    const hist = (await c.get(`${base()}/audit?entityId=${mPiso}`).expect(200)).body as { action: string }[];
    expect(hist.map((h) => h.action)).toEqual(['UPDATE', 'CREATE']);
    const other = await signup(app, 'Org Revisões Intrusa');
    await other.get(`${base()}/revisions`).expect(404);
    await other.get(`${base()}/revisions/${r00.id}/measurements/${mPiso}`).expect(404);
    await other.post(`${base()}/consolidation`, { revisionId: r00.id, groupBy: [] }).expect(404);
    // revisão de outro empreendimento não serve de base
    const p2 = (await c.post('/api/projects', newProject()).expect(201)).body.id;
    await c.post(`/api/projects/${p2}/consolidation`, { revisionId: r00.id, groupBy: [] }).expect(404);
    await c.get(`/api/projects/${p2}/revisions/compare?from=${r00.id}&to=current`).expect(404);
  });
});
