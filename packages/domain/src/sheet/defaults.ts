/**
 * Fichas de levantamento padrão (F10). Reproduzem as planilhas em uso (cerâmica, área de parede,
 * fôrma/concreto, aço, redes e telhado). São "exemplos editáveis": a organização publica as suas versões.
 * Nenhum dado financeiro (preço, fornecedor, INCC) faz parte das fichas.
 */
import type { SheetDef } from './engine.js';

export interface DefaultSheetTemplate {
  code: string;
  name: string;
  description: string;
  definition: SheetDef;
}

const AREA_DESC = 'Desconto de vãos e interferências.';

export const DEFAULT_SHEET_TEMPLATES: DefaultSheetTemplate[] = [
  {
    code: 'CER',
    name: 'Cerâmica — piso, rodapé e revestimento',
    description: 'Área de material por ambiente, pela paginação de peças ou pela área geométrica, com perda conforme paginação.',
    definition: {
      columns: [
        { key: 'ambiente', label: 'Ambiente', kind: 'input', type: 'text', required: true },
        { key: 'tipo', label: 'Tipo', kind: 'input', type: 'choice', options: ['Piso + rodapé', 'Piso', 'Revestimento'], required: true, defaultValue: 'Piso + rodapé' },
        { key: 'peca_l', label: 'Peça — largura', kind: 'input', type: 'number', unit: 'cm' },
        { key: 'peca_c', label: 'Peça — comprimento', kind: 'input', type: 'number', unit: 'cm' },
        { key: 'pecas', label: 'Peças (paginação)', kind: 'input', type: 'number', unit: 'un' },
        { key: 'area_geo', label: 'Área geométrica', kind: 'input', type: 'number', unit: 'm²' },
        { key: 'perimetro', label: 'Perímetro', kind: 'input', type: 'number', unit: 'm' },
        { key: 'altura', label: 'Altura (rodapé/revest.)', kind: 'input', type: 'number', unit: 'm' },
        { key: 'desconto', label: 'Desconto', kind: 'input', type: 'number', unit: 'm²' },
        { key: 'paginacao', label: 'Paginação', kind: 'input', type: 'choice', options: ['Sim', 'Não'], defaultValue: 'Sim' },
        { key: 'area_piso', label: 'Área de piso (material)', kind: 'calc', type: 'number', unit: 'm²', expression: 'se(tipo == "Revestimento"; 0; se(pecas > 0; pecas * peca_l * peca_c; area_geo))' },
        { key: 'area_parede', label: 'Área vertical', kind: 'calc', type: 'number', unit: 'm²', expression: 'perimetro * altura - desconto' },
        { key: 'area_total', label: 'Área total', kind: 'calc', type: 'number', unit: 'm²', expression: 'area_piso + area_parede' },
        { key: 'area_material', label: 'Área com perda', kind: 'calc', type: 'number', unit: 'm²', expression: 'area_total * (1 + se(paginacao == "Sim"; perda_paginada; perda_sem_paginacao))' },
        { key: 'contrapiso', label: 'Contrapiso', kind: 'calc', type: 'number', unit: 'm²', expression: 'se(tipo == "Revestimento"; 0; se(area_geo > 0; area_geo; area_piso))' },
        { key: 'rodape', label: 'Rodapé', kind: 'calc', type: 'number', unit: 'm', expression: 'se(tipo == "Piso + rodapé"; perimetro; 0)' },
      ],
      params: [
        { key: 'perda_paginada', label: 'Perda com paginação', unit: '%', value: '5' },
        { key: 'perda_sem_paginacao', label: 'Perda sem paginação', unit: '%', value: '13' },
      ],
      tables: [],
      outputs: [
        { key: 'ceramica', label: 'Cerâmica (com perda)', column: 'area_material', suggestedService: 'REV.004' },
        { key: 'contrapiso', label: 'Contrapiso', column: 'contrapiso', suggestedService: 'REV.003' },
        { key: 'rodape', label: 'Rodapé', column: 'rodape', suggestedService: 'REV.005' },
      ],
    },
  },
  {
    code: 'PAREDE',
    name: 'Área de parede',
    description: 'Perímetro × altura − vãos, por face. Serve para alvenaria, chapisco, emboço e pintura.',
    definition: {
      columns: [
        { key: 'ambiente', label: 'Ambiente / parede', kind: 'input', type: 'text', required: true },
        { key: 'perimetro', label: 'Perímetro', kind: 'input', type: 'number', unit: 'm', required: true },
        { key: 'altura', label: 'Altura', kind: 'input', type: 'number', unit: 'm', required: true },
        { key: 'desconto', label: 'Desconto (vãos)', kind: 'input', type: 'number', unit: 'm²' },
        { key: 'faces', label: 'Faces', kind: 'input', type: 'number', unit: 'un', defaultValue: '1' },
        { key: 'area', label: 'Área', kind: 'calc', type: 'number', unit: 'm²', expression: '(perimetro * altura - desconto) * faces' },
      ],
      params: [],
      tables: [],
      outputs: [{ key: 'area', label: 'Área de parede', column: 'area', suggestedService: 'ALV.001' }],
    },
  },
  {
    code: 'CONC',
    name: 'Fôrma e concreto (paredes e lajes)',
    description: `Paredes de concreto e lajes: fôrma por face e volume pela espessura. ${AREA_DESC}`,
    definition: {
      columns: [
        { key: 'elemento', label: 'Elemento', kind: 'input', type: 'text', required: true },
        { key: 'comprimento', label: 'Comprimento', kind: 'input', type: 'number', unit: 'm' },
        { key: 'altura', label: 'Altura', kind: 'input', type: 'number', unit: 'm' },
        { key: 'desconto', label: 'Desconto por face', kind: 'input', type: 'number', unit: 'm²' },
        { key: 'area_laje', label: 'Área de laje', kind: 'input', type: 'number', unit: 'm²' },
        { key: 'espessura', label: 'Espessura', kind: 'input', type: 'number', unit: 'cm', required: true },
        { key: 'faces_forma', label: 'Faces de fôrma', kind: 'input', type: 'number', unit: 'un', defaultValue: '2' },
        { key: 'area_parede', label: 'Área de parede (1 face)', kind: 'calc', type: 'number', unit: 'm²', expression: 'comprimento * altura - desconto' },
        { key: 'forma', label: 'Fôrma', kind: 'calc', type: 'number', unit: 'm²', expression: 'area_parede * faces_forma + area_laje' },
        { key: 'concreto', label: 'Concreto', kind: 'calc', type: 'number', unit: 'm³', expression: '(area_parede + area_laje) * espessura' },
      ],
      params: [],
      tables: [],
      outputs: [
        { key: 'forma', label: 'Fôrma', column: 'forma', suggestedService: 'EST.003' },
        { key: 'concreto', label: 'Concreto', column: 'concreto', suggestedService: 'EST.001' },
      ],
    },
  },
  {
    code: 'ACO',
    name: 'Aço — barras e telas',
    description: 'Massa de aço por barra (kg/m por bitola) ou por painel de tela soldada.',
    definition: {
      columns: [
        { key: 'elemento', label: 'Elemento', kind: 'input', type: 'text', required: true },
        { key: 'tipo', label: 'Tipo', kind: 'input', type: 'choice', options: ['Barra', 'Tela'], required: true, defaultValue: 'Barra' },
        { key: 'bitola', label: 'Bitola (barra)', kind: 'input', type: 'number', unit: 'mm' },
        { key: 'tela', label: 'Tela', kind: 'input', type: 'choice', options: ['Q-61', 'Q-138', 'L-138', 'T-92', 'T-196'] },
        { key: 'quantidade', label: 'Quantidade', kind: 'input', type: 'number', unit: 'un', required: true },
        { key: 'comprimento', label: 'Comprimento (barra)', kind: 'input', type: 'number', unit: 'm' },
        { key: 'massa', label: 'Massa', kind: 'calc', type: 'number', unit: 'kg', expression: 'se(tipo == "Barra"; quantidade * comprimento * tabela("barra_kg_m"; bitola); quantidade * tabela("tela_kg"; tela)) * (1 + perda_aco)' },
      ],
      params: [{ key: 'perda_aco', label: 'Perda de aço', unit: '%', value: '0' }],
      tables: [
        {
          key: 'barra_kg_m', label: 'Massa linear de barras CA-50/60', keyType: 'number', keyUnit: 'mm', valueUnit: 'kg/m', mode: 'exact',
          rows: [['5.0', '0.154'], ['6.3', '0.245'], ['8.0', '0.395'], ['10.0', '0.617'], ['12.5', '0.963'], ['16.0', '1.578'], ['20.0', '2.466'], ['25.0', '3.853']].map(([key, value]) => ({ key: key!, value: value! })),
        },
        {
          key: 'tela_kg', label: 'Massa por painel de tela soldada', keyType: 'text', valueUnit: 'kg', mode: 'exact',
          rows: [['Q-61', '14.25'], ['Q-138', '32.34'], ['L-138', '21.64'], ['T-92', '16.53'], ['T-196', '31.02']].map(([key, value]) => ({ key: key!, value: value! })),
        },
      ],
      outputs: [{ key: 'aco', label: 'Aço', column: 'massa', suggestedService: 'EST.002' }],
    },
  },
  {
    code: 'REDE',
    name: 'Rede enterrada — tubo, vala e reaterro',
    description: 'Por trecho: comprimento com inclinação e transpasse, peças, escavação, colchão, reaterro e fundo de vala.',
    definition: {
      columns: [
        { key: 'trecho', label: 'Trecho', kind: 'input', type: 'text', required: true },
        { key: 'material', label: 'Material', kind: 'input', type: 'text' },
        { key: 'dn', label: 'DN', kind: 'input', type: 'number', unit: 'mm', required: true },
        { key: 'comprimento', label: 'Comprimento', kind: 'input', type: 'number', unit: 'm', required: true },
        { key: 'inclinacao', label: 'Inclinação', kind: 'input', type: 'number', unit: '%' },
        { key: 'profundidade', label: 'Profundidade', kind: 'input', type: 'number', unit: 'm' },
        { key: 'comp_total', label: 'Comprimento de tubo', kind: 'calc', type: 'number', unit: 'm', expression: 'comprimento * (1 + inclinacao) * (1 + transpasse)' },
        { key: 'pecas', label: 'Peças', kind: 'calc', type: 'number', unit: 'pç', expression: 'ceil(comp_total / comp_peca)' },
        { key: 'largura', label: 'Largura da vala', kind: 'calc', type: 'number', unit: 'm', expression: 'tabela("largura_vala"; dn)' },
        { key: 'prof', label: 'Profundidade adotada', kind: 'calc', type: 'number', unit: 'm', expression: 'se(profundidade > 0; profundidade; prof_padrao)' },
        { key: 'escavacao', label: 'Escavação', kind: 'calc', type: 'number', unit: 'm³', expression: 'largura * prof * comp_total' },
        { key: 'colchao', label: 'Colchão de areia', kind: 'calc', type: 'number', unit: 'm³', expression: 'largura * h_colchao * comprimento' },
        { key: 'reaterro', label: 'Reaterro', kind: 'calc', type: 'number', unit: 'm³', expression: 'escavacao - colchao - pi() * (dn / 2) ^ 2 * comp_total' },
        { key: 'fundo', label: 'Fundo de vala', kind: 'calc', type: 'number', unit: 'm²', expression: 'largura * comp_total' },
      ],
      params: [
        { key: 'transpasse', label: 'Transpasse', unit: '%', value: '3.1' },
        { key: 'comp_peca', label: 'Comprimento da peça', unit: 'm', value: '6' },
        { key: 'h_colchao', label: 'Altura do colchão', unit: 'm', value: '0.10' },
        { key: 'prof_padrao', label: 'Profundidade padrão', unit: 'm', value: '1.5' },
      ],
      tables: [
        {
          key: 'largura_vala', label: 'Largura de vala por DN', keyType: 'number', keyUnit: 'mm', valueUnit: 'mm', mode: 'exact',
          rows: [['100', '370'], ['150', '470'], ['200', '570'], ['300', '770'], ['400', '970'], ['450', '1070'], ['500', '1170'], ['600', '1200']].map(([key, value]) => ({ key: key!, value: value! })),
        },
      ],
      outputs: [
        { key: 'tubo', label: 'Tubo', column: 'comp_total', suggestedService: 'DRE.002' },
        { key: 'escavacao', label: 'Escavação de vala', column: 'escavacao', suggestedService: 'DRE.001' },
        { key: 'reaterro', label: 'Reaterro', column: 'reaterro', suggestedService: 'DRE.005' },
        { key: 'colchao', label: 'Colchão de areia', column: 'colchao' },
        { key: 'fundo', label: 'Fundo de vala', column: 'fundo' },
      ],
    },
  },
  {
    code: 'TELHADO',
    name: 'Telhado',
    description: 'Área de cobertura por pano: comprimento × largura × quantidade.',
    definition: {
      columns: [
        { key: 'pano', label: 'Pano / peça', kind: 'input', type: 'text', required: true },
        { key: 'comprimento', label: 'Comprimento', kind: 'input', type: 'number', unit: 'm', required: true },
        { key: 'largura', label: 'Largura', kind: 'input', type: 'number', unit: 'm', required: true },
        { key: 'quantidade', label: 'Quantidade', kind: 'input', type: 'number', unit: 'un', defaultValue: '1' },
        { key: 'area', label: 'Área', kind: 'calc', type: 'number', unit: 'm²', expression: 'comprimento * largura * quantidade' },
      ],
      params: [],
      tables: [],
      outputs: [{ key: 'area', label: 'Cobertura', column: 'area', suggestedService: 'COB.001' }],
    },
  },
];
