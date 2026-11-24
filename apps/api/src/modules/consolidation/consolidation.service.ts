import { Injectable } from '@nestjs/common';
import { Decimal } from 'decimal.js';
import type { ConsolidationDimensionKey, ConsolidationFiltersInput, ConsolidationLinesDto, ConsolidationQueryInput, ConsolidationResultDto } from '@eapq/contracts';
import { grandTotals, sortRows, type ConsolidationRow } from '@eapq/domain';
import { Prisma } from '../../generated/prisma/client.js';
import { notFound } from '../../common/errors.js';
import { PrismaService, type Tx } from '../../prisma/prisma.service.js';
import { anchorLabel, loadContext } from '../measurements/context.js';
import { col, enrichedCte, STRUCTURE_KINDS, whereFilters } from './sql.js';

const MAX_ROWS = 5000;
const norm = (v: string) => new Decimal(v).toFixed();

/** De onde vêm as linhas: estado atual (calculado) ou a fotografia de uma revisão emitida. */
export type Source = { projectId: string; revisionId?: string | null };

export function sourceCte(s: Source): Prisma.Sql {
  return s.revisionId
    ? Prisma.sql`WITH enriched AS (SELECT * FROM revision_line WHERE "revisionId" = ${s.revisionId}::uuid)`
    : enrichedCte(s.projectId);
}

@Injectable()
export class ConsolidationService {
  constructor(private readonly prisma: PrismaService) {}

  /** Consultas de consolidação rodam em transação somente leitura. */
  private readOnly<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SET TRANSACTION READ ONLY`;
      return fn(tx);
    }, { timeout: 30_000 });
  }

  async assertRevision(projectId: string, revisionId?: string | null) {
    if (!revisionId) return;
    if (!(await this.prisma.projectRevision.findFirst({ where: { id: revisionId, projectId }, select: { id: true } }))) throw notFound('Revisão');
  }

  /** Agregação em SQL; resultado com ids (usado também pelo teste de equivalência e pelas revisões). */
  async rawRows(projectId: string, groupBy: ConsolidationDimensionKey[], filters: ConsolidationFiltersInput, revisionId?: string | null, tx?: Tx): Promise<{ rows: ConsolidationRow[]; truncated: boolean }> {
    const dims = groupBy.map((d) => Prisma.sql`${col(d)}::text AS ${col(d)}`);
    const select = Prisma.join([...dims, Prisma.sql`unit_symbol`, Prisma.sql`sum(qty)::text AS total`, Prisma.sql`count(*)::int AS lines`, Prisma.sql`count(DISTINCT mid)::int AS measurements`], ', ');
    const group = Prisma.join([...groupBy.map((d) => col(d)), Prisma.sql`unit_symbol`], ', ');
    const run = (t: Tx) => t.$queryRaw<Record<string, string | number | null>[]>`
      ${sourceCte({ projectId, revisionId })}
      SELECT ${select} FROM enriched ${whereFilters(filters)} GROUP BY ${group} LIMIT ${MAX_ROWS + 1}`;
    const raw = tx ? await run(tx) : await this.readOnly(run);
    const rows: ConsolidationRow[] = raw.slice(0, MAX_ROWS).map((r) => ({
      key: Object.fromEntries(groupBy.map((d) => [d, (r[d] as string | null) ?? null])),
      unit: r['unit_symbol'] as string, total: norm(r['total'] as string), lines: r['lines'] as number, measurements: r['measurements'] as number,
    }));
    return { rows: sortRows(rows, groupBy), truncated: raw.length > MAX_ROWS };
  }

  async query(organizationId: string, projectId: string, q: ConsolidationQueryInput): Promise<ConsolidationResultDto> {
    const t0 = performance.now();
    await this.assertRevision(projectId, q.revisionId);
    const { rows, truncated } = await this.rawRows(projectId, q.groupBy, q.filters, q.revisionId);
    let totals = grandTotals(rows);
    if (truncated) totals = (await this.rawRows(projectId, [], q.filters, q.revisionId)).rows.map((r) => ({ unit: r.unit, total: r.total }));
    const ids = new Set(rows.flatMap((r) => q.groupBy.map((d) => r.key[d]).filter((x): x is string => !!x)));
    const labels = q.revisionId ? await this.revisionLabels(q.revisionId, [...ids]) : await this.labels(this.prisma, organizationId, projectId, q.groupBy.map((d) => ({ dim: d, ids: [...new Set(rows.map((r) => r.key[d]).filter((x): x is string => !!x))] })));
    return {
      groupBy: q.groupBy,
      rows: rows.map((r) => ({ ...r, key: Object.fromEntries(q.groupBy.map((d) => { const id = r.key[d]; return [d, id ? { id, label: labels.get(id) ?? '—' } : null]; })) })),
      totals, truncated, elapsedMs: Math.round(performance.now() - t0),
    };
  }

  async revisionLabels(revisionId: string, ids: string[]): Promise<Map<string, string>> {
    const rows = await this.prisma.revisionLabel.findMany({ where: { revisionId, entityId: { in: ids } } });
    return new Map(rows.map((r) => [r.entityId, r.label]));
  }

  /** Rótulos atuais (código e nome) das entidades, por dimensão. */
  async labels(tx: Tx, organizationId: string, projectId: string, wanted: { dim: ConsolidationDimensionKey; ids: string[] }[]): Promise<Map<string, string>> {
    const of = (dims: ConsolidationDimensionKey[]) => [...new Set(wanted.filter((w) => dims.includes(w.dim)).flatMap((w) => w.ids))];
    const wbsIds = of(['wbs1', 'wbs2', 'wbs3', 'wbsItem']);
    const nodeIds = of([...STRUCTURE_KINDS, 'unit']);
    const [w, s, c, mo, n, t, sy, ne] = await Promise.all([
      wbsIds.length ? tx.wbsNode.findMany({ where: { projectId, id: { in: wbsIds } }, select: { id: true, code: true, title: true } }) : [],
      of(['service']).length ? tx.service.findMany({ where: { organizationId, id: { in: of(['service']) } }, select: { id: true, code: true, description: true } }) : [],
      of(['category']).length ? tx.serviceCategory.findMany({ where: { organizationId, id: { in: of(['category']) } }, select: { id: true, code: true, name: true } }) : [],
      of(['module']).length ? tx.projectModule.findMany({ where: { projectId, id: { in: of(['module']) } }, select: { id: true, name: true } }) : [],
      nodeIds.length ? tx.structureNode.findMany({ where: { projectId, id: { in: nodeIds } }, select: { id: true, code: true, name: true } }) : [],
      of(['typology']).length ? tx.dwellingTypology.findMany({ where: { projectId, id: { in: of(['typology']) } }, select: { id: true, code: true, name: true } }) : [],
      of(['system']).length ? tx.infrastructureSystem.findMany({ where: { projectId, id: { in: of(['system']) } }, select: { id: true, name: true } }) : [],
      of(['network']).length ? tx.infrastructureNetwork.findMany({ where: { projectId, id: { in: of(['network']) } }, select: { id: true, code: true, name: true } }) : [],
    ]);
    const out = new Map<string, string>();
    for (const x of w) out.set(x.id, `${x.code} ${x.title}`);
    for (const x of s) out.set(x.id, `${x.code} ${x.description}`);
    for (const x of c) out.set(x.id, `${x.code} ${x.name}`);
    for (const x of mo) out.set(x.id, x.name);
    for (const x of n) out.set(x.id, `${x.code} ${x.name}`);
    for (const x of t) out.set(x.id, `${x.code} — ${x.name}`);
    for (const x of sy) out.set(x.id, x.name);
    for (const x of ne) out.set(x.id, `${x.code} ${x.name}`);
    return out;
  }

  /** Detalhamento: linhas efetivas por trás de um grupo, até a medição (e sua memória). */
  async lines(projectId: string, filters: ConsolidationFiltersInput, limit: number, revisionId?: string | null): Promise<ConsolidationLinesDto> {
    await this.assertRevision(projectId, revisionId);
    const where = whereFilters(filters);
    const raw = await this.readOnly((tx) => tx.$queryRaw<{ mid: string; unit: string | null; qty: string; unit_symbol: string; n: number }[]>`
      ${sourceCte({ projectId, revisionId })}, f AS (SELECT * FROM enriched ${where})
      SELECT mid, "unit"::text AS unit, qty::text AS qty, unit_symbol, (SELECT count(*)::int FROM f) AS n FROM f ORDER BY "wbsItem", mid, "unit" NULLS FIRST LIMIT ${limit}`);
    const mids = [...new Set(raw.map((r) => r.mid))];
    const total = raw[0]?.n ?? 0;
    if (revisionId) {
      const [frozen, wbs, labels] = await Promise.all([
        this.prisma.revisionMeasurement.findMany({ where: { revisionId, measurementId: { in: mids } } }),
        this.prisma.revisionWbsNode.findMany({ where: { revisionId }, select: { wbsNodeId: true, code: true, title: true } }),
        this.revisionLabels(revisionId, raw.map((r) => r.unit).filter((x): x is string => !!x)),
      ]);
      const fm = new Map(frozen.map((m) => [m.measurementId, m]));
      const wm = new Map(wbs.map((w) => [w.wbsNodeId, w]));
      return {
        total,
        lines: raw.map((r) => {
          const m = fm.get(r.mid)!;
          const w = wm.get(m.wbsNodeId);
          return { measurementId: r.mid, measurementRevisionId: m.measurementRevisionId, wbsCode: w?.code ?? '', wbsTitle: w?.title ?? '', serviceCode: m.serviceCode, anchorLabel: m.anchorLabel, unitLabel: r.unit ? labels.get(r.unit) ?? null : null, quantity: norm(r.qty), unit: r.unit_symbol };
        }),
      };
    }
    const ms = await this.prisma.measurement.findMany({ where: { id: { in: mids } }, include: { wbsNode: { select: { code: true, title: true } }, service: { select: { code: true } } } });
    const byId = new Map(ms.map((m) => [m.id, m]));
    const ctx = await loadContext(this.prisma, projectId);
    return {
      total,
      lines: raw.map((r) => {
        const m = byId.get(r.mid)!;
        return {
          measurementId: r.mid, measurementRevisionId: null, wbsCode: m.wbsNode.code, wbsTitle: m.wbsNode.title, serviceCode: m.service.code,
          anchorLabel: anchorLabel(m, ctx).label, unitLabel: r.unit ? ctx.units.get(r.unit)?.label ?? null : null,
          quantity: norm(r.qty), unit: r.unit_symbol,
        };
      }),
    };
  }
}
