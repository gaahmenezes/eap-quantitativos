/**
 * RN-DUP — disjunção de âncoras. Cada medição "cobre" um ou mais caminhos hierárquicos
 * (segmentos separados por "/"). Duas medições do mesmo par (nó da EAP, serviço) conflitam
 * quando um caminho de uma é igual ou ancestral de um caminho da outra:
 *   - nó do cadastro            → caminho do nó (cobre toda a subárvore)
 *   - elemento físico no nó N   → caminho de N + "/pe:<id>"
 *   - elemento físico sem nó    → "sys:<sistema>/pe:<id>" ou "pe:<id>"
 *   - trecho / dispositivo      → "net:<rede>/seg:<id>" | "net:<rede>/nn:<id>"
 *   - elemento de tipologia     → para cada unidade em que vale: caminho da unidade + "/te:<k1>/te:<k2>…"
 *     (cadeia de chaves do elemento raiz até o elemento medido)
 * Assim medir a Torre A e o elemento "parede" das unidades da Torre A conflita; medir a parede e o piso, não.
 */
export interface Coverage {
  id: string;
  paths: readonly string[];
}

export interface CoverageConflict {
  measurementId: string;
  path: string;
  candidatePath: string;
}

const prefixesOf = (p: string): string[] => {
  const parts = p.split('/');
  return parts.map((_, i) => parts.slice(0, i + 1).join('/'));
};

/** Conflitos entre a cobertura candidata e as existentes (mesmo nó da EAP e mesmo serviço). */
export function findCoverageConflicts(existing: readonly Coverage[], candidate: readonly string[], ignoreId?: string): CoverageConflict[] {
  const exact = new Map<string, string>();
  const ancestors = new Map<string, { id: string; path: string }>();
  for (const c of existing) {
    if (c.id === ignoreId) continue;
    for (const p of c.paths) {
      exact.set(p, c.id);
      for (const pre of prefixesOf(p)) if (!ancestors.has(pre)) ancestors.set(pre, { id: c.id, path: p });
    }
  }
  const out: CoverageConflict[] = [];
  const seen = new Set<string>();
  const push = (measurementId: string, path: string, candidatePath: string) => {
    const k = `${measurementId}|${candidatePath}`;
    if (!seen.has(k)) { seen.add(k); out.push({ measurementId, path, candidatePath }); }
  };
  for (const cp of candidate) {
    // existente igual ou ancestral do candidato
    for (const pre of prefixesOf(cp)) {
      const id = exact.get(pre);
      if (id) push(id, pre, cp);
    }
    // existente descendente do candidato
    const d = ancestors.get(cp);
    if (d && !exact.has(cp)) push(d.id, d.path, cp);
  }
  return out;
}

/** Caminhos cobertos por uma medição de elemento de tipologia, dados os caminhos das unidades e a cadeia do elemento. */
export function typologyCoverage(unitPaths: readonly string[], elementChain: readonly string[]): string[] {
  const suffix = elementChain.map((k) => `te:${k}`).join('/');
  return unitPaths.map((u) => `${u}/${suffix}`);
}

/** Cadeia de chaves (raiz → elemento) num conjunto de elementos efetivos; null se o elemento não existir. */
export function elementChain(elements: readonly { stableKey: string; parentStableKey: string | null }[], key: string): string[] | null {
  const byKey = new Map(elements.map((e) => [e.stableKey, e]));
  const chain: string[] = [];
  let cur = byKey.get(key);
  if (!cur) return null;
  const guard = new Set<string>();
  while (cur && !guard.has(cur.stableKey)) {
    guard.add(cur.stableKey);
    chain.unshift(cur.stableKey);
    cur = cur.parentStableKey ? byKey.get(cur.parentStableKey) : undefined;
  }
  return chain;
}
