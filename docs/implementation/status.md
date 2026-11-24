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
| F4 | Fórmulas compatíveis por serviço | Concluída na F6 | compatibilidade derivada da grandeza (ADR-016) |
| F5 | Linguagem de condições segura (parser próprio, sem eval) | Concluída | `parser.test.ts` (expressões maliciosas e inválidas rejeitadas) |
| F5 | Templates de EAP versionados: rascunho, publicação imutável, nova versão, descarte, comparação, arquivamento | Concluída | `wbs.test.ts`; tela Templates de EAP; E2E |
| F5 | Geração determinística (`generateWbs`) com repetições e condições; templates iniciais para os 5 tipos de módulo | Concluída | `wbs.test.ts` do domínio (hash idêntico, cenários A–D), `apps/api/test/wbs.test.ts` |
| F5 | Regeneração por diff com prévia obrigatória e `planHash`; só nós novos ao incluir torre; nós protegidos ficam obsoletos; manuais intocados | Concluída | `wbs.test.ts` (domínio e API), E2E |
| F5 | Editor de EAP: árvore virtualizada, busca, editar título, mover, duplicar, nós manuais, arquivar/restaurar, serviços por item, indicador de preenchimento, histórico de gerações | Concluída | `apps/api/test/wbs.test.ts`, E2E, revisão visual desktop/390px |
| F5 | Proteção de nós com medição na regeneração | Concluída | `measurements.test.ts` (item medido vira obsoleto, não é removido) |
| F6 | Motor de fórmulas: parser seguro, decimal exato, análise dimensional, conversões, memória | Concluída | `formula.test.ts` (parede − vãos, escavação com talude, 0,1 + 0,2 = 0,3, m + m² rejeitado, expressões maliciosas) |
| F6 | Fórmulas versionadas (rascunho, publicação imutável, teste sem gravar, fórmulas iniciais) | Concluída | `measurements.test.ts`; tela Fórmulas; E2E |
| F6 | Medições manuais e por fórmula com âncora única e memória de cálculo append-only | Concluída | `measurements.test.ts`, E2E |
| F6 | Bloqueio de dupla contagem (cobertura de âncoras) | Concluída | `measurement.test.ts` (domínio), `measurements.test.ts` (cenários A e B), E2E |
| F6 | Replicação por tipologia com substituição por unidade e particularidades | Concluída | `measurement.test.ts` (cenário B 60/40/20), `measurements.test.ts` |
| F6 | Fórmula nova não recalcula; lista de desatualizadas e recálculo explícito | Concluída | `measurements.test.ts`, E2E |
| F6 | Telas Quantitativos e Memórias de cálculo | Concluída | E2E, revisão visual desktop/390px |
| F6 | Documento de origem como arquivo anexado | Planejada | hoje é referência textual; upload na F9 |
| F7 | Consolidação de referência no domínio (somas exatas por dimensão, separadas por unidade) | Concluída | `consolidate.test.ts` |
| F7 | Consolidação em SQL com replicação por tipologia, particularidades, substituições e conversão de unidade | Concluída | `consolidation.test.ts` (valores conhecidos, cenários B e C) |
| F7 | Equivalência SQL × referência do domínio | Concluída | `consolidation.test.ts` (14 combinações de agrupamento e filtro) |
| F7 | Desempenho: 200.000 linhas efetivas em < 2 s | Concluída | `consolidation-perf.test.ts` (~0,5–0,7 s medidos) |
| F7 | Tela Consolidações: dimensões, filtros, totais por unidade, detalhamento até a memória | Concluída | E2E, revisão visual desktop/390px |
| F7 | Troca de unidade de serviço medido só na mesma grandeza | Concluída | `consolidation.test.ts` |
| F8 | Emissão de revisões (R00, R01…) com fotografia imutável de EAP, cadastro, medições, linhas efetivas e rótulos | Concluída | `revisions.test.ts` (triggers de imutabilidade e de gravação só na emissão) |
| F8 | Alterar o empreendimento após a R00 não altera relatórios da R00 | Concluída | `revisions.test.ts`, E2E |
| F8 | Comparação revisão × revisão e revisão × estado atual com deltas exatos | Concluída | `compare.test.ts` (domínio), `revisions.test.ts`, E2E |
| F8 | Consolidação e detalhamento sobre a fotografia, até a memória de cálculo congelada | Concluída | `revisions.test.ts`, E2E |
| F8 | Permissão de emissão (coordenador ou administrador) | Concluída | `revisions.test.ts` (editor recebe 403) |
| F8 | Histórico por entidade (medições e nós da EAP) | Concluída | `revisions.test.ts` (filtro da auditoria), E2E |
| F9–F10 | Demais fases | Planejada | ver plano, seção 10 |

## Contagem de testes (última execução)
- `packages/domain`: 94 · `apps/api` (integração, Postgres real): 130 · `apps/web` (componentes e modelo da árvore): 8 · E2E Playwright: 11
