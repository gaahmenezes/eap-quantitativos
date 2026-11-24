/**
 * Motor de fórmulas de quantitativos (ADR-004, RN-FOR).
 * - Só o parser seguro de `expression/` (sem eval). Funções permitidas: min, max, abs, sqrt, round, ceil, floor, pi.
 * - Aritmética decimal (34 dígitos significativos); resultado guardado com até 10 casas.
 * - Análise dimensional antes de avaliar: soma/subtração/min/max exigem a mesma grandeza; a grandeza do
 *   resultado precisa ser a da unidade do serviço. Contagem (un, pç…) é tratada como adimensional.
 * - Toda entrada é convertida para a unidade base (m, kg, s) e a memória registra cada conversão.
 */
import { Decimal } from 'decimal.js';
import { ExpressionError, parseExpression, type Ast } from '../expression/parser.js';
import { baseUnitSymbol, describeDimension, DIMENSIONLESS, multiplyDimensions, sameDimension, type Dimension } from '../units/units.js';

const D = Decimal.clone({ precision: 34, rounding: Decimal.ROUND_HALF_UP });
export const QUANTITY_SCALE = 10;

export interface FormulaUnit {
  symbol: string;
  dimension: Dimension;
  factor: string;
}

export type VariableConstraint = 'positive' | 'nonnegative';

export interface FormulaVariable {
  symbol: string;
  label: string;
  /** Unidade de referência da variável (define a grandeza esperada). */
  unit: string;
  constraint?: VariableConstraint | null;
}

export interface FormulaDef {
  expression: string;
  variables: FormulaVariable[];
}

export interface FormulaIssue {
  path: string;
  message: string;
}

export class FormulaError extends Error {
  constructor(readonly issues: FormulaIssue[]) {
    super(issues.map((i) => i.message).join(' '));
  }
}

/** Contagem não altera a grandeza: 5 portas × 1,68 m² = 8,40 m². */
const physical = (d: Dimension): Dimension => ({ L: d.L, M: d.M, T: d.T, N: 0 });
export const compatibleDimensions = (a: Dimension, b: Dimension) => sameDimension(physical(a), physical(b));

const SYMBOL_RE = /^[\p{L}_][\p{L}\p{N}_]{0,29}$/u;
const RESERVED = new Set(['e', 'ou', 'and', 'or', 'nao', 'não', 'not', 'verdadeiro', 'falso', 'true', 'false', 'pi', 'min', 'max', 'abs', 'sqrt', 'round', 'ceil', 'floor', '__proto__', 'prototype', 'constructor']);
const FUNCS: Record<string, { min: number; max: number }> = {
  min: { min: 2, max: 10 }, max: { min: 2, max: 10 }, abs: { min: 1, max: 1 }, sqrt: { min: 1, max: 1 },
  round: { min: 1, max: 2 }, ceil: { min: 1, max: 1 }, floor: { min: 1, max: 1 }, pi: { min: 0, max: 0 },
};

class DimError extends Error {}

const unitIndex = (units: readonly FormulaUnit[]) => new Map(units.map((u) => [u.symbol, u]));

/** Análise estática: retorna a grandeza do resultado ou lança DimError com mensagem para o usuário. */
function analyze(ast: Ast, dims: Map<string, Dimension>): Dimension {
  switch (ast.t) {
    case 'num': return DIMENSIONLESS;
    case 'str': case 'bool': throw new DimError('Fórmulas só aceitam números e variáveis.');
    case 'ref': {
      if (ast.path.length !== 1) throw new DimError(`Referência não permitida: ${ast.path.join('.')}.`);
      const d = dims.get(ast.path[0]!);
      if (!d) throw new DimError(`Variável não declarada: ${ast.path[0]}.`);
      return d;
    }
    case 'un':
      if (ast.op !== '-') throw new DimError('Operadores lógicos não são permitidos em fórmulas.');
      return analyze(ast.a, dims);
    case 'bin': {
      if (!['+', '-', '*', '/', '^'].includes(ast.op)) throw new DimError('Comparações e operadores lógicos não são permitidos em fórmulas.');
      const a = analyze(ast.a, dims);
      if (ast.op === '^') {
        const b = analyze(ast.b, dims);
        if (!compatibleDimensions(b, DIMENSIONLESS)) throw new DimError('O expoente deve ser adimensional.');
        if (compatibleDimensions(a, DIMENSIONLESS)) return DIMENSIONLESS;
        const n = literalInteger(ast.b);
        if (n === null) throw new DimError('Grandeza com unidade só pode ser elevada a um expoente inteiro constante (ex.: lado ^ 2).');
        return { L: a.L * n, M: a.M * n, T: a.T * n, N: a.N * n };
      }
      const b = analyze(ast.b, dims);
      if (ast.op === '+' || ast.op === '-') {
        if (!compatibleDimensions(a, b)) throw new DimError(`Não é possível ${ast.op === '+' ? 'somar' : 'subtrair'} ${describeDimension(physical(a)).toLowerCase()} e ${describeDimension(physical(b)).toLowerCase()}.`);
        return a;
      }
      return multiplyDimensions(a, b, ast.op === '*' ? 1 : -1);
    }
    case 'call': {
      const f = FUNCS[ast.name.toLowerCase()];
      if (!f || !Object.hasOwn(FUNCS, ast.name.toLowerCase())) throw new DimError(`Função não permitida: ${ast.name}.`);
      if (ast.args.length < f.min || ast.args.length > f.max) throw new DimError(`Número de argumentos inválido em ${ast.name}.`);
      const name = ast.name.toLowerCase();
      if (name === 'pi') return DIMENSIONLESS;
      const ds = ast.args.map((x) => analyze(x, dims));
      if (name === 'min' || name === 'max') {
        if (!ds.every((d) => compatibleDimensions(d, ds[0]!))) throw new DimError(`Os argumentos de ${name} devem ter a mesma grandeza.`);
        return ds[0]!;
      }
      if (name === 'abs') return ds[0]!;
      if (name === 'sqrt') {
        const d = physical(ds[0]!);
        if (d.L % 2 || d.M % 2 || d.T % 2) throw new DimError('Raiz quadrada só de grandezas com expoentes pares (ex.: área → comprimento).');
        return { L: d.L / 2, M: d.M / 2, T: d.T / 2, N: 0 };
      }
      // round, ceil, floor: dependem da unidade se aplicados a grandezas — só adimensionais
      if (!compatibleDimensions(ds[0]!, DIMENSIONLESS)) throw new DimError(`${name} só se aplica a valores adimensionais (ex.: ceil(comprimento / espacamento)).`);
      if (name === 'round' && ast.args[1]) {
        const n = literalInteger(ast.args[1]);
        if (n === null || n < 0 || n > 10) throw new DimError('O número de casas de round deve ser um inteiro entre 0 e 10.');
      }
      return DIMENSIONLESS;
    }
  }
}

function literalInteger(ast: Ast): number | null {
  if (ast.t === 'num' && /^\d+$/.test(ast.v)) return Number(ast.v);
  if (ast.t === 'un' && ast.op === '-' && ast.a.t === 'num' && /^\d+$/.test(ast.a.v)) return -Number(ast.a.v);
  return null;
}

function collectSymbols(ast: Ast, out = new Set<string>()): Set<string> {
  if (ast.t === 'ref') out.add(ast.path.join('.'));
  else if (ast.t === 'un') collectSymbols(ast.a, out);
  else if (ast.t === 'bin') { collectSymbols(ast.a, out); collectSymbols(ast.b, out); }
  else if (ast.t === 'call') ast.args.forEach((a) => collectSymbols(a, out));
  return out;
}

export interface FormulaAnalysis {
  issues: FormulaIssue[];
  resultDimension: Dimension | null;
}

/** Valida a definição (sintaxe, variáveis, unidades, grandezas). `units` = unidades da organização. */
export function validateFormula(def: FormulaDef, units: readonly FormulaUnit[]): FormulaAnalysis {
  const issues: FormulaIssue[] = [];
  const byUnit = unitIndex(units);
  const dims = new Map<string, Dimension>();
  const seen = new Set<string>();
  def.variables.forEach((v, i) => {
    if (!SYMBOL_RE.test(v.symbol) || RESERVED.has(v.symbol.toLowerCase())) issues.push({ path: `variables.${i}.symbol`, message: `Símbolo inválido: "${v.symbol}". Use letras, números e _ (sem começar por número).` });
    if (seen.has(v.symbol)) issues.push({ path: `variables.${i}.symbol`, message: `Símbolo repetido: ${v.symbol}.` });
    seen.add(v.symbol);
    if (!v.label.trim()) issues.push({ path: `variables.${i}.label`, message: `Informe a descrição da variável ${v.symbol}.` });
    const u = byUnit.get(v.unit);
    if (!u) issues.push({ path: `variables.${i}.unit`, message: `Unidade não cadastrada: ${v.unit}.` });
    else dims.set(v.symbol, u.dimension);
  });
  let ast: Ast;
  try {
    ast = parseExpression(def.expression);
  } catch (e) {
    if (e instanceof ExpressionError) return { issues: [...issues, { path: 'expression', message: `${e.message} (posição ${e.position + 1})` }], resultDimension: null };
    throw e;
  }
  const used = collectSymbols(ast);
  def.variables.forEach((v, i) => { if (!used.has(v.symbol)) issues.push({ path: `variables.${i}.symbol`, message: `A variável ${v.symbol} não é usada na expressão.` }); });
  let resultDimension: Dimension | null = null;
  try {
    resultDimension = physical(analyze(ast, dims));
  } catch (e) {
    if (!(e instanceof DimError)) throw e;
    issues.push({ path: 'expression', message: e.message });
  }
  return { issues, resultDimension };
}

export interface FormulaInput {
  symbol: string;
  value: string;
  unit: string;
}

export interface MemoryInput {
  symbol: string;
  label: string;
  value: string;
  unit: string;
  baseValue: string;
  baseUnit: string;
}

/** Memória de cálculo: tudo que é preciso para refazer a conta à mão. */
export interface CalculationMemory {
  method: 'MANUAL' | 'FORMULA';
  expression: string | null;
  inputs: MemoryInput[];
  /** Expressão com os valores já convertidos para a unidade base. */
  substituted: string | null;
  resultBase: string;
  resultBaseUnit: string;
  result: string;
  unit: string;
}

export interface CalculationResult {
  quantity: string;
  memory: CalculationMemory;
}

const fmt = (d: Decimal) => {
  const s = d.toDecimalPlaces(QUANTITY_SCALE).toFixed();
  return s === '-0' ? '0' : s;
};

function parseValue(raw: string, label: string): Decimal {
  const t = raw.trim().replace(',', '.');
  if (!/^-?\d+(\.\d+)?$/.test(t)) throw new FormulaError([{ path: 'inputs', message: `Valor inválido para ${label}: "${raw}".` }]);
  return new D(t);
}

function toBase(value: Decimal, unit: FormulaUnit) {
  return value.times(unit.factor);
}

function targetFrom(resultBase: Decimal, resultDim: Dimension, target: FormulaUnit, issues: FormulaIssue[]): Decimal | null {
  if (!compatibleDimensions(resultDim, target.dimension)) {
    issues.push({ path: 'unit', message: `O resultado é ${describeDimension(physical(resultDim)).toLowerCase()}, mas o serviço é medido em ${target.symbol} (${describeDimension(physical(target.dimension)).toLowerCase()}).` });
    return null;
  }
  return resultBase.div(target.factor);
}

/**
 * Avalia uma fórmula com os valores informados e devolve a quantidade na unidade do serviço (`target`).
 * Lança FormulaError com mensagens para o usuário (variável ausente, unidade incompatível, divisão por zero…).
 */
export function evaluateFormula(def: FormulaDef, inputs: readonly FormulaInput[], units: readonly FormulaUnit[], target: FormulaUnit): CalculationResult {
  const analysis = validateFormula(def, units);
  if (analysis.issues.length) throw new FormulaError(analysis.issues);
  const byUnit = unitIndex(units);
  const issues: FormulaIssue[] = [];
  const values = new Map<string, Decimal>();
  const memInputs: MemoryInput[] = [];
  for (const v of def.variables) {
    const given = inputs.find((i) => i.symbol === v.symbol);
    const declared = byUnit.get(v.unit)!;
    if (!given || !given.value.trim()) { issues.push({ path: `inputs.${v.symbol}`, message: `Informe ${v.label} (${v.symbol}).` }); continue; }
    const unit = byUnit.get(given.unit);
    if (!unit) { issues.push({ path: `inputs.${v.symbol}`, message: `Unidade não cadastrada: ${given.unit}.` }); continue; }
    if (!compatibleDimensions(unit.dimension, declared.dimension)) {
      issues.push({ path: `inputs.${v.symbol}`, message: `${v.label}: ${given.unit} não é ${describeDimension(physical(declared.dimension)).toLowerCase()}.` });
      continue;
    }
    let value: Decimal;
    try { value = parseValue(given.value, v.label); } catch (e) { issues.push(...(e as FormulaError).issues.map((x) => ({ ...x, path: `inputs.${v.symbol}` }))); continue; }
    if (v.constraint === 'positive' && !value.gt(0)) issues.push({ path: `inputs.${v.symbol}`, message: `${v.label} deve ser maior que zero.` });
    if (v.constraint === 'nonnegative' && value.lt(0)) issues.push({ path: `inputs.${v.symbol}`, message: `${v.label} não pode ser negativo.` });
    const base = toBase(value, unit);
    values.set(v.symbol, base);
    memInputs.push({ symbol: v.symbol, label: v.label, value: value.toFixed(), unit: unit.symbol, baseValue: fmt(base), baseUnit: baseUnitSymbol(unit.dimension) });
  }
  const extra = inputs.filter((i) => !def.variables.some((v) => v.symbol === i.symbol));
  for (const x of extra) issues.push({ path: `inputs.${x.symbol}`, message: `Variável não pertence à fórmula: ${x.symbol}.` });
  if (issues.length) throw new FormulaError(issues);

  const ast = parseExpression(def.expression);
  const resultBase = evalAst(ast, values);
  const resultDim = analysis.resultDimension!;
  const converted = targetFrom(resultBase, resultDim, target, issues);
  if (!converted) throw new FormulaError(issues);
  const quantity = fmt(converted);
  return {
    quantity,
    memory: {
      method: 'FORMULA',
      expression: def.expression,
      inputs: memInputs,
      substituted: render(ast, (s) => {
        const m = memInputs.find((i) => i.symbol === s)!;
        return m.baseUnit === '1' ? m.baseValue : `${m.baseValue} ${m.baseUnit}`;
      }),
      resultBase: fmt(resultBase),
      resultBaseUnit: baseUnitSymbol(resultDim),
      result: quantity,
      unit: target.symbol,
    },
  };
}

/** Medição manual: valor numa unidade compatível, convertido para a unidade do serviço. */
export function manualQuantity(input: { value: string; unit: string }, units: readonly FormulaUnit[], target: FormulaUnit): CalculationResult {
  const unit = unitIndex(units).get(input.unit);
  if (!unit) throw new FormulaError([{ path: 'unit', message: `Unidade não cadastrada: ${input.unit}.` }]);
  const value = parseValue(input.value, 'a quantidade');
  const issues: FormulaIssue[] = [];
  const base = toBase(value, unit);
  const converted = targetFrom(base, unit.dimension, target, issues);
  if (!converted) throw new FormulaError(issues);
  const quantity = fmt(converted);
  return {
    quantity,
    memory: {
      method: 'MANUAL', expression: null, substituted: null,
      inputs: [{ symbol: 'q', label: 'Quantidade informada', value: value.toFixed(), unit: unit.symbol, baseValue: fmt(base), baseUnit: baseUnitSymbol(physical(unit.dimension)) }],
      resultBase: fmt(base), resultBaseUnit: baseUnitSymbol(physical(unit.dimension)), result: quantity, unit: target.symbol,
    },
  };
}

function evalAst(ast: Ast, vars: Map<string, Decimal>): Decimal {
  switch (ast.t) {
    case 'num': return new D(ast.v);
    case 'ref': return vars.get(ast.path[0]!)!;
    case 'un': return evalAst(ast.a, vars).neg();
    case 'bin': {
      const a = evalAst(ast.a, vars);
      const b = evalAst(ast.b, vars);
      switch (ast.op) {
        case '+': return a.plus(b);
        case '-': return a.minus(b);
        case '*': return a.times(b);
        case '/':
          if (b.isZero()) throw new FormulaError([{ path: 'expression', message: 'Divisão por zero com os valores informados.' }]);
          return a.div(b);
        case '^': {
          if (a.isZero() && b.lte(0)) throw new FormulaError([{ path: 'expression', message: 'Potência de zero com expoente não positivo.' }]);
          if (a.lt(0) && !b.isInteger()) throw new FormulaError([{ path: 'expression', message: 'Potência fracionária de número negativo.' }]);
          if (b.abs().gt(100)) throw new FormulaError([{ path: 'expression', message: 'Expoente fora do limite (±100).' }]);
          return a.pow(b);
        }
        default: throw new FormulaError([{ path: 'expression', message: 'Operador não permitido.' }]);
      }
    }
    case 'call': {
      const name = ast.name.toLowerCase();
      if (name === 'pi') return D.acos(-1);
      const xs = ast.args.map((x) => evalAst(x, vars));
      switch (name) {
        case 'min': return D.min(...xs);
        case 'max': return D.max(...xs);
        case 'abs': return xs[0]!.abs();
        case 'sqrt':
          if (xs[0]!.lt(0)) throw new FormulaError([{ path: 'expression', message: 'Raiz quadrada de número negativo com os valores informados.' }]);
          return xs[0]!.sqrt();
        case 'round': return xs[0]!.toDecimalPlaces(xs[1] ? xs[1].toNumber() : 0, Decimal.ROUND_HALF_UP);
        case 'ceil': return xs[0]!.ceil();
        case 'floor': return xs[0]!.floor();
      }
      throw new FormulaError([{ path: 'expression', message: `Função não permitida: ${ast.name}.` }]);
    }
    default: throw new FormulaError([{ path: 'expression', message: 'Elemento não permitido em fórmulas.' }]);
  }
}

const PREC: Record<string, number> = { '+': 1, '-': 1, '*': 2, '/': 2, '^': 3 };
/** Reescreve a expressão (para a memória), substituindo variáveis por valores. */
export function render(ast: Ast, sub: (symbol: string) => string, parentPrec = 0, right = false): string {
  switch (ast.t) {
    case 'num': return ast.v;
    case 'ref': return sub(ast.path.join('.'));
    case 'un': { const x = `-${render(ast.a, sub, 3)}`; return parentPrec >= 2 ? `(${x})` : x; }
    case 'bin': {
      const p = PREC[ast.op] ?? 0;
      const s = `${render(ast.a, sub, p)} ${ast.op === '*' ? '×' : ast.op === '/' ? '÷' : ast.op} ${render(ast.b, sub, p, true)}`;
      return p < parentPrec || (p === parentPrec && (p === 3 ? !right : right)) ? `(${s})` : s;
    }
    case 'call': return `${ast.name}(${ast.args.map((a) => render(a, sub)).join('; ')})`;
    default: return '';
  }
}
