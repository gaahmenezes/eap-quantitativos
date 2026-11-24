import type { FormulaDef } from './formula.js';

/** Fórmulas iniciais da organização (exemplos editáveis; publicadas como R1). */
export const DEFAULT_FORMULAS: (FormulaDef & { code: string; name: string; description: string })[] = [
  {
    code: 'AREA-RET', name: 'Área retangular', description: 'Comprimento × largura.',
    expression: 'c * l',
    variables: [{ symbol: 'c', label: 'Comprimento', unit: 'm', constraint: 'positive' }, { symbol: 'l', label: 'Largura', unit: 'm', constraint: 'positive' }],
  },
  {
    code: 'AREA-PAREDE', name: 'Área de parede descontando vãos', description: 'Perímetro × pé-direito − vãos (portas e janelas).',
    expression: 'perimetro * pe_direito - n_vaos * area_vao',
    variables: [
      { symbol: 'perimetro', label: 'Perímetro da parede', unit: 'm', constraint: 'positive' },
      { symbol: 'pe_direito', label: 'Pé-direito', unit: 'm', constraint: 'positive' },
      { symbol: 'n_vaos', label: 'Quantidade de vãos', unit: 'un', constraint: 'nonnegative' },
      { symbol: 'area_vao', label: 'Área de cada vão', unit: 'm²', constraint: 'nonnegative' },
    ],
  },
  {
    code: 'VOL-PRISMA', name: 'Volume de prisma', description: 'Comprimento × largura × altura (sapatas, blocos, lajes).',
    expression: 'c * l * h',
    variables: [{ symbol: 'c', label: 'Comprimento', unit: 'm', constraint: 'positive' }, { symbol: 'l', label: 'Largura', unit: 'm', constraint: 'positive' }, { symbol: 'h', label: 'Altura ou espessura', unit: 'cm', constraint: 'positive' }],
  },
  {
    code: 'VOL-VALA', name: 'Escavação de vala com talude', description: 'Seção trapezoidal média × comprimento.',
    expression: '(b + (b + 2 * h * talude)) / 2 * h * c',
    variables: [
      { symbol: 'b', label: 'Largura de fundo', unit: 'm', constraint: 'positive' },
      { symbol: 'h', label: 'Profundidade média', unit: 'm', constraint: 'positive' },
      { symbol: 'talude', label: 'Inclinação do talude (H:V)', unit: '%', constraint: 'nonnegative' },
      { symbol: 'c', label: 'Comprimento da vala', unit: 'm', constraint: 'positive' },
    ],
  },
  {
    code: 'COMP-LINEAR', name: 'Comprimento por repetição', description: 'Quantidade × comprimento unitário.',
    expression: 'n * c',
    variables: [{ symbol: 'n', label: 'Quantidade', unit: 'un', constraint: 'nonnegative' }, { symbol: 'c', label: 'Comprimento unitário', unit: 'm', constraint: 'positive' }],
  },
];
