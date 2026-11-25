import { describe, expect, it } from 'vitest';
import { DEFAULT_UNITS } from '../units/units.js';
import { DEFAULT_SHEET_TEMPLATES } from '../sheet/defaults.js';
import { buildScheduleRows, buildSheetRows, cellInput, detectDimensionPair, detectUnitColumn, colLetter, headerLabels, normalizeUnit, reconcileSheet, suggestColumns, suggestHeaderRow, suggestTarget, type XCell, type XSheet } from './workbook.js';

const tpl = (code: string) => DEFAULT_SHEET_TEMPLATES.find((t) => t.code === code)!.definition;
/** Monta um extrato: números viram células numéricas; "=…" vira fórmula com o valor dado em `[v, f]`. */
const X = (rows: (string | number | null | [number, string])[][], name = 'Aba'): XSheet => ({
  index: 0, name,
  rows: rows.map((r) => r.map((c): XCell | null => (c === null ? null : typeof c === 'number' ? { v: String(c), num: true } : Array.isArray(c) ? { v: String(c[0]), num: true, f: c[1] } : { v: c }))),
});

describe('extrato: células, cabeçalho e destino sugerido', () => {
  it('conta simples vira expressão; fórmula com referência usa o valor calculado', () => {
    expect(cellInput({ v: '184.63', num: true, f: '29.11+53.35+61.48+18.15+22.54' })).toBe('29.11+53.35+61.48+18.15+22.54');
    expect(cellInput({ v: '0.392', num: true, f: '(1*2.6+1*0.8+2*0.8+1*0.6)*K6' })).toBe('0.392');
    expect(cellInput({ v: '  Sala  ' })).toBe('Sala');
    expect(colLetter(0)).toBe('A'); expect(colLetter(25)).toBe('Z'); expect(colLetter(26)).toBe('AA');
  });
  it('linha de cabeçalho e rótulos (mesclados pela linha de cima)', () => {
    const s = X([['LEVANTAMENTO DE PISO'], [], [], ['Tipologia', 'Ambiente', 'Dimensões da peça', null, null, 'Peças / ambiente'], [], ['Piso + rodapé', 'Sala', 0.67, 'x', 0.67, 51]]);
    expect(suggestHeaderRow(s)).toBe(3);
    expect(headerLabels(s, 3).slice(0, 6)).toEqual(['Tipologia', 'Ambiente', 'Dimensões da peça', '', '', 'Peças / ambiente']);
  });
  it('destino pelo nome da aba (planilhas Viva Mais Barra e Marupi)', () => {
    expect(suggestTarget('Cerâmica MAT')).toEqual({ target: 'sheet', templateCode: 'CER' });
    expect(suggestTarget('Rede de Drenagem')).toEqual({ target: 'sheet', templateCode: 'REDE' });
    expect(suggestTarget('Telhado')).toEqual({ target: 'sheet', templateCode: 'TELHADO' });
    expect(suggestTarget('Esquad.Aluminio')).toEqual({ target: 'schedule', scheduleKind: 'ESQUADRIAS' });
    expect(suggestTarget('Louças_Metais_CONV')).toEqual({ target: 'schedule', scheduleKind: 'LOUCAS_METAIS' });
    expect(suggestTarget('Hidraulico casa')).toEqual({ target: 'schedule', scheduleKind: 'INSTALACOES_HIDRAULICAS' });
    expect(suggestTarget('Eletrica casa')).toEqual({ target: 'schedule', scheduleKind: 'INSTALACOES_ELETRICAS' });
    expect(suggestTarget('Considerações Gerais')).toEqual({ target: 'ignore' });
    expect(suggestTarget('Rede de Drenagem', ['Elemento', 'tipo', 'Trecho', 'Dimensão mm', 'und', 'Quantidade real'])).toEqual({ target: 'schedule', scheduleKind: 'OUTROS' });
    expect(suggestTarget('Levantamento_sienge')).toEqual({ target: 'ignore' });
  });
  it('colunas sugeridas pelos cabeçalhos da planilha', () => {
    const labels = ['Tipologia', 'Ambiente', 'Dimensões da peça', '', '', 'Peças / ambiente', 'Área Piso (real/mat)', 'Área Gemométrica', 'Desperdício Piso', 'Perímetro', 'H parede / H rodapé', 'Área Parede', 'Área de Desconto', 'Área Parede (real)', 'Área Total', 'Utilizou paginação? (sim / não)'];
    const def = tpl('CER');
    const m = suggestColumns(labels, def.columns.filter((c) => c.kind === 'input'));
    expect(m).toMatchObject({ tipo: 0, ambiente: 1, pecas: 5, area_geo: 7, perimetro: 9, altura: 10, desconto: 12, paginacao: 15 });
  });
  it('coluna de unidade detectada pelo conteúdo ("Dimensão" com m / und)', () => {
    const s = X([['Elemento', 'tipo', 'Dimensão', 'Quantidade'], ['Tubo', '100mm', 'm', 25.2], ['Anel', '50mm', 'und', 27], ['Joelho', '40mm', 'und', 6]]);
    expect(detectUnitColumn(s, 1, DEFAULT_UNITS)).toBe(2);
    expect(detectUnitColumn(s, 1, DEFAULT_UNITS, new Set([2]))).toBeNull();
  });
  it('par de dimensões "L x A" em três colunas', () => {
    const s = X([['Id', 'Dimensão', null, null, 'Área'], ['PA1', 0.8, 'x', 2.3, 1.84], ['J01', 1.6, 'x', 1.2, 1.92]]);
    expect(detectDimensionPair(s, 1)).toEqual([1, 3]);
    expect(detectDimensionPair(X([['a', 'b'], [1, 2]]), 1)).toBeNull();
  });
  it('unidades da planilha normalizadas', () => {
    expect(normalizeUnit('und', DEFAULT_UNITS)).toBe('un');
    expect(normalizeUnit('m2', DEFAULT_UNITS)).toBe('m²');
    expect(normalizeUnit('ML', DEFAULT_UNITS)).toBe('m');
    expect(normalizeUnit('caixa', DEFAULT_UNITS)).toBeNull();
  });
});

describe('ficha a partir da aba "Cerâmica MAT" (Viva Mais Barra) com conferência', () => {
  // A=tipo B=ambiente C=peça l (m) E=peça c (m) F=peças H=área geo J=perímetro K=altura M=desconto O=área total P=paginação Q=área com perda
  const row = (tipo: string, amb: string, l: number, c: number, pecas: number, geo: number, per: number | null, h: number, desc: [number, string] | number, total: number, perda: number) =>
    [tipo, amb, l, 'x', c, pecas, null, geo, null, per, h, null, desc, null, total, 'Sim', perda];
  const s = X([
    [], [], [],
    ['Tipologia', 'Ambiente', 'Dimensões da peça', null, null, 'Peças / ambiente', 'Área Piso', 'Área Gemométrica', 'Desperdício', 'Perímetro', 'H parede / H rodapé', 'Área Parede', 'Área de Desconto', 'Área Parede (real)', 'Área Total p/ execução / unid', 'Utilizou paginação?', 'Área Total / unid (contando perda)'],
    [],
    row('Piso + rodapé', 'Sala + Circ + Coz', 0.67, 0.67, 51, 19.81, 21.15, 0.07, [0.392, '(1*2.6+1*0.8+2*0.8+1*0.6)*K6'], 23.982400000000002, 25.181520000000003),
    row('Piso + rodapé', 'Quarto 01', 0.67, 0.67, 25, 10.05, 12.71, 0.07, [0.05600000000000001, '1*0.8*K7'], 12.0562, 12.65901),
    row('Piso + rodapé', 'WC Social', 0.53, 0.53, 10, 2.6, null, 0, 0, 2.8090000000000006, 2.9494500000000006),
    row('Piso + rodapé', 'Varanda', 0.67, 0.67, 9, 3.75, 8.3, 0.07, [0.37800000000000006, '(1*2.6+2.8)*K11'], 4.243100000000001, 4.455255000000001),
    row('Revestimento', 'Cozinha', 0.37, 0.59, 16, 2.8, null, 1.5, 0, 3.4928, 3.66744),
    [null, 'casa completa', null, null, null, [111, 'SUBTOTAL(9,F6:F10)'], null, null, null, null, null, null, null, null, [46.58, 'SUBTOTAL(9,O6:O10)']],
  ], 'Cerâmica MAT');
  const def = tpl('CER');
  const plan = {
    headerRow: 3, firstRow: 5,
    map: { tipo: { col: 0 }, ambiente: { col: 1 }, peca_l: { col: 2, unit: 'm' }, peca_c: { col: 4, unit: 'm' }, pecas: { col: 5 }, area_geo: { col: 7 }, perimetro: { col: 9 }, altura: { col: 10 }, desconto: { col: 12 }, paginacao: { col: 15 } },
    checks: { area_total: { col: 14 }, area_material: { col: 16 } },
  };
  const built = buildSheetRows(s, plan, def, DEFAULT_UNITS);

  it('monta 5 linhas, converte a peça de m para cm, ignora o subtotal e guarda a célula de origem', () => {
    expect(built.rows).toHaveLength(5);
    expect(built.sourceRows).toEqual([6, 7, 8, 9, 10]);
    expect(built.skipped).toEqual([{ row: 11, reason: 'Linha de total da planilha' }]);
    expect(built.rows[0]!['peca_l']).toEqual({ v: '67', ref: 'Cerâmica MAT!C6' });
    expect(built.rows[0]!['tipo']!.v).toBe('Piso + rodapé');
    expect(built.rows[0]!['paginacao']!.v).toBe('Sim');
  });
  it('conferência: todas as linhas batem com a planilha (área total e área com perda)', () => {
    const r = reconcileSheet(s, plan, built, def, DEFAULT_UNITS);
    expect(r.rowErrors).toEqual([]);
    const total = r.checks.find((c) => c.column === 'area_total')!;
    const perda = r.checks.find((c) => c.column === 'area_material')!;
    expect(total).toMatchObject({ ok: true, divergent: 0, computedTotal: '46.5835' });
    expect(perda).toMatchObject({ ok: true, divergent: 0, computedTotal: '48.912675' });
    expect(perda.rows[0]).toEqual({ row: 6, expected: '25.18152', computed: '25.18152', delta: '0', ok: true });
  });
  it('divergência aparece linha a linha', () => {
    const changed = { ...plan, map: { ...plan.map, paginacao: { col: 1 } } }; // coluna errada: "Sala…" não é Sim/Não
    const b = buildSheetRows(s, changed, def, DEFAULT_UNITS);
    const r = reconcileSheet(s, changed, b, def, DEFAULT_UNITS);
    expect(r.rowErrors.length).toBe(5);
    expect(r.checks.find((c) => c.column === 'area_material')!.divergent).toBe(5);
  });
});

describe('ficha de rede a partir da drenagem (SMR I): comprimento digitado como conta', () => {
  const s = X([['Trecho', 'Material', 'DN', 'Comprimento', 'Inclinação', 'Escavação'], ['PV1-PV6', 'PEAD', 600, [184.63, '29.11+53.35+61.48+18.15+22.54'], 0.43, 344.1096903221999]]);
  it('preserva a conta e confere a escavação', () => {
    const def = tpl('REDE');
    const plan = { headerRow: 0, firstRow: 1, map: { trecho: { col: 0 }, material: { col: 1 }, dn: { col: 2 }, comprimento: { col: 3 }, inclinacao: { col: 4 } }, checks: { escavacao: { col: 5 } } };
    const b = buildSheetRows(s, plan, def, DEFAULT_UNITS);
    expect(b.rows[0]!['comprimento']!.v).toBe('29.11+53.35+61.48+18.15+22.54');
    const r = reconcileSheet(s, plan, b, def, DEFAULT_UNITS, { comp_peca: '1' });
    expect(r.checks[0]).toMatchObject({ ok: true, computedTotal: '344.1096903222' });
  });
});

describe('quadro a partir de "Hidraulico casa" e "Esquadrias AL"', () => {
  it('lista de materiais: unidade "und" → un, quantidade por casa e conferência × 362', () => {
    const s = X([
      ['Elemento', 'tipo', 'Dimensão', 'Quantidade unitaria', 'loca de uso', 'total', 'custo unit R$'],
      ['SANITARIO', 0.0392],
      ['Tubo pvc rigido branco', '100mm', 'm', 25.2, 'habitação', 9122.4, 9.87],
      ['Anel de borracha', '50mm', 'und', 27, 'habitação', 9774, 0.49],
      ['Caixa de inspeção', '400mm', 'caixa', 4, 'habitação', 1448, 72],
    ], 'Hidraulico casa');
    const r = buildScheduleRows(s, { headerRow: 0, firstRow: 1, map: { description: 0, spec: 1, unit: 2 }, defaultUnit: 'un', quantities: [{ col: 3, label: 'Casa' }], check: { col: 5, multiplier: 362 } }, DEFAULT_UNITS);
    expect(r.rows.map((x) => [x.description, x.spec, x.unit, x.cells['d1']])).toEqual([['Tubo pvc rigido branco', '100mm', 'm', '25.2'], ['Anel de borracha', '50mm', 'un', '27']]);
    expect(r.skipped).toEqual([{ row: 2, reason: 'Sem quantidade (título de grupo?)' }, { row: 5, reason: 'Unidade não reconhecida: caixa' }]);
    expect(r.check).toMatchObject({ computedTotal: '18896.4', expectedTotal: '18896.4', ok: true });
  });
  it('esquadrias com L × A e total', () => {
    const s = X([
      ['Id', 'Dimensão', null, null, 'Área / und', 'Qtde / casa', 'Área Total / casa', 'Nº de Rep', 'Qtde / obra'],
      [],
      ['PA1', 0.8, 'x', 2.3, [1.8399999999999999, 'B3*D3'], 1, 1.84, 362, 362],
      ['J01', 1.6, 'x', 1.2, 1.92, 2, 3.84, 362, 724],
      [null, null, null, null, [13.1, 'SUM(E3:E7)'], null, null, null, [2534, 'SUM(I3:I7)']],
    ]);
    const r = buildScheduleRows(s, { headerRow: 0, firstRow: 1, map: { code: 0, description: 0, width: 1, height: 3 }, defaultUnit: 'un', quantities: [{ col: 5, label: 'Casa' }], check: { col: 8, multiplier: 362 } }, DEFAULT_UNITS);
    expect(r.rows.map((x) => [x.code, x.width, x.height, x.cells['d1']])).toEqual([['PA1', '0.8', '2.3', '1'], ['J01', '1.6', '1.2', '2']]);
    expect(r.skipped).toEqual([{ row: 5, reason: 'Linha de total da planilha' }]);
    expect(r.check).toMatchObject({ ok: true, computedTotal: '1086' });
  });
});
