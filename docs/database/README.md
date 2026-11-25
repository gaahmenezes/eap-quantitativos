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

## Tabelas (F3 — catálogo, infraestrutura e construtivo)
| Tabela | Finalidade | Restrições relevantes |
|---|---|---|
| `infrastructure_system_type` | Catálogo da organização: tipos de sistema (drenagem, água…), `networkBased` | `UNIQUE(organizationId, code)` — ADR-012 |
| `element_type` / `element_attribute_definition` | Catálogo: tipos de elemento (domínio INFRA/CONSTRUTIVO, categoria dispositivo/trecho/elemento) e atributos (tipo, unidade, obrigatório, opções, limites) | FK composta para o sistema da mesma organização |
| `infrastructure_system` | Sistema no empreendimento, com abrangência opcional no cadastro | FK composta para projeto e para tipo da organização |
| `infrastructure_network` | Rede de um sistema | `UNIQUE(systemId, code)` |
| `network_node` | Dispositivo (PV, BL, registro, poste…): cotas de tampa e fundo `NUMERIC(10,3)`, localização no cadastro, atributos JSONB validados | `UNIQUE(networkId, code)` |
| `network_segment` | Trecho PV a PV: comprimento `NUMERIC(12,3)` m, DN `NUMERIC(8,1)` mm, material, cotas de fundo, rua/trecho de rua | FKs compostas `(fromNodeId, networkId)` e `(toNodeId, networkId)` ⇒ extremidades na mesma rede; CHECK extremidades distintas, comprimento > 0 |
| `physical_element` | Elemento avulso: de um sistema sem rede (pavimento, guia, terraplenagem) e/ou localizado num nó do cadastro (área comum, rua) | CHECK sistema ou local obrigatório |
| `typology_revision` | Revisão da tipologia (DRAFT/PUBLISHED) | publicada imutável e não apagável (trigger); um DRAFT por tipologia (índice parcial) |
| `typology_element` | Elemento da revisão com `stableKey` e hierarquia | pai na mesma revisão (FK composta); imutável quando a revisão é publicada (trigger) |
| `unit_override` | Particularidade da unidade (excluir elemento / incluir elemento) | formato por operação (CHECK); só arquivamento permitido (trigger) — ADR-013 |
| `dwelling_unit.pinnedRevisionId` | Revisão publicada que vale para a unidade | trigger: revisão publicada da própria tipologia |

A declividade e as profundidades dos trechos não são armazenadas: são derivadas em decimal (`packages/domain/src/infra/segment.ts`) a partir das cotas, para nunca divergirem dos dados de origem.

## Tabelas (F4 — unidades e biblioteca de serviços)
| Tabela | Finalidade | Restrições relevantes |
|---|---|---|
| `unit_of_measure` | Unidade da organização: símbolo, nome, expoentes `dimL/dimM/dimT/dimN`, fator `NUMERIC(40,30)` para a base, casas decimais | `UNIQUE(organizationId, symbol)`; fator > 0; expoentes em [-4, 4]; dimensão e fator imutáveis quando usada (trigger) — ADR-014 |
| `service_category` | Árvore de categorias da biblioteca | `UNIQUE(organizationId, code)`; pai na mesma organização (FK composta); sem auto-referência |
| `service` | Serviço técnico: código, descrição (e descrição normalizada), categoria, unidade, critério de medição, descrição técnica, origem, `derivedFromId` | código único no catálogo (`projectId IS NULL`) e por empreendimento (índices parciais); índice GIN `pg_trgm` na descrição normalizada; FKs compostas por organização; **nenhum campo financeiro** |

## Tabelas (F5 — templates e EAP)
| Tabela | Finalidade | Restrições relevantes |
|---|---|---|
| `wbs_template` | Template de EAP da organização: código, nome, tipos de módulo a que se aplica | `UNIQUE(organizationId, code)`; arquivamento em vez de exclusão |
| `wbs_template_version` | Versão numerada (`DRAFT`/`PUBLISHED`) | `UNIQUE(templateId, number)`; um único rascunho por template (índice parcial); `publishedAt` obrigatório quando publicada; **versão publicada imutável** (trigger) — ADR-015 |
| `wbs_template_node` | Nó do template: `stableKey`, título com variáveis, tipo, condição, repetição, serviços sugeridos | `UNIQUE(versionId, stableKey)`; pai na mesma versão (FK composta); inclusão/alteração/exclusão bloqueadas em versão publicada (trigger) |
| `wbs_node` | Nó da EAP do empreendimento (independente do cadastro físico; vínculo opcional por `bindingKind/bindingId`) | pai no mesmo empreendimento (FK composta); `generationKey` única por empreendimento (índice parcial) e presente só em nós `GENERATED` (CHECK); posição ≥ 1; sem auto-referência; caminho materializado e código derivado |
| `wbs_node_service` | Serviços vinculados a um item da EAP; `fromTemplate` distingue sugestão do template de escolha manual | PK `(wbsNodeId, serviceId)`; serviço da mesma organização (FK composta) |
| `wbs_generation_run` | Registro de cada geração aplicada: seleções (módulo → versão), hash dos fatos e do resultado, resumo do diff | por empreendimento (FK composta); somente inclusão |

## Tabelas (F6 — fórmulas, medições e memórias)
| Tabela | Finalidade | Restrições relevantes |
|---|---|---|
| `formula` | Fórmula da organização: código, nome, descrição | `UNIQUE(organizationId, code)`; arquivamento |
| `formula_version` | Versão numerada: expressão, variáveis (JSONB validado pelo domínio), grandeza do resultado | `UNIQUE(formulaId, number)`; um rascunho por fórmula (índice parcial); `publishedAt` ⇔ publicada; **versão publicada imutável e não apagável** (trigger) — ADR-016 |
| `measurement` | Item da EAP × serviço × uma âncora; quantidade vigente | FKs compostas por empreendimento para item, âncoras e unidade, e por organização para o serviço; **exatamente uma âncora coerente com `anchorKind`** (CHECK); item, serviço e âncora imutáveis e exclusão física proibida (trigger) |
| `measurement_revision` | Memória de cálculo: método, versão da fórmula, entradas, memória (JSONB), quantidade `NUMERIC(28,10)`, unidade, documento de origem, motivo | `UNIQUE(measurementId, number)`; método FORMULA ⇔ versão informada; motivo obrigatório a partir da R2; só versão **publicada** de fórmula (trigger); **somente inclusão** (trigger) |

Também foram acrescentados `UNIQUE(id, projectId)` em `network_node`, `network_segment` e `physical_element` para as FKs compostas das âncoras.

## F7 — consolidação
Sem tabelas novas. A consolidação é uma consulta (`apps/api/src/modules/consolidation/sql.ts`) sobre `measurement`, `measurement_revision`, `dwelling_unit`, `typology_element`, `unit_override`, `structure_node`, `wbs_node` e infraestrutura, em transação somente leitura (ADR-017). Usa o índice único `typology_element(revisionId, stableKey)` para verificar o elemento na revisão fixada de cada unidade.

## Tabelas (F8 — revisões do empreendimento)
| Tabela | Finalidade | Restrições relevantes |
|---|---|---|
| `project_revision` | Revisão emitida: número, código (R00…), título, observações, resumo, emitente | `UNIQUE(projectId, number)`; código coerente com o número (CHECK); **imutável e não apagável** (trigger) — ADR-018 |
| `revision_wbs_node` / `revision_structure_node` | Nós da EAP e do cadastro como estavam | PK `(revisionId, id do nó)`; imutáveis; só gravados na transação da emissão |
| `revision_measurement` | Medição congelada → `measurement_revision` vigente (memória), multiplicador e total efetivo | FK para a revisão de medição imutável; imutável |
| `revision_line` | Linhas efetivas com as colunas de dimensão da consolidação | índice por revisão; imutável |
| `revision_label` | Rótulo (código e nome) de cada entidade referenciada, na emissão | PK `(revisionId, entityId)`; imutável |

## Tabelas (F9 — arquivos e importação)
| Tabela | Finalidade | Restrições relevantes |
|---|---|---|
| `document` | Arquivo enviado: nome original, tipo verificado pela assinatura, MIME, tamanho, SHA-256, chave de armazenamento aleatória | tipo em XLSX/CSV/PDF/PNG/JPEG e tamanho > 0 (CHECK); `UNIQUE(storageKey)`; **imutável** (trigger) — ADR-019 |
| `import_job` | Importação em etapas: tipo, arquivo, abas, cabeçalhos, mapeamento, resumo, situação | encerrada (aplicada/cancelada) não muda (trigger); bloqueio otimista por `version` |
| `import_row` | Área de preparação: valores brutos, situação da validação, mensagens e dados normalizados | PK `(jobId, rowNumber)`; apagada ao cancelar |

Também: `measurement_revision.documentId` (arquivo de origem, FK por organização) e o método `IMPORTED` em `MeasurementMethod`.

## Tabelas (F10 — fichas de levantamento)
| Tabela | Conteúdo | Regras no banco |
|---|---|---|
| `sheet_template` | Modelo de ficha da organização (código, nome) | `UNIQUE(organizationId, code)`; FK composta para versões |
| `sheet_template_version` | Definição (colunas, parâmetros, tabelas, saídas) em JSONB, validada pelo domínio na publicação | `UNIQUE(templateId, number)`; um único rascunho por modelo (índice parcial); **publicada é imutável** (trigger) |
| `sheet` | Ficha do empreendimento: versão do modelo, destino (item da EAP + âncora com FKs compostas por empreendimento), parâmetros, serviço por saída, linhas (JSONB), impressão digital do último lançamento | só versão **publicada** do modelo (trigger); âncora nenhuma ou exatamente uma (CHECK); **não é apagada** (trigger) |

Também: `measurement.sheetId` + `sheetOutputKey` (origem da medição; imutáveis por trigger; uma medição **ativa** por saída — índice único parcial) e o método `SHEET` em `MeasurementMethod`.

## Tabelas (F11 — quadros de componentes e materiais)
| Tabela | Conteúdo | Regras no banco |
|---|---|---|
| `schedule` | Quadro do empreendimento (tipo, título, impressão digital do último lançamento) | **não é apagado** (trigger); lançamento coerente (CHECK) |
| `schedule_column` | Destino: chave, nome, item da EAP e âncora | FKs compostas por empreendimento; âncora nenhuma ou exatamente uma (CHECK); `UNIQUE(scheduleId, key)` |
| `schedule_row` | Item: Id, descrição, especificação, unidade, largura/altura `NUMERIC(12,4)`, quantidades por destino (JSONB) | FK de unidade por organização; L/A > 0 (CHECK); `UNIQUE(scheduleId, key)` |
| `schedule_row_service` | Serviços do item (ordem) | FK de serviço por organização |

Também: `measurement.scheduleId` + `scheduleKey` (imutáveis por trigger; uma medição **ativa** por chave — índice parcial; origem única: ficha **ou** quadro — CHECK) e o método `SCHEDULE`.

## Tabelas (F12 — migração de planilhas)
| Tabela | Conteúdo | Regras no banco |
|---|---|---|
| `workbook_import` | Migração: documento XLSX de origem, plano por aba (JSONB), relatório da aplicação, situação | FK composta para empreendimento e documento; não é apagada; aplicada/cancelada não muda (trigger) |
| `workbook_import_sheet` | Extrato de cada aba: valores e texto das fórmulas (JSONB), linhas, colunas, truncada | FK composta por organização; **imutável** (trigger) |
