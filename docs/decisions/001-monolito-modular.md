# ADR-001 — Monólito modular em monorepo pnpm

**Status:** Aceita · **Data:** 2026-11-23

## Contexto
Produto com um único time, um banco e domínio fortemente relacionado (cadastro físico, EAP, serviços, quantitativos).

## Decisão
Uma API NestJS e uma SPA React no mesmo monorepo pnpm, com módulos de domínio separados por pasta. Sem microsserviços.

## Consequências
+ Transações ACID entre módulos, deploy simples, refatoração barata. − Disciplina de fronteiras de módulo depende de convenção e revisão; reavaliar se algum módulo exigir escala independente.
