/**
 * Geração determinística da EAP (RN-GER): mesmos fatos + mesmas versões de template ⇒ mesma árvore.
 * Função pura; a API monta os fatos a partir do banco e persiste o resultado por meio do diff.
 */
import { parseExpression, type Ast } from '../expression/parser.js';
import { evaluateCondition, type Facts } from '../expression/condition.js';
import { stableJson } from '../typology/resolution.js';
import { COUNT_KEYS, REPEAT_INFO, type DesiredNode, type ProjectFacts, type RepeatScope, type TemplateDef, type TemplateNodeDef } from './model.js';

export const MAX_WBS_NODES = 20_000;

export class WbsGenerationError extends Error {
  constructor(readonly issues: { path: string; message: string }[]) {
    super(issues.map((i) => `${i.path}: ${i.message}`).join('; '));
  }
}

type StructNode = ProjectFacts['structure'][number];

interface Ctx {
  moduleId: string;
  /** Nó do cadastro que delimita as contagens/repetições (null = módulo inteiro). */
  scopeNodeId: string | null;
  typologyId: string | null;
  systemId: string | null;
  vars: Record<string, Record<string, string | number>>;
  chain: string;
  binding: DesiredNode['binding'];
}

const KIND_LABEL: Record<string, string> = { HOUSE: 'CASA', APARTMENT: 'APARTAMENTO', COMMON_AREA: 'COMUM', TECHNICAL_AREA: 'TECNICA', GREEN_AREA: 'VERDE', INSTITUTIONAL_AREA: 'INSTITUCIONAL' };

function byOrder<T extends { code: string; position?: number; id: string }>(a: T, b: T) {
  return a.code.localeCompare(b.code, 'pt-BR', { numeric: true }) || (a.position ?? 0) - (b.position ?? 0) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

/** Índice do cadastro para contagens e descendentes por escopo. */
function indexStructure(facts: ProjectFacts) {
  const children = new Map<string, StructNode[]>();
  for (const n of facts.structure) {
    const key = n.parentId ?? `module:${n.moduleId}`;
    children.set(key, [...(children.get(key) ?? []), n]);
  }
  const descendants = (moduleId: string, scopeNodeId: string | null): StructNode[] => {
    const out: StructNode[] = [];
    const walk = (key: string) => { for (const c of children.get(key) ?? []) { out.push(c); walk(c.id); } };
    walk(scopeNodeId ?? `module:${moduleId}`);
    return out;
  };
  return { descendants };
}

function sampleVars(): Record<string, Record<string, string | number>> {
  return {};
}

/** Variáveis disponíveis num nó do template (repetições dos ancestrais + do próprio nó). */
export function availableVariables(def: Pick<TemplateDef, 'nodes'>, nodeKey: string): string[] {
  const byKey = new Map(def.nodes.map((n) => [n.key, n]));
  const vars = ['modulo.nome', 'modulo.codigo', 'modulo.tipo', 'empreendimento.classificacao', ...Object.keys(COUNT_KEYS).map((k) => `qtd.${k}`), 'qtd.tipologias', 'qtd.sistemas', 'qtd.redes', 'qtd.modulos_infra'];
  let n = byKey.get(nodeKey);
  const scopes: RepeatScope[] = [];
  while (n) { if (n.repeat) scopes.push(n.repeat); n = n.parentKey ? byKey.get(n.parentKey) : undefined; }
  for (const s of scopes) {
    const v = REPEAT_INFO[s].variable;
    vars.push(`${v}.nome`, `${v}.codigo`);
    if (s === 'DWELLING_TYPOLOGY') vars.push('tipologia.tipo');
    if (s === 'COMMON_AREA' || s === 'SPECIAL_AREA') vars.push('area.tipo');
    if (s === 'INFRA_SYSTEM') vars.push('sistema.tipo', 'sistema.tipo_nome');
  }
  return vars;
}

const TITLE_VAR = /\{([a-z_]+\.[a-z_]+)\}/gi;

/** Valida um template antes da publicação (títulos, variáveis, condições, hierarquia). */
export function validateTemplate(def: Pick<TemplateDef, 'nodes' | 'moduleKinds'>): { path: string; message: string }[] {
  const issues: { path: string; message: string }[] = [];
  if (def.nodes.length === 0) issues.push({ path: 'nodes', message: 'O template precisa de ao menos um nó.' });
  if (def.moduleKinds.length === 0) issues.push({ path: 'moduleKinds', message: 'Informe a que tipos de módulo o template se aplica.' });
  const keys = new Set(def.nodes.map((n) => n.key));
  const hasChildren = new Set(def.nodes.map((n) => n.parentKey).filter(Boolean));
  for (const n of def.nodes) {
    const p = `nodes.${n.key}`;
    if (n.parentKey && !keys.has(n.parentKey)) issues.push({ path: p, message: 'Nó superior inexistente.' });
    if (!n.title.trim()) issues.push({ path: `${p}.title`, message: 'Título obrigatório.' });
    if (n.nodeType === 'ITEM' && hasChildren.has(n.key)) issues.push({ path: p, message: `"${n.title}" é item quantificável e não pode ter subnós; use um agrupador.` });
    const vars = new Set(availableVariables(def, n.key));
    for (const m of n.title.matchAll(TITLE_VAR)) {
      if (!vars.has(m[1]!)) issues.push({ path: `${p}.title`, message: `Variável {${m[1]}} não está disponível em "${n.title}". Disponíveis: ${[...vars].filter((v) => !v.startsWith('qtd.')).map((v) => `{${v}}`).join(', ')}, {qtd.…}.` });
    }
    if (/\{[^}]*$/.test(n.title) || /^[^{]*\}/.test(n.title)) issues.push({ path: `${p}.title`, message: 'Chaves {} desbalanceadas no título.' });
    if (n.condition) {
      let ast: Ast | null = null;
      try { ast = parseExpression(n.condition); } catch (e) { issues.push({ path: `${p}.condition`, message: `Condição inválida: ${(e as Error).message}` }); }
      if (ast) {
        const sample: Facts = {};
        for (const v of vars) {
          const [a, b] = v.split('.') as [string, string];
          const isNum = a === 'qtd';
          ((sample[a] ??= {}) as Facts)[b] = isNum ? 1 : 'x';
        }
        try { evaluateCondition(ast, sample); } catch (e) { issues.push({ path: `${p}.condition`, message: `Condição inválida em "${n.title}": ${(e as Error).message}` }); }
      }
    }
  }
  // ciclos
  const byKey = new Map(def.nodes.map((n) => [n.key, n]));
  for (const n of def.nodes) {
    const seen = new Set<string>();
    let cur: TemplateNodeDef | undefined = n;
    while (cur?.parentKey) {
      if (seen.has(cur.key)) { issues.push({ path: `nodes.${n.key}`, message: 'Hierarquia circular.' }); break; }
      seen.add(cur.key);
      cur = byKey.get(cur.parentKey);
    }
  }
  return issues;
}

/**
 * Gera a árvore desejada para os módulos selecionados.
 * @param selections módulo → definição de template (versão publicada)
 */
export function generateWbs(facts: ProjectFacts, selections: { moduleId: string; template: TemplateDef }[]): DesiredNode[] {
  const idx = indexStructure(facts);
  const typologies = new Map(facts.typologies.map((t) => [t.id, t]));
  const systems = [...facts.systems].sort((a, b) => a.typeCode.localeCompare(b.typeCode) || a.name.localeCompare(b.name, 'pt-BR') || (a.id < b.id ? -1 : 1));
  const modules = new Map(facts.modules.map((m) => [m.id, m]));
  const infraModules = facts.modules.filter((m) => m.kind === 'INFRASTRUCTURE').length;
  const out: DesiredNode[] = [];
  const issues: { path: string; message: string }[] = [];
  const conditionCache = new Map<string, Ast>();

  let rootPos = 0; // raízes numeradas em sequência entre módulos (ordem dos módulos)
  const ordered = [...selections].sort((a, b) => (modules.get(a.moduleId)?.position ?? 0) - (modules.get(b.moduleId)?.position ?? 0));
  for (const sel of ordered) {
    const mod = modules.get(sel.moduleId);
    if (!mod) { issues.push({ path: sel.moduleId, message: 'Módulo inexistente.' }); continue; }
    if (!sel.template.moduleKinds.includes(mod.kind)) { issues.push({ path: sel.moduleId, message: `O template não se aplica ao módulo ${mod.name}.` }); continue; }
    const tdef = sel.template;
    const children = new Map<string | null, TemplateNodeDef[]>();
    for (const n of tdef.nodes) children.set(n.parentKey, [...(children.get(n.parentKey) ?? []), n]);
    for (const list of children.values()) list.sort((a, b) => a.position - b.position || (a.key < b.key ? -1 : 1));

    const counts = (ctx: Ctx): Record<string, number> => {
      const nodes = idx.descendants(ctx.moduleId, ctx.scopeNodeId).filter((n) => !ctx.typologyId || n.kind !== 'DWELLING_UNIT' || n.typologyId === ctx.typologyId);
      const c: Record<string, number> = {};
      for (const [k, kinds] of Object.entries(COUNT_KEYS)) c[k] = nodes.filter((n) => kinds.includes(n.kind)).length;
      c.tipologias = new Set(nodes.filter((n) => n.kind === 'DWELLING_UNIT' && n.typologyId).map((n) => n.typologyId)).size;
      const sys = ctx.systemId ? systems.filter((s) => s.id === ctx.systemId) : systems;
      c.sistemas = ctx.systemId ? 1 : systems.length;
      c.redes = sys.reduce((a, s) => a + s.networks.length, 0);
      c.modulos_infra = infraModules;
      return c;
    };
    const factsOf = (ctx: Ctx): Facts => ({
      ...ctx.vars,
      modulo: { nome: mod.name, codigo: mod.code, tipo: mod.kind },
      empreendimento: { classificacao: facts.classification },
      qtd: counts(ctx),
    });
    const render = (title: string, f: Facts) =>
      title.replace(TITLE_VAR, (_, v: string) => {
        const [a, b] = v.split('.') as [string, string];
        const val = (f[a] as Facts | undefined)?.[b];
        return val === undefined || typeof val === 'object' ? '' : String(val);
      }).replace(/\s+/g, ' ').trim();

    const instances = (scope: RepeatScope, ctx: Ctx): { ctx: Ctx; id: string }[] => {
      const v = REPEAT_INFO[scope].variable;
      const mk = (id: string, kind: DesiredNode['binding']['kind'], vars: Record<string, string | number>, patch: Partial<Ctx>) => ({
        id,
        ctx: { ...ctx, ...patch, vars: { ...ctx.vars, [v]: vars }, chain: `${ctx.chain}|${v}=${id}`, binding: { kind, id } },
      });
      if (scope === 'DWELLING_TYPOLOGY') {
        const ids = new Set(idx.descendants(ctx.moduleId, ctx.scopeNodeId).filter((n) => n.kind === 'DWELLING_UNIT' && n.typologyId).map((n) => n.typologyId!));
        return [...ids].map((id) => typologies.get(id)!).filter(Boolean).sort(byOrder)
          .map((t) => mk(t.id, 'TYPOLOGY', { nome: t.name, codigo: t.code, tipo: KIND_LABEL[t.kind] ?? t.kind }, { typologyId: t.id }));
      }
      if (scope === 'INFRA_SYSTEM') {
        return systems.map((s) => mk(s.id, 'SYSTEM', { nome: s.name, codigo: s.typeCode, tipo: s.typeCode, tipo_nome: s.typeName }, { systemId: s.id }));
      }
      if (scope === 'NETWORK') {
        const sys = ctx.systemId ? systems.filter((s) => s.id === ctx.systemId) : systems;
        return sys.flatMap((s) => [...s.networks].sort(byOrder).map((n) => mk(n.id, 'NETWORK', { nome: n.name, codigo: n.code }, { systemId: s.id })));
      }
      const kinds = REPEAT_INFO[scope].kinds!;
      return idx.descendants(ctx.moduleId, ctx.scopeNodeId).filter((n) => kinds.includes(n.kind)).sort(byOrder)
        .map((n) => mk(n.id, 'STRUCTURE', { nome: n.name, codigo: n.code, tipo: KIND_LABEL[n.kind] ?? n.kind }, { scopeNodeId: n.id }));
    };

    const emit = (parentKey: string | null, tParent: string | null, ctx: Ctx) => {
      let pos = parentKey === null ? rootPos : 0;
      for (const tn of children.get(tParent) ?? []) {
        const variants = tn.repeat ? instances(tn.repeat, ctx) : [{ ctx, id: '' }];
        for (const inst of variants) {
          const f = factsOf(inst.ctx);
          if (tn.condition) {
            let ast = conditionCache.get(tn.condition);
            if (!ast) { ast = parseExpression(tn.condition); conditionCache.set(tn.condition, ast); }
            let ok: boolean;
            try { ok = evaluateCondition(ast, f); } catch (e) { issues.push({ path: `${mod.name} › ${tn.title}`, message: (e as Error).message }); continue; }
            if (!ok) continue;
          }
          const key = `${tdef.templateId}:${mod.id}:${tn.key}${inst.ctx.chain}`;
          out.push({
            key,
            parentKey,
            title: render(tn.title, f) || tn.title,
            nodeType: tn.nodeType,
            position: parentKey === null ? (rootPos = ++pos) : ++pos,
            moduleId: mod.id,
            templateId: tdef.templateId,
            templateVersionId: tdef.versionId,
            templateNodeKey: tn.key,
            binding: inst.ctx.binding,
            serviceIds: [...tn.serviceIds].sort(),
          });
          if (out.length > MAX_WBS_NODES) throw new WbsGenerationError([{ path: 'nodes', message: `A EAP gerada excede ${MAX_WBS_NODES} nós. Revise as repetições do template.` }]);
          emit(key, tn.key, inst.ctx);
        }
      }
    };
    emit(null, null, { moduleId: mod.id, scopeNodeId: null, typologyId: null, systemId: null, vars: sampleVars(), chain: '', binding: { kind: 'MODULE', id: mod.id } });
  }
  if (issues.length) throw new WbsGenerationError(issues);
  return out;
}

/** Hash estável (FNV-1a 64 bits) para registrar a reprodutibilidade de uma geração. */
export function stableHash(value: unknown): string {
  let h = 0xcbf29ce484222325n;
  const s = stableJson(value);
  for (let i = 0; i < s.length; i++) {
    h ^= BigInt(s.charCodeAt(i));
    h = (h * 0x100000001b3n) & 0xffffffffffffffffn;
  }
  return h.toString(16).padStart(16, '0');
}
