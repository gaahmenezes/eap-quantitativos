# Status de implementação

Legenda: Planejada · Em desenvolvimento · Implementada · Testada · Concluída · Bloqueada.
"Concluída" = regra implementada, persistida, integrada front+back, validada, com permissões, testes aprovados e documentação atualizada.

| Fase | Funcionalidade | Status | Evidência |
|---|---|---|---|
| F0 | Diagnóstico e plano | Concluída | `docs/architecture/fase-0-diagnostico-e-plano.md` |
| F1 | Monorepo, TS estrito, lint | Concluída | `pnpm lint`, `pnpm typecheck` |
| F1 | Banco + migração F1 (FKs compostas, auditoria append-only) | Concluída | `apps/api/test/projects.test.ts` |
| F1 | Autenticação (sessão, argon2id, CSRF, Origin, bloqueio, rate limit) | Concluída | `apps/api/test/auth.test.ts`, E2E |
| F1 | Organizações, membros e convites | Concluída | `isolation.test.ts`, `projects.test.ts`, E2E convite |
| F1 | Autorização org/empreendimento (fail-closed) | Concluída | `isolation.test.ts`, `route-policy.test.ts` |
| F1 | CRUD de empreendimentos (If-Match, arquivamento com motivo) | Concluída | `projects.test.ts`, E2E ciclo de vida |
| F1 | Histórico (auditoria) por empreendimento na UI | Concluída | E2E ciclo de vida |
| F1 | Shell da UI, dashboard com dados reais, administração | Concluída | E2E, revisão visual desktop/390px |
| F1 | CI GitHub Actions | Concluída | execução 45315520023 verde (lint, typecheck, testes, E2E) |
| F1 | docker-compose do banco | Implementada | não testado neste ambiente (sem daemon Docker) |
| F1 | Push para GitHub | Concluída | branch `claude/f1-fundacao` em `gaahmenezes/eap-quantitativos` |
| F2 | Regras de hierarquia por módulo | Concluída | `packages/domain/src/structure/planner.test.ts` |
| F2 | Assistente de estruturação (prévia + gravação) | Concluída | cenários A–D no domínio e na API; E2E cenário A e validação horizontal |
| F2 | Árvore do cadastro: criar, editar, mover, reordenar, duplicar, arquivar/reativar | Concluída | `apps/api/test/structure.test.ts`; UI com árvore virtualizada e inspetor |
| F2 | Lotes (área e testada decimais) | Concluída | `structure.test.ts` |
| F2 | Tipologias (cadastro, contagem de unidades, arquivamento protegido) | Concluída | `structure.test.ts`, E2E |
| F2 | Particularidades por unidade e revisões de tipologia | Concluída na F3 | ver linhas F3 |
| F3 | Catálogo técnico por organização (sistemas, tipos de elemento, atributos) | Concluída | `infra.test.ts`; tela Administração › Catálogo técnico |
| F3 | Infraestrutura: sistemas, redes, dispositivos, trechos com declividade/profundidade derivadas | Concluída | `segment.test.ts` (valores conhecidos), `infra.test.ts` (cenário C), E2E de drenagem |
| F3 | Elementos físicos de sistemas sem rede e de áreas comuns | Concluída | `infra.test.ts`; inspetor do cadastro |
| F3 | Revisões de tipologia imutáveis, propagação explícita, particularidades append-only | Concluída | `resolution.test.ts`, `constructive.test.ts` (cenário B), E2E construtivo |
| F4 | Unidades de medida com dimensão, conversão decimal exata e unidades próprias | Concluída | `units.test.ts` (valores conhecidos), `library.test.ts`; aba Unidades |
| F4 | Categorias e biblioteca de serviços (catálogo e específicos do empreendimento) | Concluída | `library.test.ts`, E2E biblioteca |
| F4 | Aviso de descrição similar (pg_trgm) e bloqueio de código duplicado | Concluída | `library.test.ts`, E2E biblioteca |
| F4 | Duplicação com origem registrada; arquivamento auditado | Concluída | `library.test.ts` |
| F4 | Unidade dos atributos do catálogo técnico validada contra o cadastro de unidades | Concluída | `library.test.ts`; seletor no catálogo técnico |
| F4 | Fórmulas compatíveis por serviço | Planejada | F6 (motor de fórmulas) |
| F5–F10 | Demais fases | Planejada | ver plano, seção 10 |

## Contagem de testes (última execução)
- `packages/domain`: 48 · `apps/api` (integração, Postgres real): 92 · `apps/web` (componentes e modelo da árvore): 8 · E2E Playwright: 7
