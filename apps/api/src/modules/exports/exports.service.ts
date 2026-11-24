import { Injectable } from '@nestjs/common';
import { Decimal } from 'decimal.js';
import type { ConsolidationDimensionKey, ExportInput, MemoryDto } from '@eapq/contracts';
import { ANCHOR_KIND_LABELS, DIMENSION_LABELS, IMPORT_FIELDS, MODULE_KIND_LABELS, NODE_KIND_LABELS, type ImportKindKey, type ModuleKind, type NodeKind } from '@eapq/domain';
import { AppError, notFound } from '../../common/errors.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { ConsolidationService } from '../consolidation/consolidation.service.js';
import { toRevisionElements } from '../constructive/constructive.service.js';
import { loadContext } from '../measurements/context.js';
import { RevisionsService } from '../revisions/revisions.service.js';
import { qty, renderCsv, renderPdf, renderXlsx, type Cell, type Report } from './render.js';

const DIMENSIONS = Object.keys(DIMENSION_LABELS) as ConsolidationDimensionKey[];
const when = () => new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
const label = (f: ImportKindKey) => IMPORT_FIELDS[f].map((x) => x.label);
const WBS_TYPE = { GROUP: 'Agrupador', ITEM: 'Item quantificável' } as const;
const METHOD = { MANUAL: 'Manual', FORMULA: 'Fórmula', IMPORTED: 'Importada' } as const;

@Injectable()
export class ExportsService {
  constructor(private readonly prisma: PrismaService, private readonly consolidation: ConsolidationService, private readonly revisions: RevisionsService) {}

  async render(r: Report, format: ExportInput['format']): Promise<{ buffer: Buffer; mime: string; fileName: string }> {
    const stamp = new Date().toISOString().slice(0, 10);
    if (format === 'csv') return { buffer: renderCsv(r), mime: 'text/csv; charset=utf-8', fileName: `${r.fileBase}-${stamp}.csv` };
    if (format === 'xlsx') return { buffer: await renderXlsx(r), mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', fileName: `${r.fileBase}-${stamp}.xlsx` };
    return { buffer: await renderPdf(r), mime: 'application/pdf', fileName: `${r.fileBase}-${stamp}.pdf` };
  }

  /** Modelo vazio de importação (cabeçalhos = rótulos dos campos). */
  template(kind: ImportKindKey): Report {
    return { title: 'Modelo de importação', subtitle: '', fileBase: `modelo-${kind.toLowerCase()}`, columns: IMPORT_FIELDS[kind].map((f) => ({ label: f.label })), rows: [] };
  }

  async servicesCatalog(organizationId: string): Promise<Report> {
    const org = await this.prisma.organization.findUniqueOrThrow({ where: { id: organizationId } });
    return this.servicesReport(await this.prisma.service.findMany({ where: { organizationId, projectId: null, archivedAt: null }, include: { unit: true, category: true }, orderBy: { code: 'asc' } }), `${org.name} · catálogo de serviços · emitido em ${when()}`, 'servicos-catalogo');
  }

  private servicesReport(rows: { code: string; description: string; unit: { symbol: string }; category: { code: string }; measurementCriterion: string | null; technicalDescription: string | null }[], subtitle: string, fileBase: string): Report {
    return {
      title: 'Serviços', subtitle, fileBase, columns: label('SERVICES').map((l) => ({ label: l })),
      rows: rows.map((s) => [s.code, s.description, s.unit.symbol, s.category.code, s.measurementCriterion, s.technicalDescription]),
    };
  }

  async project(organizationId: string, projectId: string, input: ExportInput): Promise<Report> {
    const p = await this.prisma.project.findFirst({ where: { id: projectId, organizationId } });
    if (!p) throw notFound('Empreendimento');
    const sub = (extra = '') => `${p.code} ${p.name}${extra} · emitido em ${when()}`;
    switch (input.report) {
      case 'services': {
        const rows = await this.prisma.service.findMany({ where: { organizationId, projectId, archivedAt: null }, include: { unit: true, category: true }, orderBy: { code: 'asc' } });
        return this.servicesReport(rows, sub(' · serviços específicos'), `servicos-${p.code}`);
      }
      case 'structure': {
        const [nodes, modules] = await Promise.all([
          this.prisma.structureNode.findMany({ where: { projectId, archivedAt: null }, include: { unit: { include: { typology: true } }, lot: true } }),
          this.prisma.projectModule.findMany({ where: { projectId } }),
        ]);
        const byId = new Map(nodes.map((n) => [n.id, n]));
        const mod = new Map(modules.map((m) => [m.id, m]));
        const sorted = [...nodes].sort((a, b) => a.code.localeCompare(b.code, 'pt-BR', { numeric: true }));
        return {
          title: 'Cadastro físico', subtitle: sub(), fileBase: `cadastro-${p.code}`, columns: label('STRUCTURE').map((l, i) => ({ label: l, numeric: i >= 7 })),
          rows: sorted.map((n) => [n.code, n.parentId ? byId.get(n.parentId)?.code ?? null : null, mod.get(n.moduleId)?.name ?? '', MODULE_KIND_LABELS[mod.get(n.moduleId)!.kind as ModuleKind], NODE_KIND_LABELS[n.kind as NodeKind], n.name, n.unit?.typology?.code ?? null, qty(n.lot?.area?.toString()), qty(n.lot?.frontage?.toString())]),
        };
      }
      case 'wbs': {
        const nodes = await this.prisma.wbsNode.findMany({ where: { projectId, archivedAt: null }, include: { services: { include: { service: { select: { code: true } } } } } });
        nodes.sort((a, b) => a.code.localeCompare(b.code, 'pt-BR', { numeric: true }));
        return {
          title: 'EAP', subtitle: sub(), fileBase: `eap-${p.code}`,
          columns: [{ label: 'Código' }, { label: 'Título', width: 50 }, { label: 'Tipo' }, { label: 'Origem' }, { label: 'Situação' }, { label: 'Serviços', width: 30 }],
          rows: nodes.map((n) => [n.code, n.title, WBS_TYPE[n.nodeType], n.origin === 'MANUAL' ? 'Manual' : 'Gerado por template', n.status === 'OBSOLETE' ? 'Obsoleto' : 'Ativo', n.services.map((s) => s.service.code).sort().join(', ')]),
        };
      }
      case 'measurements': return this.measurements(organizationId, projectId, sub());
      case 'memories': return this.memories(projectId, sub());
      case 'consolidation': {
        const groupBy = (input.groupBy ?? []).filter((d): d is ConsolidationDimensionKey => DIMENSIONS.includes(d as ConsolidationDimensionKey));
        const filters = Object.fromEntries(Object.entries(input.filters ?? {}).filter(([k]) => DIMENSIONS.includes(k as ConsolidationDimensionKey)));
        const r = await this.consolidation.query(organizationId, projectId, { groupBy, filters, revisionId: input.revisionId });
        const base = input.revisionId ? ` · base ${(await this.prisma.projectRevision.findFirst({ where: { id: input.revisionId, projectId } }))?.code}` : ' · base: estado atual';
        return {
          title: 'Consolidação de quantitativos', subtitle: sub(base), fileBase: `consolidacao-${p.code}`,
          columns: [...groupBy.map((d) => ({ label: DIMENSION_LABELS[d], width: 30 })), { label: 'Quantidade', numeric: true }, { label: 'Unidade' }, { label: 'Linhas', numeric: true }, { label: 'Medições', numeric: true }],
          rows: [
            ...r.rows.map((x): Cell[] => [...groupBy.map((d) => x.key[d]?.label ?? '(sem valor)'), qty(x.total), x.unit, x.lines, x.measurements]),
            ...r.totals.map((t): Cell[] => [...groupBy.map((_, i) => (i === 0 ? 'Total geral' : '')), qty(t.total), t.unit, null, null]),
          ],
        };
      }
      case 'revision-compare': {
        if (!input.revisionId) throw new AppError(422, 'VALIDATION_FAILED', 'Dados inválidos', 'Informe a revisão de origem.');
        const c = await this.revisions.compare(organizationId, projectId, input.revisionId, input.compareTo ?? 'current');
        const kind = { added: 'Incluído', removed: 'Excluído', changed: 'Alterado' } as const;
        return {
          title: `Comparação ${c.from.code} × ${c.to.code}`, subtitle: sub(), fileBase: `comparacao-${c.from.code}-${c.to.id ? c.to.code : 'atual'}`,
          columns: [{ label: 'Item da EAP', width: 30 }, { label: 'Serviço', width: 30 }, { label: c.from.code, numeric: true }, { label: c.to.code, numeric: true }, { label: 'Diferença', numeric: true }, { label: 'Unidade' }, { label: 'Situação' }],
          rows: c.quantities.map((x) => [x.wbs, x.service, qty(x.before), qty(x.after), qty(x.delta), x.unit, kind[x.kind]]),
        };
      }
    }
  }

  private async measurements(organizationId: string, projectId: string, subtitle: string): Promise<Report> {
    const [ms, ctx, revs, networks] = await Promise.all([
      this.prisma.measurement.findMany({ where: { projectId, archivedAt: null }, include: { wbsNode: { select: { code: true } }, service: { select: { code: true } }, revisions: { include: { unit: { select: { symbol: true } } } } }, orderBy: { createdAt: 'asc' } }),
      loadContext(this.prisma, projectId),
      this.prisma.typologyRevision.findMany({ where: { projectId }, include: { elements: true }, orderBy: { number: 'desc' } }),
      this.prisma.infrastructureNetwork.findMany({ where: { projectId }, select: { id: true, code: true } }),
    ]);
    const net = new Map(networks.map((n) => [n.id, n.code]));
    // caminho por nomes do elemento de tipologia (revisão mais recente que o contém)
    const chainName = new Map<string, string>();
    for (const r of revs) {
      const els = toRevisionElements(r.elements);
      const byKey = new Map(els.map((e) => [e.stableKey, e]));
      for (const e of els) {
        if (chainName.has(e.stableKey)) continue;
        const parts: string[] = [];
        let c: typeof e | undefined = e;
        while (c) { parts.unshift(c.name); c = c.parentStableKey ? byKey.get(c.parentStableKey) : undefined; }
        chainName.set(e.stableKey, parts.join(' › '));
      }
    }
    const segs = await this.prisma.networkSegment.findMany({ where: { projectId }, select: { id: true, code: true, networkId: true } });
    const nns = await this.prisma.networkNode.findMany({ where: { projectId }, select: { id: true, code: true, networkId: true } });
    const segCode = new Map(segs.map((s) => [s.id, `${net.get(s.networkId)}/${s.code}`]));
    const nnCode = new Map(nns.map((s) => [s.id, `${net.get(s.networkId)}/${s.code}`]));
    const typCode = new Map([...ctx.typologies.values()].map((t) => [t.id, t.code]));
    const anchor = (m: (typeof ms)[number]): string => {
      switch (m.anchorKind) {
        case 'STRUCTURE_NODE': return ctx.nodes.get(m.structureNodeId!)?.code ?? '';
        case 'NETWORK_SEGMENT': return segCode.get(m.networkSegmentId!) ?? '';
        case 'NETWORK_NODE': return nnCode.get(m.networkNodeId!) ?? '';
        case 'PHYSICAL_ELEMENT': return ctx.physical.get(m.physicalElementId!)?.name ?? '';
        case 'TYPOLOGY_ELEMENT': {
          const name = m.elementKey!.startsWith('unit:') ? (ctx.units.get(m.dwellingUnitId!)?.elements ?? []).find((e) => e.stableKey === m.elementKey)?.name : chainName.get(m.elementKey!);
          return `${typCode.get(m.typologyId!) ?? ''} › ${name ?? ''}`;
        }
      }
    };
    return {
      title: 'Quantitativos (medições vigentes)', subtitle, fileBase: 'quantitativos',
      columns: [...label('MEASUREMENTS').map((l) => ({ label: l, numeric: l === 'Quantidade' })), { label: 'Revisão', numeric: true }, { label: 'Método' }],
      rows: ms.map((m) => {
        const cur = m.revisions.find((v) => v.number === m.currentNumber)!;
        return [m.wbsNode.code, m.service.code, ANCHOR_KIND_LABELS[m.anchorKind], anchor(m), m.dwellingUnitId ? ctx.nodes.get(m.dwellingUnitId)?.code ?? null : null, qty(new Decimal(m.quantity.toString()).toFixed()), cur.unit.symbol, cur.sourceReference, cur.notes, cur.number, METHOD[cur.method]];
      }),
    };
  }

  private async memories(projectId: string, subtitle: string): Promise<Report> {
    const revs = await this.prisma.measurementRevision.findMany({ where: { projectId }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], include: { unit: { select: { symbol: true } }, measurement: { include: { wbsNode: { select: { code: true, title: true } }, service: { select: { code: true } } } } } });
    const users = new Map((await this.prisma.user.findMany({ where: { id: { in: [...new Set(revs.map((r) => r.createdById))] } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]));
    return {
      title: 'Memórias de cálculo', subtitle, fileBase: 'memorias',
      columns: [{ label: 'Item da EAP' }, { label: 'Serviço' }, { label: 'Revisão', numeric: true }, { label: 'Método' }, { label: 'Fórmula' }, { label: 'Entradas', width: 40 }, { label: 'Expressão substituída', width: 40 }, { label: 'Quantidade', numeric: true }, { label: 'Unidade' }, { label: 'Motivo' }, { label: 'Documento de origem' }, { label: 'Autor' }, { label: 'Data' }],
      rows: revs.map((v) => {
        const m = v.memory as unknown as MemoryDto;
        return [
          `${v.measurement.wbsNode.code} ${v.measurement.wbsNode.title}`, v.measurement.service.code, v.number, METHOD[v.method],
          m.formula ? `${m.formula.code} R${m.formula.versionNumber}: ${m.expression}` : null,
          (m.inputs ?? []).map((i) => `${i.symbol} = ${i.value} ${i.unit}`).join('; '), m.substituted,
          qty(new Decimal(v.quantity.toString()).toFixed()), v.unit.symbol, v.reason, v.sourceReference, users.get(v.createdById) ?? '—', v.createdAt.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }),
        ];
      }),
    };
  }
}
