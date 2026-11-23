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
| F1 | CI GitHub Actions | Implementada | `.github/workflows/ci.yml` — **não executado**: repositório remoto ainda não existe |
| F1 | docker-compose do banco | Implementada | não testado neste ambiente (sem daemon Docker) |
| F1 | Push para GitHub | Bloqueada | sessão sem permissão para criar repositório; aguardando `gaahmenezes/eap-quantitativos` |
| F2 | Cadastro físico + assistente | Planejada | — |
| F3–F10 | Demais fases | Planejada | ver plano, seção 10 |

## Contagem de testes (última execução)
- `packages/domain`: 10 · `apps/api` (integração, Postgres real): 33 · `apps/web` (componentes): 4 · E2E Playwright: 2
