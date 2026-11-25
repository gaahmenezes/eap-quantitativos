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
| F6 | Documento de origem como arquivo anexado | Concluída na F9 | `io.test.ts`, E2E F9 |
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
| F9 | Upload seguro: assinatura do conteúdo, limite de tamanho, zip bomb, nome aleatório fora da raiz pública, download protegido | Concluída | `io.test.ts` (domínio e API) |
| F9 | Importação em 9 etapas com área de preparação, mapeamento sugerido e validação; nada gravado antes da confirmação | Concluída | `io.test.ts`, E2E |
| F9 | Importação de serviços (catálogo e do empreendimento), cadastro físico (hierarquia, novo módulo, ciclos) e medições (dupla contagem no banco e no arquivo) | Concluída | `io.test.ts` |
| F9 | Exportações XLSX/CSV/PDF de cadastro, EAP, serviços, quantitativos, memórias, consolidação (atual e de revisão) e comparação | Concluída | `io.test.ts` (todos os relatórios × formatos) |
| F9 | Exportar → reimportar preserva códigos e quantidades | Concluída | `io.test.ts` (medições e cadastro), E2E |
| F9 | Neutralização de injeção de fórmula em CSV e XLSX | Concluída | `io.test.ts` |
| F10 | Qualidade e preparação para produção | Planejada | ver plano, seção 10 |
| F10 | Motor de fichas no domínio: colunas digitadas/calculadas, parâmetros, tabelas de consulta, `se()`, contas na célula, validação estática de grandezas e ciclos | Concluída | `packages/domain/src/sheet/engine.test.ts` (valores das planilhas SMR I e Viva Mais Barra) |
| F10 | Modelos de ficha versionados (rascunho, publicação imutável, nova versão, descarte, arquivamento) e 6 modelos iniciais | Concluída | `apps/api/test/sheets.test.ts`; tela Modelos de ficha; E2E F10 |
| F10 | Fichas do empreendimento: grade com cálculo ao vivo, teclado, colar da planilha, parâmetros, destino (EAP + âncora), serviço por saída | Concluída | `sheets.test.ts`, E2E F10, revisão visual |
| F10 | Lançamento em medições (método Ficha) com memória por linha, revisão só no que mudou, arquivamento de saídas removidas, dupla contagem e vínculo automático serviço × item | Concluída | `sheets.test.ts` (tipologia × 60 casas), E2E F10 |
| F10 | Medição de ficha bloqueada para revisão manual; arquivar ficha arquiva seus quantitativos; isolamento entre organizações e papéis | Concluída | `sheets.test.ts` |
| F11 | Cálculo dos quadros no domínio: contagem, conversão de unidade, contagem × L × A, quadro de resumo por serviço × destino | Concluída | `packages/domain/src/schedule/schedule.test.ts` (Esquadrias AL, hidráulica e elétrica da planilha Viva Mais Barra) |
| F11 | Quadros no empreendimento: destinos (EAP + âncora, × unidades da tipologia), itens com até 3 serviços, gravação da grade com If-Match, lista padrão copiada de outro quadro | Concluída | `apps/api/test/schedules.test.ts` |
| F11 | Lançamento em medições (método Quadro) com memória por item, revisão só no que mudou, arquivamento do que saiu, dupla contagem; mecanismo comum com as fichas | Concluída | `schedules.test.ts`, `sheets.test.ts` |
| F11 | Tela de quadros: grade matricial, colar da planilha, seletor de serviço, quadro de resumo com total da obra, memória na tela de quantitativos | Concluída | E2E F11, revisão visual |
| F11 | Isolamento (outra organização 404, leitor 403), quadro não apagado, arquivar arquiva quantitativos | Concluída | `schedules.test.ts` |
| F12 | Extrato das abas (valores e fórmulas como texto, mescladas, limites), sem executar fórmulas | Concluída | `apps/api/test/workbooks.test.ts`; ensaio com as 3 planilhas reais |
| F12 | Sugestões por aba: destino, cabeçalho, colunas por rótulo/sinônimo, unidade pelo conteúdo, par "L x A", conferência | Concluída | `packages/domain/src/migration/workbook.test.ts` |
| F12 | Montagem de fichas e quadros: conta na célula preservada, unidade da coluna convertida, totais/títulos ignorados, origem por célula | Concluída | `workbook.test.ts`, `workbooks.test.ts` |
| F12 | Conferência linha a linha contra a planilha (fichas pelo motor; quadros × repetições) | Concluída | `workbook.test.ts` (Cerâmica MAT, drenagem SMR I, hidráulica), E2E F12 |
| F12 | Assistente por aba (pré-visualização, mapeamento, verificação), aplicação transacional e relatório; nada lançado em quantitativos; isolamento | Concluída | `workbooks.test.ts`, E2E F12 |
| F12 | Modelo CER: revestimento paginado passa a usar peças × dimensões (divergência revelada pela conferência) | Concluída | `engine.test.ts` |
| F13 | Destino por linha nas fichas: uma medição por saída × destino, memória por destino, dupla contagem entre destinos | Concluída | `apps/api/test/sheet-rows.test.ts`, E2E F13 |
| F13 | Fila de trabalho: tarefas vinculadas, responsável/revisor com edição, prazo, fluxo com revisão, transições auditadas, "Minhas tarefas" | Concluída | `apps/api/test/tasks.test.ts`, E2E F13 |
| F13 | Centro operacional: pendências com motivos, cobertura da EAP por grupo, vínculos sem medição, fórmulas desatualizadas, alterações desde a última revisão, tarefas e atividade | Concluída | `apps/api/test/operations.test.ts`, E2E F13, revisão visual |

## Contagem de testes (última execução)
- `packages/domain`: 151 · `apps/api` (integração, Postgres real): 181 · `apps/web` (componentes e modelo da árvore): 8 · E2E Playwright: 16
