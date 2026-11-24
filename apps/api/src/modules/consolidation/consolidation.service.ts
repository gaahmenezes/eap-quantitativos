import { Injectable } from '@nestjs/common';
import { Decimal } from 'decimal.js';
import type { ConsolidationDimensionKey, ConsolidationFiltersInput, ConsolidationLinesDto, ConsolidationQueryInput, ConsolidationResultDto } from '@eapq/contracts';
import { grandTotals, sortRows, type ConsolidationRow } from '@eapq/domain';
import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService, type Tx } from '../../prisma/prisma.service.js';
import { anchorLabel, loadContext } from '../measurements/context.js';
import { col, enrichedCte, STRUCTURE_KINDS, whereFilters } from './sql.js';

const MAX_ROWS = 5000;
const norm = (v: string) => new Decimal(v).toFixed();

@Injectable()
export class ConsolidationService {
  constructor(private readonly prisma: PrismaService) {}

  /** Agregação em SQL; resultado com ids (usado também pelo teste de equivalência). */
  async rawRows(projectId: string, groupBy: ConsolidationDimensionKey[], filters: ConsolidationFiltersInput): Promise<{ rows: ConsolidationRow[]; truncated: boolean }> {
    const dims = groupBy.map((d) => Prisma.sql`${col(d)}::text AS ${col(d)}`);
    const groupCols = groupBy.map((d) => col(d));
    const select = Prisma.join([...dims, Prisma.sql`unit_symbol`, Prisma.sql`sum(qty)::text AS total`, Prisma.sql`count(*)::int AS lines`, Prisma.sql`count(DISTINCT mid)::int AS measurements`], ', ');
    const group = Prisma.join([...groupCols, Prisma.sql`unit_symbol`], ', ');
    const raw = await this.readOnly((tx) => tx.$queryRaw<Record<string, string | number | null>[]>`
      ${enrichedCte(projectId)}
      SELECT ${select} FROM enriched ${whereFilters(filters)} GROUP BY ${group} LIMIT ${MAX_ROWS + 1}`);
    const rows: ConsolidationRow[] = raw.slice(0, MAX_ROWS).map((r) => ({
      key: Object.fromEntries(groupBy.map((d) => [d, (r[d] as string | null) ?? null])),
      unit: r['unit_symbol'] as string, total: norm(r['total'] as string), lines: r['lines'] as number, measurements: r['measurements'] as number,
    }));
    return { rows: sortRows(rows, groupBy), truncated: raw.length > MAX_ROWS };
  }

  /** Consultas de consolidação rodam em transação somente leitura. */
  private readOnly<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SET TRANSACTION READ ONLY`;
      return fn(tx);
    }, { timeout: 30_000 });
  }

  async query(organizationId: string, projectId: string, q: ConsolidationQueryInput): Promise<ConsolidationResultDto> {
    const t0 = performance.now();
    const { rows, truncated } = await this.rawRows(projectId, q.groupBy, q.filters);
    let totals = grandTotals(rows);
    if (truncated) totals = (await this.rawRows(projectId, [], q.filters)).rows.map((r) => ({ unit: r.unit, total: r.total }));
    const labels = await this.labels(organizationId, projectId, q.groupBy, rows);
    return {
      groupBy: q.groupBy,
      rows: rows.map((r) => ({ ...r, key: Object.fromEntries(q.groupBy.map((d) => { const id = r.key[d]; return [d, id ? { id, label: labels.get(id) ?? '—' } : null]; })) })),
      totals, truncated, elapsedMs: Math.round(performance.now() - t0),
    };
  }

  private async labels(organizationId: string, projectId: string, groupBy: ConsolidationDimensionKey[], rows: ConsolidationRow[]): Promise<Map<string, string>> {
    const ids = (d: ConsolidationDimensionKey) => [...new Set(rows.map((r) => r.key[d]).filter((x): x is string => !!x))];
    const out = new Map<string, string>();
    const wbsIds = [...new Set((['wbs1', 'wbs2', 'wbs3', 'wbsItem'] as const).filter((d) => groupBy.includes(d)).flatMap(ids))];
    const nodeIds = [...new Set([...STRUCTURE_KINDS, 'unit' as const].filter((d) => groupBy.includes(d)).flatMap(ids))];
    const has = (d: ConsolidationDimensionKey) => groupBy.includes(d);
    const [w, s, c, mo, n, t, sy, ne] = await Promise.all([
      wbsIds.length ? this.prisma.wbsNode.findMany({ where: { projectId, id: { in: wbsIds } }, select: { id: true, code: true, title: true } }) : [],
      has('service') ? this.prisma.service.findMany({ where: { organizationId, id: { in: ids('service') } }, select: { id: true, code: true, description: true } }) : [],
      has('category') ? this.prisma.serviceCategory.findMany({ where: { organizationId, id: { in: ids('category') } }, select: { id: true, code: true, name: true } }) : [],
      has('module') ? this.prisma.projectModule.findMany({ where: { projectId, id: { in: ids('module') } }, select: { id: true, name: true } }) : [],
      nodeIds.length ? this.prisma.structureNode.findMany({ where: { projectId, id: { in: nodeIds } }, select: { id: true, code: true, name: true } }) : [],
      has('typology') ? this.prisma.dwellingTypology.findMany({ where: { projectId, id: { in: ids('typology') } }, select: { id: true, code: true, name: true } }) : [],
      has('system') ? this.prisma.infrastructureSystem.findMany({ where: { projectId, id: { in: ids('system') } }, select: { id: true, name: true } }) : [],
      has('network') ? this.prisma.infrastructureNetwork.findMany({ where: { projectId, id: { in: ids('network') } }, select: { id: true, code: true, name: true } }) : [],
    ]);
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
  async lines(projectId: string, filters: ConsolidationFiltersInput, limit: number): Promise<ConsolidationLinesDto> {
    const where = whereFilters(filters);
    const raw = await this.readOnly((tx) => tx.$queryRaw<{ mid: string; unit: string | null; qty: string; unit_symbol: string; n: number }[]>`
      ${enrichedCte(projectId)}, f AS (SELECT * FROM enriched ${where})
      SELECT mid, "unit"::text AS unit, qty::text AS qty, unit_symbol, (SELECT count(*)::int FROM f) AS n FROM f ORDER BY "wbsItem", mid, "unit" NULLS FIRST LIMIT ${limit}`);
    const count = [{ n: raw[0]?.n ?? 0 }];
    const ms = await this.prisma.measurement.findMany({ where: { id: { in: [...new Set(raw.map((r) => r.mid))] } }, include: { wbsNode: { select: { code: true, title: true } }, service: { select: { code: true } } } });
    const byId = new Map(ms.map((m) => [m.id, m]));
    const ctx = await loadContext(this.prisma, projectId);
    return {
      total: count[0]?.n ?? 0,
      lines: raw.map((r) => {
        const m = byId.get(r.mid)!;
        return {
          measurementId: r.mid, wbsCode: m.wbsNode.code, wbsTitle: m.wbsNode.title, serviceCode: m.service.code,
          anchorLabel: anchorLabel(m, ctx).label, unitLabel: r.unit ? ctx.units.get(r.unit)?.label ?? null : null,
          quantity: norm(r.qty), unit: r.unit_symbol,
        };
      }),
    };
  }
}
