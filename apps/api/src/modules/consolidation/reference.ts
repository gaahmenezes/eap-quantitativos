/**
 * Linhas efetivas montadas em TypeScript com o domínio (expandMeasurements) — referência para
 * o teste de equivalência com a consolidação em SQL. Não é usado nas rotas.
 */
import { Decimal } from 'decimal.js';
import { expandMeasurements, type ConsolidationLine, type ExpandMeasurement, type LineAttributes } from '@eapq/domain';
import type { Tx } from '../../prisma/prisma.service.js';
import { expandUnits, loadContext } from '../measurements/context.js';
import { STRUCTURE_KINDS } from './sql.js';

export async function referenceLines(tx: Tx, projectId: string): Promise<ConsolidationLine[]> {
  const ctx = await loadContext(tx, projectId);
  const [ms, nodes, wbs, units, segments, netNodes, networks, physical] = await Promise.all([
    tx.measurement.findMany({ where: { projectId, archivedAt: null }, include: { revisions: { include: { unit: true } }, service: { include: { unit: true } } } }),
    tx.structureNode.findMany({ where: { projectId }, select: { id: true, path: true, kind: true, moduleId: true } }),
    tx.wbsNode.findMany({ where: { projectId }, select: { id: true, path: true, moduleId: true } }),
    tx.dwellingUnit.findMany({ where: { projectId }, select: { structureNodeId: true, typologyId: true } }),
    tx.networkSegment.findMany({ where: { projectId }, select: { id: true, networkId: true, streetSectionId: true } }),
    tx.networkNode.findMany({ where: { projectId }, select: { id: true, networkId: true, locationNodeId: true } }),
    tx.infrastructureNetwork.findMany({ where: { projectId }, select: { id: true, systemId: true } }),
    tx.physicalElement.findMany({ where: { projectId }, select: { id: true, structureNodeId: true, systemId: true } }),
  ]);
  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  const wbsById = new Map(wbs.map((w) => [w.id, w]));
  const unitTyp = new Map(units.map((u) => [u.structureNodeId, u.typologyId]));
  const segById = new Map(segments.map((s) => [s.id, s]));
  const nnById = new Map(netNodes.map((s) => [s.id, s]));
  const netById = new Map(networks.map((s) => [s.id, s]));
  const peById = new Map(physical.map((s) => [s.id, s]));

  const qty = new Map<string, { q: string; unit: string }>();
  for (const m of ms) {
    const cur = m.revisions.find((r) => r.number === m.currentNumber)!;
    const su = m.service.unit;
    const q = cur.unitId === su.id ? m.quantity.toString() : new Decimal(m.quantity.toString()).times(cur.unit.factor.toString()).div(su.factor.toString()).toDecimalPlaces(10, Decimal.ROUND_HALF_UP).toFixed();
    qty.set(m.id, { q, unit: su.symbol });
  }
  const toExpand = (m: (typeof ms)[number]): ExpandMeasurement => ({
    id: m.id, wbsNodeId: m.wbsNodeId, serviceId: m.serviceId, quantity: qty.get(m.id)!.q,
    anchor: m.anchorKind === 'TYPOLOGY_ELEMENT' ? { kind: 'TYPOLOGY_ELEMENT', typologyId: m.typologyId!, elementKey: m.elementKey!, unitId: m.dwellingUnitId } : { kind: 'OTHER' },
  });
  const ex = expandMeasurements(ms.map(toExpand), expandUnits(ctx));
  const byId = new Map(ms.map((m) => [m.id, m]));

  return ex.lines.map((l) => {
    const m = byId.get(l.measurementId)!;
    const seg = m.networkSegmentId ? segById.get(m.networkSegmentId) : undefined;
    const nn = m.networkNodeId ? nnById.get(m.networkNodeId) : undefined;
    const pe = m.physicalElementId ? peById.get(m.physicalElementId) : undefined;
    const isTyp = m.anchorKind === 'TYPOLOGY_ELEMENT';
    const loc = isTyp ? l.unitId : m.structureNodeId ?? pe?.structureNodeId ?? seg?.streetSectionId ?? nn?.locationNodeId ?? null;
    const networkId = seg?.networkId ?? nn?.networkId ?? null;
    const attrs: LineAttributes = {};
    const w = wbsById.get(m.wbsNodeId)!;
    const wp = w.path.split('/');
    attrs.wbsItem = m.wbsNodeId; attrs.wbs1 = wp[0] ?? null; attrs.wbs2 = wp[1] ?? null; attrs.wbs3 = wp[2] ?? null;
    attrs.service = m.serviceId; attrs.category = m.service.categoryId;
    const ln = loc ? nodeById.get(loc) : undefined;
    attrs.module = ln?.moduleId ?? w.moduleId ?? null;
    const ancestors = ln ? ln.path.split('/').map((id) => nodeById.get(id)!).filter(Boolean) : [];
    for (const k of STRUCTURE_KINDS) attrs[k] = ancestors.filter((a) => a.kind === k).map((a) => a.id).sort().at(-1) ?? null;
    const du = ancestors.filter((a) => a.kind === 'DWELLING_UNIT').map((a) => a.id).sort().at(-1) ?? null;
    attrs.unit = isTyp ? l.unitId : du;
    attrs.typology = isTyp ? m.typologyId : du ? unitTyp.get(du) ?? null : null;
    attrs.network = isTyp ? null : networkId;
    attrs.system = isTyp ? null : (networkId ? netById.get(networkId)?.systemId : undefined) ?? pe?.systemId ?? null;
    return { measurementId: m.id, quantity: l.quantity, unit: qty.get(m.id)!.unit, attrs };
  });
}
