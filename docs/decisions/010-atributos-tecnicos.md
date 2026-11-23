# ADR-010 — Atributos técnicos: colunas tipadas + JSONB validado

**Status:** Aceita · **Data:** 2026-11-23

## Contexto
Cada sistema de infraestrutura e cada tipo de elemento tem atributos diferentes; novos sistemas devem ser adicionados sem migração; EAV genérico é proibido.

## Decisão
Atributos centrais de redes (comprimento, diâmetro, material, profundidades, cotas, declividade) são colunas tipadas NUMERIC. Atributos adicionais ficam em JSONB validado no backend contra as ElementAttributeDefinition do ElementType (tipo, dimensão, obrigatoriedade, enum).

## Consequências
+ Extensível e validado. − Consultas sobre atributos extras são menos eficientes; promover a coluna se virar filtro frequente.
