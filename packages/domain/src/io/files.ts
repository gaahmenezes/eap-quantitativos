/**
 * Verificação de arquivos enviados: tipo pela assinatura (não pela extensão) e limites de
 * descompactação de XLSX (zip bomb), lendo o diretório central do ZIP sem descompactar.
 */
export type FileKind = 'XLSX' | 'CSV' | 'PDF' | 'PNG' | 'JPEG';

export const MIME: Record<FileKind, string> = {
  XLSX: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  CSV: 'text/csv',
  PDF: 'application/pdf',
  PNG: 'image/png',
  JPEG: 'image/jpeg',
};

export class FileCheckError extends Error {}

const startsWith = (b: Uint8Array, sig: number[]) => sig.every((x, i) => b[i] === x);

export function sniffFile(buf: Uint8Array, fileName: string): FileKind {
  const ext = fileName.toLowerCase().split('.').pop() ?? '';
  if (startsWith(buf, [0x25, 0x50, 0x44, 0x46, 0x2d])) return 'PDF';
  if (startsWith(buf, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'PNG';
  if (startsWith(buf, [0xff, 0xd8, 0xff])) return 'JPEG';
  if (startsWith(buf, [0x50, 0x4b, 0x03, 0x04])) {
    const names = zipEntries(buf).map((e) => e.name);
    if (names.includes('[Content_Types].xml') && names.some((n) => n.startsWith('xl/'))) return 'XLSX';
    throw new FileCheckError('O arquivo é compactado, mas não é uma planilha XLSX.');
  }
  if (ext === 'csv' || ext === 'txt') {
    if (buf.includes(0)) throw new FileCheckError('O arquivo CSV contém bytes inválidos (parece binário).');
    return 'CSV';
  }
  throw new FileCheckError('Tipo de arquivo não suportado. Envie XLSX, CSV, PDF, PNG ou JPEG.');
}

export interface ZipEntry { name: string; compressed: number; uncompressed: number }

/** Lê o diretório central do ZIP (sem descompactar). */
export function zipEntries(buf: Uint8Array): ZipEntry[] {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65_557); i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new FileCheckError('Arquivo compactado corrompido.');
  const count = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const out: ZipEntry[] = [];
  for (let k = 0; k < count; k++) {
    if (p + 46 > buf.length || dv.getUint32(p, true) !== 0x02014b50) throw new FileCheckError('Arquivo compactado corrompido.');
    const compressed = dv.getUint32(p + 20, true);
    const uncompressed = dv.getUint32(p + 24, true);
    const n = dv.getUint16(p + 28, true);
    const extra = dv.getUint16(p + 30, true);
    const comment = dv.getUint16(p + 32, true);
    let name = '';
    for (const b of buf.subarray(p + 46, p + 46 + n)) name += String.fromCharCode(b);
    out.push({ name, compressed, uncompressed });
    p += 46 + n + extra + comment;
  }
  return out;
}

/** Limites contra zip bomb: tamanho total descompactado, nº de entradas e taxa de compressão. */
export function checkZipLimits(buf: Uint8Array, limits = { maxUncompressed: 100 * 1024 * 1024, maxEntries: 2000, maxRatio: 200 }) {
  const es = zipEntries(buf);
  if (es.length > limits.maxEntries) throw new FileCheckError('A planilha tem partes internas demais.');
  const total = es.reduce((a, e) => a + e.uncompressed, 0);
  if (total > limits.maxUncompressed) throw new FileCheckError('A planilha descompactada é grande demais.');
  for (const e of es) if (e.compressed > 0 && e.uncompressed / e.compressed > limits.maxRatio && e.uncompressed > 1024 * 1024) throw new FileCheckError('A planilha tem taxa de compressão suspeita e foi recusada.');
}
