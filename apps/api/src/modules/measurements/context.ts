/**
 * Contexto físico do empreendimento para medições: caminhos do cadastro, unidades com elementos
 * efetivos (revisão fixada + particularidades), elementos físicos, trechos e dispositivos.
 * Usado para calcular a cobertura das âncoras (RN-DUP) e a replicação por tipologia (RN-TIP).
 */
import { elementChain, resolveUnitElements, typologyCoverage, type EffectiveElement, type ExpandUnit } from '@eapq/domain';
import type { Measurement } from '../../generated/prisma/client.js';
import type { Tx } from '../../prisma/prisma.service.js';
import { toOverrideInput, toRevisionElements } from '../constructive/constructive.service.js';

export interface MeasurementCtx {
  nodes: Map<string, { id: string; path: string; name: string; code: string; kind: string; archivedAt: Date | null }>;
  units: Map<string, { id: string; typologyId: string | null; path: string; label: string; elements: EffectiveElement[] | null }>;
  typologies: Map<string, { id: string; code: string; name: string }>;
  /** Rótulos de elementos de tipologia por chave (todas as revisões + inclusões por unidade). */
  elementLabels: Map<string, string>;
  physical: Map<string, { id: string; name: string; structureNodeId: string | null; systemId: string | null; archivedAt: Date | null }>;
  segments: Map<string, { id: string; networkId: string; label: string; archivedAt: Date | null }>;
  netNodes: Map<string, { id: string; networkId: string; label: string; archivedAt: Date | null }>;
}

export async function loadContext(tx: Tx, projectId: string): Promise<MeasurementCtx> {
  const [nodes, units, typologies, revisions, physical, segments, netNodes] = await Promise.all([
    tx.structureNode.findMany({ where: { projectId }, select: { id: true, path: true, name: true, code: true, kind: true, archivedAt: true } }),
    tx.dwellingUnit.findMany({ where: { projectId }, include: { pinnedRevision: { include: { elements: true } }, overrides: { where: { archivedAt: null } } } }),
    tx.dwellingTypology.findMany({ where: { projectId }, select: { id: true, code: true, name: true } }),
    tx.typologyRevision.findMany({ where: { projectId }, include: { elements: { select: { stableKey: true, name: true } } }, orderBy: { number: 'asc' } }),
    tx.physicalElement.findMany({ where: { projectId }, select: { id: true, name: true, structureNodeId: true, systemId: true, archivedAt: true } }),
    tx.networkSegment.findMany({ where: { projectId }, select: { id: true, networkId: true, code: true, archivedAt: true, network: { select: { code: true } } } }),
    tx.networkNode.findMany({ where: { projectId }, select: { id: true, networkId: true, code: true, archivedAt: true, network: { select: { code: true } } } }),
  ]);
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));
  const elementLabels = new Map<string, string>();
  for (const r of revisions) for (const e of r.elements) elementLabels.set(e.stableKey, e.name);
  const unitMap: MeasurementCtx['units'] = new Map();
  for (const u of units) {
    const n = nodeMap.get(u.structureNodeId)!;
    const elements = u.pinnedRevision ? resolveUnitElements(toRevisionElements(u.pinnedRevision.elements), u.overrides.map(toOverrideInput)).elements : null;
    for (const o of u.overrides) if (o.op === 'ADD_ELEMENT') elementLabels.set(`unit:${o.id}`, `${o.name} (só ${n.name})`);
    unitMap.set(u.structureNodeId, { id: u.structureNodeId, typologyId: u.typologyId, path: n.path, label: `${n.code} ${n.name}`, elements });
  }
  return {
    nodes: nodeMap,
    units: unitMap,
    typologies: new Map(typologies.map((t) => [t.id, t])),
    elementLabels,
    physical: new Map(physical.map((p) => [p.id, p])),
    segments: new Map(segments.map((s) => [s.id, { id: s.id, networkId: s.networkId, label: `Trecho ${s.network.code}/${s.code}`, archivedAt: s.archivedAt }])),
    netNodes: new Map(netNodes.map((s) => [s.id, { id: s.id, networkId: s.networkId, label: `Dispositivo ${s.network.code}/${s.code}`, archivedAt: s.archivedAt }])),
  };
}

export type AnchorFields = Pick<Measurement, 'anchorKind' | 'structureNodeId' | 'networkSegmentId' | 'networkNodeId' | 'physicalElementId' | 'typologyId' | 'elementKey' | 'dwellingUnitId'>;

const typologyKey = (m: AnchorFields, unitId: string) => `${m.typologyId}|${m.elementKey}|${unitId}`;

/**
 * Caminhos cobertos por uma medição. `replacements` = chaves "tipologia|elemento|unidade" com medição
 * própria da unidade (para o mesmo nó da EAP e serviço): a medição geral não cobre essas unidades.
 */
export function coverageOf(m: AnchorFields, ctx: MeasurementCtx, replacements: ReadonlySet<string>): string[] {
  switch (m.anchorKind) {
    case 'STRUCTURE_NODE': {
      const n = ctx.nodes.get(m.structureNodeId!);
      return n ? [n.path] : [];
    }
    case 'PHYSICAL_ELEMENT': {
      const p = ctx.physical.get(m.physicalElementId!);
      if (!p) return [];
      const n = p.structureNodeId ? ctx.nodes.get(p.structureNodeId) : undefined;
      return [n ? `${n.path}/pe:${p.id}` : p.systemId ? `sys:${p.systemId}/pe:${p.id}` : `pe:${p.id}`];
    }
    case 'NETWORK_SEGMENT': {
      const s = ctx.segments.get(m.networkSegmentId!);
      return s ? [`net:${s.networkId}/seg:${s.id}`] : [];
    }
    case 'NETWORK_NODE': {
      const s = ctx.netNodes.get(m.networkNodeId!);
      return s ? [`net:${s.networkId}/nn:${s.id}`] : [];
    }
    case 'TYPOLOGY_ELEMENT': {
      const targets = m.dwellingUnitId
        ? [ctx.units.get(m.dwellingUnitId)].filter((u) => !!u)
        : [...ctx.units.values()].filter((u) => u.typologyId === m.typologyId && !replacements.has(typologyKey(m, u.id)));
      const out: string[] = [];
      for (const u of targets) {
        if (!u.elements) continue;
        const chain = elementChain(u.elements, m.elementKey!);
        if (chain) out.push(...typologyCoverage([u.path], chain));
      }
      return out;
    }
  }
}

export function replacementKeys(ms: readonly AnchorFields[]): Set<string> {
  return new Set(ms.filter((m) => m.anchorKind === 'TYPOLOGY_ELEMENT' && m.dwellingUnitId).map((m) => typologyKey(m, m.dwellingUnitId!)));
}

export function expandUnits(ctx: MeasurementCtx): ExpandUnit[] {
  return [...ctx.units.values()].map((u) => ({ id: u.id, typologyId: u.typologyId, elementKeys: u.elements ? new Set(u.elements.map((e) => e.stableKey)) : null }));
}

export function anchorLabel(m: AnchorFields, ctx: MeasurementCtx): { label: string; archived: boolean } {
  switch (m.anchorKind) {
    case 'STRUCTURE_NODE': {
      const n = ctx.nodes.get(m.structureNodeId!);
      return { label: n ? `${n.code} ${n.name}` : '—', archived: !!n?.archivedAt };
    }
    case 'PHYSICAL_ELEMENT': {
      const p = ctx.physical.get(m.physicalElementId!);
      const n = p?.structureNodeId ? ctx.nodes.get(p.structureNodeId) : undefined;
      return { label: p ? `${p.name}${n ? ` — ${n.code} ${n.name}` : ''}` : '—', archived: !!p?.archivedAt };
    }
    case 'NETWORK_SEGMENT': { const s = ctx.segments.get(m.networkSegmentId!); return { label: s?.label ?? '—', archived: !!s?.archivedAt }; }
    case 'NETWORK_NODE': { const s = ctx.netNodes.get(m.networkNodeId!); return { label: s?.label ?? '—', archived: !!s?.archivedAt }; }
    case 'TYPOLOGY_ELEMENT': {
      const t = ctx.typologies.get(m.typologyId!);
      const el = ctx.elementLabels.get(m.elementKey!) ?? 'elemento';
      const u = m.dwellingUnitId ? ctx.units.get(m.dwellingUnitId) : undefined;
      return { label: `Tipologia ${t?.code ?? '?'} › ${el}${u ? ` — somente ${u.label}` : ''}`, archived: false };
    }
  }
}
