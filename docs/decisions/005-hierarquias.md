# ADR-005 — Hierarquias: adjacência + caminho materializado; código derivado

**Status:** Aceita · **Data:** 2026-11-23

## Contexto
Cadastro físico e EAP são árvores profundas e editáveis; códigos hierárquicos (01.02.003) mudam quando nós são movidos, mas vínculos não podem mudar.

## Decisão
Cada nó tem id estável (UUID), parentId, position e `path` (IDs dos ancestrais). O código hierárquico é derivado da posição e gravado apenas como coluna de leitura, recalculado para a subárvore na mesma transação de mover/reordenar. Códigos nunca são chaves.

## Consequências
+ Consultas de subárvore por prefixo de path indexado; vínculos estáveis. − Mover nó grande reescreve path/código da subárvore (aceitável).
