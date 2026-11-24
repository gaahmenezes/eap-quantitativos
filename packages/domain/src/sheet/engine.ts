/**
 * Motor de fichas de levantamento (F10, ADR-020).
 * Uma ficha é uma tabela: cada linha (ambiente, trecho, peça…) tem colunas de entrada e colunas calculadas.
 * Colunas calculadas usam o parser seguro (sem eval), com análise de grandezas, parâmetros nomeados
 * (perda, transpasse…), tabelas de consulta (DN → largura de vala, bitola → kg/m) e se(condição; a; b).
 * Tudo em decimal; valores internos na unidade base (m, kg, s). Saídas somam colunas de todas as linhas.
 */
import { Decimal } from 'decimal.js';
import { ExpressionError, parseExpression, type Ast } from '../expression/parser.js';
import { compatibleDimensions, QUANTITY_SCALE, type FormulaUnit } from '../formula/formula.js';
import { baseUnitSymbol, describeDimension, DIMENSIONLESS, multiplyDimensions, type Dimension } from '../units/units.js';

const D = Decimal.clone({ precision: 34, rounding: Decimal.ROUND_HALF_UP });

export type SheetColumnType = 'number' | 'text' | 'choice';

export interface SheetColumn {
  key: string;
  label: string;
  kind: 'input' | 'calc';
  type: SheetColumnType;
  /** Unidade (colunas numéricas). Em colunas calculadas, define a unidade de exibição. */
  unit?: string | null;
  options?: string[];
  required?: boolean;
  /** Valor usado quando a célula fica vazia (entrada). */
  defaultValue?: string | null;
  expression?: string | null;
}

export interface SheetParam { key: string; label: string; unit: string; value: string }

export interface SheetTable {
  key: string;
  label: string;
  keyType: 'text' | 'number';
  keyUnit?: string | null;
  valueUnit: string;
  /** exact: chave igual; range: primeira linha cuja chave (limite superior) ≥ valor. */
  mode: 'exact' | 'range';
  rows: { key: string; value: string }[];
}

export interface SheetOutput { key: string; label: string; column: string; suggestedService?: string | null }

export interface SheetDef {
  columns: SheetColumn[];
  params: SheetParam[];
  tables: SheetTable[];
  outputs: SheetOutput[];
}

export interface SheetIssue { path: string; message: string }

type Ty = { t: 'num'; dim: Dimension; zero?: boolean } | { t: 'text' } | { t: 'bool' };
type Val = { t: 'num'; v: Decimal; dim: Dimension } | { t: 'text'; v: string } | { t: 'bool'; v: boolean };

class SheetError extends Error {}

const KEY_RE = /^[a-z][a-z0-9_]{0,29}$/;
const RESERVED = new Set(['e', 'ou', 'and', 'or', 'nao', 'não', 'not', 'verdadeiro', 'falso', 'true', 'false', 'se', 'tabela', 'pi', 'min', 'max', 'abs', 'sqrt', 'round', 'ceil', 'floor']);
const FUNCS = new Set(['se', 'tabela', 'pi', 'min', 'max', 'abs', 'sqrt', 'round', 'ceil', 'floor']);
const physical = (d: Dimension): Dimension => ({ L: d.L, M: d.M, T: d.T, N: 0 });
const dimText = (d: Dimension) => describeDimension(physical(d)).toLowerCase();

function refsOf(ast: Ast, out = new Set<string>()): Set<string> {
  if (ast.t === 'ref') out.add(ast.path.join('.'));
  else if (ast.t === 'un') refsOf(ast.a, out);
  else if (ast.t === 'bin') { refsOf(ast.a, out); refsOf(ast.b, out); }
  else if (ast.t === 'call') ast.args.forEach((a) => refsOf(a, out));
  return out;
}

const sameTy = (a: Ty, b: Ty) => a.t === b.t && (a.t !== 'num' || b.t !== 'num' || a.zero || b.zero || compatibleDimensions(a.dim, b.dim));

/** Contexto compilado da ficha: tipos de cada nome, ordem de cálculo e expressões analisadas. */
export interface CompiledSheet {
  def: SheetDef;
  units: Map<string, FormulaUnit>;
  order: string[];
  asts: Map<string, Ast>;
  types: Map<string, Ty>;
  tables: Map<string, SheetTable>;
  issues: SheetIssue[];
}

export function compileSheet(def: SheetDef, unitList: readonly FormulaUnit[]): CompiledSheet {
  const units = new Map(unitList.map((u) => [u.symbol, u]));
  const issues: SheetIssue[] = [];
  const types = new Map<string, Ty>();
  const asts = new Map<string, Ast>();
  const tables = new Map(def.tables.map((t) => [t.key, t]));
  const seen = new Set<string>();
  const checkKey = (key: string, path: string) => {
    if (!KEY_RE.test(key) || RESERVED.has(key)) issues.push({ path, message: `Chave inválida: "${key}". Use letras minúsculas, números e _ (começando por letra).` });
    if (seen.has(key)) issues.push({ path, message: `Chave repetida: ${key}.` });
    seen.add(key);
  };
  const unitDim = (u: string | null | undefined, path: string): Dimension | null => {
    if (!u) return null;
    const x = units.get(u);
    if (!x) { issues.push({ path, message: `Unidade não cadastrada: ${u}.` }); return null; }
    return x.dimension;
  };
  def.params.forEach((p, i) => {
    checkKey(p.key, `params.${i}.key`);
    const d = unitDim(p.unit, `params.${i}.unit`);
    if (!/^-?\d+(\.\d+)?$/.test(p.value)) issues.push({ path: `params.${i}.value`, message: `Valor inválido no parâmetro ${p.label}.` });
    types.set(p.key, { t: 'num', dim: d ?? DIMENSIONLESS });
  });
  def.tables.forEach((t, i) => {
    if (!KEY_RE.test(t.key)) issues.push({ path: `tables.${i}.key`, message: `Chave de tabela inválida: "${t.key}".` });
    unitDim(t.valueUnit, `tables.${i}.valueUnit`);
    if (t.keyType === 'number') unitDim(t.keyUnit, `tables.${i}.keyUnit`);
    if (!t.rows.length) issues.push({ path: `tables.${i}.rows`, message: `A tabela ${t.label} está vazia.` });
    for (const r of t.rows) {
      if (!/^-?\d+(\.\d+)?$/.test(r.value)) issues.push({ path: `tables.${i}.rows`, message: `Valor inválido na tabela ${t.label}: ${r.value}.` });
      if (t.keyType === 'number' && !/^-?\d+(\.\d+)?$/.test(r.key)) issues.push({ path: `tables.${i}.rows`, message: `Chave numérica inválida na tabela ${t.label}: ${r.key}.` });
    }
  });
  if (!def.columns.length) issues.push({ path: 'columns', message: 'A ficha precisa de ao menos uma coluna.' });
  def.columns.forEach((c, i) => {
    checkKey(c.key, `columns.${i}.key`);
    if (!c.label.trim()) issues.push({ path: `columns.${i}.label`, message: `Informe o título da coluna ${c.key}.` });
    if (c.type === 'choice' && !c.options?.length) issues.push({ path: `columns.${i}.options`, message: `A coluna ${c.label} precisa de opções.` });
    if (c.kind === 'input') {
      if (c.type === 'number') types.set(c.key, { t: 'num', dim: unitDim(c.unit ?? 'un', `columns.${i}.unit`) ?? DIMENSIONLESS });
      else types.set(c.key, { t: 'text' });
    } else {
      if (c.type !== 'number' && c.type !== 'text') issues.push({ path: `columns.${i}.type`, message: 'Coluna calculada deve ser numérica ou texto.' });
      try {
        asts.set(c.key, parseExpression(c.expression ?? ''));
      } catch (e) {
        issues.push({ path: `columns.${i}.expression`, message: `${c.label}: ${e instanceof ExpressionError ? e.message : 'expressão inválida'}` });
      }
    }
  });
  // ordem de cálculo (dependências entre colunas calculadas)
  const calc = def.columns.filter((c) => c.kind === 'calc');
  const calcKeys = new Set(calc.map((c) => c.key));
  const order: string[] = [];
  const state = new Map<string, 0 | 1 | 2>();
  const visit = (k: string, chain: string[]) => {
    if (state.get(k) === 2) return;
    if (state.get(k) === 1) { issues.push({ path: `columns.${k}`, message: `Cálculo circular: ${[...chain, k].join(' → ')}.` }); return; }
    state.set(k, 1);
    const ast = asts.get(k);
    if (ast) for (const r of refsOf(ast)) if (calcKeys.has(r)) visit(r, [...chain, k]);
    state.set(k, 2);
    order.push(k);
  };
  for (const c of calc) visit(c.key, []);
  for (const k of order) {
    const ast = asts.get(k);
    const col = calc.find((c) => c.key === k)!;
    if (!ast) continue;
    try {
      const ty = analyze(ast, types, tables, units);
      if (col.type === 'number') {
        if (ty.t !== 'num') throw new SheetError(`${col.label}: a expressão não resulta em número.`);
        const shown = col.unit ? units.get(col.unit) : undefined;
        if (col.unit && !shown) throw new SheetError(`Unidade não cadastrada: ${col.unit}.`);
        if (shown && !ty.zero && !compatibleDimensions(ty.dim, shown.dimension)) throw new SheetError(`${col.label}: o resultado é ${dimText(ty.dim)}, mas a coluna está em ${col.unit}.`);
        types.set(k, { t: 'num', dim: shown?.dimension ?? ty.dim });
      } else {
        if (ty.t !== 'text') throw new SheetError(`${col.label}: a expressão não resulta em texto.`);
        types.set(k, ty);
      }
    } catch (e) {
      if (!(e instanceof SheetError)) throw e;
      issues.push({ path: `columns.${k}.expression`, message: e.message });
      types.set(k, { t: 'num', dim: DIMENSIONLESS });
    }
  }
  const outKeys = new Set<string>();
  def.outputs.forEach((o, i) => {
    if (!KEY_RE.test(o.key)) issues.push({ path: `outputs.${i}.key`, message: `Chave de saída inválida: "${o.key}".` });
    if (outKeys.has(o.key)) issues.push({ path: `outputs.${i}.key`, message: `Saída repetida: ${o.key}.` });
    outKeys.add(o.key);
    const ty = types.get(o.column);
    if (!def.columns.some((c) => c.key === o.column)) issues.push({ path: `outputs.${i}.column`, message: `A saída ${o.label} aponta para uma coluna inexistente.` });
    else if (ty?.t !== 'num') issues.push({ path: `outputs.${i}.column`, message: `A saída ${o.label} precisa de uma coluna numérica.` });
  });
  return { def, units, order, asts, types, tables, issues };
}

function analyze(ast: Ast, env: Map<string, Ty>, tables: Map<string, SheetTable>, units: Map<string, FormulaUnit>): Ty {
  const num = (dim: Dimension, zero = false): Ty => ({ t: 'num', dim, zero });
  switch (ast.t) {
    case 'num': return num(DIMENSIONLESS, new Decimal(ast.v).isZero());
    case 'str': return { t: 'text' };
    case 'bool': return { t: 'bool' };
    case 'ref': {
      const k = ast.path.join('.');
      const ty = env.get(k);
      if (!ty) throw new SheetError(`Nome desconhecido: ${k}. Use a chave de uma coluna ou de um parâmetro.`);
      return ty;
    }
    case 'un': {
      const a = analyze(ast.a, env, tables, units);
      if (ast.op === '-') { if (a.t !== 'num') throw new SheetError('Sinal negativo só em números.'); return a; }
      if (a.t !== 'bool') throw new SheetError('"não" só se aplica a condições.');
      return a;
    }
    case 'bin': {
      const a = analyze(ast.a, env, tables, units);
      const b = analyze(ast.b, env, tables, units);
      if (ast.op === 'and' || ast.op === 'or') {
        if (a.t !== 'bool' || b.t !== 'bool') throw new SheetError('"e" e "ou" ligam condições.');
        return { t: 'bool' };
      }
      if (['==', '!=', '<', '<=', '>', '>='].includes(ast.op)) {
        if (a.t === 'text' && b.t === 'text') {
          if (ast.op !== '==' && ast.op !== '!=') throw new SheetError('Textos só podem ser comparados com == ou !=.');
          return { t: 'bool' };
        }
        if (a.t !== 'num' || b.t !== 'num' || !sameTy(a, b)) throw new SheetError('Comparação entre grandezas diferentes.');
        return { t: 'bool' };
      }
      if (a.t !== 'num' || b.t !== 'num') throw new SheetError('Operação aritmética com texto ou condição.');
      if (ast.op === '+' || ast.op === '-') {
        if (!sameTy(a, b)) throw new SheetError(`Não é possível ${ast.op === '+' ? 'somar' : 'subtrair'} ${dimText(a.dim)} e ${dimText(b.dim)}.`);
        return a.zero ? b : a;
      }
      if (ast.op === '*' || ast.op === '/') return num(multiplyDimensions(a.dim, b.dim, ast.op === '*' ? 1 : -1), ast.op === '*' && (a.zero || b.zero));
      // potência
      if (!compatibleDimensions(b.dim, DIMENSIONLESS)) throw new SheetError('O expoente deve ser adimensional.');
      if (compatibleDimensions(a.dim, DIMENSIONLESS)) return num(DIMENSIONLESS);
      if (ast.b.t !== 'num' || !/^\d+$/.test(ast.b.v)) throw new SheetError('Grandeza com unidade só pode ser elevada a um expoente inteiro (ex.: (dn / 2) ^ 2).');
      const n = Number(ast.b.v);
      return num({ L: a.dim.L * n, M: a.dim.M * n, T: a.dim.T * n, N: a.dim.N * n });
    }
    case 'call': {
      const name = ast.name.toLowerCase();
      if (!FUNCS.has(name)) throw new SheetError(`Função não permitida: ${ast.name}.`);
      if (name === 'pi') { if (ast.args.length) throw new SheetError('pi() não recebe argumentos.'); return num(DIMENSIONLESS); }
      if (name === 'se') {
        if (ast.args.length !== 3) throw new SheetError('se(condição; valor se sim; valor se não) recebe 3 argumentos.');
        const c = analyze(ast.args[0]!, env, tables, units);
        if (c.t !== 'bool') throw new SheetError('O primeiro argumento de se() deve ser uma condição.');
        const a = analyze(ast.args[1]!, env, tables, units);
        const b = analyze(ast.args[2]!, env, tables, units);
        if (!sameTy(a, b)) throw new SheetError('Os dois resultados de se() devem ser do mesmo tipo e grandeza.');
        return a.t === 'num' && a.zero ? b : a;
      }
      if (name === 'tabela') {
        if (ast.args.length !== 2 || ast.args[0]!.t !== 'str') throw new SheetError('Use tabela("chave_da_tabela"; valor).');
        const t = tables.get((ast.args[0] as { v: string }).v);
        if (!t) throw new SheetError(`Tabela inexistente: ${(ast.args[0] as { v: string }).v}.`);
        const k = analyze(ast.args[1]!, env, tables, units);
        if (t.keyType === 'text' && k.t !== 'text') throw new SheetError(`A tabela ${t.label} é consultada por texto.`);
        if (t.keyType === 'number') {
          const ku = t.keyUnit ? units.get(t.keyUnit) : undefined;
          if (k.t !== 'num' || (ku && !compatibleDimensions(k.dim, ku.dimension))) throw new SheetError(`A tabela ${t.label} é consultada por ${t.keyUnit ?? 'número'}.`);
        }
        return num(units.get(t.valueUnit)?.dimension ?? DIMENSIONLESS);
      }
      const xs = ast.args.map((a) => analyze(a, env, tables, units));
      if (xs.some((x) => x.t !== 'num')) throw new SheetError(`${name}() só aceita números.`);
      const ns = xs as { t: 'num'; dim: Dimension; zero?: boolean }[];
      if (name === 'min' || name === 'max') {
        if (ns.length < 2 || !ns.every((x) => sameTy(x, ns[0]!))) throw new SheetError(`${name}() precisa de 2 ou mais valores da mesma grandeza.`);
        return ns[0]!;
      }
      if (ns.length < 1 || ns.length > (name === 'round' ? 2 : 1)) throw new SheetError(`Número de argumentos inválido em ${name}().`);
      if (name === 'abs') return ns[0]!;
      if (name === 'sqrt') {
        const d = physical(ns[0]!.dim);
        if (d.L % 2 || d.M % 2 || d.T % 2) throw new SheetError('Raiz quadrada só de grandezas com expoentes pares.');
        return num({ L: d.L / 2, M: d.M / 2, T: d.T / 2, N: 0 });
      }
      if (!compatibleDimensions(ns[0]!.dim, DIMENSIONLESS)) throw new SheetError(`${name}() só se aplica a valores adimensionais (ex.: ceil(comprimento / comprimento_peca)).`);
      return num(DIMENSIONLESS);
    }
  }
}

// ------------------------------------------------------------------ avaliação

/** Célula de entrada: texto digitado (número, soma como "30,29+10,68", ou texto/opção) e referência de projeto. */
export interface SheetCell { v?: string | null; ref?: string | null }
export type SheetRowInput = Record<string, SheetCell | undefined>;

export interface CellResult { value: string | null; display: string; error?: string; expr?: string; ref?: string | null }
export interface RowResult { cells: Record<string, CellResult>; errors: string[] }
export interface OutputTotal { key: string; label: string; column: string; unit: string; total: string; base: string; dim: Dimension }
export interface SheetResult { rows: RowResult[]; totals: OutputTotal[]; errorCount: number; issues: SheetIssue[] }

const fmt = (d: Decimal) => { const s = d.toDecimalPlaces(QUANTITY_SCALE).toFixed(); return s === '-0' ? '0' : s; };

/** Expressão numérica de célula: só números e + − × ÷ ^ ( ). */
export function evaluateCellNumber(text: string): Decimal {
  const ast = parseExpression(text.trim().replace(/^=/, ''));
  const walk = (a: Ast): Decimal => {
    if (a.t === 'num') return new D(a.v);
    if (a.t === 'un' && a.op === '-') return walk(a.a).neg();
    if (a.t === 'bin' && ['+', '-', '*', '/', '^'].includes(a.op)) {
      const x = walk(a.a); const y = walk(a.b);
      if (a.op === '+') return x.plus(y);
      if (a.op === '-') return x.minus(y);
      if (a.op === '*') return x.times(y);
      if (a.op === '/') { if (y.isZero()) throw new SheetError('Divisão por zero.'); return x.div(y); }
      return x.pow(y);
    }
    throw new SheetError('Digite um número ou uma conta com números (ex.: 30,29+10,68).');
  };
  return walk(ast);
}

function evalAst(ast: Ast, env: Map<string, Val>, c: CompiledSheet): Val {
  switch (ast.t) {
    case 'num': return { t: 'num', v: new D(ast.v), dim: DIMENSIONLESS };
    case 'str': return { t: 'text', v: ast.v };
    case 'bool': return { t: 'bool', v: ast.v };
    case 'ref': return env.get(ast.path.join('.'))!;
    case 'un': { const a = evalAst(ast.a, env, c); return a.t === 'num' ? { ...a, v: a.v.neg() } : { t: 'bool', v: !(a as { v: boolean }).v }; }
    case 'bin': {
      if (ast.op === 'and') { const a = evalAst(ast.a, env, c) as { v: boolean }; return { t: 'bool', v: a.v && (evalAst(ast.b, env, c) as { v: boolean }).v }; }
      if (ast.op === 'or') { const a = evalAst(ast.a, env, c) as { v: boolean }; return { t: 'bool', v: a.v || (evalAst(ast.b, env, c) as { v: boolean }).v }; }
      const a = evalAst(ast.a, env, c);
      const b = evalAst(ast.b, env, c);
      if (a.t === 'text' || b.t === 'text') {
        const eq = String(a.v).trim().toLowerCase() === String(b.v).trim().toLowerCase();
        return { t: 'bool', v: ast.op === '==' ? eq : !eq };
      }
      const x = (a as { v: Decimal }).v; const y = (b as { v: Decimal }).v;
      const da = (a as { dim: Dimension }).dim; const db = (b as { dim: Dimension }).dim;
      switch (ast.op) {
        case '==': return { t: 'bool', v: x.eq(y) };
        case '!=': return { t: 'bool', v: !x.eq(y) };
        case '<': return { t: 'bool', v: x.lt(y) };
        case '<=': return { t: 'bool', v: x.lte(y) };
        case '>': return { t: 'bool', v: x.gt(y) };
        case '>=': return { t: 'bool', v: x.gte(y) };
        case '+': return { t: 'num', v: x.plus(y), dim: x.isZero() ? db : da };
        case '-': return { t: 'num', v: x.minus(y), dim: x.isZero() ? db : da };
        case '*': return { t: 'num', v: x.times(y), dim: multiplyDimensions(da, db) };
        case '/':
          if (y.isZero()) throw new SheetError('Divisão por zero.');
          return { t: 'num', v: x.div(y), dim: multiplyDimensions(da, db, -1) };
        case '^': {
          const n = y.toNumber();
          return { t: 'num', v: x.pow(y), dim: { L: da.L * n, M: da.M * n, T: da.T * n, N: da.N * n } };
        }
      }
      throw new SheetError('Operação inválida.');
    }
    case 'call': {
      const name = ast.name.toLowerCase();
      if (name === 'pi') return { t: 'num', v: D.acos(-1), dim: DIMENSIONLESS };
      if (name === 'se') return (evalAst(ast.args[0]!, env, c) as { v: boolean }).v ? evalAst(ast.args[1]!, env, c) : evalAst(ast.args[2]!, env, c);
      if (name === 'tabela') {
        const t = c.tables.get((ast.args[0] as { v: string }).v)!;
        const k = evalAst(ast.args[1]!, env, c);
        const vu = c.units.get(t.valueUnit)!;
        let row: { key: string; value: string } | undefined;
        if (t.keyType === 'text') row = t.rows.find((r) => r.key.trim().toLowerCase() === String(k.v).trim().toLowerCase());
        else {
          const ku = t.keyUnit ? c.units.get(t.keyUnit) : undefined;
          const kv = (k as { v: Decimal }).v.div(ku?.factor ?? '1');
          const sorted = [...t.rows].sort((p, q) => new Decimal(p.key).comparedTo(q.key));
          row = t.mode === 'exact' ? sorted.find((r) => new Decimal(r.key).eq(kv)) : sorted.find((r) => kv.lte(r.key));
          if (!row) throw new SheetError(`${fmt(kv)} ${t.keyUnit ?? ''} não está na tabela ${t.label}.`);
        }
        if (!row) throw new SheetError(`"${String(k.v)}" não está na tabela ${t.label}.`);
        return { t: 'num', v: new D(row.value).times(vu.factor), dim: vu.dimension };
      }
      const xs = ast.args.map((a) => (evalAst(a, env, c) as { v: Decimal; dim: Dimension }));
      const first = xs[0]!;
      switch (name) {
        case 'min': return { t: 'num', v: D.min(...xs.map((x) => x.v)), dim: first.dim };
        case 'max': return { t: 'num', v: D.max(...xs.map((x) => x.v)), dim: first.dim };
        case 'abs': return { t: 'num', v: first.v.abs(), dim: first.dim };
        case 'sqrt':
          if (first.v.lt(0)) throw new SheetError('Raiz de número negativo.');
          return { t: 'num', v: first.v.sqrt(), dim: { L: first.dim.L / 2, M: first.dim.M / 2, T: first.dim.T / 2, N: 0 } };
        case 'round': return { t: 'num', v: first.v.toDecimalPlaces(xs[1] ? xs[1].v.toNumber() : 0, Decimal.ROUND_HALF_UP), dim: first.dim };
        case 'ceil': return { t: 'num', v: first.v.ceil(), dim: first.dim };
        case 'floor': return { t: 'num', v: first.v.floor(), dim: first.dim };
      }
      throw new SheetError(`Função não permitida: ${ast.name}.`);
    }
  }
}

/** Calcula todas as linhas e os totais das saídas. `paramValues` substitui os valores padrão dos parâmetros. */
export function computeSheet(c: CompiledSheet, rows: readonly SheetRowInput[], paramValues: Record<string, string> = {}): SheetResult {
  const base = new Map<string, Val>();
  for (const p of c.def.params) {
    const u = c.units.get(p.unit);
    const raw = paramValues[p.key] ?? p.value;
    const v = /^-?\d+(\.\d+)?$/.test(raw) ? new D(raw) : new D(p.value);
    base.set(p.key, { t: 'num', v: v.times(u?.factor ?? '1'), dim: u?.dimension ?? DIMENSIONLESS });
  }
  const sums = new Map<string, Decimal>();
  let errorCount = 0;
  const results: RowResult[] = rows.map((row) => {
    const env = new Map(base);
    const cells: Record<string, CellResult> = {};
    const errors: string[] = [];
    for (const col of c.def.columns.filter((x) => x.kind === 'input')) {
      const cell = row[col.key] ?? {};
      const text = (cell.v ?? '').trim() || (col.defaultValue ?? '');
      if (col.type === 'number') {
        const u = c.units.get(col.unit ?? 'un');
        let v = new D(0);
        if (text) {
          try { v = evaluateCellNumber(text); } catch (e) {
            const msg = e instanceof ExpressionError || e instanceof SheetError ? `Valor inválido: ${e.message}` : 'Valor inválido.';
            errors.push(`${col.label}: ${msg}`);
            cells[col.key] = { value: null, display: text, error: msg, ref: cell.ref ?? null };
            env.set(col.key, { t: 'num', v: new D(0), dim: u?.dimension ?? DIMENSIONLESS });
            continue;
          }
        } else if (col.required) errors.push(`${col.label}: obrigatório.`);
        env.set(col.key, { t: 'num', v: v.times(u?.factor ?? '1'), dim: u?.dimension ?? DIMENSIONLESS });
        cells[col.key] = { value: fmt(v), display: fmt(v), ...(text && !/^-?\d+([.,]\d+)?$/.test(text) && { expr: text }), ref: cell.ref ?? null };
      } else {
        if (!text && col.required) errors.push(`${col.label}: obrigatório.`);
        if (col.type === 'choice' && text && !(col.options ?? []).some((o) => o.toLowerCase() === text.toLowerCase())) errors.push(`${col.label}: "${text}" não é uma opção (${(col.options ?? []).join(', ')}).`);
        env.set(col.key, { t: 'text', v: text });
        cells[col.key] = { value: text, display: text, ref: cell.ref ?? null };
      }
    }
    for (const k of c.order) {
      const col = c.def.columns.find((x) => x.key === k)!;
      const ast = c.asts.get(k);
      if (!ast) continue;
      try {
        const v = evalAst(ast, env, c);
        env.set(k, v);
        if (v.t === 'num') {
          const u = col.unit ? c.units.get(col.unit) : undefined;
          const shown = u ? v.v.div(u.factor) : v.v;
          cells[k] = { value: fmt(shown), display: fmt(shown) };
        } else cells[k] = { value: String(v.v), display: String(v.v) };
      } catch (e) {
        if (!(e instanceof SheetError)) throw e;
        errors.push(`${col.label}: ${e.message}`);
        cells[k] = { value: null, display: '—', error: e.message };
        env.set(k, { t: 'num', v: new D(0), dim: (c.types.get(k) as { dim?: Dimension })?.dim ?? DIMENSIONLESS });
      }
    }
    if (errors.length) errorCount++;
    else for (const o of c.def.outputs) {
      const v = env.get(o.column);
      if (v?.t === 'num') sums.set(o.key, (sums.get(o.key) ?? new D(0)).plus(v.v));
    }
    return { cells, errors };
  });
  const totals: OutputTotal[] = c.def.outputs.map((o) => {
    const col = c.def.columns.find((x) => x.key === o.column);
    const ty = c.types.get(o.column) as { dim: Dimension } | undefined;
    const dim = ty?.dim ?? DIMENSIONLESS;
    const u = col?.unit ? c.units.get(col.unit) : undefined;
    const b = sums.get(o.key) ?? new D(0);
    return { key: o.key, label: o.label, column: o.column, unit: u?.symbol ?? baseUnitSymbol(dim), total: fmt(u ? b.div(u.factor) : b), base: fmt(b), dim };
  });
  return { rows: results, totals, errorCount, issues: c.issues };
}

/** Converte o total de uma saída para a unidade de um serviço (mesma grandeza). */
export function outputInUnit(total: OutputTotal, target: FormulaUnit): string | null {
  if (!compatibleDimensions(total.dim, target.dimension)) return null;
  return fmt(new D(total.base).div(target.factor));
}
