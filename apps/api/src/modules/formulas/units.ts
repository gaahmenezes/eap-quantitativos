import type { FormulaUnit } from '@eapq/domain';
import type { Tx } from '../../prisma/prisma.service.js';

export interface OrgUnit extends FormulaUnit { id: string }

/** Unidades da organização no formato do domínio (fator decimal exato como texto). */
export async function loadUnits(tx: Tx, organizationId: string): Promise<OrgUnit[]> {
  const rows = await tx.unitOfMeasure.findMany({ where: { organizationId }, select: { id: true, symbol: true, dimL: true, dimM: true, dimT: true, dimN: true, factor: true } });
  return rows.map((u) => ({ id: u.id, symbol: u.symbol, dimension: { L: u.dimL, M: u.dimM, T: u.dimT, N: u.dimN }, factor: u.factor.toString() }));
}
