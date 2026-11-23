# ADR-002 — Pacotes domain e contracts

**Status:** Aceita · **Data:** 2026-11-23

## Contexto
A inteligência do produto (fórmulas, unidades, geração/diff de EAP, consolidação, resolução de tipologias) precisa ser testada com resultados conhecidos, isolada de banco e HTTP.

## Decisão
`packages/domain`: TypeScript puro, única dependência externa decimal.js. `packages/contracts`: schemas zod dos DTOs, usados pelo pipe de validação da API e pelos formulários/cliente do web. Nenhum outro pacote compartilhado sem necessidade demonstrada.

## Consequências
+ Testes rápidos e determinísticos; mesma validação nos dois lados. − Build de pacotes internos precisa ser mantido (TS project references / exports de fonte).
