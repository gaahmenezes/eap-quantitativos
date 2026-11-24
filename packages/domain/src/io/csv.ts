/**
 * CSV (RFC 4180) sem dependências: leitura com detecção de separador (";" — padrão do Excel em pt-BR — ou ","),
 * aspas, quebras de linha dentro de campos e BOM; escrita com ";" e neutralização de fórmulas.
 */
export class CsvError extends Error {}

export function detectDelimiter(text: string): ';' | ',' | '\t' {
  const first = text.split(/\r?\n/, 1)[0] ?? '';
  const count = (c: string) => first.split(c).length - 1;
  const counts = [[';', count(';')], [',', count(',')], ['\t', count('\t')]] as const;
  return [...counts].sort((a, b) => b[1] - a[1])[0]![1] > 0 ? [...counts].sort((a, b) => b[1] - a[1])[0]![0] : ';';
}

export function parseCsv(input: string, opts: { delimiter?: string; maxRows?: number } = {}): string[][] {
  const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
  const d = opts.delimiter ?? detectDelimiter(text);
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  let i = 0;
  const pushRow = () => {
    row.push(field);
    field = '';
    if (!(row.length === 1 && row[0] === '')) rows.push(row);
    row = [];
    if (opts.maxRows && rows.length > opts.maxRows) throw new CsvError(`O arquivo tem mais de ${opts.maxRows} linhas.`);
  };
  while (i < text.length) {
    const c = text[i]!;
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
        quoted = false; i++; continue;
      }
      field += c; i++; continue;
    }
    if (c === '"' && field === '') { quoted = true; i++; continue; }
    if (c === d) { row.push(field); field = ''; i++; continue; }
    if (c === '\r') { i++; continue; }
    if (c === '\n') { pushRow(); i++; continue; }
    field += c; i++;
  }
  if (quoted) throw new CsvError('Aspas sem fechamento no arquivo CSV.');
  if (field !== '' || row.length) pushRow();
  return rows;
}

/**
 * Neutraliza conteúdo que planilhas interpretariam como fórmula (CSV/XLSX injection):
 * texto começando com = + - @ tabulação ou retorno ganha um apóstrofo na frente.
 */
export function neutralizeCell(v: string): string {
  return /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
}

export function toCsv(header: readonly string[], rows: readonly (readonly (string | number | null | undefined)[])[], delimiter = ';'): string {
  const cell = (v: string | number | null | undefined) => {
    if (v === null || v === undefined) return '';
    const s = typeof v === 'number' ? String(v) : neutralizeCell(v);
    return /[";\n\r,\t]/.test(s) || s !== s.trim() ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return '﻿' + [header, ...rows].map((r) => r.map(cell).join(delimiter)).join('\r\n') + '\r\n';
}
