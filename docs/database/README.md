# Banco de dados

PostgreSQL 16, schema em `apps/api/prisma/schema.prisma`, migrações versionadas em `apps/api/prisma/migrations/`.

## Convenções
- Chaves primárias UUID v7 (`uuid(7)`), ordenáveis no tempo. Códigos de negócio nunca são chave.
- Toda tabela de tenant tem `organizationId`. Tabelas referenciadas expõem `UNIQUE(id, organizationId)` e as filhas usam **FK composta** (ADR-007).
- Datas `timestamptz(3)`. Quantidades (a partir da F6) em `NUMERIC`.
- Dados referenciados são arquivados (`archivedAt`), não apagados.
- Restrições não expressáveis no Prisma ficam em SQL dentro da migração, com comentário.
- Proibido `$queryRawUnsafe`/`$executeRawUnsafe` (regra de lint).

## Tabelas (F1)
| Tabela | Finalidade | Restrições relevantes |
|---|---|---|
| `organization` | Organização (tenant) | — |
| `app_user` | Usuário; senha argon2id; contador de falhas e bloqueio | `email` único e minúsculo (CHECK) |
| `membership` | Usuário × organização, papel OWNER/ADMIN/MEMBER | PK composta |
| `invitation` | Convite; apenas hash SHA-256 do token | índice parcial único de convite pendente por e-mail |
| `session` | Sessão opaca; apenas hash do token; token CSRF | expiração, revogação |
| `project` | Empreendimento | `UNIQUE(organizationId, code)`, `UNIQUE(id, organizationId)`, CHECK status×archivedAt, `version` ≥ 1 |
| `project_member` | Usuário × empreendimento, papel COORDINATOR/EDITOR/VIEWER | FK composta para `project` e para `membership` ⇒ só membros da mesma organização |
| `audit_log` | Auditoria append-only (before/after JSON, motivo, requestId) | triggers bloqueiam UPDATE, DELETE e TRUNCATE |

## Tabelas (F2 — cadastro físico)
| Tabela | Finalidade | Restrições relevantes |
|---|---|---|
| `project_module` | Módulo do empreendimento (vertical, horizontal, loteamento, áreas comuns, infraestrutura) — ADR-011 | FK composta para `project`; `position` ≥ 1; `code` derivado |
| `structure_node` | Nó do cadastro físico: adjacência (`parentId`) + caminho materializado (`path` = ids dos ancestrais e do próprio nó, separados por `/`), `depth`, `position`, `code` derivado, `origin` (assistente, manual, duplicação), `archivedAt`, `version` | pai no mesmo projeto (FK composta) e no mesmo módulo (trigger); `kind` imutável (trigger); sem auto-referência |
| `dwelling_unit` | Detalhe 1:1 de unidade habitacional: tipologia vinculada | só para nós `DWELLING_UNIT` (trigger); tipologia do mesmo projeto (FK composta) |
| `lot_detail` | Detalhe 1:1 de lote: área (m², NUMERIC 14,4) e testada (m, NUMERIC 10,3) | só para nós `LOT` (trigger); valores > 0 |
| `dwelling_typology` | Tipologia construtiva (apartamento ou casa) | `UNIQUE(projectId, code)`; área privativa > 0 |

As regras de hierarquia (quais tipos aceitam quais filhos em cada módulo) ficam em `packages/domain/src/structure/rules.ts` e são validadas na API antes de gravar. Alterações estruturais do mesmo empreendimento são serializadas por `pg_advisory_xact_lock`.
