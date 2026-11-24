import type { ModuleDto, StructureDto, StructureNodeDto } from '@eapq/contracts';

export type TreeRow =
  | { type: 'module'; id: string; depth: 0; module: ModuleDto; childCount: number; descendants: number }
  | { type: 'node'; id: string; depth: number; node: StructureNodeDto; module: ModuleDto; childCount: number; descendants: number };

export interface TreeIndex {
  modules: ModuleDto[];
  byId: Map<string, StructureNodeDto>;
  /** filhos por pai; chave = id do nó ou id do módulo (para raízes). */
  children: Map<string, StructureNodeDto[]>;
  descendants: Map<string, number>;
}

export function indexStructure(s: StructureDto, includeArchived: boolean): TreeIndex {
  const nodes = includeArchived ? s.nodes : s.nodes.filter((n) => !n.archivedAt);
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const children = new Map<string, StructureNodeDto[]>();
  for (const n of nodes) {
    const key = n.parentId ?? n.moduleId;
    if (n.parentId && !byId.has(n.parentId)) continue; // pai oculto (arquivado)
    const list = children.get(key) ?? [];
    list.push(n);
    children.set(key, list);
  }
  for (const list of children.values()) list.sort((a, b) => a.position - b.position || (a.id < b.id ? -1 : 1));
  const descendants = new Map<string, number>();
  const count = (key: string): number => {
    const cached = descendants.get(key);
    if (cached !== undefined) return cached;
    const total = (children.get(key) ?? []).reduce((acc, c) => acc + 1 + count(c.id), 0);
    descendants.set(key, total);
    return total;
  };
  const modules = [...s.modules].sort((a, b) => a.position - b.position);
  for (const m of modules) count(m.id);
  return { modules, byId, children, descendants };
}

const norm = (v: string) => v.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();

/**
 * Linhas visíveis. Com busca, mostra os itens que casam e seus ancestrais (abertos),
 * independentemente do estado de expansão.
 */
export function visibleRows(idx: TreeIndex, expanded: ReadonlySet<string>, query: string): TreeRow[] {
  const q = norm(query.trim());
  let keep: Set<string> | null = null;
  if (q) {
    keep = new Set();
    for (const n of idx.byId.values()) {
      if (norm(n.name).includes(q) || n.code.startsWith(query.trim())) {
        keep.add(n.id);
        keep.add(n.moduleId);
        let p = n.parentId;
        while (p) {
          keep.add(p);
          p = idx.byId.get(p)?.parentId ?? null;
        }
      }
    }
  }
  const rows: TreeRow[] = [];
  const walk = (key: string, module: ModuleDto) => {
    for (const n of idx.children.get(key) ?? []) {
      if (keep && !keep.has(n.id)) continue;
      const childCount = idx.children.get(n.id)?.length ?? 0;
      rows.push({ type: 'node', id: n.id, depth: n.depth + 1, node: n, module, childCount, descendants: idx.descendants.get(n.id) ?? 0 });
      if (childCount && (keep ? true : expanded.has(n.id))) walk(n.id, module);
    }
  };
  for (const m of idx.modules) {
    if (keep && !keep.has(m.id)) continue;
    rows.push({ type: 'module', id: m.id, depth: 0, module: m, childCount: idx.children.get(m.id)?.length ?? 0, descendants: idx.descendants.get(m.id) ?? 0 });
    if (keep || expanded.has(m.id)) walk(m.id, m);
  }
  return rows;
}

/** Ids de todos os ancestrais de um nó (para abrir o caminho até ele). */
export function ancestorsOf(idx: TreeIndex, nodeId: string): string[] {
  const out: string[] = [];
  let n = idx.byId.get(nodeId);
  if (n) out.push(n.moduleId);
  while (n?.parentId) {
    out.push(n.parentId);
    n = idx.byId.get(n.parentId);
  }
  return out;
}

/** O nó `candidate` está dentro da subárvore de `rootId` (ou é ele)? */
export function isInSubtree(idx: TreeIndex, rootId: string, candidate: string): boolean {
  let n: StructureNodeDto | undefined = idx.byId.get(candidate);
  while (n) {
    if (n.id === rootId) return true;
    n = n.parentId ? idx.byId.get(n.parentId) : undefined;
  }
  return false;
}
