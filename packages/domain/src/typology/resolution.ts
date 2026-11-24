/**
 * Resolução da estrutura efetiva de uma unidade (RN-TIP, seção 10 da diretriz):
 * elementos da revisão de tipologia fixada na unidade + particularidades (overrides) da unidade.
 * Particularidades nunca são apagadas pela tipologia; quando o alvo deixa de existir numa
 * nova revisão, elas ficam "órfãs" e são reportadas para decisão do usuário.
 */
export interface RevisionElement {
  stableKey: string;
  parentStableKey: string | null;
  name: string;
  elementTypeId: string;
  attributes: Record<string, unknown>;
}

export type UnitOverrideInput =
  | { id: string; op: 'EXCLUDE_ELEMENT'; targetStableKey: string }
  | { id: string; op: 'ADD_ELEMENT'; parentStableKey: string | null; name: string; elementTypeId: string; attributes: Record<string, unknown> };

export interface EffectiveElement extends RevisionElement {
  source: 'TYPOLOGY' | 'UNIT';
  overrideId?: string;
}

export interface Resolution {
  elements: EffectiveElement[];
  excluded: RevisionElement[];
  orphanOverrides: { overrideId: string; reason: string }[];
}

export function resolveUnitElements(revision: readonly RevisionElement[], overrides: readonly UnitOverrideInput[]): Resolution {
  const byKey = new Map(revision.map((e) => [e.stableKey, e]));
  const excludedKeys = new Set<string>();
  const orphanOverrides: Resolution['orphanOverrides'] = [];
  for (const o of overrides) {
    if (o.op !== 'EXCLUDE_ELEMENT') continue;
    if (!byKey.has(o.targetStableKey)) orphanOverrides.push({ overrideId: o.id, reason: 'O elemento excluído não existe na revisão fixada.' });
    else excludedKeys.add(o.targetStableKey);
  }
  // Exclusão de um elemento exclui também seus subelementos.
  const isExcluded = (e: RevisionElement): boolean => {
    let cur: RevisionElement | undefined = e;
    while (cur) {
      if (excludedKeys.has(cur.stableKey)) return true;
      cur = cur.parentStableKey ? byKey.get(cur.parentStableKey) : undefined;
    }
    return false;
  };
  const elements: EffectiveElement[] = [];
  const excluded: RevisionElement[] = [];
  for (const e of revision) {
    if (isExcluded(e)) excluded.push(e);
    else elements.push({ ...e, source: 'TYPOLOGY' });
  }
  for (const o of overrides) {
    if (o.op !== 'ADD_ELEMENT') continue;
    if (o.parentStableKey && (!byKey.has(o.parentStableKey) || excludedKeys.has(o.parentStableKey))) {
      orphanOverrides.push({ overrideId: o.id, reason: 'O elemento superior da inclusão não existe ou foi excluído.' });
      continue;
    }
    elements.push({
      stableKey: `unit:${o.id}`,
      parentStableKey: o.parentStableKey,
      name: o.name,
      elementTypeId: o.elementTypeId,
      attributes: o.attributes,
      source: 'UNIT',
      overrideId: o.id,
    });
  }
  return { elements, excluded, orphanOverrides };
}

/** Comparação entre duas revisões por stableKey. */
export function diffRevisions(from: readonly RevisionElement[], to: readonly RevisionElement[]) {
  const a = new Map(from.map((e) => [e.stableKey, e]));
  const b = new Map(to.map((e) => [e.stableKey, e]));
  const same = (x: RevisionElement, y: RevisionElement) =>
    x.name === y.name && x.parentStableKey === y.parentStableKey && x.elementTypeId === y.elementTypeId && stableJson(x.attributes) === stableJson(y.attributes);
  return {
    added: to.filter((e) => !a.has(e.stableKey)),
    removed: from.filter((e) => !b.has(e.stableKey)),
    changed: to.filter((e) => a.has(e.stableKey) && !same(a.get(e.stableKey)!, e)).map((e) => ({ before: a.get(e.stableKey)!, after: e })),
    unchanged: to.filter((e) => a.has(e.stableKey) && same(a.get(e.stableKey)!, e)).length,
  };
}

export function stableJson(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(stableJson).join(',')}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o).sort().map((k) => `${JSON.stringify(k)}:${stableJson(o[k])}`).join(',')}}`;
}

/** Impacto de fixar uma unidade numa nova revisão (prévia de propagação). */
export function propagationImpact(
  current: readonly RevisionElement[] | null,
  target: readonly RevisionElement[],
  overrides: readonly UnitOverrideInput[],
) {
  const before = current ? resolveUnitElements(current, overrides) : null;
  const after = resolveUnitElements(target, overrides);
  const newOrphans = after.orphanOverrides.filter((o) => !before?.orphanOverrides.some((b) => b.overrideId === o.overrideId));
  return { diff: diffRevisions(current ?? [], target), conflicts: newOrphans, hasOverrides: overrides.length > 0 };
}
