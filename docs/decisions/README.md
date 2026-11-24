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
