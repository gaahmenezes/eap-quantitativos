# ADR-003 — PostgreSQL 16 + Prisma 7 estável + SQL nas migrações

**Status:** Aceita · **Data:** 2026-11-23

## Contexto
Necessidade de integridade referencial forte, NUMERIC, CHECKs, índices parciais, triggers de auditoria. Em nov/2026 a tag latest do Prisma aponta para 8.0.0-rc (release candidate).

## Decisão
PostgreSQL 16 com Prisma 7.10.x (estável, fixado). Restrições que o Prisma não expressa (CHECK de âncora exclusiva, FKs compostas especiais, triggers append-only, pg_trgm) entram como SQL nas migrações versionadas. `$queryRawUnsafe` proibido; consultas raw só com template tag parametrizado.

## Consequências
+ Tipagem e migrações gerenciadas. − Parte das regras vive em SQL; deve ser coberta por testes de integração.
