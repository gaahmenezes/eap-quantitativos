/**
 * Catálogo técnico inicial copiado para cada organização (editável; sem preços — regra 1).
 * Novos sistemas e tipos de elemento são cadastrados pelo usuário, sem migração.
 */
import type { AttributeDefinition } from './attributes.js';

export type ElementCategory = 'NETWORK_NODE' | 'NETWORK_SEGMENT' | 'ELEMENT';
export type ElementDomain = 'INFRA' | 'CONSTRUTIVO';

export interface DefaultSystemType {
  code: string;
  name: string;
  /** Sistemas organizados em redes (dispositivos + trechos). */
  networkBased: boolean;
}

export interface DefaultElementType {
  code: string;
  name: string;
  domain: ElementDomain;
  category: ElementCategory;
  systemCode: string | null;
  attributes: AttributeDefinition[];
}

const num = (key: string, label: string, unit: string, required = false, min: string | null = '0'): AttributeDefinition => ({ key, label, dataType: 'NUMBER', unit, required, min });
const txt = (key: string, label: string, required = false): AttributeDefinition => ({ key, label, dataType: 'TEXT', required });
const list = (key: string, label: string, values: string[], required = false): AttributeDefinition => ({ key, label, dataType: 'ENUM', enumValues: values, required });

export const DEFAULT_SYSTEM_TYPES: DefaultSystemType[] = [
  { code: 'TERRAPLENAGEM', name: 'Terraplenagem', networkBased: false },
  { code: 'DRENAGEM', name: 'Drenagem', networkBased: true },
  { code: 'AGUA', name: 'Abastecimento de água', networkBased: true },
  { code: 'ESGOTO', name: 'Esgotamento sanitário', networkBased: true },
  { code: 'PAVIMENTACAO', name: 'Pavimentação', networkBased: false },
  { code: 'GUIAS_SARJETAS', name: 'Guias e sarjetas', networkBased: false },
  { code: 'ILUMINACAO', name: 'Iluminação externa', networkBased: true },
  { code: 'PAISAGISMO', name: 'Paisagismo e urbanização', networkBased: false },
  { code: 'CONTENCOES', name: 'Contenções', networkBased: false },
];


export const DEFAULT_ELEMENT_TYPES: DefaultElementType[] = [
  // Drenagem
  { code: 'PV-DREN', name: 'Poço de visita (drenagem)', domain: 'INFRA', category: 'NETWORK_NODE', systemCode: 'DRENAGEM', attributes: [num('diametroInterno', 'Diâmetro interno', 'm'), list('tipo', 'Tipo', ['Alvenaria', 'Concreto pré-moldado', 'Concreto moldado in loco'])] },
  { code: 'BL', name: 'Boca de lobo', domain: 'INFRA', category: 'NETWORK_NODE', systemCode: 'DRENAGEM', attributes: [list('tipo', 'Tipo', ['Simples', 'Dupla', 'Tripla'], true), list('grelha', 'Grelha', ['Sem grelha', 'Com grelha'])] },
  { code: 'CX-LIG', name: 'Caixa de ligação', domain: 'INFRA', category: 'NETWORK_NODE', systemCode: 'DRENAGEM', attributes: [num('largura', 'Largura', 'm'), num('comprimento', 'Comprimento', 'm')] },
  { code: 'DISSIP', name: 'Dissipador / estrutura de lançamento', domain: 'INFRA', category: 'NETWORK_NODE', systemCode: 'DRENAGEM', attributes: [txt('tipo', 'Tipo')] },
  { code: 'TUBO-DREN', name: 'Tubulação de drenagem', domain: 'INFRA', category: 'NETWORK_SEGMENT', systemCode: 'DRENAGEM', attributes: [list('classe', 'Classe', ['PA-1', 'PA-2', 'PA-3', 'PS-1', 'PS-2'])] },
  { code: 'SARJETAO', name: 'Sarjetão / canaleta', domain: 'INFRA', category: 'ELEMENT', systemCode: 'DRENAGEM', attributes: [num('comprimento', 'Comprimento', 'm', true), num('largura', 'Largura', 'm')] },
  // Água
  { code: 'REG', name: 'Registro', domain: 'INFRA', category: 'NETWORK_NODE', systemCode: 'AGUA', attributes: [num('diametro', 'Diâmetro', 'mm', true), list('tipo', 'Tipo', ['Gaveta', 'Borboleta', 'Esfera'])] },
  { code: 'VALV', name: 'Válvula / ventosa', domain: 'INFRA', category: 'NETWORK_NODE', systemCode: 'AGUA', attributes: [txt('tipo', 'Tipo', true)] },
  { code: 'RES', name: 'Reservatório', domain: 'INFRA', category: 'NETWORK_NODE', systemCode: 'AGUA', attributes: [num('volume', 'Volume', 'm³', true), list('tipo', 'Tipo', ['Elevado', 'Apoiado', 'Enterrado'])] },
  { code: 'TUBO-AGUA', name: 'Tubulação de água', domain: 'INFRA', category: 'NETWORK_SEGMENT', systemCode: 'AGUA', attributes: [list('pressaoNominal', 'Pressão nominal', ['PN 6', 'PN 10', 'PN 16'])] },
  { code: 'RAMAL-AGUA', name: 'Ramal predial de água', domain: 'INFRA', category: 'ELEMENT', systemCode: 'AGUA', attributes: [num('quantidade', 'Quantidade', 'un', true), num('comprimentoMedio', 'Comprimento médio', 'm')] },
  // Esgoto
  { code: 'PV-ESG', name: 'Poço de visita (esgoto)', domain: 'INFRA', category: 'NETWORK_NODE', systemCode: 'ESGOTO', attributes: [num('diametroInterno', 'Diâmetro interno', 'm')] },
  { code: 'CI', name: 'Caixa de inspeção', domain: 'INFRA', category: 'NETWORK_NODE', systemCode: 'ESGOTO', attributes: [num('diametroInterno', 'Diâmetro interno', 'm')] },
  { code: 'EEE', name: 'Estação elevatória', domain: 'INFRA', category: 'NETWORK_NODE', systemCode: 'ESGOTO', attributes: [num('vazao', 'Vazão', 'L/s'), num('potencia', 'Potência', 'cv')] },
  { code: 'TUBO-ESG', name: 'Rede coletora', domain: 'INFRA', category: 'NETWORK_SEGMENT', systemCode: 'ESGOTO', attributes: [] },
  { code: 'LIG-ESG', name: 'Ligação predial de esgoto', domain: 'INFRA', category: 'ELEMENT', systemCode: 'ESGOTO', attributes: [num('quantidade', 'Quantidade', 'un', true)] },
  // Iluminação
  { code: 'POSTE', name: 'Poste com luminária', domain: 'INFRA', category: 'NETWORK_NODE', systemCode: 'ILUMINACAO', attributes: [num('altura', 'Altura', 'm', true), txt('luminaria', 'Luminária')] },
  { code: 'CX-PASS', name: 'Caixa de passagem', domain: 'INFRA', category: 'NETWORK_NODE', systemCode: 'ILUMINACAO', attributes: [num('largura', 'Largura', 'm')] },
  { code: 'QD-ILUM', name: 'Quadro de alimentação', domain: 'INFRA', category: 'NETWORK_NODE', systemCode: 'ILUMINACAO', attributes: [] },
  { code: 'ELETRODUTO', name: 'Eletroduto com cabos', domain: 'INFRA', category: 'NETWORK_SEGMENT', systemCode: 'ILUMINACAO', attributes: [txt('cabo', 'Cabo')] },
  // Sistemas não organizados em rede
  { code: 'AREA-TERRAP', name: 'Área de terraplenagem', domain: 'INFRA', category: 'ELEMENT', systemCode: 'TERRAPLENAGEM', attributes: [num('area', 'Área', 'm²', true), num('alturaMediaCorte', 'Altura média de corte', 'm'), num('alturaMediaAterro', 'Altura média de aterro', 'm')] },
  { code: 'TALUDE', name: 'Talude', domain: 'INFRA', category: 'ELEMENT', systemCode: 'TERRAPLENAGEM', attributes: [num('area', 'Área', 'm²', true), txt('inclinacao', 'Inclinação (H:V)')] },
  { code: 'PAV-TRECHO', name: 'Pavimento de trecho', domain: 'INFRA', category: 'ELEMENT', systemCode: 'PAVIMENTACAO', attributes: [num('comprimento', 'Comprimento', 'm', true), num('largura', 'Largura', 'm', true), list('revestimento', 'Revestimento', ['CBUQ', 'TSD', 'Intertravado', 'Concreto'], true), num('espessuraBase', 'Espessura da base', 'm'), num('espessuraSubBase', 'Espessura da sub-base', 'm')] },
  { code: 'GUIA', name: 'Guia / meio-fio', domain: 'INFRA', category: 'ELEMENT', systemCode: 'GUIAS_SARJETAS', attributes: [num('comprimento', 'Comprimento', 'm', true), list('tipo', 'Tipo', ['Pré-moldada', 'Extrusada'])] },
  { code: 'SARJETA', name: 'Sarjeta', domain: 'INFRA', category: 'ELEMENT', systemCode: 'GUIAS_SARJETAS', attributes: [num('comprimento', 'Comprimento', 'm', true), num('largura', 'Largura', 'm')] },
  { code: 'RAMPA-ACESS', name: 'Rampa de acessibilidade', domain: 'INFRA', category: 'ELEMENT', systemCode: 'GUIAS_SARJETAS', attributes: [num('quantidade', 'Quantidade', 'un', true)] },
  { code: 'AREA-PAISAG', name: 'Área de paisagismo', domain: 'INFRA', category: 'ELEMENT', systemCode: 'PAISAGISMO', attributes: [num('area', 'Área', 'm²', true), list('tipo', 'Tipo', ['Grama', 'Forração', 'Arbustos', 'Misto'])] },
  { code: 'MURO-ARRIMO', name: 'Muro de arrimo', domain: 'INFRA', category: 'ELEMENT', systemCode: 'CONTENCOES', attributes: [num('comprimento', 'Comprimento', 'm', true), num('alturaMedia', 'Altura média', 'm', true), list('tipo', 'Tipo', ['Concreto armado', 'Gabião', 'Bloco estrutural', 'Solo grampeado'])] },
  // Construtivo (tipologias e áreas comuns)
  { code: 'AMBIENTE', name: 'Ambiente / cômodo', domain: 'CONSTRUTIVO', category: 'ELEMENT', systemCode: null, attributes: [num('area', 'Área', 'm²'), num('peDireito', 'Pé-direito', 'm'), num('perimetro', 'Perímetro', 'm')] },
  { code: 'FUNDACAO', name: 'Fundação', domain: 'CONSTRUTIVO', category: 'ELEMENT', systemCode: null, attributes: [list('tipo', 'Tipo', ['Radier', 'Sapata', 'Estaca', 'Baldrame'], true)] },
  { code: 'ESTRUTURA', name: 'Estrutura', domain: 'CONSTRUTIVO', category: 'ELEMENT', systemCode: null, attributes: [list('sistema', 'Sistema', ['Concreto armado', 'Alvenaria estrutural', 'Parede de concreto', 'Metálica'], true)] },
  { code: 'ALVENARIA', name: 'Alvenaria / vedação', domain: 'CONSTRUTIVO', category: 'ELEMENT', systemCode: null, attributes: [list('material', 'Material', ['Bloco cerâmico', 'Bloco de concreto', 'Drywall']), num('espessura', 'Espessura', 'cm')] },
  { code: 'COBERTURA', name: 'Cobertura', domain: 'CONSTRUTIVO', category: 'ELEMENT', systemCode: null, attributes: [list('telha', 'Telha', ['Cerâmica', 'Concreto', 'Fibrocimento', 'Metálica', 'Laje impermeabilizada']), num('area', 'Área projetada', 'm²')] },
  { code: 'ESQUADRIA', name: 'Esquadria', domain: 'CONSTRUTIVO', category: 'ELEMENT', systemCode: null, attributes: [list('tipo', 'Tipo', ['Porta', 'Janela', 'Porta-janela', 'Basculante'], true), num('largura', 'Largura', 'm'), num('altura', 'Altura', 'm'), num('quantidade', 'Quantidade', 'un')] },
  { code: 'REVESTIMENTO', name: 'Revestimento', domain: 'CONSTRUTIVO', category: 'ELEMENT', systemCode: null, attributes: [list('local', 'Local', ['Piso', 'Parede', 'Teto', 'Fachada'], true), txt('material', 'Material')] },
  { code: 'INST-HIDRO', name: 'Instalações hidrossanitárias', domain: 'CONSTRUTIVO', category: 'ELEMENT', systemCode: null, attributes: [] },
  { code: 'INST-ELET', name: 'Instalações elétricas', domain: 'CONSTRUTIVO', category: 'ELEMENT', systemCode: null, attributes: [] },
  { code: 'EQUIP', name: 'Equipamento / mobiliário fixo', domain: 'CONSTRUTIVO', category: 'ELEMENT', systemCode: null, attributes: [num('quantidade', 'Quantidade', 'un')] },
];
