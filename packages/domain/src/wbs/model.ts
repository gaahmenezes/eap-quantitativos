/**
 * Modelo de templates de EAP e dos fatos do empreendimento usados na geração (RN-GER).
 * Variáveis e contagens usam nomes em português, pois são escritas pelos usuários nos templates.
 */
export const REPEAT_SCOPES = [
  'TOWER', 'BUILDING_BLOCK', 'FLOOR', 'DWELLING_UNIT', 'DWELLING_TYPOLOGY', 'COMMON_AREA', 'SPECIAL_AREA',
  'PHASE', 'STAGE', 'SECTOR', 'BLOCK_QUADRA', 'LOT', 'STREET', 'STREET_SECTION', 'INFRA_SYSTEM', 'NETWORK',
] as const;
export type RepeatScope = (typeof REPEAT_SCOPES)[number];

/** Nome da variável de cada repetição e rótulo para a interface. */
export const REPEAT_INFO: Record<RepeatScope, { variable: string; label: string; kinds?: string[] }> = {
  TOWER: { variable: 'torre', label: 'Cada torre', kinds: ['TOWER'] },
  BUILDING_BLOCK: { variable: 'bloco', label: 'Cada bloco', kinds: ['BUILDING_BLOCK'] },
  FLOOR: { variable: 'pavimento', label: 'Cada pavimento', kinds: ['FLOOR'] },
  DWELLING_UNIT: { variable: 'unidade', label: 'Cada unidade habitacional', kinds: ['DWELLING_UNIT'] },
  DWELLING_TYPOLOGY: { variable: 'tipologia', label: 'Cada tipologia presente' },
  COMMON_AREA: { variable: 'area', label: 'Cada área comum ou técnica', kinds: ['COMMON_AREA', 'TECHNICAL_AREA'] },
  SPECIAL_AREA: { variable: 'area', label: 'Cada área verde ou institucional', kinds: ['GREEN_AREA', 'INSTITUTIONAL_AREA'] },
  PHASE: { variable: 'fase', label: 'Cada fase', kinds: ['PHASE'] },
  STAGE: { variable: 'etapa', label: 'Cada etapa', kinds: ['STAGE'] },
  SECTOR: { variable: 'setor', label: 'Cada setor', kinds: ['SECTOR'] },
  BLOCK_QUADRA: { variable: 'quadra', label: 'Cada quadra', kinds: ['BLOCK_QUADRA'] },
  LOT: { variable: 'lote', label: 'Cada lote', kinds: ['LOT'] },
  STREET: { variable: 'rua', label: 'Cada rua', kinds: ['STREET'] },
  STREET_SECTION: { variable: 'trecho', label: 'Cada trecho de rua', kinds: ['STREET_SECTION'] },
  INFRA_SYSTEM: { variable: 'sistema', label: 'Cada sistema de infraestrutura' },
  NETWORK: { variable: 'rede', label: 'Cada rede do sistema' },
};

/** Contagens disponíveis em condições e títulos: qtd.<chave> no escopo atual. */
export const COUNT_KEYS: Record<string, string[]> = {
  torres: ['TOWER'], blocos: ['BUILDING_BLOCK'], pavimentos: ['FLOOR'], unidades: ['DWELLING_UNIT'],
  areas_comuns: ['COMMON_AREA'], areas_tecnicas: ['TECHNICAL_AREA'], areas_verdes: ['GREEN_AREA'], areas_institucionais: ['INSTITUTIONAL_AREA'],
  fases: ['PHASE'], etapas: ['STAGE'], setores: ['SECTOR'], quadras: ['BLOCK_QUADRA'], lotes: ['LOT'], ruas: ['STREET'], trechos: ['STREET_SECTION'],
};

export type WbsNodeType = 'GROUP' | 'ITEM';

export interface TemplateNodeDef {
  key: string;
  parentKey: string | null;
  title: string;
  nodeType: WbsNodeType;
  condition: string | null;
  repeat: RepeatScope | null;
  position: number;
  serviceIds: string[];
}

export interface TemplateDef {
  templateId: string;
  versionId: string;
  moduleKinds: string[];
  nodes: TemplateNodeDef[];
}

export interface ProjectFacts {
  classification: string;
  modules: { id: string; kind: string; name: string; code: string; position: number }[];
  structure: { id: string; moduleId: string; parentId: string | null; kind: string; name: string; code: string; position: number; typologyId?: string | null }[];
  typologies: { id: string; code: string; name: string; kind: 'HOUSE' | 'APARTMENT' }[];
  systems: { id: string; typeCode: string; typeName: string; name: string; networks: { id: string; code: string; name: string }[] }[];
}

export type BindingKind = 'MODULE' | 'STRUCTURE' | 'TYPOLOGY' | 'SYSTEM' | 'NETWORK';

export interface DesiredNode {
  key: string;
  parentKey: string | null;
  title: string;
  nodeType: WbsNodeType;
  /** Posição entre os irmãos gerados (base 1). */
  position: number;
  moduleId: string;
  templateId: string;
  templateVersionId: string;
  templateNodeKey: string;
  binding: { kind: BindingKind; id: string };
  serviceIds: string[];
}
