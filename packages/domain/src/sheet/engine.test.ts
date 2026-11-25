import { describe, expect, it } from 'vitest';
import { DEFAULT_UNITS } from '../units/units.js';
import { compileSheet, computeSheet, evaluateCellNumber, outputInUnit, type SheetDef, type SheetRowInput } from './engine.js';
import { DEFAULT_SHEET_TEMPLATES } from './defaults.js';

const tpl = (code: string) => DEFAULT_SHEET_TEMPLATES.find((t) => t.code === code)!.definition;
const row = (o: Record<string, string>): SheetRowInput => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, { v }]));
const run = (def: SheetDef, rows: SheetRowInput[], params: Record<string, string> = {}) => {
  const c = compileSheet(def, DEFAULT_UNITS);
  expect(c.issues).toEqual([]);
  return computeSheet(c, rows, params);
};
const total = (r: ReturnType<typeof run>, k: string) => r.totals.find((t) => t.key === k)!.total;

describe('fichas padrão compilam sem problemas', () => {
  it.each(DEFAULT_SHEET_TEMPLATES.map((t) => [t.code, t.definition] as const))('%s', (_c, def) => {
    expect(compileSheet(def, DEFAULT_UNITS).issues).toEqual([]);
  });
});

describe('REDE — SMR I, drenagem PEAD DN 600 (valores da planilha)', () => {
  const r = run(tpl('REDE'), [row({ trecho: 'PV1-PV6', material: 'PEAD', dn: '600', comprimento: '29,11+53,35+61,48+18,15+22,54', inclinacao: '0,43' })], { comp_peca: '1', h_colchao: '0.498' });
  const cells = r.rows[0]!.cells;
  it('soma das parcelas digitadas na célula', () => {
    expect(cells.comprimento!.value).toBe('184.63');
    expect(cells.comprimento!.expr).toBe('29,11+53,35+61,48+18,15+22,54');
  });
  it('comprimento com inclinação e transpasse, peças, largura pela tabela, profundidade padrão', () => {
    expect(cells.comp_total!.value).toBe('191.172050179');
    expect(cells.pecas!.value).toBe('192');
    expect(cells.largura!.value).toBe('1.2');
    expect(cells.prof!.value).toBe('1.5');
  });
  it('escavação, colchão, reaterro e fundo', () => {
    expect(cells.escavacao!.value).toBe('344.1096903222');
    expect(cells.colchao!.value).toBe('110.334888');
    expect(Number(cells.reaterro!.value)).toBeCloseTo(179.7221785649358, 9);
    expect(cells.fundo!.value).toBe('229.4064602148');
    expect(total(r, 'escavacao')).toBe('344.1096903222');
    expect(r.errorCount).toBe(0);
  });
  it('DN fora da tabela é erro na linha e não entra no total', () => {
    const x = run(tpl('REDE'), [row({ trecho: 'T1', dn: '350', comprimento: '10' }), row({ trecho: 'T2', dn: '100', comprimento: '10' })]);
    expect(x.rows[0]!.errors.join()).toMatch(/não está na tabela/);
    expect(x.errorCount).toBe(1);
    // 10 × 1,031 × 0,37 × 1,5
    expect(total(x, 'escavacao')).toBe('5.72205');
  });
});

describe('CER — Viva Mais Barra, cerâmica', () => {
  const r = run(tpl('CER'), [row({ ambiente: 'Sala/cozinha', tipo: 'Piso + rodapé', peca_l: '67', peca_c: '67', pecas: '51', perimetro: '21,15', altura: '0,07', desconto: '0,392', paginacao: 'Sim' })]);
  const c = r.rows[0]!.cells;
  it('área por paginação, área vertical, total e perda de 5 %', () => {
    expect(c.area_piso!.value).toBe('22.8939');
    expect(c.area_parede!.value).toBe('1.0885');
    expect(c.area_total!.value).toBe('23.9824');
    expect(c.area_material!.value).toBe('25.18152');
    expect(c.rodape!.value).toBe('21.15');
  });
  it('revestimento paginado: peças × dimensões (planilha: 16 × 0,37 × 0,59 = 3,4928 → 3,66744 com perda)', () => {
    const x = run(tpl('CER'), [row({ ambiente: 'Cozinha', tipo: 'Revestimento', peca_l: '37', peca_c: '59', pecas: '16', altura: '1,5', paginacao: 'Sim' })]);
    expect(x.rows[0]!.cells.area_parede!.value).toBe('3.4928');
    expect(x.rows[0]!.cells.area_material!.value).toBe('3.66744');
    expect(x.rows[0]!.cells.contrapiso!.value).toBe('0');
  });
  it('sem paginação usa 13 % e área geométrica', () => {
    const x = run(tpl('CER'), [row({ ambiente: 'Banho', tipo: 'Piso', area_geo: '10', paginacao: 'Não' })]);
    expect(x.rows[0]!.cells.area_material!.value).toBe('11.3');
    expect(x.rows[0]!.cells.rodape!.value).toBe('0');
  });
  it('opção inexistente é erro', () => {
    const x = run(tpl('CER'), [row({ ambiente: 'A', tipo: 'Teto', area_geo: '1' })]);
    expect(x.rows[0]!.errors.join()).toMatch(/não é uma opção/);
  });
});

describe('CONC, ACO, TELHADO, PAREDE', () => {
  it('concreto 8,319 m³ e fôrma 167,676 m²', () => {
    const conc = run(tpl('CONC'), [row({ elemento: 'Paredes', comprimento: '32,5', altura: '2,7', desconto: '4,56', espessura: '10', faces_forma: '0' })]);
    expect(total(conc, 'concreto')).toBe('8.319');
    const forma = run(tpl('CONC'), [row({ elemento: 'Paredes', comprimento: '33,99', altura: '2,7', desconto: '7,935', espessura: '10' })]);
    expect(total(forma, 'forma')).toBe('167.676');
  });
  it('aço: barra 6.3 × 34 × 1 m = 8,33 kg; tela Q-138 × 6 = 194,04 kg; barra 10.0 com 51 m', () => {
    const r = run(tpl('ACO'), [
      row({ elemento: 'Vergas', tipo: 'Barra', bitola: '6,3', quantidade: '34', comprimento: '1' }),
      row({ elemento: 'Laje', tipo: 'Tela', tela: 'Q-138', quantidade: '6' }),
      row({ elemento: 'Arranque', tipo: 'Barra', bitola: '10', quantidade: '1', comprimento: '51' }),
    ]);
    expect(r.rows.map((x) => x.cells.massa!.value)).toEqual(['8.33', '194.04', '31.467']);
    expect(total(r, 'aco')).toBe('233.837');
    const t = r.totals[0]!;
    expect(outputInUnit(t, DEFAULT_UNITS.find((u) => u.symbol === 't')!)).toBe('0.233837');
    expect(outputInUnit(t, DEFAULT_UNITS.find((u) => u.symbol === 'm²')!)).toBeNull();
  });
  it('perda de aço sobrescrita no parâmetro', () => {
    const r = run(tpl('ACO'), [row({ elemento: 'V', tipo: 'Barra', bitola: '8', quantidade: '10', comprimento: '2' })], { perda_aco: '10' });
    expect(total(r, 'aco')).toBe('8.69');
  });
  it('telhado 3,05 × 1,1 × 7 = 23,485 m²', () => {
    expect(total(run(tpl('TELHADO'), [row({ pano: 'Garagem', comprimento: '3,05', largura: '1,1', quantidade: '7' })]), 'area')).toBe('23.485');
  });
  it('parede com padrão de 1 face e obrigatório ausente', () => {
    const r = run(tpl('PAREDE'), [row({ ambiente: 'Sala', perimetro: '10', altura: '2,8', desconto: '1,6' }), row({ ambiente: 'X', perimetro: '5' })]);
    expect(r.rows[0]!.cells.area!.value).toBe('26.4');
    expect(r.rows[1]!.errors).toContain('Altura: obrigatório.');
    expect(total(r, 'area')).toBe('26.4');
  });
});

describe('validação estática', () => {
  const base: SheetDef = { columns: [{ key: 'a', label: 'A', kind: 'input', type: 'number', unit: 'm' }, { key: 'b', label: 'B', kind: 'input', type: 'number', unit: 'm²' }], params: [], tables: [], outputs: [] };
  const issues = (extra: Partial<SheetDef>) => compileSheet({ ...base, ...extra, columns: [...base.columns, ...(extra.columns ?? [])] }, DEFAULT_UNITS).issues.map((i) => i.message).join(' | ');
  it('soma de grandezas diferentes', () => {
    expect(issues({ columns: [{ key: 'x', label: 'X', kind: 'calc', type: 'number', unit: 'm', expression: 'a + b' }] })).toMatch(/Não é possível somar/);
  });
  it('resultado em unidade incompatível', () => {
    expect(issues({ columns: [{ key: 'x', label: 'X', kind: 'calc', type: 'number', unit: 'm³', expression: 'a * a' }] })).toMatch(/mas a coluna está em m³/);
  });
  it('ciclo entre colunas calculadas', () => {
    expect(issues({ columns: [{ key: 'x', label: 'X', kind: 'calc', type: 'number', expression: 'y' }, { key: 'y', label: 'Y', kind: 'calc', type: 'number', expression: 'x' }] })).toMatch(/Cálculo circular/);
  });
  it('nome desconhecido, função proibida, tabela inexistente, chave inválida', () => {
    expect(issues({ columns: [{ key: 'x', label: 'X', kind: 'calc', type: 'number', expression: 'zz * 2' }] })).toMatch(/Nome desconhecido: zz/);
    expect(issues({ columns: [{ key: 'x', label: 'X', kind: 'calc', type: 'number', expression: 'eval(a)' }] })).toMatch(/Função não permitida/);
    expect(issues({ columns: [{ key: 'x', label: 'X', kind: 'calc', type: 'number', expression: 'tabela("nada"; a)' }] })).toMatch(/Tabela inexistente/);
    expect(issues({ columns: [{ key: '__proto__', label: 'X', kind: 'input', type: 'text' }] })).toMatch(/Chave inválida/);
    expect(issues({ columns: [{ key: 'a', label: 'Dup', kind: 'input', type: 'text' }] })).toMatch(/Chave repetida/);
  });
  it('se() com ramos de grandezas diferentes e condição não booleana', () => {
    expect(issues({ columns: [{ key: 'x', label: 'X', kind: 'calc', type: 'number', expression: 'se(a > 0; a; b)' }] })).toMatch(/mesmo tipo e grandeza/);
    expect(issues({ columns: [{ key: 'x', label: 'X', kind: 'calc', type: 'number', expression: 'se(a; a; a)' }] })).toMatch(/condição/);
  });
  it('ceil exige valor adimensional', () => {
    expect(issues({ columns: [{ key: 'x', label: 'X', kind: 'calc', type: 'number', expression: 'ceil(a)' }] })).toMatch(/adimensionais/);
  });
});

describe('células numéricas', () => {
  it('aceita contas com números e vírgula decimal', () => {
    expect(evaluateCellNumber('30,29+10,68+14,26').toFixed()).toBe('55.23');
    expect(evaluateCellNumber('=2*(3,5-1)').toFixed()).toBe('5');
  });
  it('recusa nomes, funções e texto', () => {
    expect(() => evaluateCellNumber('a+1')).toThrow();
    expect(() => evaluateCellNumber('max(1;2)')).toThrow();
    expect(() => evaluateCellNumber('1/0')).toThrow();
  });
  it('erro de célula vira erro da linha, sem quebrar a ficha', () => {
    const r = run(tpl('TELHADO'), [row({ pano: 'P', comprimento: 'abc', largura: '1' })]);
    expect(r.rows[0]!.errors[0]).toMatch(/Comprimento: Valor inválido/);
    expect(total(r, 'area')).toBe('0');
  });
  it('linha em branco é ignorada (sem erro de obrigatório)', () => {
    const r = run(tpl('TELHADO'), [row({}), row({ pano: '', comprimento: ' ' }), row({ pano: 'P', comprimento: '2', largura: '3' })]);
    expect(r.rows[0]!.blank).toBe(true);
    expect(r.rows[1]!.blank).toBe(true);
    expect(r.errorCount).toBe(0);
    expect(total(r, 'area')).toBe('6');
  });
  it('determinístico e exato em decimal (0,1 + 0,2)', () => {
    const r = run(tpl('TELHADO'), [row({ pano: 'P', comprimento: '0,1+0,2', largura: '1' })]);
    expect(total(r, 'area')).toBe('0.3');
  });
});
