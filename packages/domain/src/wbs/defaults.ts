/**
 * Templates iniciais de EAP (exemplo editável, publicado como R1 em cada organização).
 * Serviços sugeridos referenciam códigos da biblioteca inicial (resolvidos para IDs na cópia).
 */
import type { RepeatScope, WbsNodeType } from './model.js';

export interface DefaultTemplateNode {
  key: string;
  parent: string | null;
  title: string;
  type: WbsNodeType;
  condition?: string;
  repeat?: RepeatScope;
  services?: string[];
}

export interface DefaultTemplate {
  code: string;
  name: string;
  description: string;
  moduleKinds: string[];
  nodes: DefaultTemplateNode[];
}

const G = (key: string, parent: string | null, title: string, extra: Partial<DefaultTemplateNode> = {}): DefaultTemplateNode => ({ key, parent, title, type: 'GROUP', ...extra });
const I = (key: string, parent: string, title: string, services: string[], extra: Partial<DefaultTemplateNode> = {}): DefaultTemplateNode => ({ key, parent, title, type: 'ITEM', services, ...extra });

const finishing = (p: string, prefix: string) => [
  I(`${prefix}-alv`, p, 'Alvenaria e vedações', ['ALV.001']),
  I(`${prefix}-rev`, p, 'Revestimentos de parede', ['REV.001', 'REV.002']),
  I(`${prefix}-pis`, p, 'Contrapiso, pisos e rodapés', ['REV.003', 'REV.004', 'REV.005']),
  I(`${prefix}-esq`, p, 'Esquadrias', ['ESQ.001', 'ESQ.002']),
  I(`${prefix}-ins`, p, 'Instalações hidráulicas e elétricas', ['INS.001', 'INS.002']),
];

/** Sistemas de infraestrutura: itens por tipo de sistema, dentro de cada rede (ou do sistema, se não houver redes). */
const infraSystems = (root: string): DefaultTemplateNode[] => [
  G(`${root}-sis`, root, '{sistema.nome}', { repeat: 'INFRA_SYSTEM' }),
  G(`${root}-rede`, `${root}-sis`, 'Rede {rede.codigo} — {rede.nome}', { repeat: 'NETWORK' }),
  I(`${root}-dre-esc`, `${root}-rede`, 'Escavação e reaterro de valas', ['DRE.001', 'DRE.005'], { condition: 'sistema.tipo == "DRENAGEM"' }),
  I(`${root}-dre-tub`, `${root}-rede`, 'Tubulação de drenagem', ['DRE.002'], { condition: 'sistema.tipo == "DRENAGEM"' }),
  I(`${root}-dre-dis`, `${root}-rede`, 'Poços de visita e bocas de lobo', ['DRE.003', 'DRE.004'], { condition: 'sistema.tipo == "DRENAGEM"' }),
  I(`${root}-agu`, `${root}-rede`, 'Rede de água, registros e ligações', ['AGU.001', 'AGU.002', 'AGU.003'], { condition: 'sistema.tipo == "AGUA"' }),
  I(`${root}-esg`, `${root}-rede`, 'Rede coletora, poços de visita e ligações', ['ESG.001', 'ESG.002', 'ESG.003'], { condition: 'sistema.tipo == "ESGOTO"' }),
  I(`${root}-ilu`, `${root}-rede`, 'Postes, luminárias e eletrodutos', ['ILU.001', 'ILU.002'], { condition: 'sistema.tipo == "ILUMINACAO"' }),
  I(`${root}-ter`, `${root}-sis`, 'Limpeza, corte, aterro e regularização', ['TER.001', 'TER.002', 'TER.003', 'TER.004', 'TER.005'], { condition: 'sistema.tipo == "TERRAPLENAGEM"' }),
  I(`${root}-pav`, `${root}-sis`, 'Base, sub-base e revestimento', ['PAV.001', 'PAV.002', 'PAV.003', 'PAV.004', 'PAV.005', 'PAV.006'], { condition: 'sistema.tipo == "PAVIMENTACAO"' }),
  I(`${root}-gui`, `${root}-sis`, 'Guias, sarjetas e rampas', ['GUI.001', 'GUI.002', 'GUI.003'], { condition: 'sistema.tipo == "GUIAS_SARJETAS"' }),
  I(`${root}-pai`, `${root}-sis`, 'Paisagismo', ['PAI.001'], { condition: 'sistema.tipo == "PAISAGISMO"' }),
];

export const DEFAULT_WBS_TEMPLATES: DefaultTemplate[] = [
  {
    code: 'EAP-VERT',
    name: 'Residencial vertical',
    description: 'Torre › fundações, estrutura por pavimento, acabamentos por pavimento e tipologia, cobertura.',
    moduleKinds: ['VERTICAL_RESIDENTIAL'],
    nodes: [
      G('root', null, '{modulo.nome}'),
      G('torre', 'root', '{torre.nome}', { repeat: 'TOWER' }),
      G('fund', 'torre', 'Fundações'),
      I('fund-i', 'fund', 'Fundação', ['FUN.001']),
      G('estr', 'torre', 'Estrutura'),
      G('estr-pav', 'estr', '{pavimento.nome}', { repeat: 'FLOOR' }),
      I('estr-pav-i', 'estr-pav', 'Estrutura de concreto armado', ['EST.001', 'EST.002', 'EST.003']),
      G('acab', 'torre', 'Vedações, acabamentos e instalações', { condition: 'qtd.unidades > 0' }),
      G('acab-pav', 'acab', '{pavimento.nome}', { repeat: 'FLOOR', condition: 'qtd.unidades > 0' }),
      G('acab-tip', 'acab-pav', 'Apartamentos {tipologia.codigo} — {tipologia.nome} ({qtd.unidades} un.)', { repeat: 'DWELLING_TYPOLOGY' }),
      ...finishing('acab-tip', 'ap'),
      I('cob', 'torre', 'Cobertura', ['COB.001']),
    ],
  },
  {
    code: 'EAP-HORIZ',
    name: 'Residencial horizontal',
    description: 'Casas agrupadas por tipologia (replicação por tipologia × quantidade de unidades).',
    moduleKinds: ['HORIZONTAL_RESIDENTIAL'],
    nodes: [
      G('root', null, '{modulo.nome}'),
      G('tip', 'root', 'Casas {tipologia.codigo} — {tipologia.nome} ({qtd.unidades} un.)', { repeat: 'DWELLING_TYPOLOGY' }),
      I('tip-fund', 'tip', 'Fundação', ['FUN.001']),
      I('tip-estr', 'tip', 'Estrutura', ['EST.001', 'EST.002', 'EST.003']),
      I('tip-cob', 'tip', 'Cobertura', ['COB.001']),
      ...finishing('tip', 'cs'),
      G('sem-tip', 'root', 'Casas sem tipologia definida ({qtd.unidades} un.)', { condition: 'qtd.tipologias == 0 e qtd.unidades > 0' }),
    ],
  },
  {
    code: 'EAP-LOT',
    name: 'Loteamento',
    description: 'Fases e quadras, sistema viário por rua e trecho, áreas verdes e institucionais e infraestrutura.',
    moduleKinds: ['LAND_SUBDIVISION'],
    nodes: [
      G('root', null, '{modulo.nome}'),
      G('fase', 'root', '{fase.nome}', { repeat: 'PHASE' }),
      G('quadra', 'fase', '{quadra.nome} ({qtd.lotes} lotes)', { repeat: 'BLOCK_QUADRA' }),
      I('quadra-i', 'quadra', 'Limpeza e demarcação dos lotes', ['TER.001']),
      G('viario', 'root', 'Sistema viário', { condition: 'qtd.ruas > 0' }),
      G('rua', 'viario', '{rua.nome}', { repeat: 'STREET' }),
      G('trecho', 'rua', '{trecho.nome}', { repeat: 'STREET_SECTION' }),
      I('trecho-ter', 'trecho', 'Terraplenagem do leito', ['TER.002', 'TER.003', 'TER.005']),
      I('trecho-pav', 'trecho', 'Pavimentação', ['PAV.001', 'PAV.002', 'PAV.003', 'PAV.004', 'PAV.005']),
      I('trecho-gui', 'trecho', 'Guias e sarjetas', ['GUI.001', 'GUI.002']),
      G('areas', 'root', 'Áreas verdes e institucionais', { condition: 'qtd.areas_verdes + qtd.areas_institucionais > 0' }),
      G('area', 'areas', '{area.nome}', { repeat: 'SPECIAL_AREA' }),
      I('area-i', 'area', 'Tratamento paisagístico', ['PAI.001']),
      G('infra', 'root', 'Infraestrutura', { condition: 'qtd.sistemas > 0 e qtd.modulos_infra == 0' }),
      ...infraSystems('infra'),
    ],
  },
  {
    code: 'EAP-AREAS',
    name: 'Áreas comuns',
    description: 'Uma estrutura por área comum ou técnica.',
    moduleKinds: ['COMMON_AREAS'],
    nodes: [
      G('root', null, '{modulo.nome}'),
      G('area', 'root', '{area.nome}', { repeat: 'COMMON_AREA' }),
      I('area-est', 'area', 'Fundação e estrutura', ['FUN.001', 'EST.001']),
      I('area-ved', 'area', 'Vedações e acabamentos', ['ALV.001', 'REV.002', 'REV.004']),
      I('area-ins', 'area', 'Instalações', ['INS.001', 'INS.002']),
    ],
  },
  {
    code: 'EAP-INFRA',
    name: 'Infraestrutura',
    description: 'Cada sistema de infraestrutura cadastrado, por rede, e vias de acesso.',
    moduleKinds: ['INFRASTRUCTURE'],
    nodes: [
      G('root', null, '{modulo.nome}'),
      ...infraSystems('root'),
      G('vias', 'root', 'Vias e acessos', { condition: 'qtd.ruas > 0' }),
      G('rua', 'vias', '{rua.nome}', { repeat: 'STREET' }),
      I('rua-pav', 'rua', 'Pavimentação e guias', ['PAV.001', 'PAV.002', 'PAV.005', 'GUI.001']),
    ],
  },
];
