import { describe, expect, it } from 'vitest';
import { DEFAULT_UNITS } from '../units/units.js';
import { evaluateFormula, FormulaError, manualQuantity, validateFormula, type FormulaDef } from './formula.js';
import { parseExpression } from '../expression/parser.js';

const U = DEFAULT_UNITS;
const unit = (s: string) => U.find((u) => u.symbol === s)!;
const errs = (f: () => unknown) => {
  try { f(); } catch (e) { if (e instanceof FormulaError) return e.issues.map((i) => i.message).join(' | '); throw e; }
  throw new Error('esperava FormulaError');
};

describe('fórmulas — resultados conhecidos', () => {
  it('área de parede descontando aberturas (com contagem)', () => {
    const def: FormulaDef = {
      expression: 'comprimento * altura - n_portas * area_porta',
      variables: [
        { symbol: 'comprimento', label: 'Comprimento', unit: 'm', constraint: 'positive' },
        { symbol: 'altura', label: 'Pé-direito', unit: 'm', constraint: 'positive' },
        { symbol: 'n_portas', label: 'Portas', unit: 'un', constraint: 'nonnegative' },
        { symbol: 'area_porta', label: 'Área da porta', unit: 'm²', constraint: 'nonnegative' },
      ],
    };
    const r = evaluateFormula(def, [
      { symbol: 'comprimento', value: '4,20', unit: 'm' },
      { symbol: 'altura', value: '280', unit: 'cm' },
      { symbol: 'n_portas', value: '2', unit: 'un' },
      { symbol: 'area_porta', value: '1.68', unit: 'm²' },
    ], U, unit('m²'));
    expect(r.quantity).toBe('8.4'); // 4,20 × 2,80 − 2 × 1,68 = 11,76 − 3,36
    expect(r.memory.inputs.find((i) => i.symbol === 'altura')).toMatchObject({ value: '280', unit: 'cm', baseValue: '2.8', baseUnit: 'm' });
    expect(r.memory.substituted).toBe('4.2 m × 2.8 m - 2 un × 1.68 m²');
    expect(r.memory).toMatchObject({ method: 'FORMULA', resultBase: '8.4', resultBaseUnit: 'm²', result: '8.4', unit: 'm²' });
  });

  it('volume de escavação de vala com talude médio, resultado em m³ e em L', () => {
    const def: FormulaDef = {
      expression: '(b + (b + 2 * h * talude)) / 2 * h * c',
      variables: [
        { symbol: 'b', label: 'Largura de fundo', unit: 'm' },
        { symbol: 'h', label: 'Profundidade média', unit: 'm' },
        { symbol: 'talude', label: 'Inclinação do talude (H:V)', unit: '%' },
        { symbol: 'c', label: 'Comprimento', unit: 'm' },
      ],
    };
    const inputs = [
      { symbol: 'b', value: '0.60', unit: 'm' },
      { symbol: 'h', value: '1.50', unit: 'm' },
      { symbol: 'talude', value: '50', unit: '%' },
      { symbol: 'c', value: '42.35', unit: 'm' },
    ];
    // largura do topo = 0,60 + 2 × 1,50 × 0,5 = 2,10; média 1,35; 1,35 × 1,50 × 42,35 = 85,75875
    expect(evaluateFormula(def, inputs, U, unit('m³')).quantity).toBe('85.75875');
    expect(evaluateFormula(def, inputs, U, unit('L')).quantity).toBe('85758.75');
  });

  it('precisão decimal exata: 0,1 + 0,2 = 0,3 e 1/3 com 10 casas', () => {
    const def: FormulaDef = { expression: 'a + b', variables: [{ symbol: 'a', label: 'A', unit: 'm' }, { symbol: 'b', label: 'B', unit: 'm' }] };
    expect(evaluateFormula(def, [{ symbol: 'a', value: '0.1', unit: 'm' }, { symbol: 'b', value: '0.2', unit: 'm' }], U, unit('m')).quantity).toBe('0.3');
    const third: FormulaDef = { expression: 'a / 3', variables: [{ symbol: 'a', label: 'A', unit: 'm' }] };
    expect(evaluateFormula(third, [{ symbol: 'a', value: '1', unit: 'm' }], U, unit('m')).quantity).toBe('0.3333333333');
  });

  it('quantidade de estribos com ceil e conversão cm → m; raiz de área; pi', () => {
    const est: FormulaDef = { expression: 'ceil(c / s) + 1', variables: [{ symbol: 'c', label: 'Comprimento da viga', unit: 'm' }, { symbol: 's', label: 'Espaçamento', unit: 'cm' }] };
    expect(evaluateFormula(est, [{ symbol: 'c', value: '5', unit: 'm' }, { symbol: 's', value: '15', unit: 'cm' }], U, unit('un')).quantity).toBe('35');
    const lado: FormulaDef = { expression: 'sqrt(a)', variables: [{ symbol: 'a', label: 'Área', unit: 'm²' }] };
    expect(evaluateFormula(lado, [{ symbol: 'a', value: '2.25', unit: 'm²' }], U, unit('m')).quantity).toBe('1.5');
    const circ: FormulaDef = { expression: 'pi() * (d / 2) ^ 2 * h', variables: [{ symbol: 'd', label: 'Diâmetro', unit: 'cm' }, { symbol: 'h', label: 'Altura', unit: 'm' }] };
    expect(evaluateFormula(circ, [{ symbol: 'd', value: '40', unit: 'cm' }, { symbol: 'h', value: '10', unit: 'm' }], U, unit('m³')).quantity).toBe('1.2566370614');
    const mx: FormulaDef = { expression: 'max(a; b) - min(a, b)', variables: [{ symbol: 'a', label: 'A', unit: 'm' }, { symbol: 'b', label: 'B', unit: 'm' }] };
    expect(evaluateFormula(mx, [{ symbol: 'a', value: '1,5', unit: 'm' }, { symbol: 'b', value: '40', unit: 'cm' }], U, unit('m')).quantity).toBe('1.1');
  });

  it('precedência: -x^2 = -(x²) e potência à direita', () => {
    const def: FormulaDef = { expression: 'a * a + 2 ^ 3 ^ 0 * a * a * 0 - (-x ^ 2) * a * a', variables: [{ symbol: 'a', label: 'A', unit: 'm' }, { symbol: 'x', label: 'X', unit: '%' }] };
    expect(evaluateFormula(def, [{ symbol: 'a', value: '3', unit: 'm' }, { symbol: 'x', value: '10', unit: '%' }], U, unit('m²')).quantity).toBe('9.09'); // 9 + 0 + 0,01 × 9
    expect(JSON.stringify(parseExpression('-x^2'))).toBe(JSON.stringify({ t: 'un', op: '-', a: { t: 'bin', op: '^', a: { t: 'ref', path: ['x'] }, b: { t: 'num', v: '2' } } }));
  });

  it('medição manual converte para a unidade do serviço', () => {
    const r = manualQuantity({ value: '1250', unit: 'cm²' }, U, unit('m²'));
    expect(r.quantity).toBe('0.125');
    expect(r.memory).toMatchObject({ method: 'MANUAL', inputs: [{ value: '1250', unit: 'cm²', baseValue: '0.125', baseUnit: 'm²' }] });
    expect(errs(() => manualQuantity({ value: '3', unit: 'm' }, U, unit('m²')))).toContain('serviço é medido em m²');
  });
});

describe('fórmulas — rejeições', () => {
  const v = (expression: string, variables = [{ symbol: 'a', label: 'A', unit: 'm' }, { symbol: 'b', label: 'B', unit: 'm²' }]) =>
    validateFormula({ expression, variables }, U).issues.map((i) => i.message).join(' | ');

  it('soma de grandezas diferentes (m + m²) é rejeitada', () => {
    expect(v('a + b')).toContain('Não é possível somar comprimento e área');
    expect(v('a * a + b')).toBe('');
  });

  it('constante somada a grandeza, round de grandeza e expoente variável são rejeitados', () => {
    expect(v('a + 0.10 + b / a')).toContain('Não é possível somar comprimento e adimensional');
    expect(v('round(a) + b / a')).toContain('round só se aplica a valores adimensionais');
    expect(v('a ^ (b / b) * b')).toContain('expoente inteiro constante');
    expect(v('sqrt(a) + b')).toContain('Raiz quadrada só de grandezas com expoentes pares');
  });

  it('expressões maliciosas ou inválidas são rejeitadas sem executar nada', () => {
    expect(v('constructor.constructor("return process")()')).toMatch(/Nome não permitido|Símbolo inesperado/);
    expect(v('a.__proto__ + b')).toMatch(/Nome não permitido/);
    expect(v('eval(a) + b')).toContain('Função não permitida: eval');
    expect(v('process + a + b')).toContain('Variável não declarada: process');
    expect(v('a + b;')).toMatch(/Símbolo inesperado|Expressão incompleta/);
    expect(v('a > b')).toContain('Comparações e operadores lógicos não são permitidos');
    expect(v('"texto"')).toContain('Fórmulas só aceitam números e variáveis');
    expect(v('a'.repeat(501))).toContain('Expressão muito longa');
    expect(v('('.repeat(60) + 'a' + ')'.repeat(60))).toContain('aninhada demais');
  });

  it('variáveis mal declaradas', () => {
    expect(v('a * a', [{ symbol: 'a', label: 'A', unit: 'm' }, { symbol: 'a', label: 'A2', unit: 'm' }])).toContain('Símbolo repetido');
    expect(v('a', [{ symbol: 'a', label: 'A', unit: 'polegada' }])).toContain('Unidade não cadastrada');
    expect(v('a', [{ symbol: 'a', label: 'A', unit: 'm' }, { symbol: 'z', label: 'Z', unit: 'm' }])).toContain('não é usada');
    expect(v('a', [{ symbol: '1a', label: 'A', unit: 'm' }])).toContain('Símbolo inválido');
  });

  it('valores inválidos, restrições, divisão por zero e resultado incompatível', () => {
    const def: FormulaDef = { expression: 'a / b', variables: [{ symbol: 'a', label: 'Área', unit: 'm²', constraint: 'positive' }, { symbol: 'b', label: 'Largura', unit: 'm' }] };
    expect(errs(() => evaluateFormula(def, [{ symbol: 'a', value: '-1', unit: 'm²' }, { symbol: 'b', value: '2', unit: 'm' }], U, unit('m')))).toContain('Área deve ser maior que zero');
    expect(errs(() => evaluateFormula(def, [{ symbol: 'a', value: '1', unit: 'm²' }, { symbol: 'b', value: '0', unit: 'm' }], U, unit('m')))).toContain('Divisão por zero');
    expect(errs(() => evaluateFormula(def, [{ symbol: 'a', value: '1e3', unit: 'm²' }, { symbol: 'b', value: '2', unit: 'm' }], U, unit('m')))).toContain('Valor inválido');
    expect(errs(() => evaluateFormula(def, [{ symbol: 'a', value: '1', unit: 'kg' }, { symbol: 'b', value: '2', unit: 'm' }], U, unit('m')))).toContain('kg não é área');
    expect(errs(() => evaluateFormula(def, [{ symbol: 'b', value: '2', unit: 'm' }], U, unit('m')))).toContain('Informe Área');
    expect(errs(() => evaluateFormula(def, [{ symbol: 'a', value: '1', unit: 'm²' }, { symbol: 'b', value: '2', unit: 'm' }], U, unit('m²')))).toContain('O resultado é comprimento');
  });
});

describe('fórmulas iniciais', () => {
  it('todas são válidas com as unidades padrão', async () => {
    const { DEFAULT_FORMULAS } = await import('./defaults.js');
    for (const f of DEFAULT_FORMULAS) expect(validateFormula(f, U).issues, f.code).toEqual([]);
  });
});
