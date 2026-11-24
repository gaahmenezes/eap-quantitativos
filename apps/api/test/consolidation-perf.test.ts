import { randomUUID } from 'node:crypto';
import { afterAll, expect, it } from 'vitest';
import type { ConsolidationResultDto, ServiceDto, StructureDto, TypologyDto } from '@eapq/contracts';
import { bootApp, newProject, signup } from './helpers.js';

const { app, prisma } = await bootApp();
afterAll(() => app.close());

const ELEMENTS = 200; // por tipologia
const TOWERS = 10; const FLOORS = 25; const PER_FLOOR = 4; // 1.000 unidades

it(`consolida ${ELEMENTS * TOWERS * FLOORS * PER_FLOOR} linhas efetivas em menos de 2 s (RNF06)`, async () => {
  const c = await signup(app, 'Org Desempenho');
  const p = (await c.post('/api/projects', newProject()).expect(201)).body.id as string;
  await c.post(`/api/projects/${p}/structure/wizard/apply`, {
    typologies: [{ code: '2Q', name: '2 quartos', kind: 'APARTMENT' }, { code: '3Q', name: '3 quartos', kind: 'APARTMENT' }],
    modules: [{ kind: 'VERTICAL_RESIDENTIAL', name: 'Torres', towers: Array.from({ length: TOWERS }, (_, i) => ({ name: `Torre ${i + 1}`, floors: FLOORS, unitsPerFloor: PER_FLOOR, groundFloor: false, unitTypologies: ['2Q', '2Q', '3Q', '3Q'] })) }],
  }).expect(201);
  const typs = (await c.get(`/api/projects/${p}/typologies`).expect(200)).body as TypologyDto[];
  const s = (await c.get(`/api/projects/${p}/structure`).expect(200)).body as StructureDto;
  const types = (await c.get('/api/catalog/element-types').expect(200)).body as { id: string; code: string }[];
  const amb = types.find((t) => t.code === 'AMBIENTE')!.id;
  const org = (await prisma.project.findUniqueOrThrow({ where: { id: p } })).organizationId;
  const service = ((await c.get('/api/catalog/services?q=REV.004').expect(200)).body.items as ServiceDto[])[0]!;
  const wbs = (await c.post(`/api/projects/${p}/wbs/nodes`, { parentId: null, title: 'Pisos', nodeType: 'ITEM' }).expect(201)).body.id as string;
  await c.put(`/api/projects/${p}/wbs/nodes/${wbs}/services`, { serviceIds: [service.id] }).expect(200);
  const user = (await prisma.user.findFirstOrThrow({ where: { email: c.email } })).id;

  for (const t of typs) {
    const r = (await c.post(`/api/projects/${p}/typologies/${t.id}/revisions`, {}).expect(201)).body;
    const keys = Array.from({ length: ELEMENTS }, () => randomUUID());
    await prisma.typologyElement.createMany({ data: keys.map((k, i) => ({ organizationId: org, revisionId: r.id, stableKey: k, elementTypeId: amb, name: `Ambiente ${i + 1}`, attributes: {}, position: i + 1 })) });
    await c.post(`/api/projects/${p}/typologies/${t.id}/revisions/${r.id}/publish`, {}).expect(200);
    const units = s.nodes.filter((n) => n.kind === 'DWELLING_UNIT' && n.typologyId === t.id).map((n) => n.id);
    await c.post(`/api/projects/${p}/typologies/${t.id}/propagation`, { unitIds: units }).expect(200);
    // medições geradas direto no banco (o objetivo aqui é medir a consulta, não o cadastro)
    const ids = keys.map(() => randomUUID());
    await prisma.measurement.createMany({ data: keys.map((k, i) => ({ id: ids[i], organizationId: org, projectId: p, wbsNodeId: wbs, serviceId: service.id, anchorKind: 'TYPOLOGY_ELEMENT', typologyId: t.id, elementKey: k, quantity: '1.25' })) });
    await prisma.measurementRevision.createMany({ data: ids.map((id) => ({ organizationId: org, projectId: p, measurementId: id, number: 1, method: 'MANUAL', inputs: {}, memory: {}, quantity: '1.25', unitId: service.unitId, createdById: user })) });
  }
  await prisma.$executeRaw`ANALYZE`;

  const run = async (groupBy: string[]) => {
    const t0 = performance.now();
    const r = (await c.post(`/api/projects/${p}/consolidation`, { groupBy }).expect(200)).body as ConsolidationResultDto;
    return { r, ms: performance.now() - t0 };
  };
  await run([]); // aquecimento
  const total = await run([]);
  const byTower = await run(['TOWER', 'typology']);
  const byUnit = await run(['unit']);
  console.info(`consolidação: total ${total.ms.toFixed(0)} ms · torre×tipologia ${byTower.ms.toFixed(0)} ms · por unidade ${byUnit.ms.toFixed(0)} ms`);
  const lines = TOWERS * FLOORS * PER_FLOOR * ELEMENTS;
  expect(total.r.rows[0]).toMatchObject({ lines, total: String(lines * 1.25) });
  expect(byTower.r.rows).toHaveLength(TOWERS * 2);
  expect(byUnit.r.rows).toHaveLength(TOWERS * FLOORS * PER_FLOOR);
  for (const x of [total, byTower, byUnit]) expect(x.ms).toBeLessThan(2000);
}, 300_000);
