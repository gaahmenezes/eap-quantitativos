# Registro de Decisões Arquiteturais (ADR)

Formato: contexto → decisão → consequências. Status: Proposta | Aceita | Substituída.

| ADR | Título | Status |
|---|---|---|
| [001](001-monolito-modular.md) | Monólito modular em monorepo pnpm | Aceita |
| [002](002-pacotes-domain-contracts.md) | Pacotes `domain` e `contracts` | Aceita |
| [003](003-postgres-prisma.md) | PostgreSQL 16 + Prisma 7 estável + SQL nas migrações | Aceita |
| [004](004-parser-de-formulas.md) | Parser de fórmulas próprio com análise dimensional | Aceita |
| [005](005-hierarquias.md) | Hierarquias: adjacência + caminho materializado; código derivado | Aceita |
| [006](006-autenticacao-sessao.md) | Sessão em cookie + argon2id + CSRF | Aceita |
| [007](007-isolamento-multitenant.md) | Isolamento por organização com FKs compostas | Aceita |
| [008](008-imutabilidade-versoes.md) | Versões publicadas imutáveis | Aceita |
| [009](009-snapshots-de-revisao.md) | Revisões como snapshots normalizados | Aceita |
| [010](010-atributos-tecnicos.md) | Atributos técnicos: colunas tipadas + JSONB validado | Aceita |
| [011](011-misto-por-modulos.md) | Empreendimento misto como composição de módulos | Aceita |
| [012](012-catalogo-tecnico-por-organizacao.md) | Catálogo técnico por organização, copiado de um padrão | Aceita |
| [013](013-revisoes-de-tipologia-e-propagacao.md) | Revisões de tipologia, unidade fixada e propagação explícita | Aceita |
| [014](014-unidades-e-biblioteca-de-servicos.md) | Unidades com dimensão e fator exato; biblioteca de serviços em dois escopos | Aceita |
| [015](015-templates-e-geracao-de-eap.md) | Templates de EAP versionados e geração determinística por diff | Aceita |
| [016](016-medicoes-e-memoria-de-calculo.md) | Medições com âncora única, memória de cálculo append-only e disjunção por cobertura | Aceita |
| [017](017-consolidacao-sql-com-referencia.md) | Consolidação em SQL validada por uma implementação de referência no domínio | Aceita |
| [018](018-revisoes-como-fotografias.md) | Revisões do empreendimento como fotografias imutáveis | Aceita |
| [019](019-importacao-exportacao-e-arquivos.md) | Importação em área de preparação, exportações tabulares e arquivos de origem | Aceita |
| [020](020-fichas-de-levantamento.md) | Fichas de levantamento: modelos versionados, grade e lançamento em medições | Aceita |
| [021](021-quadros-de-componentes.md) | Quadros de componentes e materiais: itens × destinos e quadro de resumo lançado em medições | Aceita |
| [022](022-migracao-de-planilhas.md) | Migração das planilhas: extrato por aba, plano com mapeamento, conferência e criação de fichas e quadros | Aceita |
| [023](023-centro-operacional.md) | Centro operacional: painel de pendências e cobertura, fila de trabalho com revisão e destino por linha nas fichas | Aceita |
| [024](024-linguagem-visual.md) | Linguagem visual: tokens, Inter tabular, ícones, menu agrupado e recolhível, seletor de empreendimento e busca Ctrl+K | Aceita |
