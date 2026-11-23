# Arquitetura

### 4.1 Decisões principais (viram ADRs em `docs/decisions/`)
| # | Decisão | Justificativa |
|---|---|---|
| ADR‑001 | **Monólito modular** em monorepo pnpm | Um time, um banco, domínio fortemente relacionado; microsserviços não se justificam. |
| ADR‑002 | Pacotes: `apps/api` (NestJS), `apps/web` (React/Vite), `packages/domain` (TS puro), `packages/contracts` (schemas zod) | `domain` concentra a inteligência (motor de fórmulas, unidades, gerador de EAP, diff, consolidação) **sem dependência de framework/banco** → testável com resultados conhecidos. `contracts` dá tipagem e validação idênticas no front e no back. Não criar mais pacotes sem necessidade. |
| ADR‑003 | PostgreSQL 16 + **Prisma 7.10 (estável)**; SQL bruto versionado nas migrações para CHECKs, índices parciais, triggers de auditoria e `pg_trgm` | Prisma não expressa tudo; restrições críticas ficam no banco. Proibido `$queryRawUnsafe`. |
| ADR‑004 | **Parser matemático próprio** (Pratt parser, ~400 linhas) sobre decimal.js, com análise dimensional | Sem `eval`; whitelist de operadores/funções; controle total de precisão e dimensões; mathjs seria pesado e já teve CVEs no avaliador. |
| ADR‑005 | Hierarquias por **lista de adjacência + caminho materializado de IDs** (`path`), código hierárquico **derivado** e armazenado só para leitura | ID estável nunca muda; mover nó recalcula `code`/`path` da subárvore em transação. |
| ADR‑006 | Autenticação por **sessão em cookie** (`__Host-`, httpOnly, Secure, SameSite=Lax) com sessões no Postgres; senhas **argon2id**; CSRF por token sincronizador + checagem de `Origin` | Mais seguro que JWT em localStorage para app web próprio; revogação imediata. |
| ADR‑007 | Isolamento: `organizationId` em toda tabela de tenant + **FKs compostas `(id, organizationId)`** + guarda de acesso em cada caso de uso | Impede no banco que um registro referencie outro de outra organização. RLS do Postgres avaliado na Fase 10 como defesa extra. |
| ADR‑008 | Templates publicados e revisões de tipologia são **imutáveis**; edição sempre em nova versão rascunho | Atende “não alterar retroativamente”. |
| ADR‑009 | Revisões de projeto como **snapshots normalizados** (tabelas `revision_*` referenciando versões imutáveis de medição) | Comparação via SQL, relatórios históricos estáveis. |
| ADR‑010 | Atributos técnicos variáveis: **colunas tipadas** para o núcleo (comprimento, diâmetro, cotas, profundidade, declividade, material em segmentos) + **JSONB validado contra o schema do `ElementType`** para atributos extras | Evita EAV genérico e evita dezenas de tabelas por sistema; novos sistemas sem migração. |
| ADR‑011 | Empreendimento **misto = composição de módulos** (`ProjectModule`), não uma quinta estrutura rígida | Vertical, horizontal e loteamento são módulos; misto combina vários no mesmo projeto, cada um com sua subárvore e seus templates. |

### 4.2 Stack
- **Web:** React 19, TypeScript, Vite 8, Tailwind 4, componentes próprios sobre Radix (padrão shadcn, código no repo), React Router, TanStack Query (estado servidor), TanStack Table + TanStack Virtual (tabelas/árvores grandes), react-hook-form + zod. Estado local mínimo (sem Redux).
- **API:** NestJS 12, REST, pipe de validação zod (`contracts`), filtro global de exceções (formato RFC 9457 *problem details*), helmet, throttler, logs estruturados (pino) com `requestId`.
- **Arquivos:** abstração `StorageService` (disco local em dev; S3 compatível depois). exceljs (XLSX), csv-parse/csv-stringify (CSV), pdfmake (PDF).
- **Testes:** Vitest (domain, api, web), Supertest + Postgres real (banco de teste isolado por execução), Testing Library, Playwright E2E.
- **Qualidade:** ESLint + Prettier, `tsc --noEmit` estrito, CI GitHub Actions (lint, typecheck, testes com serviço Postgres).

### 4.3 Estrutura de pastas
```
apps/api/src/modules/{auth,organizations,projects,structure,infrastructure,
                      typologies,services,units,formulas,wbs-templates,wbs,
                      measurements,consolidation,revisions,imports,exports,audit,documents}
apps/api/prisma/{schema.prisma,migrations/,seed/}
apps/web/src/{app,routes,features/<módulo>,components/ui,lib/api}
packages/domain/src/{formula,units,wbs-generator,wbs-diff,consolidation,typology-resolution,codes}
packages/contracts/src/<módulo>.ts
docs/{architecture,product,domain,database,decisions,implementation}
CLAUDE.md  README.md
```
Cada módulo da API: `controller` (HTTP fino) → `application service` (caso de uso, transação, autorização, auditoria) → `domain` (regras puras) → `repository` (Prisma).

---

