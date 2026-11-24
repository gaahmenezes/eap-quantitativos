import { describe, expect, it } from 'vitest';
import { collectRefs, parseExpression } from './parser.js';
import { evaluateCondition, type Facts } from './condition.js';

const facts: Facts = { count: { TOWER: 2, FLOOR: 22, LOT: 0 }, module: { kind: 'VERTICAL_RESIDENTIAL' }, typology: { kind: 'APARTMENT', units: 40 } };

describe('parser de expressões', () => {
  it('respeita precedência e associatividade', () => {
    expect(parseExpression('1 + 2 * 3')).toEqual({ t: 'bin', op: '+', a: { t: 'num', v: '1' }, b: { t: 'bin', op: '*', a: { t: 'num', v: '2' }, b: { t: 'num', v: '3' } } });
    expect(parseExpression('2 ^ 3 ^ 2')).toMatchObject({ op: '^', b: { op: '^' } });
    expect(parseExpression('a.b.c')).toEqual({ t: 'ref', path: ['a', 'b', 'c'] });
    expect(parseExpression('comprimento * largura - aberturas')).toMatchObject({ op: '-' });
  });
  it('aceita vírgula decimal e operadores em português', () => {
    expect(parseExpression('2,5')).toEqual({ t: 'num', v: '2.5' });
    expect(parseExpression('não x e y ou z')).toMatchObject({ op: 'or', a: { op: 'and', a: { t: 'un', op: 'not' } } });
  });
  it('rejeita sintaxe inválida, caracteres e nomes perigosos', () => {
    expect(() => parseExpression('1 +')).toThrow(/incompleta/);
    expect(() => parseExpression('(1 + 2')).toThrow(/Esperado "\)"/);
    expect(() => parseExpression('a; b')).toThrow(/não permitido/);
    expect(() => parseExpression('x.constructor')).toThrow(/não permitido/);
    expect(() => parseExpression('__proto__')).toThrow(/não permitido/);
    expect(() => parseExpression('`x`')).toThrow();
    expect(() => parseExpression('('.repeat(60) + '1' + ')'.repeat(60))).toThrow(/aninhada/);
  });
  it('lista as referências usadas', () => {
    expect(collectRefs(parseExpression('count.TOWER > 1 e module.kind == "X"'))).toEqual([['count', 'TOWER'], ['module', 'kind']]);
  });
});

describe('condições de template', () => {
  it('avalia contagens, textos e lógica com curto-circuito', () => {
    expect(evaluateCondition('count.TOWER > 1', facts)).toBe(true);
    expect(evaluateCondition('count.LOT > 0 ou typology.kind == "APARTMENT"', facts)).toBe(true);
    expect(evaluateCondition('count.LOT > 0 e inexistente > 1', facts)).toBe(false);
    expect(evaluateCondition('não (count.FLOOR >= 22)', facts)).toBe(false);
  });
  it('erros de tipo e variáveis desconhecidas são explícitos', () => {
    expect(() => evaluateCondition('count.TOWER', facts)).toThrow(/verdadeiro ou falso/);
    expect(() => evaluateCondition('count.TORRE > 1', facts)).toThrow(/desconhecida: count.TORRE/);
    expect(() => evaluateCondition('module.kind > 1', facts)).toThrow(/exige números/);
    expect(() => evaluateCondition('count.TOWER == "2"', facts)).toThrow(/tipos diferentes/);
    expect(() => evaluateCondition('max(1,2) > 1', facts)).toThrow(/Funções não são permitidas/);
    expect(() => evaluateCondition('module.toString == "x"', facts)).toThrow(/desconhecida/);
  });
});
