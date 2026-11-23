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
