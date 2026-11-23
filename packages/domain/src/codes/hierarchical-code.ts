/**
 * Código hierárquico derivado da posição (ADR-005). Ex.: [1, 2, 3] com larguras [2, 2, 3] ⇒ "01.02.003".
 * O código nunca é identificador; é recalculado sempre que a estrutura muda.
 */
export interface CodeFormat {
  /** Largura mínima (zero à esquerda) por nível; o último valor vale para níveis mais profundos. */
  widths: readonly number[];
  separator: string;
}

export const DEFAULT_CODE_FORMAT: CodeFormat = { widths: [2, 2, 3], separator: '.' };

export function formatHierarchicalCode(
  positions: readonly number[],
  format: CodeFormat = DEFAULT_CODE_FORMAT,
): string {
  if (format.widths.length === 0) throw new Error('CodeFormat.widths não pode ser vazio');
  return positions
    .map((pos, level) => {
      if (!Number.isInteger(pos) || pos < 1) {
        throw new Error(`Posição inválida no nível ${level + 1}: ${pos}`);
      }
      const width = format.widths[Math.min(level, format.widths.length - 1)]!;
      return String(pos).padStart(width, '0');
    })
    .join(format.separator);
}

/** Calcula códigos de uma árvore a partir de (id, parentId, position), ordenando irmãos por position e id. */
export function deriveTreeCodes<T extends { id: string; parentId: string | null; position: number }>(
  nodes: readonly T[],
  format: CodeFormat = DEFAULT_CODE_FORMAT,
): Map<string, string> {
  const children = new Map<string | null, T[]>();
  for (const n of nodes) {
    const list = children.get(n.parentId) ?? [];
    list.push(n);
    children.set(n.parentId, list);
  }
  const result = new Map<string, string>();
  const walk = (parentId: string | null, prefix: number[]) => {
    const list = (children.get(parentId) ?? []).sort(
      (a, b) => a.position - b.position || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
    );
    list.forEach((node, idx) => {
      const path = [...prefix, idx + 1];
      result.set(node.id, formatHierarchicalCode(path, format));
      walk(node.id, path);
    });
  };
  walk(null, []);
  if (result.size !== nodes.length) {
    throw new Error('Árvore inconsistente: há nós com pai inexistente ou ciclos');
  }
  return result;
}
