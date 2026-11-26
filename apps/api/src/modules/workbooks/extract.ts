/**
 * Extrato das abas de uma pasta de trabalho XLSX (F12): valores calculados e texto das fórmulas, sem
 * executar nada. Limites por aba para conter arquivos enormes; o arquivo já passou pela verificação de
 * assinatura e zip bomb (DocumentsService.store).
 */
import ExcelJS from 'exceljs';
import { EXTRACT_LIMITS, extractSheets, type WorksheetLike, type XSheet } from '@eapq/domain';
import { AppError } from '../../common/errors.js';

export const LIMITS = EXTRACT_LIMITS;
const bad = (detail: string) => new AppError(422, 'INVALID_FILE', 'Arquivo inválido', detail, [{ path: 'file', message: detail }]);

export async function extractWorkbook(buf: Buffer): Promise<XSheet[]> {
  const wb = new ExcelJS.Workbook();
  try { await wb.xlsx.load(buf as unknown as ArrayBuffer); } catch { throw bad('Não foi possível ler a planilha.'); }
  if (!wb.worksheets.length) throw bad('A planilha não tem abas.');
  if (wb.worksheets.length > LIMITS.sheets) throw bad(`A planilha tem mais de ${LIMITS.sheets} abas.`);
  return extractSheets(wb.worksheets as unknown as WorksheetLike[]);
}
