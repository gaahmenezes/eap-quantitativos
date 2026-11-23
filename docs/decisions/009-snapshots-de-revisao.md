# ADR-009 — Revisões como snapshots normalizados

**Status:** Aceita · **Data:** 2026-11-23

## Contexto
Relatórios de revisões emitidas (R00, R01…) devem permanecer estáveis e comparáveis.

## Decisão
Ao emitir revisão, gravar tabelas revision_* com cópia dos nós de EAP e cadastro e referências às MeasurementRevision imutáveis vigentes. Comparação por SQL entre snapshots.

## Consequências
+ Relatórios históricos estáveis, diff consultável. − Armazenamento cresce linearmente com revisões (aceitável).
