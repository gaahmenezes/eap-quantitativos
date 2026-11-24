/**
 * Importadores por tipo. Cada um carrega o contexto uma vez, valida todas as linhas (sem gravar nada)
 * e, na confirmação, grava as linhas válidas numa única transação com auditoria.
 */
import { randomUUID } from 'node:crypto';
import { Decimal } from 'decimal.js';
import {
  ANCHOR_KIND_LABELS, canPlace, findCoverageConflicts, FormulaError, manualQuantity, MODULE_KIND_LABELS, MODULE_KINDS,
  NODE_KIND_LABELS, normalizeDescription, normalizeHeader, parseDecimalText, type ModuleKind, type NodeKind,
} from '@eapq/domain';
import type { Actor } from '../../common/auth/auth-context.js';
import type { Prisma } from '../../generated/prisma/client.js';
import type { Tx } from '../../prisma/prisma.service.js';
import type { AuditService } from '../audit/audit.service.js';
import { loadUnits, type OrgUnit } from '../formulas/units.js';
import { coverageOf, loadContext, replacementKeys, type AnchorFields } from '../measurements/context.js';
import { latestPublishedRevision, toRevisionElements } from '../constructive/constructive.service.js';
import { recomputeStructureCodes } from '../structure/codes.js';

export interface RowIn { rowNumber: number; get: (field: string) => string }
export interface RowOut { rowNumber: number; status: 'VALID' | 'WARNING' | 'ERROR'; messages: string[]; data: Record<string, unknown> | null }
export interface ImportScope { organizationId: string; projectId: string | null }
export interface ApplyInfo { jobId: string; fileName: string }

export interface Importer {
  validate(tx: Tx, scope: ImportScope, rows: RowIn[]): Promise<RowOut[]>;
  apply(tx: Tx, actor: Actor, scope: ImportScope, rows: RowOut[], info: ApplyInfo, audit: AuditService): Promise<number>;
}

const CODE_RE = /^[A-Z0-9][A-Z0-9._-]*$/;
const out = (rowNumber: number, errors: string[], warnings: string[], data: Record<string, unknown>): RowOut =>
  errors.length ? { rowNumber, status: 'ERROR', messages: errors, data: null } : { rowNumber, status: warnings.length ? 'WARNING' : 'VALID', messages: warnings, data };

// ---------------------------------------------------------------- serviços
export const servicesImporter: Importer = {
  async validate(tx, scope, rows) {
    const [units, cats, existing] = await Promise.all([
      tx.unitOfMeasure.findMany({ where: { organizationId: scope.organizationId, archivedAt: null }, select: { id: true, symbol: true } }),
      tx.serviceCategory.findMany({ where: { organizationId: scope.organizationId, archivedAt: null }, select: { id: true, code: true } }),
      tx.service.findMany({ where: { organizationId: scope.organizationId, OR: [{ projectId: null }, ...(scope.projectId ? [{ projectId: scope.projectId }] : [])] }, select: { code: true, projectId: true } }),
    ]);
    const unitBy = new Map(units.map((u) => [u.symbol, u.id]));
    const catBy = new Map(cats.map((c) => [c.code.toUpperCase(), c.id]));
    const taken = new Map(existing.map((s) => [s.code, s.projectId ? 'neste empreendimento' : 'no catálogo da organização']));
    const seen = new Map<string, number>();
    return rows.map((r) => {
      const e: string[] = [];
      const code = r.get('code').toUpperCase();
      const description = r.get('description');
      if (!code) e.push('Código obrigatório.');
      else if (code.length > 30 || !CODE_RE.test(code)) e.push(`Código inválido: "${code}" (letras, números, ponto, hífen ou sublinhado).`);
      else if (taken.has(code)) e.push(`O código ${code} já existe ${taken.get(code)}.`);
      else if (seen.has(code)) e.push(`Código ${code} repetido na planilha (linha ${seen.get(code)}).`);
      if (code) seen.set(code, seen.get(code) ?? r.rowNumber);
      if (!description) e.push('Descrição obrigatória.'); else if (description.length > 300) e.push('Descrição com mais de 300 caracteres.');
      const unitId = unitBy.get(r.get('unit'));
      if (!r.get('unit')) e.push('Unidade obrigatória.'); else if (!unitId) e.push(`Unidade não cadastrada: ${r.get('unit')}.`);
      const categoryId = catBy.get(r.get('category').toUpperCase());
      if (!r.get('category')) e.push('Código da categoria obrigatório.'); else if (!categoryId) e.push(`Categoria não cadastrada: ${r.get('category')}.`);
      if (r.get('criterion').length > 2000) e.push('Critério de medição com mais de 2.000 caracteres.');
      if (r.get('technical').length > 4000) e.push('Descrição técnica com mais de 4.000 caracteres.');
      return out(r.rowNumber, e, [], { code, description, unitId, categoryId, criterion: r.get('criterion') || null, technical: r.get('technical') || null });
    });
  },
  async apply(tx, actor, scope, rows, info, audit) {
    const data = rows.map((r) => ({ id: randomUUID(), ...(r.data as { code: string; description: string; unitId: string; categoryId: string; criterion: string | null; technical: string | null }) }));
    await tx.service.createMany({
      data: data.map((d) => ({
        id: d.id, organizationId: scope.organizationId, projectId: scope.projectId, code: d.code, description: d.description, normalizedDescription: normalizeDescription(d.description),
        categoryId: d.categoryId, unitId: d.unitId, measurementCriterion: d.criterion, technicalDescription: d.technical, origin: scope.projectId ? 'PROJECT' : 'CATALOG',
      })),
    });
    await audit.recordMany(tx, actor, data.map((d) => ({ projectId: scope.projectId, entityType: 'Service', entityId: d.id, action: 'CREATE', after: { code: d.code, description: d.description }, reason: `Importação ${info.fileName}` })));
    return data.length;
  },
};

// ---------------------------------------------------------------- cadastro físico
const KIND_BY_LABEL = new Map<string, NodeKind>([...Object.entries(NODE_KIND_LABELS).flatMap(([k, l]) => [[normalizeHeader(l), k as NodeKind], [normalizeHeader(k), k as NodeKind]] as [string, NodeKind][])]);
const MODULE_BY_LABEL = new Map<string, ModuleKind>([...MODULE_KINDS.flatMap((k) => [[normalizeHeader(MODULE_KIND_LABELS[k]), k], [normalizeHeader(k), k]] as [string, ModuleKind][])]);
const typologyKindFor = (m: ModuleKind) => (m === 'VERTICAL_RESIDENTIAL' ? 'APARTMENT' : m === 'HORIZONTAL_RESIDENTIAL' ? 'HOUSE' : null);

interface StructureRow { ref: string; parentRef: string | null; parentRow: number | null; parentNodeId: string | null; moduleName: string; moduleId: string | null; moduleKind: ModuleKind; kind: NodeKind; name: string; typologyId: string | null; area: string | null; frontage: string | null }

export const structureImporter: Importer = {
  async validate(tx, scope, rows) {
    const projectId = scope.projectId!;
    const [modules, nodes, typologies] = await Promise.all([
      tx.projectModule.findMany({ where: { projectId, archivedAt: null } }),
      tx.structureNode.findMany({ where: { projectId, archivedAt: null }, select: { id: true, code: true, kind: true, moduleId: true } }),
      tx.dwellingTypology.findMany({ where: { projectId }, select: { id: true, code: true, kind: true, archivedAt: true } }),
    ]);
    const modByName = new Map(modules.map((m) => [m.name.trim().toLowerCase(), m]));
    const nodeByCode = new Map(nodes.map((n) => [n.code, n]));
    const typByCode = new Map(typologies.map((t) => [t.code.toUpperCase(), t]));
    const refRow = new Map<string, number>();
    for (const r of rows) { const ref = r.get('ref'); if (ref && !refRow.has(ref)) refRow.set(ref, r.rowNumber); }
    const parsed = new Map<number, { kind: NodeKind | null; moduleKey: string; moduleKind: ModuleKind | null; parentRef: string }>();
    const newModules = new Map<string, ModuleKind>();
    for (const r of rows) {
      const kind = KIND_BY_LABEL.get(normalizeHeader(r.get('kind'))) ?? null;
      const name = r.get('module').trim();
      const existing = modByName.get(name.toLowerCase());
      const mk = existing?.kind ?? MODULE_BY_LABEL.get(normalizeHeader(r.get('moduleKind'))) ?? newModules.get(name.toLowerCase()) ?? null;
      if (!existing && mk && name) newModules.set(name.toLowerCase(), mk);
      parsed.set(r.rowNumber, { kind, moduleKey: name.toLowerCase(), moduleKind: mk, parentRef: r.get('parentRef') });
    }
    const results: RowOut[] = [];
    for (const r of rows) {
      const e: string[] = [];
      const p = parsed.get(r.rowNumber)!;
      const ref = r.get('ref');
      if (!ref) e.push('Referência obrigatória.');
      else if (refRow.get(ref) !== r.rowNumber) e.push(`Referência ${ref} repetida (linha ${refRow.get(ref)}).`);
      if (!r.get('name')) e.push('Nome obrigatório.'); else if (r.get('name').length > 120) e.push('Nome com mais de 120 caracteres.');
      if (!p.kind) e.push(`Tipo não reconhecido: "${r.get('kind')}".`);
      if (!p.moduleKey) e.push('Módulo obrigatório.');
      else if (!p.moduleKind) e.push(`O módulo "${r.get('module')}" não existe; informe o tipo do módulo para criá-lo.`);
      let parentKind: NodeKind | null = null;
      let parentRow: number | null = null;
      let parentNodeId: string | null = null;
      if (p.parentRef) {
        if (refRow.has(p.parentRef)) {
          parentRow = refRow.get(p.parentRef)!;
          const pp = parsed.get(parentRow)!;
          parentKind = pp.kind;
          if (pp.moduleKey !== p.moduleKey) e.push('O item superior está em outro módulo.');
          // ciclo: sobe pelas referências da planilha
          const seen = new Set<number>([r.rowNumber]);
          let cur: number | null = parentRow;
          while (cur !== null) {
            if (seen.has(cur)) { e.push('Referências em ciclo.'); break; }
            seen.add(cur);
            const pr: string = parsed.get(cur)!.parentRef;
            cur = pr && refRow.has(pr) ? refRow.get(pr)! : null;
          }
        } else if (nodeByCode.has(p.parentRef)) {
          const n = nodeByCode.get(p.parentRef)!;
          parentNodeId = n.id;
          parentKind = n.kind as NodeKind;
          const m = modByName.get(p.moduleKey);
          if (!m || m.id !== n.moduleId) e.push('O item superior existente está em outro módulo.');
        } else e.push(`Item superior não encontrado: ${p.parentRef}.`);
      }
      if (p.kind && p.moduleKind && !e.length && !canPlace(p.moduleKind, parentKind, p.kind)) {
        e.push(`${NODE_KIND_LABELS[p.kind]} não pode ficar ${parentKind ? `dentro de ${NODE_KIND_LABELS[parentKind]}` : 'na raiz do módulo'} (${MODULE_KIND_LABELS[p.moduleKind]}).`);
      }
      let typologyId: string | null = null;
      if (r.get('typology')) {
        const t = typByCode.get(r.get('typology').toUpperCase());
        if (p.kind !== 'DWELLING_UNIT') e.push('Tipologia só se aplica a unidades habitacionais.');
        else if (!t) e.push(`Tipologia não cadastrada: ${r.get('typology')}.`);
        else if (t.archivedAt) e.push(`Tipologia ${t.code} arquivada.`);
        else if (p.moduleKind && typologyKindFor(p.moduleKind) && t.kind !== typologyKindFor(p.moduleKind)) e.push(`A tipologia ${t.code} não serve para este módulo.`);
        else typologyId = t.id;
      }
      const num = (f: string, label: string, max: number) => {
        const raw = r.get(f);
        if (!raw) return null;
        const v = parseDecimalText(raw);
        if (v === null || new Decimal(v).lt(0)) { e.push(`${label} inválida: "${raw}".`); return null; }
        if (new Decimal(v).gte(max)) { e.push(`${label} fora do limite.`); return null; }
        if (p.kind !== 'LOT') { e.push(`${label} só se aplica a lotes.`); return null; }
        return v;
      };
      const area = num('lotArea', 'Área do lote', 1e10);
      const frontage = num('lotFrontage', 'Testada', 1e7);
      results.push(out(r.rowNumber, e, [], { ref, parentRef: p.parentRef || null, parentRow, parentNodeId, moduleName: r.get('module').trim(), moduleId: modByName.get(p.moduleKey)?.id ?? null, moduleKind: p.moduleKind, kind: p.kind, name: r.get('name'), typologyId, area, frontage } as unknown as Record<string, unknown>));
    }
    // filho de linha com erro também é erro
    const bad = new Set(results.filter((x) => x.status === 'ERROR').map((x) => x.rowNumber));
    let changed = true;
    while (changed) {
      changed = false;
      for (const x of results) {
        const pr: number | null = x.data ? (x.data as unknown as StructureRow).parentRow : null;
        if (x.status !== 'ERROR' && pr !== null && bad.has(pr)) { x.status = 'ERROR'; x.messages = [`O item superior (linha ${pr}) tem erro.`]; x.data = null; bad.add(x.rowNumber); changed = true; }
      }
    }
    return results;
  },
  async apply(tx, actor, scope, rows, info, audit) {
    const projectId = scope.projectId!;
    const data = rows.map((r) => ({ rowNumber: r.rowNumber, ...(r.data as unknown as StructureRow) }));
    // módulos novos
    const modIds = new Map<string, string>();
    const lastMod = await tx.projectModule.aggregate({ where: { projectId }, _max: { position: true } });
    let modPos = lastMod._max.position ?? 0;
    for (const d of data) {
      const key = d.moduleName.toLowerCase();
      if (d.moduleId || modIds.has(key)) continue;
      const id = randomUUID();
      await tx.projectModule.create({ data: { id, organizationId: actor.organizationId, projectId, kind: d.moduleKind, name: d.moduleName, position: ++modPos, code: '' } });
      modIds.set(key, id);
      await audit.record(tx, actor, { projectId, entityType: 'ProjectModule', entityId: id, action: 'CREATE', after: { kind: d.moduleKind, name: d.moduleName }, reason: `Importação ${info.fileName}` });
    }
    const moduleOf = (d: StructureRow) => d.moduleId ?? modIds.get(d.moduleName.toLowerCase())!;
    // ordem pai → filho
    const idByRow = new Map<number, string>();
    const pathById = new Map<string, { path: string; depth: number }>();
    const existingParents = await tx.structureNode.findMany({ where: { id: { in: data.map((d) => d.parentNodeId).filter((x): x is string => !!x) } }, select: { id: true, path: true, depth: true } });
    for (const p of existingParents) pathById.set(p.id, p);
    const nextPos = new Map<string, number>();
    const pos = async (moduleId: string, parentId: string | null) => {
      const k = `${moduleId}|${parentId ?? ''}`;
      if (!nextPos.has(k)) nextPos.set(k, (await tx.structureNode.aggregate({ where: { projectId, moduleId, parentId }, _max: { position: true } }))._max.position ?? 0);
      nextPos.set(k, nextPos.get(k)! + 1);
      return nextPos.get(k)!;
    };
    const pending = [...data];
    const nodes: Prisma.StructureNodeCreateManyInput[] = [];
    while (pending.length) {
      const ready = pending.filter((d) => d.parentRow === null || idByRow.has(d.parentRow));
      if (!ready.length) throw new Error('Hierarquia da importação inconsistente.');
      for (const d of ready) {
        const id = randomUUID();
        const parentId = d.parentRow !== null ? idByRow.get(d.parentRow)! : d.parentNodeId;
        const parent = parentId ? pathById.get(parentId)! : null;
        const node = { path: parent ? `${parent.path}/${id}` : id, depth: parent ? parent.depth + 1 : 0 };
        pathById.set(id, node);
        idByRow.set(d.rowNumber, id);
        nodes.push({ id, organizationId: actor.organizationId, projectId, moduleId: moduleOf(d), parentId, kind: d.kind, name: d.name, position: await pos(moduleOf(d), parentId), depth: node.depth, path: node.path, code: '', origin: 'MANUAL' });
        pending.splice(pending.indexOf(d), 1);
      }
    }
    for (let i = 0; i < nodes.length; i += 1000) await tx.structureNode.createMany({ data: nodes.slice(i, i + 1000) });
    const units = await Promise.all(data.filter((d) => d.kind === 'DWELLING_UNIT').map(async (d) => ({ structureNodeId: idByRow.get(d.rowNumber)!, projectId, typologyId: d.typologyId, pinnedRevisionId: d.typologyId ? (await latestPublishedRevision(tx, d.typologyId))?.id ?? null : null })));
    if (units.length) await tx.dwellingUnit.createMany({ data: units });
    const lots = data.filter((d) => d.kind === 'LOT').map((d) => ({ structureNodeId: idByRow.get(d.rowNumber)!, projectId, area: d.area, frontage: d.frontage }));
    if (lots.length) await tx.lotDetail.createMany({ data: lots });
    await recomputeStructureCodes(tx, projectId);
    await audit.recordMany(tx, actor, nodes.map((n) => ({ projectId, entityType: 'StructureNode', entityId: n.id!, action: 'CREATE', after: { kind: n.kind, name: n.name, parentId: n.parentId }, reason: `Importação ${info.fileName}` })));
    return nodes.length;
  },
};

// ---------------------------------------------------------------- medições
const ANCHOR_BY_LABEL = new Map<string, AnchorFields['anchorKind']>(Object.entries(ANCHOR_KIND_LABELS).flatMap(([k, l]) => [[normalizeHeader(l), k], [normalizeHeader(k), k]] as [string, AnchorFields['anchorKind']][]));
const splitPath = (s: string) => s.split(/\s*[›>]\s*/).map((x) => x.trim()).filter(Boolean);

interface MeasurementRow { wbsNodeId: string; serviceId: string; anchor: AnchorFields; quantity: string; unitId: string; memory: unknown; source: string | null; notes: string | null; inputs: { value: string; unit: string } }

async function typologyElementIndex(tx: Tx, projectId: string) {
  const revs = await tx.typologyRevision.findMany({ where: { projectId }, include: { elements: true }, orderBy: { number: 'desc' } });
  const idx = new Map<string, Map<string, Set<string>>>(); // typologyId → caminho/nome normalizado → chaves
  for (const r of revs) {
    const els = toRevisionElements(r.elements);
    const byKey = new Map(els.map((e) => [e.stableKey, e]));
    const m = idx.get(r.typologyId) ?? new Map<string, Set<string>>();
    for (const e of els) {
      const chain: string[] = [];
      let c: typeof e | undefined = e;
      while (c) { chain.unshift(c.name); c = c.parentStableKey ? byKey.get(c.parentStableKey) : undefined; }
      for (const k of [chain.join(' › '), e.name].map((x) => x.toLowerCase())) m.set(k, (m.get(k) ?? new Set()).add(e.stableKey));
    }
    idx.set(r.typologyId, m);
  }
  return idx;
}

export const measurementsImporter: Importer = {
  async validate(tx, scope, rows) {
    const projectId = scope.projectId!;
    const [wbs, services, units, ctx, existing, typIdx, networks, typologies] = await Promise.all([
      tx.wbsNode.findMany({ where: { projectId, archivedAt: null }, include: { services: { select: { serviceId: true } } } }),
      tx.service.findMany({ where: { organizationId: scope.organizationId, OR: [{ projectId: null }, { projectId }] }, select: { id: true, code: true, unitId: true, archivedAt: true } }),
      loadUnits(tx, scope.organizationId),
      loadContext(tx, projectId),
      tx.measurement.findMany({ where: { projectId, archivedAt: null } }),
      typologyElementIndex(tx, projectId),
      tx.infrastructureNetwork.findMany({ where: { projectId }, select: { id: true, code: true } }),
      tx.dwellingTypology.findMany({ where: { projectId }, select: { id: true, code: true } }),
    ]);
    const wbsByCode = new Map(wbs.map((w) => [w.code, w]));
    const svcByCode = new Map(services.map((s) => [s.code, s]));
    const unitById = new Map(units.map((u) => [u.id, u]));
    const nodeByCode = new Map([...ctx.nodes.values()].filter((n) => !n.archivedAt).map((n) => [n.code, n]));
    const netCode = new Map(networks.map((n) => [n.id, n.code]));
    const segBy = new Map([...ctx.segments.values()].filter((s) => !s.archivedAt).map((s) => [`${netCode.get(s.networkId)}/${s.label.split('/').pop()}`.toUpperCase(), s]));
    const nnBy = new Map([...ctx.netNodes.values()].filter((s) => !s.archivedAt).map((s) => [`${netCode.get(s.networkId)}/${s.label.split('/').pop()}`.toUpperCase(), s]));
    const peByName = new Map<string, string[]>();
    for (const p of ctx.physical.values()) if (!p.archivedAt) peByName.set(p.name.toLowerCase(), [...(peByName.get(p.name.toLowerCase()) ?? []), p.id]);
    const typByCode = new Map(typologies.map((t) => [t.code.toUpperCase(), t.id]));
    const unitByCode = new Map([...ctx.units.values()].filter((u) => !u.archived).map((u) => [ctx.nodes.get(u.id)!.code, u]));
    // cobertura existente + das linhas válidas anteriores, por item × serviço
    const pairs = new Map<string, { id: string; fields: AnchorFields }[]>();
    for (const m of existing) pairs.set(`${m.wbsNodeId}|${m.serviceId}`, [...(pairs.get(`${m.wbsNodeId}|${m.serviceId}`) ?? []), { id: m.id, fields: m }]);

    const results: RowOut[] = [];
    for (const r of rows) {
      const e: string[] = [];
      const w = wbsByCode.get(r.get('wbs'));
      if (!r.get('wbs')) e.push('Código do item da EAP obrigatório.');
      else if (!w) e.push(`Item da EAP não encontrado: ${r.get('wbs')}.`);
      else if (w.nodeType !== 'ITEM') e.push(`${r.get('wbs')} é agrupador; medições só em itens quantificáveis.`);
      const s = svcByCode.get(r.get('service').toUpperCase());
      if (!r.get('service')) e.push('Código do serviço obrigatório.');
      else if (!s) e.push(`Serviço não encontrado: ${r.get('service')}.`);
      else if (s.archivedAt) e.push(`Serviço ${s.code} arquivado.`);
      else if (w && !w.services.some((x) => x.serviceId === s.id)) e.push(`O serviço ${s.code} não está vinculado ao item ${w.code}.`);
      const kind = r.get('anchorKind') ? ANCHOR_BY_LABEL.get(normalizeHeader(r.get('anchorKind'))) : 'STRUCTURE_NODE';
      const a = r.get('anchor');
      const base: AnchorFields = { anchorKind: kind ?? 'STRUCTURE_NODE', structureNodeId: null, networkSegmentId: null, networkNodeId: null, physicalElementId: null, typologyId: null, elementKey: null, dwellingUnitId: null };
      let anchor: AnchorFields | null = null;
      if (!kind) e.push(`Tipo de âncora não reconhecido: "${r.get('anchorKind')}".`);
      else if (!a) e.push('Âncora obrigatória.');
      else if (kind === 'STRUCTURE_NODE') { const n = nodeByCode.get(a); if (n) anchor = { ...base, structureNodeId: n.id }; else e.push(`Item do cadastro não encontrado: ${a}.`); }
      else if (kind === 'NETWORK_SEGMENT') { const x = segBy.get(a.toUpperCase()); if (x) anchor = { ...base, networkSegmentId: x.id }; else e.push(`Trecho não encontrado: ${a} (use REDE/TRECHO).`); }
      else if (kind === 'NETWORK_NODE') { const x = nnBy.get(a.toUpperCase()); if (x) anchor = { ...base, networkNodeId: x.id }; else e.push(`Dispositivo não encontrado: ${a} (use REDE/CÓDIGO).`); }
      else if (kind === 'PHYSICAL_ELEMENT') {
        const ids = peByName.get(a.toLowerCase()) ?? [];
        if (ids.length === 1) anchor = { ...base, physicalElementId: ids[0]! }; else e.push(ids.length ? `Há ${ids.length} elementos chamados "${a}"; renomeie-os para importar.` : `Elemento físico não encontrado: ${a}.`);
      } else {
        const [tcode, ...rest] = splitPath(a);
        const typologyId = tcode ? typByCode.get(tcode.toUpperCase()) : undefined;
        const unit = r.get('unitRef') ? unitByCode.get(r.get('unitRef')) : undefined;
        if (!typologyId) e.push(`Tipologia não encontrada em "${a}" (use TIPOLOGIA › Elemento).`);
        else if (r.get('unitRef') && (!unit || unit.typologyId !== typologyId)) e.push(`Unidade ${r.get('unitRef')} não encontrada nesta tipologia.`);
        else {
          const path = rest.join(' › ').toLowerCase();
          let keys = [...(typIdx.get(typologyId)?.get(path) ?? [])];
          if (!keys.length && unit) keys = (unit.elements ?? []).filter((x) => x.source === 'UNIT' && x.name.toLowerCase() === (rest.at(-1) ?? '').toLowerCase()).map((x) => x.stableKey);
          if (keys.length === 1) anchor = { ...base, typologyId, elementKey: keys[0]!, dwellingUnitId: unit?.id ?? null };
          else e.push(keys.length ? `Elemento ambíguo "${rest.join(' › ')}"; informe o caminho completo (ex.: A › Sala › Piso).` : `Elemento não encontrado na tipologia: ${rest.join(' › ')}.`);
        }
      }
      const q = parseDecimalText(r.get('quantity'));
      if (!r.get('quantity')) e.push('Quantidade obrigatória.'); else if (q === null) e.push(`Quantidade inválida: "${r.get('quantity')}".`); else if (new Decimal(q).lt(0)) e.push('Quantidade negativa.');
      let calc: ReturnType<typeof manualQuantity> | null = null;
      const target = s ? unitById.get(s.unitId) : undefined;
      if (q !== null && target) {
        try { calc = manualQuantity({ value: q, unit: r.get('unit') || target.symbol }, units as OrgUnit[], target); }
        catch (x) { if (x instanceof FormulaError) e.push(...x.issues.map((i) => i.message)); else throw x; }
      }
      if (anchor && w && s && !e.length) {
        const key = `${w.id}|${s.id}`;
        const others = pairs.get(key) ?? [];
        const repl = replacementKeys([...others.map((o) => o.fields), anchor]);
        const cand = coverageOf(anchor, ctx, repl);
        if (anchor.anchorKind === 'TYPOLOGY_ELEMENT' && !cand.length) e.push('Nenhuma unidade com revisão fixada contém este elemento.');
        const conflicts = findCoverageConflicts(others.map((o) => ({ id: o.id, paths: coverageOf(o.fields, ctx, repl) })), cand);
        if (conflicts.length) {
          const where = conflicts.map((c) => (c.measurementId.startsWith('row:') ? `linha ${c.measurementId.slice(4)} da planilha` : 'medição já existente')).filter((v, i, xs) => xs.indexOf(v) === i);
          e.push(`Dupla contagem: este serviço já é medido neste item numa âncora sobreposta (${where.join(', ')}).`);
        } else if (!e.length) pairs.set(key, [...others, { id: `row:${r.rowNumber}`, fields: anchor }]);
      }
      results.push(out(r.rowNumber, e, [], { wbsNodeId: w?.id, serviceId: s?.id, anchor, quantity: calc?.quantity, unitId: target?.id, memory: calc?.memory, source: r.get('source') || null, notes: r.get('notes') || null, inputs: { value: q, unit: r.get('unit') || target?.symbol } }));
    }
    return results;
  },
  async apply(tx, actor, scope, rows, info, audit) {
    const projectId = scope.projectId!;
    const data = rows.map((r) => ({ id: randomUUID(), rowNumber: r.rowNumber, ...(r.data as unknown as MeasurementRow) }));
    for (let i = 0; i < data.length; i += 1000) {
      const chunk = data.slice(i, i + 1000);
      await tx.measurement.createMany({ data: chunk.map((d) => ({ id: d.id, organizationId: actor.organizationId, projectId, wbsNodeId: d.wbsNodeId, serviceId: d.serviceId, ...d.anchor, quantity: d.quantity })) });
      await tx.measurementRevision.createMany({
        data: chunk.map((d) => ({
          organizationId: actor.organizationId, projectId, measurementId: d.id, number: 1, method: 'IMPORTED' as const, inputs: d.inputs as Prisma.InputJsonValue,
          memory: { ...(d.memory as object), method: 'IMPORTED', import: { jobId: info.jobId, fileName: info.fileName, row: d.rowNumber } } as Prisma.InputJsonValue,
          quantity: d.quantity, unitId: d.unitId, sourceReference: (d.source ?? `Importação ${info.fileName}, linha ${d.rowNumber}`).slice(0, 300), notes: d.notes, createdById: actor.userId,
        })),
      });
    }
    await audit.recordMany(tx, actor, data.map((d) => ({ projectId, entityType: 'Measurement', entityId: d.id, action: 'CREATE', after: { wbsNodeId: d.wbsNodeId, serviceId: d.serviceId, quantity: d.quantity, method: 'IMPORTED' }, reason: `Importação ${info.fileName}, linha ${d.rowNumber}` })));
    return data.length;
  },
};

export const IMPORTERS = { SERVICES: servicesImporter, STRUCTURE: structureImporter, MEASUREMENTS: measurementsImporter } as const;
