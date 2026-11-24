import { describe, expect, it } from 'vitest';
import { CsvError, detectDelimiter, neutralizeCell, parseCsv, toCsv } from './csv.js';
import { checkZipLimits, FileCheckError, sniffFile } from './files.js';
import { normalizeHeader, parseDecimalText, suggestMapping } from './values.js';

describe('CSV', () => {
  it('lê ; e , com aspas, quebras de linha e BOM', () => {
    expect(detectDelimiter('a;b;c\n1;2;3')).toBe(';');
    expect(detectDelimiter('a,b,c')).toBe(',');
    expect(parseCsv('﻿código;descrição\r\nALV.001;"Alvenaria; bloco ""cerâmico"""\n"X";"linha 1\nlinha 2"\n\n')).toEqual([
      ['código', 'descrição'], ['ALV.001', 'Alvenaria; bloco "cerâmico"'], ['X', 'linha 1\nlinha 2'],
    ]);
    expect(() => parseCsv('a;"b')).toThrow(CsvError);
    expect(() => parseCsv('a\nb\nc\nd', { maxRows: 2 })).toThrow(/mais de 2 linhas/);
  });
  it('escreve com neutralização de fórmulas e ida e volta', () => {
    const csv = toCsv(['código', 'descrição', 'q'], [['=HYPERLINK("x")', '+cmd|calc', 12.5], ['@SUM(A1)', 'normal; com ;', null], ['-10', 'a"b', 3]]);
    const back = parseCsv(csv);
    expect(back).toEqual([['código', 'descrição', 'q'], ["'=HYPERLINK(\"x\")", "'+cmd|calc", '12.5'], ["'@SUM(A1)", 'normal; com ;', ''], ["'-10", 'a"b', '3']]);
    expect(neutralizeCell('normal')).toBe('normal');
    expect(neutralizeCell('\tx')).toBe("'\tx");
  });
});

describe('valores de planilha', () => {
  it('números em pt-BR e en-US viram decimal exato', () => {
    expect(['1.234,56', '1234,56', '1234.56', '1,234.56', '0,1', '-2,5', '1.234.567', "'12,5", ' 7 '].map(parseDecimalText)).toEqual(['1234.56', '1234.56', '1234.56', '1234.56', '0.1', '-2.5', '1234567', '12.5', '7']);
    expect([12.5, 'abc', '', null, '1,2,3', '1e5'].map(parseDecimalText)).toEqual(['12.5', null, null, null, null, null]);
  });
  it('sugere mapeamento por cabeçalho sem acento', () => {
    expect(normalizeHeader('  Código do Serviço  ')).toBe('codigo do servico');
    const m = suggestMapping(['Cód.', 'Descrição do serviço', 'UN', 'Categoria'], [
      { key: 'code', label: 'Código', required: true, aliases: ['cod', 'codigo do servico'] },
      { key: 'description', label: 'Descrição', required: true, aliases: [] },
      { key: 'unit', label: 'Unidade', required: true, aliases: ['un', 'und'] },
      { key: 'category', label: 'Código da categoria', required: true, aliases: ['categoria'] },
      { key: 'criterion', label: 'Critério de medição', required: false, aliases: [] },
    ]);
    expect(m).toEqual({ code: 0, description: 1, unit: 2, category: 3, criterion: null });
  });
});

describe('verificação de arquivos', () => {
  const zip = (entries: { name: string; compressed: number; uncompressed: number }[]) => {
    // monta só o diretório central + EOCD (suficiente para a verificação)
    const enc = new TextEncoder();
    const parts: number[] = [0x50, 0x4b, 0x03, 0x04];
    const cdStart = parts.length;
    for (const e of entries) {
      const n = enc.encode(e.name);
      const h = new Uint8Array(46);
      const dv = new DataView(h.buffer);
      dv.setUint32(0, 0x02014b50, true); dv.setUint32(20, e.compressed, true); dv.setUint32(24, e.uncompressed, true); dv.setUint16(28, n.length, true);
      parts.push(...h, ...n);
    }
    const cdSize = parts.length - cdStart;
    const eocd = new Uint8Array(22);
    const dv = new DataView(eocd.buffer);
    dv.setUint32(0, 0x06054b50, true); dv.setUint16(8, entries.length, true); dv.setUint16(10, entries.length, true); dv.setUint32(12, cdSize, true); dv.setUint32(16, cdStart, true);
    return new Uint8Array([...parts, ...eocd]);
  };
  it('reconhece pelo conteúdo, não pela extensão', () => {
    const xlsx = zip([{ name: '[Content_Types].xml', compressed: 100, uncompressed: 300 }, { name: 'xl/workbook.xml', compressed: 100, uncompressed: 400 }]);
    expect(sniffFile(xlsx, 'planilha.csv')).toBe('XLSX');
    expect(sniffFile(new TextEncoder().encode('%PDF-1.7 ...'), 'x.xlsx')).toBe('PDF');
    expect(sniffFile(new TextEncoder().encode('a;b\n1;2'), 'dados.csv')).toBe('CSV');
    expect(() => sniffFile(zip([{ name: 'word/document.xml', compressed: 1, uncompressed: 1 }]), 'x.xlsx')).toThrow(/não é uma planilha/);
    expect(() => sniffFile(new Uint8Array([0x4d, 0x5a, 0x90, 0, 3]), 'virus.csv')).toThrow(FileCheckError);
    expect(() => sniffFile(new TextEncoder().encode('MZ'), 'programa.exe')).toThrow(/não suportado/);
  });
  it('recusa zip bomb', () => {
    expect(() => checkZipLimits(zip([{ name: 'xl/sheet1.xml', compressed: 10_000, uncompressed: 200 * 1024 * 1024 }]))).toThrow(/grande demais/);
    expect(() => checkZipLimits(zip([{ name: 'xl/sheet1.xml', compressed: 1000, uncompressed: 50 * 1024 * 1024 }]))).toThrow(/compressão suspeita/);
    expect(() => checkZipLimits(zip([{ name: 'xl/sheet1.xml', compressed: 500_000, uncompressed: 5 * 1024 * 1024 }]))).not.toThrow();
  });
});
