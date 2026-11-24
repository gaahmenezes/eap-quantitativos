# ADR-013 — Revisões de tipologia, unidade fixada e propagação explícita

**Status:** Aceita · **Data:** 2026-11-24

## Contexto
Uma tipologia (ex.: casa tipo A) é compartilhada por dezenas de unidades. Mudanças na tipologia não podem sobrescrever silenciosamente as unidades nem apagar suas particularidades.

## Decisão
- Elementos da tipologia vivem em `typology_revision`; há no máximo um rascunho por tipologia; revisões publicadas são imutáveis (trigger). Cada elemento tem `stableKey`, preservado entre revisões.
- Cada unidade guarda `pinnedRevisionId`: a revisão publicada que vale para ela. Publicar uma nova revisão não altera unidades.
- Atualizar unidades é uma ação explícita (propagação) com prévia: unidades pendentes, particularidades e conflitos. Unidades com particularidades em conflito só são atualizadas com confirmação.
- Particularidades (`unit_override`: excluir elemento da tipologia ou incluir elemento próprio) são append-only: só podem ser arquivadas com motivo (trigger impede apagar/alterar). A estrutura efetiva da unidade é calculada por `resolveUnitElements` (domínio puro). Quando o alvo de uma particularidade some numa nova revisão, ela fica sinalizada como órfã, nunca removida.
- Unidade criada ou com tipologia trocada manualmente passa a seguir a última revisão publicada (ação explícita do usuário sobre aquela unidade).

## Consequências
+ Rastreabilidade completa e nenhuma perda de particularidade. + Base pronta para medições por tipologia × unidade (F6).
− O usuário precisa executar a propagação; a UI destaca as unidades pendentes.
