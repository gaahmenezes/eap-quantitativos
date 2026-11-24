/** Normalização de valores vindos de planilhas e de cabeçalhos de coluna. */

/** Remove acentos, caixa e pontuação: "Código do Serviço" → "codigo do servico". */
export function normalizeHeader(h: string): string {
  return h.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

/**
 * Número decimal em texto exato a partir de formatos usuais: "1.234,56", "1234,56", "1234.56", "1,234.56", 12.5.
 * Retorna null se não for número. Nunca passa por float quando a entrada é texto.
 */
export function parseDecimalText(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : null;
  let s = String(v).trim().replace(/\s/g, '');
  if (!s) return null;
  if (s.startsWith("'")) s = s.slice(1);
  const lastComma = s.lastIndexOf(',');
  const lastDot = s.lastIndexOf('.');
  if (lastComma >= 0 && lastDot >= 0) {
    // o separador mais à direita é o decimal
    s = lastComma > lastDot ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  } else if (lastComma >= 0) {
    if ((s.match(/,/g) ?? []).length > 1) return null;
    s = s.replace(',', '.');
  } else if ((s.match(/\./g) ?? []).length > 1) {
    s = s.replace(/\./g, ''); // 1.234.567
  }
  return /^-?\d+(\.\d+)?$/.test(s) ? s.replace(/^(-?)0+(?=\d)/, '$1') : null;
}

export interface FieldDef {
  key: string;
  label: string;
  required: boolean;
  /** Cabeçalhos aceitos (normalizados) para sugerir o mapeamento. */
  aliases: string[];
}

/** Sugere coluna → campo pelo cabeçalho (exato, depois por inclusão). Cada coluna é usada uma vez. */
export function suggestMapping(headers: readonly string[], fields: readonly FieldDef[]): Record<string, number | null> {
  const norm = headers.map(normalizeHeader);
  const used = new Set<number>();
  const out: Record<string, number | null> = {};
  for (const f of fields) {
    const names = [normalizeHeader(f.label), ...f.aliases.map(normalizeHeader)];
    let idx = norm.findIndex((h, i) => !used.has(i) && names.includes(h));
    if (idx < 0) idx = norm.findIndex((h, i) => !used.has(i) && h.length > 2 && names.some((n) => h.includes(n) || n.includes(h)));
    out[f.key] = idx >= 0 ? idx : null;
    if (idx >= 0) used.add(idx);
  }
  return out;
}
