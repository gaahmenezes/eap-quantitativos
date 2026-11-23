# ADR-004 — Parser de fórmulas próprio com análise dimensional

**Status:** Aceita · **Data:** 2026-11-23

## Contexto
Fórmulas de engenharia definidas por usuários precisam ser avaliadas com segurança, precisão decimal e verificação de unidades. eval é inaceitável; bibliotecas genéricas (mathjs) são grandes e já tiveram vulnerabilidades no avaliador.

## Decisão
Parser Pratt próprio em `packages/domain/src/formula`: números, variáveis declaradas, + − * / ^ (expoente inteiro), parênteses e whitelist de funções (min, max, abs, sqrt, round, ceil, floor, pi). Avaliação sobre decimal.js (precisão 34). Cada valor carrega um vetor dimensional; soma/subtração exigem dimensões iguais; resultado deve ter a dimensão da unidade do serviço.

## Consequências
+ Controle total, auditável, testável. − Manutenção da gramática é nossa; extensões exigem testes.
