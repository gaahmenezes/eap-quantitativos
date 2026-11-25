/**
 * Extrato das abas de uma pasta de trabalho XLSX (F12): valores calculados e texto das fórmulas, sem
 * executar nada. Limites por aba para conter arquivos enormes; o arquivo já passou pela verificação de
 * assinatura e zip bomb (DocumentsService.store).
 */
import ExcelJS from 'exceljs';
import type { XCell, XSheet } from '@eapq/domain';
import { AppError } from '../../common/errors.js';

export const LIMITS = { sheets: 200, rows: 3000, cols: 60 } as const;
const bad = (detail: string) => new AppError(422, 'INVALID_FILE', 'Arquivo inválido', detail, [{ path: 'file', message: detail }]);

function toCell(cell: ExcelJS.Cell): XCell | null {
  // célula mesclada: só a mestre carrega o valor (o exceljs repete o valor nas demais)
  if (cell.isMerged && cell.master && cell.master.address !== cell.address) return null;
  const raw = cell.value;
  if (raw === null || raw === undefined) return null;
  let f: string | undefined;
  let v: ExcelJS.CellValue = raw;
  if (typeof raw === 'object' && !(raw instanceof Date)) {
    if ('formula' in raw || 'sharedFormula' in raw) {
      try { f = cell.formula || undefined; } catch { f = undefined; }
      v = (raw as { result?: ExcelJS.CellValue }).result ?? null;
      if (v && typeof v === 'object' && 'error' in v) v = null;
    } else if ('richText' in raw && Array.isArray(raw.richText)) v = raw.richText.map((r) => r.text).join('');
    else if ('text' in raw) v = String((raw as { text: unknown }).text ?? '');
    else if ('error' in raw) v = null;
  }
  if (v instanceof Date) return { v: v.toISOString().slice(0, 10), ...(f && { f }) };
  if (typeof v === 'number') return Number.isFinite(v) ? { v: String(v), num: true, ...(f && { f }) } : null;
  if (typeof v === 'boolean') return { v: v ? 'verdadeiro' : 'falso' };
  if (typeof v === 'string') return v.trim() || f ? { v: v.slice(0, 500), ...(f && { f }) } : null;
  return f ? { v: '', f } : null;
}

export async function extractWorkbook(buf: Buffer): Promise<XSheet[]> {
  const wb = new ExcelJS.Workbook();
  try { await wb.xlsx.load(buf as unknown as ArrayBuffer); } catch { throw bad('Não foi possível ler a planilha.'); }
  if (!wb.worksheets.length) throw bad('A planilha não tem abas.');
  if (wb.worksheets.length > LIMITS.sheets) throw bad(`A planilha tem mais de ${LIMITS.sheets} abas.`);
  return wb.worksheets.map((ws, index) => {
    const rows: (XCell | null)[][] = [];
    let truncated = ws.rowCount > LIMITS.rows || ws.columnCount > LIMITS.cols;
    const maxRow = Math.min(ws.rowCount, LIMITS.rows);
    const maxCol = Math.min(ws.columnCount, LIMITS.cols);
    for (let r = 1; r <= maxRow; r++) {
      const row = ws.getRow(r);
      const out: (XCell | null)[] = [];
      for (let c = 1; c <= maxCol; c++) out.push(toCell(row.getCell(c)));
      while (out.length && out[out.length - 1] === null) out.pop();
      rows.push(out);
    }
    while (rows.length && rows[rows.length - 1]!.length === 0) rows.pop();
    if (ws.rowCount > LIMITS.rows) truncated = true;
    return { index, name: ws.name.slice(0, 100), rows, truncated };
  });
}
