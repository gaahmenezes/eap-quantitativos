/**
 * Normalização de descrições para detectar possíveis serviços duplicados (aviso, não bloqueio).
 * Remove acentos, caixa, pontuação e espaços repetidos; padroniza símbolos de unidade e números.
 */
export function normalizeDescription(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/ª/g, 'a')
    .replace(/º/g, 'o')
    .replace(/²/g, '2')
    .replace(/³/g, '3')
    .replace(/(\d),(\d)/g, '$1.$2')
    .replace(/[^a-z0-9.]+/g, ' ')
    .replace(/\.(?!\d)|(?<!\d)\./g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
