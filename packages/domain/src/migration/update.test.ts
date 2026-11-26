import { describe, expect, it } from 'vitest';
import { DEFAULT_SHEET_TEMPLATES } from '../sheet/defaults.js';
import type { SheetRowInput } from '../sheet/engine.js';
import { diffRows, matchRows, sameValue, scheduleKeyed, scheduleRowKey, sheetKeyed, sheetLabels, sheetRowKey } from './update.js';

const CER = DEFAULT_SHEET_TEMPLATES.find((t) => t.code === 'CER')!.definition;
const row = (o: Record<string, string>): SheetRowInput => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, { v }]));

describe('casamento de linhas', () => {
  it('pela chave, na ordem; repetidas casam uma a uma; sem par = nova', () => {
    expect(matchRows(['a', 'b', 'a', 'c'], ['b', 'a', 'x', 'a', 'a'])).toEqual([1, 0, null, 2, null]);
    expect(matchRows([], ['a'])).toEqual([null]);
  });
  it('valores iguais: texto igual ou mesmo número; conta na célula diferente de número é mudança de memória', () => {
    expect(sameValue('0.6', '0.60')).toBe(true);
    expect(sameValue('Sala', 'Sala')).toBe(true);
    expect(sameValue('0.6', '0.7')).toBe(false);
    expect(sameValue('37.83', '28.23+9.6')).toBe(false);
    expect(sameValue('28.23+9.6', '28.23+9.6')).toBe(true);
    expect(sameValue('', '1')).toBe(false);
    expect(sameValue(undefined, '')).toBe(true);
  });
});

describe('diferença entre a ficha atual e a nova versão da planilha', () => {
  const before = [
    row({ ambiente: 'Sala', tipo: 'Piso + rodapé', area_geo: '19.81', perimetro: '21.15' }),
    row({ ambiente: 'Quarto 01', tipo: 'Piso + rodapé', area_geo: '10.05' }),
    row({ ambiente: 'WC Social', tipo: 'Piso', area_geo: '2.6' }),
  ];
  const after = [
    row({ ambiente: 'Sala', tipo: 'Piso + rodapé', area_geo: '19.81', perimetro: '21.15' }),
    row({ ambiente: 'Quarto 01', tipo: 'Piso + rodapé', area_geo: '10.55' }),
    row({ ambiente: 'Quarto 02', tipo: 'Piso + rodapé', area_geo: '9.4' }),
  ];
  it('chave = colunas de texto e de escolha (ambiente + tipo + paginação)', () => {
    expect(sheetRowKey(CER, before[0]!)).toBe('sala|piso rodape|');
  });
  it('mantidas, alteradas (com o campo), novas e retiradas', () => {
    const d = diffRows(sheetKeyed(CER, before), sheetKeyed(CER, after), sheetLabels(CER));
    expect(d.matches).toEqual([0, 1, null]);
    expect(d.counts).toEqual({ added: 1, removed: 1, changed: 1, unchanged: 1 });
    expect(d.rows.find((r) => r.status === 'changed')).toMatchObject({ before: 1, after: 1, changes: [{ field: 'Área geométrica', before: '10.05', after: '10.55' }] });
    expect(d.rows.find((r) => r.status === 'removed')).toMatchObject({ before: 2, after: null, key: 'wc social|piso|' });
    expect(d.rows.find((r) => r.status === 'added')).toMatchObject({ before: null, after: 2 });
  });
  it('linha deslocada (inserida no meio da planilha) continua casada com a sua', () => {
    const moved = [after[2]!, ...before];
    const d = diffRows(sheetKeyed(CER, before), sheetKeyed(CER, moved));
    expect(d.matches).toEqual([null, 0, 1, 2]);
    expect(d.counts).toMatchObject({ added: 1, unchanged: 3, removed: 0 });
  });
});

describe('quadro: chave pelo código ou pela descrição', () => {
  const it0 = { code: 'J01', description: 'Janela maxim-ar', spec: null, unit: 'un', width: '1.6', height: '1.2', cells: { d1: '2' } };
  it('chaves', () => {
    expect(scheduleRowKey(it0)).toBe('#j01');
    expect(scheduleRowKey({ ...it0, code: null, spec: '100mm' })).toBe('janela maxim ar|100mm');
  });
  it('mudou a quantidade de um destino', () => {
    const d = diffRows(scheduleKeyed([it0]), scheduleKeyed([{ ...it0, cells: { d1: '3' } }]));
    expect(d.rows[0]).toMatchObject({ status: 'changed', changes: [{ field: 'cell:d1', before: '2', after: '3' }] });
  });
});
