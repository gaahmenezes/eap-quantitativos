# ADR-008 — Versões publicadas imutáveis

**Status:** Aceita · **Data:** 2026-11-23

## Contexto
Templates de EAP, tipologias e fórmulas evoluem, mas empreendimentos já gerados e medições históricas não podem mudar retroativamente.

## Decisão
Versões publicadas (WbsTemplateVersion, TypologyRevision, FormulaVersion) e MeasurementRevision são imutáveis (bloqueio em serviço + trigger). Edição sempre cria nova versão rascunho. Projetos/unidades/medições referenciam a versão usada.

## Consequências
+ Reprodutibilidade e auditoria. − Propagação exige fluxo explícito com prévia.
