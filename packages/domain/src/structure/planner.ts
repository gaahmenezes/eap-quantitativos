/**
 * Planejador do assistente de estruturação (RF03). Função pura e determinística:
 * mesmos parâmetros ⇒ mesma estrutura (mesmas chaves, nomes, posições e tipologias).
 * Não acessa banco; a API persiste o plano retornado.
 */
import { canPlace, type ModuleKind, type NodeKind } from './rules.js';

export type TypologyKind = 'APARTMENT' | 'HOUSE';

export interface TypologyInput {
  code: string;
  name: string;
  kind: TypologyKind;
}

export interface TowerInput {
  name: string;
  floors: number;
  unitsPerFloor: number;
  /** Cria um pavimento térreo sem unidades antes dos pavimentos-tipo. */
  groundFloor?: boolean;
  /** Tipologia por posição no pavimento (índice 0 = final 01). null = sem tipologia. */
  unitTypologies?: (string | null)[];
}

export interface BlockInput {
  name: string;
  lotCount: number;
}

export interface StreetInput {
  name: string;
  sectionCount: number;
}

export type ModuleInput =
  | { kind: 'VERTICAL_RESIDENTIAL'; name: string; towers: TowerInput[] }
  | {
      kind: 'HORIZONTAL_RESIDENTIAL';
      name: string;
      layout: 'UNITS' | 'LOTS';
      houseCount?: number;
      blocks?: BlockInput[];
      /** Distribuição sequencial: as primeiras N casas recebem a 1ª tipologia, e assim por diante. */
      typologyDistribution?: { typologyCode: string; quantity: number }[];
    }
  | {
      kind: 'LAND_SUBDIVISION';
      name: string;
      phases: { name: string; blocks: BlockInput[] }[];
      streets?: StreetInput[];
      areas?: { kind: 'INSTITUTIONAL_AREA' | 'GREEN_AREA'; name: string }[];
    }
  | { kind: 'COMMON_AREAS'; name: string; areas: { kind: 'COMMON_AREA' | 'TECHNICAL_AREA'; name: string }[] }
  | { kind: 'INFRASTRUCTURE'; name: string; streets: StreetInput[] };

export interface StructurePlanInput {
  typologies: TypologyInput[];
  modules: ModuleInput[];
}

export interface PlannedNode {
  key: string;
  parentKey: string | null;
  kind: NodeKind;
  name: string;
  /** Posição entre irmãos, base 1. */
  position: number;
  typologyCode?: string;
}

export interface PlannedModule {
  key: string;
  kind: ModuleKind;
  name: string;
  position: number;
  nodes: PlannedNode[];
}

export interface StructurePlan {
  typologies: TypologyInput[];
  modules: PlannedModule[];
  counts: Partial<Record<NodeKind, number>>;
  unitsByTypology: Record<string, number>;
  unitsWithoutTypology: number;
  totalNodes: number;
}

export interface PlanIssue {
  path: string;
  message: string;
}

export class StructurePlanError extends Error {
  constructor(readonly issues: PlanIssue[]) {
    super(issues.map((i) => `${i.path}: ${i.message}`).join('; '));
  }
}

export const PLAN_LIMITS = {
  towers: 50,
  floors: 200,
  unitsPerFloor: 60,
  lotsPerBlock: 500,
  blocks: 500,
  houses: 10_000,
  sections: 200,
  totalNodes: 25_000,
} as const;

const pad = (n: number, w: number) => String(n).padStart(w, '0');

export function planStructure(input: StructurePlanInput): StructurePlan {
  const issues: PlanIssue[] = [];
  const typologies = new Map<string, TypologyInput>();
  input.typologies.forEach((t, i) => {
    if (typologies.has(t.code)) issues.push({ path: `typologies.${i}.code`, message: `Código de tipologia repetido: ${t.code}` });
    typologies.set(t.code, t);
  });
  if (input.modules.length === 0) issues.push({ path: 'modules', message: 'Informe ao menos um módulo.' });

  const checkTypology = (code: string | null | undefined, expected: TypologyKind, path: string) => {
    if (code == null) return;
    const t = typologies.get(code);
    if (!t) issues.push({ path, message: `Tipologia inexistente: ${code}` });
    else if (t.kind !== expected) {
      issues.push({
        path,
        message: `A tipologia ${code} é de ${t.kind === 'HOUSE' ? 'casa' : 'apartamento'} e não pode ser usada aqui.`,
      });
    }
  };
  const checkRange = (v: number, min: number, max: number, path: string, label: string) => {
    if (!Number.isInteger(v) || v < min || v > max) issues.push({ path, message: `${label} deve ser inteiro entre ${min} e ${max}.` });
  };
  const checkUniqueNames = (names: string[], path: string, label: string) => {
    const seen = new Set<string>();
    names.forEach((n, i) => {
      const k = n.trim().toLocaleLowerCase('pt-BR');
      if (seen.has(k)) issues.push({ path: `${path}.${i}.name`, message: `${label} com nome repetido: ${n}` });
      seen.add(k);
    });
  };

  const modules: PlannedModule[] = [];
  input.modules.forEach((m, mi) => {
    const mp = `modules.${mi}`;
    const mkey = `m${mi + 1}`;
    const nodes: PlannedNode[] = [];
    const pos = new Map<string | null, number>();
    const add = (parentKey: string | null, key: string, kind: NodeKind, name: string, typologyCode?: string) => {
      const position = (pos.get(parentKey) ?? 0) + 1;
      pos.set(parentKey, position);
      nodes.push({ key, parentKey, kind, name, position, ...(typologyCode ? { typologyCode } : {}) });
      return key;
    };
    const addStreets = (parentKey: string | null, streets: StreetInput[], path: string, prefix: string) => {
      checkUniqueNames(streets.map((s) => s.name), path, 'Rua');
      streets.forEach((s, si) => {
        checkRange(s.sectionCount, 0, PLAN_LIMITS.sections, `${path}.${si}.sectionCount`, 'Quantidade de trechos');
        const sk = add(parentKey, `${prefix}/r${si + 1}`, 'STREET', s.name.trim());
        for (let t = 1; t <= Math.min(s.sectionCount, PLAN_LIMITS.sections); t++) add(sk, `${sk}/tr${t}`, 'STREET_SECTION', `Trecho ${pad(t, 2)}`);
      });
    };
    const addBlocks = (parentKey: string | null, blocks: BlockInput[], path: string, prefix: string, onLot?: (lotKey: string, blockName: string, lot: number) => void) => {
      checkUniqueNames(blocks.map((b) => b.name), path, 'Quadra');
      if (blocks.length > PLAN_LIMITS.blocks) issues.push({ path, message: `No máximo ${PLAN_LIMITS.blocks} quadras.` });
      blocks.forEach((b, bi) => {
        checkRange(b.lotCount, 1, PLAN_LIMITS.lotsPerBlock, `${path}.${bi}.lotCount`, 'Quantidade de lotes');
        const bk = add(parentKey, `${prefix}/q${bi + 1}`, 'BLOCK_QUADRA', b.name.trim());
        for (let l = 1; l <= Math.min(b.lotCount, PLAN_LIMITS.lotsPerBlock); l++) {
          const lk = add(bk, `${bk}/l${l}`, 'LOT', `Lote ${pad(l, 2)}`);
          onLot?.(lk, b.name.trim(), l);
        }
      });
    };

    switch (m.kind) {
      case 'VERTICAL_RESIDENTIAL': {
        if (m.towers.length === 0) issues.push({ path: `${mp}.towers`, message: 'Informe ao menos uma torre.' });
        if (m.towers.length > PLAN_LIMITS.towers) issues.push({ path: `${mp}.towers`, message: `No máximo ${PLAN_LIMITS.towers} torres.` });
        checkUniqueNames(m.towers.map((t) => t.name), `${mp}.towers`, 'Torre');
        m.towers.forEach((t, ti) => {
          const tp = `${mp}.towers.${ti}`;
          checkRange(t.floors, 1, PLAN_LIMITS.floors, `${tp}.floors`, 'Número de pavimentos');
          checkRange(t.unitsPerFloor, 0, PLAN_LIMITS.unitsPerFloor, `${tp}.unitsPerFloor`, 'Unidades por pavimento');
          if (t.unitTypologies && t.unitTypologies.length !== t.unitsPerFloor) {
            issues.push({ path: `${tp}.unitTypologies`, message: 'Informe uma tipologia (ou nenhuma) para cada posição do pavimento.' });
          }
          t.unitTypologies?.forEach((c, ci) => checkTypology(c, 'APARTMENT', `${tp}.unitTypologies.${ci}`));
          const tk = add(null, `${mkey}/t${ti + 1}`, 'TOWER', t.name.trim());
          if (t.groundFloor) add(tk, `${tk}/terreo`, 'FLOOR', 'Térreo');
          const floors = Math.min(Math.max(t.floors, 0), PLAN_LIMITS.floors);
          const units = Math.min(Math.max(t.unitsPerFloor, 0), PLAN_LIMITS.unitsPerFloor);
          for (let f = 1; f <= floors; f++) {
            const fk = add(tk, `${tk}/p${f}`, 'FLOOR', `${f}º pavimento`);
            for (let u = 1; u <= units; u++) {
              const code = t.unitTypologies?.[u - 1] ?? undefined;
              add(fk, `${fk}/u${u}`, 'DWELLING_UNIT', `Apto ${f}${pad(u, 2)}`, code ?? undefined);
            }
          }
        });
        break;
      }
      case 'HORIZONTAL_RESIDENTIAL': {
        // Sequência de tipologias das casas na ordem de geração.
        const dist = m.typologyDistribution ?? [];
        dist.forEach((d, di) => {
          checkTypology(d.typologyCode, 'HOUSE', `${mp}.typologyDistribution.${di}.typologyCode`);
          checkRange(d.quantity, 1, PLAN_LIMITS.houses, `${mp}.typologyDistribution.${di}.quantity`, 'Quantidade');
        });
        const sequence: string[] = dist.flatMap((d) => Array<string>(Math.min(Math.max(d.quantity, 0), PLAN_LIMITS.houses)).fill(d.typologyCode));
        let houseIndex = 0;
        const nextTypology = () => sequence[houseIndex++];
        let total = 0;
        if (m.layout === 'UNITS') {
          const n = m.houseCount ?? 0;
          checkRange(n, 1, PLAN_LIMITS.houses, `${mp}.houseCount`, 'Quantidade de casas');
          total = Math.min(Math.max(n, 0), PLAN_LIMITS.houses);
          for (let h = 1; h <= total; h++) add(null, `${mkey}/c${h}`, 'DWELLING_UNIT', `Casa ${pad(h, 3)}`, nextTypology());
        } else {
          const blocks = m.blocks ?? [];
          if (blocks.length === 0) issues.push({ path: `${mp}.blocks`, message: 'Informe ao menos uma quadra.' });
          addBlocks(null, blocks, `${mp}.blocks`, mkey, (lk, blockName, lot) => {
            total++;
            add(lk, `${lk}/c`, 'DWELLING_UNIT', `Casa ${blockName} L${pad(lot, 2)}`, nextTypology());
          });
        }
        if (dist.length > 0 && sequence.length !== total) {
          issues.push({
            path: `${mp}.typologyDistribution`,
            message: `A soma das quantidades por tipologia (${sequence.length}) deve ser igual ao total de casas (${total}).`,
          });
        }
        break;
      }
      case 'LAND_SUBDIVISION': {
        if (m.phases.length === 0) issues.push({ path: `${mp}.phases`, message: 'Informe ao menos uma fase.' });
        checkUniqueNames(m.phases.map((p) => p.name), `${mp}.phases`, 'Fase');
        m.phases.forEach((p, pi) => {
          const pk = add(null, `${mkey}/f${pi + 1}`, 'PHASE', p.name.trim());
          addBlocks(pk, p.blocks, `${mp}.phases.${pi}.blocks`, pk);
        });
        addStreets(null, m.streets ?? [], `${mp}.streets`, mkey);
        checkUniqueNames((m.areas ?? []).map((a) => a.name), `${mp}.areas`, 'Área');
        (m.areas ?? []).forEach((a, ai) => add(null, `${mkey}/a${ai + 1}`, a.kind, a.name.trim()));
        break;
      }
      case 'COMMON_AREAS': {
        if (m.areas.length === 0) issues.push({ path: `${mp}.areas`, message: 'Informe ao menos uma área.' });
        checkUniqueNames(m.areas.map((a) => a.name), `${mp}.areas`, 'Área');
        m.areas.forEach((a, ai) => add(null, `${mkey}/a${ai + 1}`, a.kind, a.name.trim()));
        break;
      }
      case 'INFRASTRUCTURE': {
        addStreets(null, m.streets, `${mp}.streets`, mkey);
        break;
      }
    }

    // Defesa: o plano nunca viola as regras de hierarquia.
    const kindOf = new Map(nodes.map((n) => [n.key, n.kind]));
    for (const n of nodes) {
      const parentKind = n.parentKey ? kindOf.get(n.parentKey)! : null;
      if (!canPlace(m.kind, parentKind, n.kind)) {
        issues.push({ path: mp, message: `Estrutura inválida: ${n.kind} sob ${parentKind ?? 'raiz'}` });
        break;
      }
    }
    modules.push({ key: mkey, kind: m.kind, name: m.name.trim(), position: mi + 1, nodes });
  });

  const all = modules.flatMap((m) => m.nodes);
  if (all.length > PLAN_LIMITS.totalNodes) {
    issues.push({ path: 'modules', message: `A estrutura gerada (${all.length} itens) excede o limite de ${PLAN_LIMITS.totalNodes}.` });
  }
  if (issues.length) throw new StructurePlanError(issues);

  const counts: Partial<Record<NodeKind, number>> = {};
  const unitsByTypology: Record<string, number> = {};
  let unitsWithoutTypology = 0;
  for (const n of all) {
    counts[n.kind] = (counts[n.kind] ?? 0) + 1;
    if (n.kind === 'DWELLING_UNIT') {
      if (n.typologyCode) unitsByTypology[n.typologyCode] = (unitsByTypology[n.typologyCode] ?? 0) + 1;
      else unitsWithoutTypology++;
    }
  }
  return { typologies: input.typologies, modules, counts, unitsByTypology, unitsWithoutTypology, totalNodes: all.length };
}
