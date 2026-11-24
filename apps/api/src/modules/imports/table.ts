import ExcelJS from 'exceljs';
import { CsvError, parseCsv } from '@eapq/domain';
import { AppError } from '../../common/errors.js';

export const MAX_ROWS = 20_000;
export const MAX_COLS = 50;

const bad = (detail: string) => new AppError(422, 'INVALID_FILE', 'Arquivo inválido', detail, [{ path: 'file', message: detail }]);

/** Texto de uma célula do exceljs (valor calculado de fórmulas; nunca executa nada). */
function cellText(v: ExcelJS.CellValue): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : '';
  if (typeof v === 'string') return v;
  if (typeof v === 'boolean') return v ? 'verdadeiro' : 'falso';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'object') {
    if ('richText' in v && Array.isArray(v.richText)) return v.richText.map((r) => r.text).join('');
    if ('result' in v) return cellText((v as { result?: ExcelJS.CellValue }).result ?? null);
    if ('text' in v) return String((v as { text: unknown }).text ?? '');
    if ('error' in v) return '';
  }
  return '';
}

export interface Table { sheets: string[]; sheet: string; rows: string[][] }

export async function readTable(kind: string, buf: Buffer, sheet?: string | null): Promise<Table> {
  if (kind === 'CSV') {
    let text: string;
    try { text = new TextDecoder('utf-8', { fatal: true }).decode(buf); } catch { text = new TextDecoder('latin1').decode(buf); }
    try {
      const rows = parseCsv(text, { maxRows: MAX_ROWS + 1 });
      if (rows.some((r) => r.length > MAX_COLS)) throw bad(`O arquivo tem mais de ${MAX_COLS} colunas.`);
      return { sheets: ['CSV'], sheet: 'CSV', rows: rows.map((r) => r.map((c) => c.trim())) };
    } catch (e) {
      if (e instanceof CsvError) throw bad(e.message);
      throw e;
    }
  }
  if (kind !== 'XLSX') throw bad('Para importar, envie uma planilha XLSX ou um arquivo CSV.');
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(buf as unknown as ArrayBuffer);
  } catch {
    throw bad('Não foi possível ler a planilha.');
  }
  const sheets = wb.worksheets.map((w) => w.name);
  if (!sheets.length) throw bad('A planilha não tem abas.');
  const ws = sheet ? wb.getWorksheet(sheet) : wb.worksheets[0];
  if (!ws) throw bad(`Aba não encontrada: ${sheet}.`);
  if (ws.rowCount > MAX_ROWS + 1) throw bad(`A aba tem mais de ${MAX_ROWS} linhas.`);
  if (ws.columnCount > MAX_COLS) throw bad(`A aba tem mais de ${MAX_COLS} colunas.`);
  const rows: string[][] = [];
  ws.eachRow({ includeEmpty: false }, (row) => {
    const out: string[] = [];
    for (let c = 1; c <= Math.min(ws.columnCount, MAX_COLS); c++) out.push(cellText(row.getCell(c).value).trim());
    while (out.length && out[out.length - 1] === '') out.pop();
    if (out.length) rows.push(out);
  });
  return { sheets, sheet: ws.name, rows };
}
