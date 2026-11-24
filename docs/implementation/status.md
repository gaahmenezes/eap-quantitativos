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
| F2 | Particularidades por unidade e revisões de tipologia | Planejada | F3 (estrutura) e F6 (quantitativos) |
| F3 | Infraestrutura (redes, trechos, dispositivos) e construtivo (elementos de tipologia) | Planejada | — |
| F4–F10 | Demais fases | Planejada | ver plano, seção 10 |

## Contagem de testes (última execução)
- `packages/domain`: 26 · `apps/api` (integração, Postgres real): 55 · `apps/web` (componentes e modelo da árvore): 8 · E2E Playwright: 4
