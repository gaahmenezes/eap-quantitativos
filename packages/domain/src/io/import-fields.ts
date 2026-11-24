import type { FieldDef } from './values.js';

export type ImportKindKey = 'SERVICES' | 'STRUCTURE' | 'MEASUREMENTS';

/**
 * Campos de cada tipo de importação. Os rótulos são os cabeçalhos das exportações correspondentes,
 * de modo que exportar → reimportar não exige mapeamento manual.
 */
export const IMPORT_FIELDS: Record<ImportKindKey, FieldDef[]> = {
  SERVICES: [
    { key: 'code', label: 'Código', required: true, aliases: ['cod', 'codigo do servico', 'item'] },
    { key: 'description', label: 'Descrição', required: true, aliases: ['descricao do servico', 'servico'] },
    { key: 'unit', label: 'Unidade', required: true, aliases: ['un', 'und', 'unid'] },
    { key: 'category', label: 'Código da categoria', required: true, aliases: ['categoria', 'grupo'] },
    { key: 'criterion', label: 'Critério de medição', required: false, aliases: ['criterio'] },
    { key: 'technical', label: 'Descrição técnica', required: false, aliases: ['especificacao'] },
  ],
  STRUCTURE: [
    { key: 'ref', label: 'Referência', required: true, aliases: ['codigo', 'ref', 'id'] },
    { key: 'parentRef', label: 'Referência do item superior', required: false, aliases: ['pai', 'referencia do pai', 'codigo do pai'] },
    { key: 'module', label: 'Módulo', required: true, aliases: [] },
    { key: 'moduleKind', label: 'Tipo do módulo', required: false, aliases: [] },
    { key: 'kind', label: 'Tipo', required: true, aliases: ['tipo do item', 'natureza'] },
    { key: 'name', label: 'Nome', required: true, aliases: ['descricao', 'identificacao'] },
    { key: 'typology', label: 'Tipologia', required: false, aliases: ['codigo da tipologia'] },
    { key: 'lotArea', label: 'Área do lote (m²)', required: false, aliases: ['area', 'area do lote'] },
    { key: 'lotFrontage', label: 'Testada (m)', required: false, aliases: ['testada'] },
  ],
  MEASUREMENTS: [
    { key: 'wbs', label: 'Código do item da EAP', required: true, aliases: ['item da eap', 'eap', 'codigo eap'] },
    { key: 'service', label: 'Código do serviço', required: true, aliases: ['servico'] },
    { key: 'anchorKind', label: 'Tipo de âncora', required: false, aliases: ['tipo de local'] },
    { key: 'anchor', label: 'Âncora', required: true, aliases: ['local', 'onde'] },
    { key: 'unitRef', label: 'Unidade habitacional', required: false, aliases: ['apartamento', 'casa'] },
    { key: 'quantity', label: 'Quantidade', required: true, aliases: ['qtd', 'quant'] },
    { key: 'unit', label: 'Unidade', required: false, aliases: ['un', 'und'] },
    { key: 'source', label: 'Documento de origem', required: false, aliases: ['origem', 'fonte'] },
    { key: 'notes', label: 'Observações', required: false, aliases: ['obs'] },
  ],
};

/** Tipos de âncora aceitos na importação de medições (rótulos das exportações). */
export const ANCHOR_KIND_LABELS = {
  STRUCTURE_NODE: 'Cadastro',
  NETWORK_SEGMENT: 'Trecho',
  NETWORK_NODE: 'Dispositivo',
  PHYSICAL_ELEMENT: 'Elemento físico',
  TYPOLOGY_ELEMENT: 'Tipologia',
} as const;
