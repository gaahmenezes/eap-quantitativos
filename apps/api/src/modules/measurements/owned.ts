/**
 * Medições geradas por uma origem (ficha de levantamento ou quadro de componentes): sincroniza as
 * medições ativas da origem com os planos calculados, numa transação já aberta e com o lock da EAP.
 * - chave nova → cria (checando dupla contagem);
 * - mesma chave e mesmo destino → nova revisão só se a quantidade ou a contribuição mudou;
 * - destino diferente ou chave ausente → arquiva (a medição continua no histórico).
 * Vínculos serviço × item da EAP que faltarem são criados e auditados.
 */
import type { MemoryDto } from '@eapq/contracts';
import type { Actor } from '../../common/auth/auth-context.js';
import type { Prisma } from '../../generated/prisma/client.js';
import type { Tx } from '../../prisma/prisma.service.js';
import type { AuditService } from '../audit/audit.service.js';
import type { AnchorFields, MeasurementCtx } from './context.js';
import type { MeasurementsService } from './measurements.service.js';

export interface OwnedPlan {
  key: string;
  label: string;
  wbsNodeId: string;
  serviceId: string;
  anchor: AnchorFields;
  quantity: string;
  unitId: string;
  memory: MemoryDto;
}

export interface Owner {
  kind: 'sheet' | 'schedule';
  id: string;
  title: string;
  sourceReference: string | null;
  documentId: string | null;
  inputs: Prisma.InputJsonValue;
}

export interface SyncResult { created: number; revised: number; unchanged: number; archived: number; linkedServices: number }

const ANCHOR_COLS = ['anchorKind', 'structureNodeId', 'networkSegmentId', 'networkNodeId', 'physicalElementId', 'typologyId', 'elementKey', 'dwellingUnitId'] as const;
export const sameAnchor = (a: AnchorFields, b: AnchorFields) => ANCHOR_COLS.every((k) => (a[k] ?? null) === (b[k] ?? null));

export async function syncOwnedMeasurements(
  tx: Tx, actor: Actor, projectId: string, owner: Owner, plans: OwnedPlan[],
  deps: { ctx: MeasurementCtx; measurements: MeasurementsService; audit: AuditService; reason: string; fingerprint: (m: MemoryDto) => string },
): Promise<SyncResult> {
  const ownerWhere = owner.kind === 'sheet' ? { sheetId: owner.id } : { scheduleId: owner.id };
  const keyOf = (m: { sheetOutputKey: string | null; scheduleKey: string | null }) => (owner.kind === 'sheet' ? m.sheetOutputKey : m.scheduleKey)!;
  const what = owner.kind === 'sheet' ? 'ficha' : 'quadro';
  const out: SyncResult = { created: 0, revised: 0, unchanged: 0, archived: 0, linkedServices: 0 };
  const byKey = new Map(plans.map((p) => [p.key, p]));

  const archive = async (id: string, why: string) => {
    await tx.measurement.update({ where: { id }, data: { archivedAt: new Date(), archiveReason: why.slice(0, 500), version: { increment: 1 } } });
    await deps.audit.record(tx, actor, { projectId, entityType: 'Measurement', entityId: id, action: 'ARCHIVE', reason: why.slice(0, 500) });
    out.archived++;
  };
  for (const ex of await tx.measurement.findMany({ where: { ...ownerWhere, archivedAt: null } })) {
    const p = byKey.get(keyOf(ex));
    if (!p) await archive(ex.id, `Retirado do ${what} "${owner.title}"`);
    else if (ex.wbsNodeId !== p.wbsNodeId || ex.serviceId !== p.serviceId || !sameAnchor(ex, p.anchor)) await archive(ex.id, `Destino alterado no ${what} "${owner.title}"`);
  }

  // vínculo serviço × item da EAP criado automaticamente (a origem declara o que mede)
  const pairs = new Map<string, Set<string>>();
  for (const p of plans) pairs.set(p.wbsNodeId, (pairs.get(p.wbsNodeId) ?? new Set()).add(p.serviceId));
  for (const [wbsNodeId, sids] of pairs) {
    const have = new Set((await tx.wbsNodeService.findMany({ where: { wbsNodeId }, select: { serviceId: true } })).map((l) => l.serviceId));
    const missing = [...sids].filter((x) => !have.has(x));
    if (!missing.length) continue;
    await tx.wbsNodeService.createMany({ data: missing.map((serviceId) => ({ wbsNodeId, projectId, organizationId: actor.organizationId, serviceId, fromTemplate: false })) });
    await deps.audit.record(tx, actor, { projectId, entityType: 'WbsNode', entityId: wbsNodeId, action: 'UPDATE', reason: `Serviços vinculados pelo ${what} "${owner.title}"`.slice(0, 500), after: { servicesAdded: missing } });
    out.linkedServices += missing.length;
  }

  const active = await tx.measurement.findMany({ where: { ...ownerWhere, archivedAt: null }, include: { revisions: { orderBy: { number: 'desc' }, take: 1 } } });
  for (const p of plans) {
    const ex = active.find((m) => keyOf(m) === p.key);
    const rev = { organizationId: actor.organizationId, projectId, method: p.memory.method as 'SHEET' | 'SCHEDULE', formulaVersionId: null, inputs: owner.inputs, memory: p.memory as unknown as Prisma.InputJsonValue, quantity: p.quantity, unitId: p.unitId, sourceReference: owner.sourceReference, documentId: owner.documentId, createdById: actor.userId };
    if (ex) {
      const last = ex.revisions[0]!;
      if (ex.quantity.toString() === p.quantity && last.unitId === p.unitId && deps.fingerprint(last.memory as unknown as MemoryDto) === deps.fingerprint(p.memory)) { out.unchanged++; continue; }
      await tx.measurement.update({ where: { id: ex.id }, data: { quantity: p.quantity, currentNumber: { increment: 1 }, version: { increment: 1 } } });
      await tx.measurementRevision.create({ data: { ...rev, measurementId: ex.id, number: ex.currentNumber + 1, reason: deps.reason.slice(0, 500) } });
      await deps.audit.record(tx, actor, { projectId, entityType: 'Measurement', entityId: ex.id, action: 'UPDATE', reason: deps.reason.slice(0, 500), before: { quantity: ex.quantity.toString(), revision: ex.currentNumber }, after: { quantity: p.quantity, revision: ex.currentNumber + 1, method: p.memory.method } });
      out.revised++;
    } else {
      await deps.measurements.checkOverlap(tx, projectId, p.wbsNodeId, p.serviceId, p.anchor, deps.ctx);
      const origin = owner.kind === 'sheet' ? { sheetId: owner.id, sheetOutputKey: p.key } : { scheduleId: owner.id, scheduleKey: p.key };
      const m = await tx.measurement.create({ data: { organizationId: actor.organizationId, projectId, wbsNodeId: p.wbsNodeId, serviceId: p.serviceId, ...p.anchor, ...origin, quantity: p.quantity } });
      await tx.measurementRevision.create({ data: { ...rev, measurementId: m.id, number: 1 } });
      await deps.audit.record(tx, actor, { projectId, entityType: 'Measurement', entityId: m.id, action: 'CREATE', after: { wbsNodeId: p.wbsNodeId, serviceId: p.serviceId, quantity: p.quantity, unit: p.memory.unit, method: p.memory.method, [`${owner.kind}Id`]: owner.id, key: p.key, label: p.label } });
      out.created++;
    }
  }
  return out;
}
