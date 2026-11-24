import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';
import { Decimal } from 'decimal.js';
import { neutralizeCell, toCsv } from '@eapq/domain';

export type Cell = string | number | null;
export interface Report {
  title: string;
  subtitle: string;
  fileBase: string;
  columns: { label: string; numeric?: boolean; width?: number }[];
  rows: Cell[][];
}

/** Quantidade decimal como número quando o ponto flutuante a representa exatamente; senão, texto (sem perda). */
export const qty = (v: string | null | undefined): Cell => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) && new Decimal(n).eq(v) ? n : v;
};

export function renderCsv(r: Report): Buffer {
  return Buffer.from(toCsv(r.columns.map((c) => c.label), r.rows), 'utf8');
}

export async function renderXlsx(r: Report): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'EAP Quantitativos';
  const ws = wb.addWorksheet(r.title.slice(0, 31).replace(/[\\/?*[\]:]/g, ' '));
  ws.addRow(r.columns.map((c) => c.label)).font = { bold: true };
  for (const row of r.rows) ws.addRow(row.map((v) => (typeof v === 'string' ? neutralizeCell(v) : v)));
  r.columns.forEach((c, i) => {
    const col = ws.getColumn(i + 1);
    col.width = c.width ?? Math.min(60, Math.max(10, c.label.length + 2, ...r.rows.slice(0, 200).map((x) => String(x[i] ?? '').length + 2)));
    if (c.numeric) col.numFmt = '#,##0.##########';
  });
  ws.views = [{ state: 'frozen', ySplit: 1 }];
  return Buffer.from(await wb.xlsx.writeBuffer());
}

const pdfText = (v: Cell) => (v === null ? '' : typeof v === 'number' ? v.toLocaleString('pt-BR', { maximumFractionDigits: 10 }) : v);

/** PDF tabular A4 paisagem com cabeçalho, quebra de página e numeração. Fonte padrão (sem arquivos externos). */
export function renderPdf(r: Report): Promise<Buffer> {
  return new Promise((resolveP, reject) => {
    const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 36, bufferPages: true, info: { Title: r.title, Producer: 'EAP Quantitativos' } });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolveP(Buffer.concat(chunks)));
    doc.on('error', reject);
    const left = doc.page.margins.left;
    const width = doc.page.width - left - doc.page.margins.right;
    const weights = r.columns.map((c, i) => c.width ?? Math.min(40, Math.max(6, c.label.length, ...r.rows.slice(0, 200).map((x) => pdfText(x[i] ?? null).length))));
    const total = weights.reduce((a, b) => a + b, 0);
    const widths = weights.map((w) => (w / total) * width);
    const header = () => {
      doc.font('Helvetica-Bold').fontSize(13).fillColor('#1b252d').text(r.title, left, doc.page.margins.top);
      doc.font('Helvetica').fontSize(8.5).fillColor('#5b6873').text(r.subtitle);
      doc.moveDown(0.6);
      row(r.columns.map((c) => c.label), true);
    };
    const row = (cells: string[], bold = false) => {
      doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(7.5).fillColor('#1b252d');
      const h = Math.max(...cells.map((t, i) => doc.heightOfString(t, { width: widths[i]! - 4 }))) + 4;
      if (doc.y + h > doc.page.height - doc.page.margins.bottom - 14) { doc.addPage(); header(); return row(cells, bold); }
      const y = doc.y;
      let x = left;
      cells.forEach((t, i) => {
        doc.text(t, x + 2, y + 2, { width: widths[i]! - 4, align: r.columns[i]!.numeric ? 'right' : 'left' });
        x += widths[i]!;
      });
      doc.moveTo(left, y + h).lineTo(left + width, y + h).lineWidth(bold ? 0.8 : 0.3).strokeColor('#aab5bf').stroke();
      doc.x = left;
      doc.y = y + h;
    };
    header();
    for (const x of r.rows) row(x.map(pdfText));
    if (!r.rows.length) doc.font('Helvetica').fontSize(9).text('Sem registros.');
    const range = doc.bufferedPageRange();
    for (let i = 0; i < range.count; i++) {
      doc.switchToPage(i);
      const bottom = doc.page.margins.bottom;
      doc.page.margins.bottom = 0; // o rodapé fica na margem; sem isso o pdfkit o descarta
      doc.font('Helvetica').fontSize(7).fillColor('#5b6873').text(`Página ${i + 1} de ${range.count}`, left, doc.page.height - bottom + 10, { width, align: 'right', lineBreak: false });
      doc.page.margins.bottom = bottom;
    }
    doc.end();
  });
}
