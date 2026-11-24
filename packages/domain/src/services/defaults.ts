/**
 * Biblioteca inicial de serviços (exemplo editável). Apenas informação técnica de engenharia:
 * código, descrição, unidade e critério de medição — sem preços, custos ou composições (regra 1).
 */
export interface DefaultCategory {
  code: string;
  name: string;
  parentCode: string | null;
}

export interface DefaultService {
  code: string;
  description: string;
  categoryCode: string;
  unit: string;
  criterion: string;
}

export const DEFAULT_SERVICE_CATEGORIES: DefaultCategory[] = [
  { code: 'INF', name: 'Infraestrutura', parentCode: null },
  { code: 'INF-TER', name: 'Terraplenagem', parentCode: 'INF' },
  { code: 'INF-DRE', name: 'Drenagem', parentCode: 'INF' },
  { code: 'INF-AGU', name: 'Abastecimento de água', parentCode: 'INF' },
  { code: 'INF-ESG', name: 'Esgotamento sanitário', parentCode: 'INF' },
  { code: 'INF-PAV', name: 'Pavimentação', parentCode: 'INF' },
  { code: 'INF-GUI', name: 'Guias e sarjetas', parentCode: 'INF' },
  { code: 'INF-ILU', name: 'Iluminação externa', parentCode: 'INF' },
  { code: 'INF-PAI', name: 'Paisagismo e urbanização', parentCode: 'INF' },
  { code: 'CON', name: 'Construtivo', parentCode: null },
  { code: 'CON-FUN', name: 'Fundações', parentCode: 'CON' },
  { code: 'CON-EST', name: 'Estrutura', parentCode: 'CON' },
  { code: 'CON-ALV', name: 'Alvenaria e vedações', parentCode: 'CON' },
  { code: 'CON-COB', name: 'Cobertura', parentCode: 'CON' },
  { code: 'CON-REV', name: 'Revestimentos e pisos', parentCode: 'CON' },
  { code: 'CON-ESQ', name: 'Esquadrias', parentCode: 'CON' },
  { code: 'CON-INS', name: 'Instalações', parentCode: 'CON' },
];

export const DEFAULT_SERVICES: DefaultService[] = [
  { code: 'TER.001', description: 'Limpeza e raspagem do terreno', categoryCode: 'INF-TER', unit: 'm²', criterion: 'Área em projeção horizontal efetivamente limpa.' },
  { code: 'TER.002', description: 'Escavação mecanizada de material de 1ª categoria', categoryCode: 'INF-TER', unit: 'm³', criterion: 'Volume no corte (geométrico), medido por seções.' },
  { code: 'TER.003', description: 'Aterro compactado com controle de grau de compactação', categoryCode: 'INF-TER', unit: 'm³', criterion: 'Volume compactado no aterro, medido por seções.' },
  { code: 'TER.004', description: 'Transporte de material de terraplenagem', categoryCode: 'INF-TER', unit: 'm³', criterion: 'Volume transportado, medido no corte.' },
  { code: 'TER.005', description: 'Regularização e compactação do subleito', categoryCode: 'INF-TER', unit: 'm²', criterion: 'Área regularizada da plataforma.' },
  { code: 'DRE.001', description: 'Escavação de vala para rede de drenagem', categoryCode: 'INF-DRE', unit: 'm³', criterion: 'Comprimento × largura × profundidade média da vala.' },
  { code: 'DRE.002', description: 'Tubo de concreto para drenagem, assentamento', categoryCode: 'INF-DRE', unit: 'm', criterion: 'Comprimento entre faces internas dos poços de visita, por diâmetro.' },
  { code: 'DRE.003', description: 'Poço de visita para drenagem', categoryCode: 'INF-DRE', unit: 'un', criterion: 'Unidade executada, por faixa de profundidade.' },
  { code: 'DRE.004', description: 'Boca de lobo', categoryCode: 'INF-DRE', unit: 'un', criterion: 'Unidade executada, por tipo (simples, dupla, tripla).' },
  { code: 'DRE.005', description: 'Reaterro compactado de vala', categoryCode: 'INF-DRE', unit: 'm³', criterion: 'Volume escavado menos o volume ocupado pela tubulação e berço.' },
  { code: 'AGU.001', description: 'Tubulação de água, assentamento', categoryCode: 'INF-AGU', unit: 'm', criterion: 'Comprimento instalado, por diâmetro e material.' },
  { code: 'AGU.002', description: 'Registro de manobra', categoryCode: 'INF-AGU', unit: 'un', criterion: 'Unidade instalada, por diâmetro.' },
  { code: 'AGU.003', description: 'Ligação predial de água', categoryCode: 'INF-AGU', unit: 'un', criterion: 'Ligação executada.' },
  { code: 'ESG.001', description: 'Rede coletora de esgoto, assentamento', categoryCode: 'INF-ESG', unit: 'm', criterion: 'Comprimento entre poços de visita, por diâmetro.' },
  { code: 'ESG.002', description: 'Poço de visita para esgoto', categoryCode: 'INF-ESG', unit: 'un', criterion: 'Unidade executada, por faixa de profundidade.' },
  { code: 'ESG.003', description: 'Ligação predial de esgoto', categoryCode: 'INF-ESG', unit: 'un', criterion: 'Ligação executada.' },
  { code: 'PAV.001', description: 'Sub-base de brita graduada', categoryCode: 'INF-PAV', unit: 'm³', criterion: 'Volume compactado: área × espessura de projeto.' },
  { code: 'PAV.002', description: 'Base de brita graduada simples', categoryCode: 'INF-PAV', unit: 'm³', criterion: 'Volume compactado: área × espessura de projeto.' },
  { code: 'PAV.003', description: 'Imprimação impermeabilizante', categoryCode: 'INF-PAV', unit: 'm²', criterion: 'Área imprimada.' },
  { code: 'PAV.004', description: 'Pintura de ligação', categoryCode: 'INF-PAV', unit: 'm²', criterion: 'Área aplicada.' },
  { code: 'PAV.005', description: 'Revestimento em concreto betuminoso usinado a quente', categoryCode: 'INF-PAV', unit: 'm³', criterion: 'Volume aplicado: área × espessura de projeto.' },
  { code: 'PAV.006', description: 'Pavimento intertravado de concreto', categoryCode: 'INF-PAV', unit: 'm²', criterion: 'Área executada.' },
  { code: 'GUI.001', description: 'Guia de concreto pré-moldada', categoryCode: 'INF-GUI', unit: 'm', criterion: 'Comprimento assentado.' },
  { code: 'GUI.002', description: 'Sarjeta de concreto moldada in loco', categoryCode: 'INF-GUI', unit: 'm', criterion: 'Comprimento executado, por largura.' },
  { code: 'GUI.003', description: 'Rampa de acessibilidade em calçada', categoryCode: 'INF-GUI', unit: 'un', criterion: 'Unidade executada.' },
  { code: 'ILU.001', description: 'Poste de iluminação com luminária', categoryCode: 'INF-ILU', unit: 'un', criterion: 'Conjunto instalado, por altura.' },
  { code: 'ILU.002', description: 'Eletroduto enterrado com cabos', categoryCode: 'INF-ILU', unit: 'm', criterion: 'Comprimento instalado entre caixas.' },
  { code: 'PAI.001', description: 'Plantio de grama em placas', categoryCode: 'INF-PAI', unit: 'm²', criterion: 'Área plantada.' },
  { code: 'FUN.001', description: 'Fundação em radier de concreto armado', categoryCode: 'CON-FUN', unit: 'm³', criterion: 'Volume de concreto conforme projeto.' },
  { code: 'EST.001', description: 'Concreto estrutural lançado em vigas e pilares', categoryCode: 'CON-EST', unit: 'm³', criterion: 'Volume geométrico dos elementos.' },
  { code: 'EST.002', description: 'Armadura de aço CA-50', categoryCode: 'CON-EST', unit: 'kg', criterion: 'Massa conforme tabela de armação.' },
  { code: 'EST.003', description: 'Fôrma de madeira para estrutura', categoryCode: 'CON-EST', unit: 'm²', criterion: 'Área de contato com o concreto.' },
  { code: 'ALV.001', description: 'Alvenaria de vedação com bloco cerâmico', categoryCode: 'CON-ALV', unit: 'm²', criterion: 'Área líquida: comprimento × altura, descontando vãos maiores que 2 m².' },
  { code: 'COB.001', description: 'Cobertura com telha cerâmica', categoryCode: 'CON-COB', unit: 'm²', criterion: 'Área inclinada da cobertura.' },
  { code: 'REV.001', description: 'Chapisco em parede', categoryCode: 'CON-REV', unit: 'm²', criterion: 'Área revestida.' },
  { code: 'REV.002', description: 'Emboço em parede', categoryCode: 'CON-REV', unit: 'm²', criterion: 'Área revestida, descontando vãos maiores que 2 m².' },
  { code: 'REV.003', description: 'Contrapiso de argamassa', categoryCode: 'CON-REV', unit: 'm²', criterion: 'Área do ambiente.' },
  { code: 'REV.004', description: 'Piso cerâmico assentado', categoryCode: 'CON-REV', unit: 'm²', criterion: 'Área do ambiente.' },
  { code: 'REV.005', description: 'Rodapé cerâmico', categoryCode: 'CON-REV', unit: 'm', criterion: 'Perímetro descontando vãos de portas.' },
  { code: 'ESQ.001', description: 'Porta de madeira completa', categoryCode: 'CON-ESQ', unit: 'un', criterion: 'Unidade instalada, por dimensão.' },
  { code: 'ESQ.002', description: 'Janela de alumínio', categoryCode: 'CON-ESQ', unit: 'm²', criterion: 'Área do vão.' },
  { code: 'INS.001', description: 'Ponto de instalação hidráulica', categoryCode: 'CON-INS', unit: 'pt', criterion: 'Ponto executado.' },
  { code: 'INS.002', description: 'Ponto de instalação elétrica', categoryCode: 'CON-INS', unit: 'pt', criterion: 'Ponto executado.' },
];
