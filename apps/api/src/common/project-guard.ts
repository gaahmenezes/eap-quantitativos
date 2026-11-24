import { validateAttributes, type AttributeDefinition } from '@eapq/domain';
import type { Tx } from '../prisma/prisma.service.js';
import { AppError, conflict, notFound } from './errors.js';

/** Empreendimento da organização e ativo (arquivado = somente leitura). */
export async function assertProjectEditable(tx: Tx, organizationId: string, projectId: string): Promise<void> {
  const p = await tx.project.findFirst({ where: { id: projectId, organizationId }, select: { status: true } });
  if (!p) throw notFound('Empreendimento');
  if (p.status === 'ARCHIVED') throw conflict('PROJECT_ARCHIVED', 'Empreendimento arquivado não pode ser alterado.');
}

/** Valida atributos contra as definições do tipo de elemento; erros viram 422 com caminhos. */
export function checkAttributes(defs: AttributeDefinition[], input: Record<string, unknown> | undefined) {
  const { values, issues } = validateAttributes(defs, input);
  if (issues.length) throw new AppError(422, 'VALIDATION_FAILED', 'Dados inválidos', 'Revise os atributos técnicos.', issues);
  return values;
}

export const decimalOrNull = (v: { toString(): string } | null | undefined) => (v == null ? null : v.toString());
