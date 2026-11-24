import { deriveTreeCodes } from '@eapq/domain';
import type { Tx } from '../../prisma/prisma.service.js';

/**
 * Recalcula os códigos hierárquicos derivados (ADR-005) de módulos e nós do empreendimento.
 * Módulos são o 1º nível; raízes do módulo, o 2º. Só grava o que mudou.
 */
export async function recomputeStructureCodes(tx: Tx, projectId: string): Promise<void> {
  const modules = await tx.projectModule.findMany({
    where: { projectId },
    select: { id: true, position: true, code: true },
  });
  const nodes = await tx.structureNode.findMany({
    where: { projectId },
    select: { id: true, parentId: true, moduleId: true, position: true, code: true },
  });
  const tree = [
    ...modules.map((m) => ({ id: m.id, parentId: null, position: m.position })),
    ...nodes.map((n) => ({ id: n.id, parentId: n.parentId ?? n.moduleId, position: n.position })),
  ];
  const codes = deriveTreeCodes(tree);
  const changedModules = modules.filter((m) => codes.get(m.id) !== m.code);
  const changedNodes = nodes.filter((n) => codes.get(n.id) !== n.code);
  if (changedModules.length) {
    await tx.$executeRaw`
      UPDATE project_module m SET code = v.code
      FROM unnest(${changedModules.map((m) => m.id)}::uuid[], ${changedModules.map((m) => codes.get(m.id)!)}::text[]) AS v(id, code)
      WHERE m.id = v.id AND m."projectId" = ${projectId}::uuid`;
  }
  if (changedNodes.length) {
    await tx.$executeRaw`
      UPDATE structure_node s SET code = v.code
      FROM unnest(${changedNodes.map((n) => n.id)}::uuid[], ${changedNodes.map((n) => codes.get(n.id)!)}::text[]) AS v(id, code)
      WHERE s.id = v.id AND s."projectId" = ${projectId}::uuid`;
  }
}

/** Renumera irmãos 1..n na ordem informada. */
export async function renumberSiblings(tx: Tx, projectId: string, orderedIds: string[]): Promise<void> {
  if (!orderedIds.length) return;
  const positions = orderedIds.map((_, i) => i + 1);
  await tx.$executeRaw`
    UPDATE structure_node s SET position = v.pos
    FROM unnest(${orderedIds}::uuid[], ${positions}::int[]) AS v(id, pos)
    WHERE s.id = v.id AND s."projectId" = ${projectId}::uuid AND s.position <> v.pos`;
}
