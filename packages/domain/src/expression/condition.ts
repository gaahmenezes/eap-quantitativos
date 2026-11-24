/**
 * Avaliador de condições de template sobre fatos do empreendimento (valores simples).
 * Tipos estritos: número, texto e lógico; comparações entre tipos diferentes são erro.
 */
import { ExpressionError, parseExpression, type Ast } from './parser.js';

export type FactValue = number | string | boolean;
export type Facts = { [k: string]: FactValue | Facts };

const own = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k);

function lookup(facts: Facts, path: string[]): FactValue {
  let cur: FactValue | Facts = facts;
  for (const seg of path) {
    if (typeof cur !== 'object' || cur === null || !own(cur, seg)) throw new ExpressionError(`Variável desconhecida: ${path.join('.')}.`, 0);
    cur = (cur as Facts)[seg]!;
  }
  if (typeof cur === 'object') throw new ExpressionError(`${path.join('.')} não é um valor.`, 0);
  return cur;
}

function evaluate(ast: Ast, facts: Facts): FactValue {
  switch (ast.t) {
    case 'num': return Number(ast.v);
    case 'str': return ast.v;
    case 'bool': return ast.v;
    case 'ref': return lookup(facts, ast.path);
    case 'call': throw new ExpressionError(`Funções não são permitidas em condições (${ast.name}).`, 0);
    case 'un': {
      const a = evaluate(ast.a, facts);
      if (ast.op === 'not') { if (typeof a !== 'boolean') throw new ExpressionError('"não" exige um valor lógico.', 0); return !a; }
      if (typeof a !== 'number') throw new ExpressionError('"-" exige um número.', 0);
      return -a;
    }
    case 'bin': {
      if (ast.op === 'and' || ast.op === 'or') {
        const a = evaluate(ast.a, facts);
        if (typeof a !== 'boolean') throw new ExpressionError(`"${ast.op === 'and' ? 'e' : 'ou'}" exige valores lógicos.`, 0);
        if (ast.op === 'and' && !a) return false;
        if (ast.op === 'or' && a) return true;
        const b = evaluate(ast.b, facts);
        if (typeof b !== 'boolean') throw new ExpressionError(`"${ast.op === 'and' ? 'e' : 'ou'}" exige valores lógicos.`, 0);
        return b;
      }
      const a = evaluate(ast.a, facts);
      const b = evaluate(ast.b, facts);
      if (ast.op === '==' || ast.op === '!=') {
        if (typeof a !== typeof b) throw new ExpressionError('Comparação entre tipos diferentes.', 0);
        return ast.op === '==' ? a === b : a !== b;
      }
      if (typeof a !== 'number' || typeof b !== 'number') throw new ExpressionError(`"${ast.op}" exige números.`, 0);
      switch (ast.op) {
        case '<': return a < b;
        case '<=': return a <= b;
        case '>': return a > b;
        case '>=': return a >= b;
        case '+': return a + b;
        case '-': return a - b;
        case '*': return a * b;
        case '/': if (b === 0) throw new ExpressionError('Divisão por zero.', 0); return a / b;
        case '^': return a ** b;
      }
    }
  }
}

export function evaluateCondition(source: string | Ast, facts: Facts): boolean {
  const ast = typeof source === 'string' ? parseExpression(source) : source;
  const v = evaluate(ast, facts);
  if (typeof v !== 'boolean') throw new ExpressionError('A condição deve resultar em verdadeiro ou falso.', 0);
  return v;
}

/** Verifica sintaxe e tipos com fatos de exemplo; retorna a mensagem de erro ou null. */
export function checkCondition(source: string, sampleFacts: Facts): string | null {
  try {
    evaluateCondition(source, sampleFacts);
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}
