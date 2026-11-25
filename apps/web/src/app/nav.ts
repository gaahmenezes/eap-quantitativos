import {
  Activity, BookOpen, Building2, Calculator, ClipboardList, FileSpreadsheet, FileStack, FolderInput, GitCompare, Grid3x3, Hammer,
  LayoutDashboard, LayoutGrid, Layers, ListTree, Network, ScrollText, Settings, Sigma, Table2, Upload, type LucideIcon,
} from 'lucide-react';

export interface NavItem { label: string; icon: LucideIcon; to?: string; projectPath?: string; keywords?: string }
export interface NavGroup { label: string; items: NavItem[] }

/** Menu da organização, agrupado por natureza do trabalho. */
export const GLOBAL_GROUPS: NavGroup[] = [
  { label: 'Geral', items: [
    { label: 'Dashboard', to: '/', icon: LayoutDashboard, keywords: 'início minhas tarefas' },
    { label: 'Empreendimentos', to: '/empreendimentos', icon: Building2, keywords: 'projetos obras' },
  ] },
  { label: 'Bibliotecas', items: [
    { label: 'Biblioteca de serviços', to: '/servicos', icon: BookOpen, keywords: 'serviços unidades categorias' },
    { label: 'Templates de EAP', to: '/templates', icon: ListTree, keywords: 'modelos eap' },
    { label: 'Fórmulas', to: '/formulas', icon: Sigma, keywords: 'cálculo' },
    { label: 'Modelos de ficha', to: '/fichas', icon: FileStack, keywords: 'fichas planilhas modelos' },
  ] },
  { label: 'Organização', items: [
    { label: 'Administração', to: '/administracao', icon: Settings, keywords: 'membros convites catálogo técnico' },
  ] },
];

/** Menu do empreendimento, na ordem do trabalho: cadastrar → levantar → quantificar → controlar. */
export const PROJECT_GROUPS: NavGroup[] = [
  { label: 'Visão geral', items: [
    { label: 'Centro operacional', projectPath: 'painel', icon: Activity, keywords: 'painel pendências tarefas cobertura' },
  ] },
  { label: 'Cadastro', items: [
    { label: 'Cadastro físico', projectPath: 'cadastro', icon: Layers, keywords: 'torres pavimentos unidades lotes' },
    { label: 'Infraestrutura', projectPath: 'infraestrutura', icon: Network, keywords: 'redes trechos drenagem' },
    { label: 'Construtivo', projectPath: 'construtivo', icon: Hammer, keywords: 'tipologias elementos' },
    { label: 'EAP', projectPath: 'eap', icon: ListTree, keywords: 'estrutura analítica' },
  ] },
  { label: 'Levantamento', items: [
    { label: 'Fichas de levantamento', projectPath: 'fichas', icon: FileSpreadsheet, keywords: 'planilhas cerâmica concreto rede' },
    { label: 'Quadros de componentes', projectPath: 'quadros', icon: Grid3x3, keywords: 'esquadrias louças materiais' },
    { label: 'Migração de planilhas', projectPath: 'migracao', icon: FolderInput, keywords: 'importar excel xlsx' },
    { label: 'Importações', projectPath: 'importacoes', icon: Upload, keywords: 'csv xlsx' },
  ] },
  { label: 'Quantitativos', items: [
    { label: 'Quantitativos', projectPath: 'quantitativos', icon: Calculator, keywords: 'medições' },
    { label: 'Memórias de cálculo', projectPath: 'memorias', icon: ScrollText, keywords: 'revisões de medição' },
    { label: 'Consolidações', projectPath: 'consolidacoes', icon: Table2, keywords: 'totais resumo' },
  ] },
  { label: 'Controle', items: [
    { label: 'Revisões', projectPath: 'revisoes', icon: GitCompare, keywords: 'r00 r01 emissão comparação' },
  ] },
];

export const ICONS = { board: LayoutGrid, task: ClipboardList };
