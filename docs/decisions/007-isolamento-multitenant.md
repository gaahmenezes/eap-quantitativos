# ADR-007 — Isolamento por organização com FKs compostas

**Status:** Aceita · **Data:** 2026-11-23

## Contexto
Dados de organizações diferentes nunca podem se misturar, nem por bug de aplicação.

## Decisão
Toda tabela de tenant tem organizationId. Tabelas referenciadas expõem UNIQUE(id, organizationId) e as filhas referenciam (xId, organizationId). Os serviços resolvem o contexto (org, projeto, papel) antes de qualquer acesso e consultam sempre filtrando por organizationId. Recurso de outra org ⇒ 404. RLS do PostgreSQL será avaliado na Fase 10 como defesa adicional.

## Consequências
+ Banco impede vínculos cruzados. − Chaves compostas aumentam verbosidade do schema.
