const dateTime = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
const date = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'medium' });

export const fmtDateTime = (iso: string) => dateTime.format(new Date(iso));
export const fmtDate = (iso: string) => date.format(new Date(iso));

/** Quantidade decimal (texto "1234.5") em pt-BR sem passar por float: "1.234,5". */
export function fmtQty(value: string): string {
  const neg = value.startsWith('-');
  const [int = '0', frac] = (neg ? value.slice(1) : value).split('.');
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${neg ? '-' : ''}${grouped}${frac ? `,${frac}` : ''}`;
}
