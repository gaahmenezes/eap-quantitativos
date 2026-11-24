/**
 * Regeneração controlada (RN-REG): compara a EAP existente com a desejada por generationKey.
 * Nunca apaga nós protegidos (com dados vinculados ou subnós manuais): eles ficam OBSOLETOS.
 * Nós manuais e nós excluídos (arquivados) pelo usuário não são tocados.
 */
import type { DesiredNode, WbsNodeType } from './model.js';

export interface ExistingWbsNode {
  id: string;
  parentId: string | null;
  generationKey: string | null;
  moduleId: string | null;
  title: string;
  nodeType: WbsNodeType;
  position: number;
  status: 'ACTIVE' | 'OBSOLETE';
  archived: boolean;
  origin: 'GENERATED' | 'MANUAL';
  /** Título editado pelo usuário: a regeneração não o sobrescreve. */
  titleOverridden: boolean;
  /** Movido pelo usuário: a regeneração não altera pai nem posição. */
  placementOverridden: boolean;
  templateVersionId: string | null;
}

export interface WbsUpdate {
  id: string;
  key: string;
  changes: {
    title?: { from: string; to: string };
    nodeType?: { from: WbsNodeType; to: WbsNodeType };
    parentKey?: { from: string | null; to: string | null };
    position?: { from: number; to: number };
    reactivate?: true;
    templateVersionId?: { from: string | null; to: string };
  };
}

export interface WbsDiff {
  create: DesiredNode[];
  update: WbsUpdate[];
  unchanged: number;
  /** Sem dados vinculados: serão removidos. */
  remove: { id: string; title: string }[];
  /** Com dados vinculados ou subnós manuais: ficam obsoletos, nunca apagados. */
  obsolete: { id: string; title: string; reason: string }[];
  /** Nós que o usuário excluiu (arquivou) e que o template ainda geraria: permanecem excluídos. */
  keptArchived: number;
}

export function diffWbs(
  existing: readonly ExistingWbsNode[],
  desired: readonly DesiredNode[],
  opts: { moduleIds: readonly string[]; protectedIds: ReadonlySet<string> },
): WbsDiff {
  const byKey = new Map(existing.filter((e) => e.generationKey).map((e) => [e.generationKey!, e]));
  const byId = new Map(existing.map((e) => [e.id, e]));
  const keyOfId = (id: string | null) => (id ? (byId.get(id)?.generationKey ?? `id:${id}`) : null);
  const desiredKeys = new Set(desired.map((d) => d.key));
  const scope = new Set(opts.moduleIds);

  const create: DesiredNode[] = [];
  const update: WbsUpdate[] = [];
  let unchanged = 0;
  let keptArchived = 0;
  for (const d of desired) {
    const e = byKey.get(d.key);
    if (!e) { create.push(d); continue; }
    if (e.archived) { keptArchived++; continue; }
    const ch: WbsUpdate['changes'] = {};
    if (!e.titleOverridden && e.title !== d.title) ch.title = { from: e.title, to: d.title };
    if (e.nodeType !== d.nodeType) ch.nodeType = { from: e.nodeType, to: d.nodeType };
    if (!e.placementOverridden) {
      const curParent = keyOfId(e.parentId);
      if (curParent !== d.parentKey) ch.parentKey = { from: curParent, to: d.parentKey };
      if (e.position !== d.position) ch.position = { from: e.position, to: d.position };
    }
    if (e.status === 'OBSOLETE') ch.reactivate = true;
    if (e.templateVersionId !== d.templateVersionId) ch.templateVersionId = { from: e.templateVersionId, to: d.templateVersionId };
    const meaningful = Object.keys(ch).filter((k) => k !== 'templateVersionId');
    if (meaningful.length) update.push({ id: e.id, key: d.key, changes: ch });
    else { unchanged++; if (ch.templateVersionId) update.push({ id: e.id, key: d.key, changes: ch }); }
  }

  // Candidatos a remoção: nós gerados dos módulos regenerados que o template não produz mais.
  const gone = existing.filter((e) => e.origin === 'GENERATED' && !e.archived && e.moduleId && scope.has(e.moduleId) && e.generationKey && !desiredKeys.has(e.generationKey));
  const goneIds = new Set(gone.map((g) => g.id));
  // Protegido = tem dados, ou tem descendente protegido/manual/que permanece.
  const keepers = new Set<string>(opts.protectedIds);
  for (const e of existing) {
    const staysOnItsOwn = !goneIds.has(e.id); // manual, de outro módulo, ou ainda desejado
    if (!staysOnItsOwn && !opts.protectedIds.has(e.id)) continue;
    let p = e.parentId;
    while (p) { keepers.add(p); p = byId.get(p)?.parentId ?? null; }
  }
  const remove: WbsDiff['remove'] = [];
  const obsolete: WbsDiff['obsolete'] = [];
  for (const g of gone) {
    if (keepers.has(g.id)) {
      if (g.status !== 'OBSOLETE') obsolete.push({ id: g.id, title: g.title, reason: opts.protectedIds.has(g.id) ? 'possui dados vinculados' : 'possui subnós que permanecem' });
    } else remove.push({ id: g.id, title: g.title });
  }
  return { create, update, unchanged, remove, obsolete, keptArchived };
}
