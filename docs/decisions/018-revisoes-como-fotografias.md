# ADR-018 — Revisões do empreendimento como fotografias imutáveis

**Status:** Aceita · **Data:** 2026-11-24 · Detalha o ADR-009.

## Contexto
Entregas formais (projeto legal, executivo…) precisam de uma base congelada: relatórios de uma revisão emitida não podem mudar quando o empreendimento continua sendo editado, e as alterações entre revisões precisam ser listadas com deltas exatos.

## Decisão
- **Emissão** (`project_revision`, numeração R00, R01… sequencial por empreendimento) grava, numa única transação e sob o mesmo lock da EAP e das medições:
  - nós ativos da EAP e do cadastro físico (código, título/nome, hierarquia);
  - medições vigentes, cada uma **apontando para a revisão de medição imutável** (memória de cálculo) em vigor, com multiplicador e total efetivo;
  - **linhas efetivas** da consolidação (mesma consulta do ADR-017), com todas as colunas de dimensão;
  - **rótulos** de tudo o que é referenciado, como eram na emissão;
  - resumo (contagens e totais por unidade) e auditoria.
- Fotografias são **imutáveis** (triggers bloqueiam UPDATE/DELETE) e só podem ser gravadas na transação que cria a revisão (trigger compara `xmin`).
- **Consultas sobre uma revisão** usam as mesmas rotas de consolidação e detalhamento, com `revisionId`; lêem só a fotografia.
- **Comparação** revisão × revisão ou revisão × estado atual, por ids estáveis (função pura no domínio): quantitativos por item da EAP × serviço com delta (depois − antes), medições incluídas/excluídas/alteradas (com número da revisão da medição), nós da EAP e do cadastro incluídos/excluídos/alterados.
- Emitir exige a permissão `project.revisions.issue` (coordenador do empreendimento ou administrador da organização).
- Histórico por entidade: a auditoria do empreendimento aceita filtro por entidade e aparece nas medições e nos nós da EAP.

## Consequências
+ Relatórios de revisões emitidas são estáveis e auditáveis; comparação sem recalcular o passado.
− Cada revisão ocupa espaço proporcional às linhas efetivas (ex.: 200 mil linhas por revisão num empreendimento grande). Limpeza não existe por definição (imutável); arquivamento fora do banco fica para avaliação na F10.
