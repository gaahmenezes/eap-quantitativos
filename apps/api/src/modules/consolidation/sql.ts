/**
 * Consolidação em SQL (F7, ADR-017). Monta as linhas efetivas no banco — mesma semântica de
 * `expandMeasurements` do domínio: replicação por tipologia nas unidades cuja revisão fixada +
 * particularidades contém o elemento, substituição por medição própria da unidade, unidades
 * arquivadas fora — e agrega pelas dimensões pedidas. Identificadores vêm só de uma lista fixa.
 */
import { Prisma } from '../../generated/prisma/client.js';
import type { ConsolidationDimensionKey, ConsolidationFiltersInput } from '@eapq/contracts';

export const STRUCTURE_KINDS = ['PHASE', 'STAGE', 'SECTOR', 'BLOCK_QUADRA', 'LOT', 'STREET', 'TOWER', 'BUILDING_BLOCK', 'FLOOR'] as const;

/** Coluna (identificador fixo) de cada dimensão na CTE `enriched`. */
const COLUMN: Record<ConsolidationDimensionKey, string> = {
  wbs1: '"wbs1"', wbs2: '"wbs2"', wbs3: '"wbs3"', wbsItem: '"wbsItem"', service: '"service"', category: '"category"', module: '"module"',
  PHASE: '"PHASE"', STAGE: '"STAGE"', SECTOR: '"SECTOR"', BLOCK_QUADRA: '"BLOCK_QUADRA"', LOT: '"LOT"', STREET: '"STREET"', TOWER: '"TOWER"', BUILDING_BLOCK: '"BUILDING_BLOCK"', FLOOR: '"FLOOR"',
  typology: '"typology"', unit: '"unit"', system: '"system"', network: '"network"',
};
export const col = (d: ConsolidationDimensionKey) => Prisma.raw(COLUMN[d]);

export function enrichedCte(projectId: string): Prisma.Sql {
  const kindCols = Prisma.raw(STRUCTURE_KINDS.map((k) => `(max(anc_id::text) FILTER (WHERE kind = '${k}'))::uuid AS "${k}"`).join(', '));
  const kindSel = Prisma.raw(STRUCTURE_KINDS.map((k) => `kp."${k}"`).join(', '));
  return Prisma.sql`
WITH RECURSIVE
m AS NOT MATERIALIZED (
  SELECT ms.id, ms."wbsNodeId", ms."serviceId", ms."anchorKind", ms."structureNodeId", ms."networkSegmentId", ms."networkNodeId", ms."physicalElementId",
         ms."typologyId", ms."elementKey", ms."dwellingUnitId", s."categoryId" AS category, su.symbol AS unit_symbol,
         CASE WHEN cr."unitId" = s."unitId" THEN ms.quantity ELSE round(ms.quantity * ru.factor / su.factor, 10) END AS qty
  FROM measurement ms
  JOIN measurement_revision cr ON cr."measurementId" = ms.id AND cr.number = ms."currentNumber"
  JOIN service s ON s.id = ms."serviceId"
  JOIN unit_of_measure su ON su.id = s."unitId"
  JOIN unit_of_measure ru ON ru.id = cr."unitId"
  WHERE ms."projectId" = ${projectId}::uuid AND ms."archivedAt" IS NULL
),
units AS NOT MATERIALIZED (
  SELECT u."structureNodeId" AS id, u."typologyId", u."pinnedRevisionId"
  FROM dwelling_unit u JOIN structure_node un ON un.id = u."structureNodeId" AND un."archivedAt" IS NULL
  WHERE u."projectId" = ${projectId}::uuid
),
anc AS (
  SELECT e."revisionId", e."stableKey"::text AS key, e."stableKey"::text AS anc_key, e."parentId"
  FROM typology_element e JOIN typology_revision r ON r.id = e."revisionId" WHERE r."projectId" = ${projectId}::uuid
  UNION ALL
  SELECT a."revisionId", a.key, p."stableKey"::text, p."parentId" FROM anc a JOIN typology_element p ON p.id = a."parentId"
),
excl AS MATERIALIZED (
  SELECT DISTINCT u.id AS unit_id, a.key
  FROM units u JOIN anc a ON a."revisionId" = u."pinnedRevisionId"
  JOIN unit_override o ON o."unitId" = u.id AND o.op = 'EXCLUDE_ELEMENT' AND o."archivedAt" IS NULL AND o."targetStableKey"::text = a.anc_key
),
-- elementos incluídos numa unidade (particularidade ADD_ELEMENT) que continuam válidos
added AS MATERIALIZED (
  SELECT u.id AS unit_id, 'unit:' || o.id::text AS key
  FROM units u JOIN unit_override o ON o."unitId" = u.id AND o.op = 'ADD_ELEMENT' AND o."archivedAt" IS NULL
  WHERE u."pinnedRevisionId" IS NOT NULL AND (o."parentStableKey" IS NULL OR (
    EXISTS (SELECT 1 FROM typology_element e WHERE e."revisionId" = u."pinnedRevisionId" AND e."stableKey" = o."parentStableKey")
    AND NOT EXISTS (SELECT 1 FROM excl x WHERE x.unit_id = u.id AND x.key = o."parentStableKey"::text)))
),
lines AS (
  SELECT m.id AS mid, m."wbsNodeId", m."serviceId", m.category, m.qty, m.unit_symbol,
         COALESCE(m."structureNodeId", pe."structureNodeId", sg."streetSectionId", nn."locationNodeId") AS loc,
         NULL::uuid AS line_unit, NULL::uuid AS line_typology,
         COALESCE(sg."networkId", nn."networkId") AS network, COALESCE(net."systemId", pe."systemId") AS system
  FROM m
  LEFT JOIN physical_element pe ON pe.id = m."physicalElementId"
  LEFT JOIN network_segment sg ON sg.id = m."networkSegmentId"
  LEFT JOIN network_node nn ON nn.id = m."networkNodeId"
  LEFT JOIN infrastructure_network net ON net.id = COALESCE(sg."networkId", nn."networkId")
  WHERE m."anchorKind" <> 'TYPOLOGY_ELEMENT'
  UNION ALL
  SELECT m.id, m."wbsNodeId", m."serviceId", m.category, m.qty, m.unit_symbol, u.id, u.id, m."typologyId", NULL, NULL
  FROM m JOIN units u ON u."typologyId" = m."typologyId"
  -- o elemento existe na revisão fixada da unidade (índice revisionId + stableKey)
  JOIN typology_element e ON e."revisionId" = u."pinnedRevisionId" AND e."stableKey" = (CASE WHEN m."elementKey" LIKE 'unit:%' THEN NULL ELSE m."elementKey" END)::uuid
  WHERE m."anchorKind" = 'TYPOLOGY_ELEMENT' AND m."dwellingUnitId" IS NULL
    AND NOT EXISTS (SELECT 1 FROM excl x WHERE x.unit_id = u.id AND x.key = m."elementKey")
    AND NOT EXISTS (SELECT 1 FROM m r WHERE r."dwellingUnitId" = u.id AND r."wbsNodeId" = m."wbsNodeId" AND r."serviceId" = m."serviceId" AND r."typologyId" = m."typologyId" AND r."elementKey" = m."elementKey")
  UNION ALL
  SELECT m.id, m."wbsNodeId", m."serviceId", m.category, m.qty, m.unit_symbol, u.id, u.id, m."typologyId", NULL, NULL
  FROM m JOIN units u ON u.id = m."dwellingUnitId" AND u."typologyId" = m."typologyId"
  WHERE m."anchorKind" = 'TYPOLOGY_ELEMENT' AND (
    (m."elementKey" LIKE 'unit:%' AND EXISTS (SELECT 1 FROM added a WHERE a.unit_id = u.id AND a.key = m."elementKey"))
    OR (m."elementKey" NOT LIKE 'unit:%'
        AND EXISTS (SELECT 1 FROM typology_element e WHERE e."revisionId" = u."pinnedRevisionId" AND e."stableKey"::text = m."elementKey")
        AND NOT EXISTS (SELECT 1 FROM excl x WHERE x.unit_id = u.id AND x.key = m."elementKey")))
),
anc_kind AS (
  SELECT d.id AS node_id, a.kind::text AS kind, a.id AS anc_id
  FROM structure_node d CROSS JOIN LATERAL unnest(string_to_array(d.path, '/')) AS x(aid)
  JOIN structure_node a ON a.id = x.aid::uuid
  WHERE d."projectId" = ${projectId}::uuid AND d.id IN (SELECT loc FROM lines WHERE loc IS NOT NULL)
),
kp AS (
  SELECT node_id, ${kindCols}, (max(anc_id::text) FILTER (WHERE kind = 'DWELLING_UNIT'))::uuid AS du
  FROM anc_kind GROUP BY node_id
),
kpt AS (
  SELECT kp.*, du."typologyId" AS du_typology, n."moduleId" AS node_module
  FROM kp JOIN structure_node n ON n.id = kp.node_id LEFT JOIN dwelling_unit du ON du."structureNodeId" = kp.du
),
enriched AS (
  SELECT l.mid, l.qty, l.unit_symbol,
         l."wbsNodeId" AS "wbsItem",
         NULLIF(split_part(w.path, '/', 1), '')::uuid AS "wbs1",
         NULLIF(split_part(w.path, '/', 2), '')::uuid AS "wbs2",
         NULLIF(split_part(w.path, '/', 3), '')::uuid AS "wbs3",
         l."serviceId" AS "service", l.category AS "category",
         COALESCE(kp.node_module, w."moduleId") AS "module",
         ${kindSel},
         COALESCE(l.line_typology, kp.du_typology) AS "typology",
         COALESCE(l.line_unit, kp.du) AS "unit",
         l.system AS "system", l.network AS "network"
  FROM lines l
  JOIN wbs_node w ON w.id = l."wbsNodeId"
  LEFT JOIN kpt kp ON kp.node_id = l.loc
)`;
}

export function whereFilters(filters: ConsolidationFiltersInput): Prisma.Sql {
  const parts: Prisma.Sql[] = [];
  for (const [dim, values] of Object.entries(filters) as [ConsolidationDimensionKey, string[]][]) {
    if (!values?.length) continue;
    const ids = values.filter((v) => v !== 'none');
    const none = values.includes('none');
    const c = col(dim);
    const conds: Prisma.Sql[] = [];
    if (ids.length) conds.push(Prisma.sql`${c} = ANY(${ids}::uuid[])`);
    if (none) conds.push(Prisma.sql`${c} IS NULL`);
    parts.push(Prisma.sql`(${Prisma.join(conds, ' OR ')})`);
  }
  return parts.length ? Prisma.sql`WHERE ${Prisma.join(parts, ' AND ')}` : Prisma.empty;
}
