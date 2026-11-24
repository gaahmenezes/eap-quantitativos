/**
 * Parser de expressões seguro (ADR-004): tokenizador + Pratt parser produzindo uma AST.
 * Nenhum código é executado: avaliadores percorrem a AST com regras próprias
 * (condições de template aqui; fórmulas decimais com análise dimensional na F6).
 *
 * Gramática:
 *   expr    := or
 *   or      := and ( ('ou' | '||') and )*
 *   and     := not ( ('e' | '&&') not )*
 *   not     := ('não' | 'nao' | '!') not | cmp
 *   cmp     := add ( ('=='|'!='|'<'|'<='|'>'|'>=') add )?
 *   add     := mul ( ('+'|'-') mul )*
 *   mul     := pow ( ('*'|'/') pow )*
 *   pow     := unary ( '^' pow )?
 *   unary   := '-' unary | primary
 *   primary := número | 'texto' | verdadeiro | falso | ident(.ident)* | ident '(' args ')' | '(' expr ')'
 */
export type Ast =
  | { t: 'num'; v: string }
  | { t: 'str'; v: string }
  | { t: 'bool'; v: boolean }
  | { t: 'ref'; path: string[] }
  | { t: 'un'; op: '-' | 'not'; a: Ast }
  | { t: 'bin'; op: '+' | '-' | '*' | '/' | '^' | '==' | '!=' | '<' | '<=' | '>' | '>=' | 'and' | 'or'; a: Ast; b: Ast }
  | { t: 'call'; name: string; args: Ast[] };

export class ExpressionError extends Error {
  constructor(message: string, readonly position: number) {
    super(message);
  }
}

type Tok = { k: 'num' | 'str' | 'id' | 'op' | 'eof'; v: string; p: number };

const MAX_LENGTH = 500;
const MAX_DEPTH = 40;
const OPS = ['<=', '>=', '==', '!=', '&&', '||', '+', '-', '*', '/', '^', '(', ')', ',', '<', '>', '!', '.'];
const WORD_OPS = new Map<string, string>([['e', '&&'], ['and', '&&'], ['ou', '||'], ['or', '||'], ['não', '!'], ['nao', '!'], ['not', '!']]);
/** Nomes que nunca podem ser referenciados (defesa contra acesso a protótipos). */
const FORBIDDEN = new Set(['__proto__', 'prototype', 'constructor']);

function tokenize(src: string): Tok[] {
  if (src.length > MAX_LENGTH) throw new ExpressionError(`Expressão muito longa (máximo de ${MAX_LENGTH} caracteres).`, MAX_LENGTH);
  const toks: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i]!;
    if (/\s/.test(c)) { i++; continue; }
    if (/\d/.test(c)) {
      const m = /^\d+([.,]\d+)?/.exec(src.slice(i))!;
      toks.push({ k: 'num', v: m[0].replace(',', '.'), p: i });
      i += m[0].length;
      continue;
    }
    if (c === "'" || c === '"') {
      const end = src.indexOf(c, i + 1);
      if (end < 0) throw new ExpressionError('Texto sem aspas de fechamento.', i);
      toks.push({ k: 'str', v: src.slice(i + 1, end), p: i });
      i = end + 1;
      continue;
    }
    const w = /^[\p{L}_][\p{L}\p{N}_]*/u.exec(src.slice(i));
    if (w) {
      const word = w[0];
      const lower = word.toLowerCase();
      const wordOp = WORD_OPS.get(lower);
      if (wordOp) toks.push({ k: 'op', v: wordOp, p: i });
      else toks.push({ k: 'id', v: word, p: i });
      i += word.length;
      continue;
    }
    const op = OPS.find((o) => src.startsWith(o, i));
    if (op) {
      toks.push({ k: 'op', v: op, p: i });
      i += op.length;
      continue;
    }
    throw new ExpressionError(`Caractere não permitido: "${c}".`, i);
  }
  toks.push({ k: 'eof', v: '', p: src.length });
  return toks;
}

export function parseExpression(src: string): Ast {
  const toks = tokenize(src);
  let i = 0;
  let depth = 0;
  const peek = () => toks[i]!;
  const next = () => toks[i++]!;
  const isOp = (v: string) => peek().k === 'op' && peek().v === v;
  const expect = (v: string) => {
    if (!isOp(v)) throw new ExpressionError(`Esperado "${v}".`, peek().p);
    next();
  };
  const guard = <T>(f: () => T): T => {
    if (++depth > MAX_DEPTH) throw new ExpressionError('Expressão aninhada demais.', peek().p);
    try { return f(); } finally { depth--; }
  };

  const primary = (): Ast => guard(() => {
    const t = next();
    if (t.k === 'num') return { t: 'num', v: t.v };
    if (t.k === 'str') return { t: 'str', v: t.v };
    if (t.k === 'op' && t.v === '(') { const e = or(); expect(')'); return e; }
    if (t.k === 'id') {
      const lower = t.v.toLowerCase();
      if (lower === 'verdadeiro' || lower === 'true') return { t: 'bool', v: true };
      if (lower === 'falso' || lower === 'false') return { t: 'bool', v: false };
      if (isOp('(')) {
        next();
        const args: Ast[] = [];
        if (!isOp(')')) { do { args.push(or()); } while (isOp(',') && next()); }
        expect(')');
        return { t: 'call', name: t.v, args };
      }
      const path = [t.v];
      while (isOp('.')) {
        next();
        const n = next();
        if (n.k !== 'id') throw new ExpressionError('Nome esperado após ".".', n.p);
        path.push(n.v);
      }
      for (const seg of path) if (FORBIDDEN.has(seg)) throw new ExpressionError(`Nome não permitido: ${seg}.`, t.p);
      return { t: 'ref', path };
    }
    throw new ExpressionError(t.k === 'eof' ? 'Expressão incompleta.' : `Símbolo inesperado: "${t.v}".`, t.p);
  });
  const unary = (): Ast => (isOp('-') ? (next(), { t: 'un', op: '-', a: guard(unary) }) : primary());
  const pow = (): Ast => {
    const a = unary();
    if (isOp('^')) { next(); return { t: 'bin', op: '^', a, b: guard(pow) }; }
    return a;
  };
  const chain = (sub: () => Ast, ops: string[], map: (o: string) => Extract<Ast, { t: 'bin' }>['op'] = (o) => o as never) => (): Ast => {
    let a = sub();
    while (peek().k === 'op' && ops.includes(peek().v)) { const o = next().v; a = { t: 'bin', op: map(o), a, b: sub() }; }
    return a;
  };
  const mul = chain(pow, ['*', '/']);
  const add = chain(mul, ['+', '-']);
  const cmp = (): Ast => {
    const a = add();
    if (peek().k === 'op' && ['==', '!=', '<', '<=', '>', '>='].includes(peek().v)) { const o = next().v as '=='; return { t: 'bin', op: o, a, b: add() }; }
    return a;
  };
  const not = (): Ast => (isOp('!') ? (next(), { t: 'un', op: 'not', a: guard(not) }) : cmp());
  const and = chain(not, ['&&'], () => 'and');
  function or(): Ast { return chain(and, ['||'], () => 'or')(); }

  const ast = or();
  if (peek().k !== 'eof') throw new ExpressionError(`Símbolo inesperado: "${peek().v}".`, peek().p);
  return ast;
}

/** Referências (caminhos) usadas por uma AST, para validação antecipada. */
export function collectRefs(ast: Ast, out: string[][] = []): string[][] {
  switch (ast.t) {
    case 'ref': out.push(ast.path); break;
    case 'un': collectRefs(ast.a, out); break;
    case 'bin': collectRefs(ast.a, out); collectRefs(ast.b, out); break;
    case 'call': ast.args.forEach((a) => collectRefs(a, out)); break;
  }
  return out;
}
