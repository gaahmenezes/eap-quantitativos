/**
 * Modelos de ficha para as abas que não se encaixavam (superfícies, mármore/granito, movimento de terra), conferidos
 * com linhas reais das planilhas Viva Mais Barra e Marupi: o total recalculado pela ficha tem de bater com a planilha.
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_UNITS } from '../units/units.js';
import { DEFAULT_SHEET_TEMPLATES } from '../sheet/defaults.js';
import { compileSheet } from '../sheet/engine.js';
import { blockEnd, buildSheetRows, FRACTION, headerCandidates, headerLabels, looksLikeFraction, reconcileSheet, suggestColumns, suggestTarget, type SheetPlan, type XCell, type XSheet } from './workbook.js';

const tpl = (code: string) => DEFAULT_SHEET_TEMPLATES.find((t) => t.code === code)!.definition;
const X = (rows: (string | number | null | [number, string])[][], name = 'Aba'): XSheet => ({
  index: 0, name,
  rows: rows.map((r) => r.map((c): XCell | null => (c === null ? null : typeof c === 'number' ? { v: String(c), num: true } : Array.isArray(c) ? { v: String(c[0]), num: true, f: c[1] } : { v: c }))),
});
const run = (s: XSheet, plan: SheetPlan, code: string) => {
  const def = tpl(code);
  const built = buildSheetRows(s, plan, def, DEFAULT_UNITS);
  return { built, rec: reconcileSheet(s, plan, built, def, DEFAULT_UNITS) };
};
const total = (rec: ReturnType<typeof reconcileSheet>, key: string) => rec.totals.find((t) => t.key === key)!.total;

describe('modelos novos compilam', () => {
  it.each(['SUP', 'MARM', 'TERRA'])('%s sem problemas', (code) => {
    expect(compileSheet(tpl(code), DEFAULT_UNITS).issues).toEqual([]);
  });
});

describe('SUP — superfícies (impermeabilização, muros, calçadas)', () => {
  // VMB › Impermeabilização (linhas 6–8 e 13)
  const head = ['Tipologia', 'Local', 'Perímetro', 'H parede /\nH rodapé', 'Área de Piso', 'Área Parede (sem desconto)', 'Área Parede (com desconto)', 'Nº de Rep\n(unid hab)', 'Área Total da Obra / Ambiente'];
  const s = X([
    head,
    ['Neutrol 2 demãos', 'viga de bordo', 8.9, [0.9, '0.3+0.6'], null, [8.01, '(C6*D6)'], 10.15, 362, [3674.3, 'H6*G6']],
    ['argamassa polimerica', 'perimetro externo casa', 30.31, 0.6, null, [18.186, '(C7*D7)'], [18.186, 'F7'], 362, [6583.332, 'H7*G7']],
    ['argamassa polimerica', 'perimetro Interno casa', [37.83, '28.23+9.6'], 0.2, null, [7.566, '(C8*D8)'], [7.566, 'F8'], 362, [2738.892, 'H8*G8']],
    ['argamassa polimerica', 'Varanda', null, null, 3.78, null, null, 362, [1368.36, 'H13*E13']],
    ['SUBTOTAL', 'SUBTOTAL', [92.72, 'SUBTOTAL(9,C6:C15)'], null, null, null, null, null, [20389.288, 'SUBTOTAL(9,I6:I15)']],
  ], 'Impermeabilização');

  it('destino e colunas sugeridos pelos cabeçalhos', () => {
    expect(suggestTarget('Impermeabilização')).toEqual({ target: 'sheet', templateCode: 'SUP' });
    const def = tpl('SUP');
    expect(suggestColumns(headerLabels(s, 0), def.columns.filter((c) => c.kind === 'input'))).toMatchObject({ servico: 0, local: 1, perimetro: 2, altura: 3, piso: 4, repeticoes: 7 });
    expect(suggestColumns(headerLabels(s, 0), def.columns.filter((c) => c.kind === 'calc'), 0.8)).toMatchObject({ parede_bruta: 5, parede_liq: 6, total_obra: 8 });
  });

  it('total da obra confere; a parede digitada à mão (10,15 ≠ 8,9 × 0,9) aparece como divergência', () => {
    const plan: SheetPlan = { headerRow: 0, firstRow: 1, map: { servico: { col: 0 }, local: { col: 1 }, perimetro: { col: 2 }, altura: { col: 3 }, piso: { col: 4 }, repeticoes: { col: 7 } }, checks: { parede_bruta: { col: 5 }, parede_liq: { col: 6 }, total_obra: { col: 8 } } };
    const { built, rec } = run(s, plan, 'SUP');
    expect(built.rows).toHaveLength(4);
    expect(built.rows[2]!['perimetro']!.v).toBe('28.23+9.6'); // memória da conta preservada
    expect(built.skipped).toEqual([{ row: 6, reason: 'Linha de total da planilha' }]);
    const tot = rec.checks.find((c) => c.column === 'total_obra')!;
    expect(tot.rows.map((r) => r.ok)).toEqual([false, true, true, true]);
    expect(tot.rows[0]).toMatchObject({ expected: '3674.3', computed: '2899.62' }); // 8,01 × 362
    expect(rec.checks.find((c) => c.column === 'parede_bruta')!.ok).toBe(true);
    expect(total(rec, 'area')).toBe('13590.204'); // 2899,62 + 6583,332 + 2738,892 + 1368,36
  });

  it('muros: perímetro × altura − desconto (VMB › Muros Muretas e Portões)', () => {
    const m = X([
      ['Tipologia', 'Local', 'Perímetro', 'H parede / H rodapé', 'Área Parede (sem desconto)', 'Área de Desconto', 'Área Parede (com desconto)', 'Nº de Rep (unid hab)', 'Área Total da Obra'],
      ['Muro em bloco', 'Lateral divisa maykai', [256.0645, '57.2545+4.92+56.21+137.68'], 2, [512.129, '(C6*D6)'], 0, [512.129, 'E6-F6'], 1, [512.129, 'H6*G6']],
      ['Portão em Aluminio', 'Entrada (correr)', [9.6, '3.8+3.8+1+1'], 2, [19.2, '(C12*D12)'], 1.5, [17.7, 'E12-F12'], 1, [17.7, 'H12*G12']],
    ]);
    const plan: SheetPlan = { headerRow: 0, firstRow: 1, map: { servico: { col: 0 }, local: { col: 1 }, perimetro: { col: 2 }, altura: { col: 3 }, desconto: { col: 5 }, repeticoes: { col: 7 } }, checks: { parede_liq: { col: 6 }, total_obra: { col: 8 } } };
    const { rec } = run(m, plan, 'SUP');
    expect(rec.checks.every((c) => c.ok)).toBe(true);
    expect(total(rec, 'area')).toBe('529.829');
    expect(total(rec, 'linear')).toBe('265.6645');
  });

  it('acabamento só com a área de parede: "Parede informada" (Marupi › Churras-ACAB)', () => {
    const a = X([['Local', 'Tipologia', 'Ambiente', 'Área Teto', 'Área Parede (com desconto)', 'Área Total da unidade (material)'], ['Interno', 'Emboço', 'Banheiros', null, [65.2, '34.3+30.9'], [65.2, 'D6+E6']], ['Interno', 'Pintura', 'Teto', 11.4, null, [11.4, 'D8+E8']]]);
    const plan: SheetPlan = { headerRow: 0, firstRow: 1, map: { servico: { col: 1 }, local: { col: 2 }, piso: { col: 3 }, parede_inf: { col: 4 } }, checks: { area_unid: { col: 5 } } };
    const { rec } = run(a, plan, 'SUP');
    expect(rec.checks[0]!.ok).toBe(true);
    expect(total(rec, 'area')).toBe('76.6');
  });

  it('sem regra pelo nome: perímetro + altura + área ⇒ superfícies', () => {
    expect(suggestTarget('beach_tennispint', ['Tipologia', 'Ambiente', 'Área Teto', 'Perímetro', 'H parede / H rodapé', 'Área Parede (sem desconto)'])).toEqual({ target: 'sheet', templateCode: 'SUP' });
    expect(suggestTarget('Muros Muretas e Portões')).toEqual({ target: 'sheet', templateCode: 'SUP' });
    expect(suggestTarget('Calçada_setor')).toEqual({ target: 'sheet', templateCode: 'SUP' });
    expect(suggestTarget('Churras-IMP')).toEqual({ target: 'sheet', templateCode: 'SUP' });
  });
});

describe('MARM — mármore e granito (VMB › Marmore_granito)', () => {
  const s = X([
    ['Tipologia', 'Ambiente', 'Dimensões da peça', null, null, 'Quantidade', 'Área ', 'Quant. Utilização', 'Área Total', 'Metros'],
    ['Soleira Mármore', 'Quartos', 0.84, 'x', 0.1, 2, [0.168, 'C3*E3*F3'], 362, [60.816, 'G3*H3'], [608.16, 'C3*F3*H3']],
    ['Soleira Mármore', 'Entrada', 2.6, 'x', 0.1, 1, [0.26, 'C6*E6*F6'], 362, [94.12, 'G6*H6'], [941.2, 'C6*F6*H6']],
    ['Filetes', 'Box Banheiro', 1.2, 'x', 0.03, 2, [0.072, '(C9*E9*F9)'], 362, [26.064, 'G9*H9'], [868.8, 'C9*F9*H9']],
  ], 'Marmore_granito');
  it('destino, colunas e conferência por peça, área total e metros', () => {
    expect(suggestTarget('Marmore_granito')).toEqual({ target: 'sheet', templateCode: 'MARM' });
    expect(suggestTarget('Marm_Gran_SF')).toEqual({ target: 'sheet', templateCode: 'MARM' });
    expect(suggestTarget('Churras-MAR')).toEqual({ target: 'sheet', templateCode: 'MARM' });
    const def = tpl('MARM');
    const labels = headerLabels(s, 0).map((l, i) => (i === 2 || i === 4 ? '' : l));
    expect(suggestColumns(labels, def.columns.filter((c) => c.kind === 'input' && !['comprimento', 'largura'].includes(c.key)))).toMatchObject({ peca: 0, ambiente: 1, quantidade: 5, repeticoes: 7 });
    expect(suggestColumns(labels, def.columns.filter((c) => c.kind === 'calc'), 0.8)).toMatchObject({ area_unid: 6, area_total: 8, metros: 9 });
    const plan: SheetPlan = { headerRow: 0, firstRow: 1, map: { peca: { col: 0 }, ambiente: { col: 1 }, comprimento: { col: 2 }, largura: { col: 4 }, quantidade: { col: 5 }, repeticoes: { col: 7 } }, checks: { area_unid: { col: 6 }, area_total: { col: 8 }, metros: { col: 9 } } };
    const { rec } = run(s, plan, 'MARM');
    expect(rec.checks.map((c) => [c.column, c.ok])).toEqual([['area_unid', true], ['area_total', true], ['metros', true]]);
    expect(total(rec, 'area')).toBe('181');
    expect(total(rec, 'metros')).toBe('2418.16');
  });
});

describe('TERRA — movimento de terra', () => {
  it('Marupi › Terraplenagem: volume informado e empolamento escrito como fração (0,35 = 35%)', () => {
    const s = X([
      ['Elemento', 'volume geométrico', 'Dimensão', 'Taxa de empolamento (%)', 'volume com empolamento'],
      ['Limpeza do terreno', 276937.58, 'm2'],
      ['Corte', [124621.911, 'B3*0.45'], 'm³', 0.35, [168239.57985, '(1+D4)*B4']],
      ['Aterro', 98155.02, 'm³', 0.35, [132509.277, '(1+D5)*B5']],
    ], 'Terraplenagem');
    expect(suggestTarget('Terraplenagem')).toEqual({ target: 'sheet', templateCode: 'TERRA' });
    expect(looksLikeFraction(s, 3, 1)).toBe(true);
    expect(looksLikeFraction(s, 1, 1)).toBe(false);
    const plan: SheetPlan = { headerRow: 0, firstRow: 1, map: { elemento: { col: 0 }, volume: { col: 1 }, empolamento: { col: 3, unit: FRACTION } }, checks: { vol_empolado: { col: 4 } } };
    const { built, rec } = run(s, plan, 'TERRA');
    expect(built.rows[1]!['empolamento']!.v).toBe('35');
    const c = rec.checks[0]!;
    // a limpeza (m²) foi digitada na coluna de volume: a ficha mostra a linha em vez de esconder
    expect(c.rows.map((r) => r.ok)).toEqual([false, true, true]);
    expect(total(rec, 'volume')).toBe('499714.511');
  });
  it('VMB › obras_em_terra: vala = largura × perímetro × profundidade, × repetições', () => {
    const s = X([
      ['Descrição', 'Especificação', 'Largura de vala (m)', 'Perímetro (m)', 'Profundidade (m)', 'volume (m³)', 'área (m²)', 'p/362'],
      ['Escavação', null, 0.1, [30.46, '(623*2+900*2)/100'], 0.3, [0.9138, 'D3*C3*E3'], null, [330.7956, 'F3*362']],
      ['Compactação', null, null, null, null, null, 68.983, [24971.846, 'G4*362']],
    ], 'obras_em_terra');
    const plan: SheetPlan = { headerRow: 0, firstRow: 1, map: { elemento: { col: 0 }, largura: { col: 2 }, comprimento: { col: 3 }, profundidade: { col: 4 }, area: { col: 6 } }, checks: { vol_geo: { col: 5 } } };
    const { rec } = run(s, plan, 'TERRA');
    expect(rec.checks[0]!.ok).toBe(true);
    expect(total(rec, 'volume')).toBe('0.9138');
    expect(total(rec, 'area')).toBe('68.983');
  });
});

describe('destino e cabeçalho', () => {
  it('nomes abreviados das abas de áreas comuns', () => {
    expect(suggestTarget('Churras-ESQ')).toEqual({ target: 'schedule', scheduleKind: 'ESQUADRIAS' });
    expect(suggestTarget('Churras-LOU')).toEqual({ target: 'schedule', scheduleKind: 'LOUCAS_METAIS' });
    expect(suggestTarget('INST.ELET_GUA_CLX_ADM')).toEqual({ target: 'schedule', scheduleKind: 'INSTALACOES_ELETRICAS' });
    expect(suggestTarget('Iluminação_externa')).toEqual({ target: 'schedule', scheduleKind: 'INSTALACOES_ELETRICAS' });
    expect(suggestTarget('Incendio')).toEqual({ target: 'schedule', scheduleKind: 'OUTROS' });
    expect(suggestTarget('Pav-BEA')).toEqual({ target: 'sheet', templateCode: 'CER' });
    expect(suggestTarget('Mdo Instalações')).toEqual({ target: 'ignore' });
  });
  it('lista com unidade e quantidade vira quadro, pelo rótulo ou pelo conteúdo', () => {
    expect(suggestTarget('Grama Habitação', ['Tipologia', 'Unidade', 'Quantidade por casa', 'Quantidade casas'])).toEqual({ target: 'schedule', scheduleKind: 'OUTROS' });
    expect(suggestTarget('Equip_áreacomum', ['Ambiente', 'Especificação', 'Quant.'], { unitColumn: true })).toEqual({ target: 'schedule', scheduleKind: 'OUTROS' });
    expect(suggestTarget('Equip_áreacomum', ['Ambiente', 'Especificação', 'Quant.'])).toEqual({ target: 'ignore' });
  });
  it('aba com dois blocos: os dois cabeçalhos são candidatos, o de mais rótulos primeiro', () => {
    const s = X([
      ['IMPERMEABILIZAÇÃO - ADM'],
      ['Tipologia', 'Ambiente', 'Área Parede (com desconto)'],
      ['Argamassa Polimérica', 'Entorno Externo', [19.38, '32.3*0.6']],
      [],
      ['Id', 'Largura', 'Dimensão', 'Altura', 'Área / und', 'Qtde', 'Área Total'],
      ['J01', 1.1, 'x', 0.6, [0.66, 'B13*D13'], 3, [1.98, 'E13*F13']],
    ]);
    expect(blockEnd(s, 1)).toBe(3); // o bloco de cima termina antes do "MAPA DE ESQUADRIAS"
    expect(blockEnd(X([['A', 'B', 'C'], ['x', 1, 2], ['A', 'B', 'C'], ['y', 3, 4]]), 0)).toBeNull(); // cabeçalho repetido não corta
    const c = headerCandidates(s);
    expect(c[0]).toBe(4);
    expect(c).toContain(1);
  });
});
