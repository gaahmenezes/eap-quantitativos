# ADR-016 — Medições com âncora única, memória de cálculo append-only e disjunção por cobertura

**Status:** Aceita · **Data:** 2026-11-24

## Contexto
Quantitativos precisam ser reproduzíveis (memória de cálculo), nunca contados em dobro, replicados por tipologia sem perder as particularidades de cada unidade, e não podem mudar sozinhos quando uma fórmula evolui. Nada financeiro.

## Decisão
- **Fórmula** por organização com **versões** (`DRAFT` → `PUBLISHED` imutável por trigger). A versão guarda a expressão e as variáveis (símbolo, descrição, unidade de referência, restrição > 0 / ≥ 0). Avaliação só pelo parser próprio (ADR-004), em decimal de 34 dígitos; resultado com até 10 casas (`NUMERIC(28,10)`).
- **Análise dimensional** antes de avaliar: soma, subtração, min e max exigem a mesma grandeza; potência de grandeza só com expoente inteiro constante; `round/ceil/floor` só em valores adimensionais; constantes são adimensionais. **Contagem (un, pç) é tratada como adimensional** (5 portas × 1,68 m² = 8,40 m²). A grandeza do resultado precisa ser a da unidade do serviço. Compatibilidade fórmula × serviço é **derivada da grandeza** (sem tabela de vínculo).
- **Medição** = item da EAP (`ITEM`) × serviço vinculado ao item × **uma âncora** (CHECK no banco): nó do cadastro, trecho, dispositivo, elemento físico ou elemento de tipologia (`typologyId` + `elementKey`, opcionalmente só de uma unidade). Âncora, item e serviço não mudam (trigger); medição não é apagada (arquivamento).
- **Memória de cálculo** = `measurement_revision`, somente inclusão (trigger): método, versão da fórmula, entradas originais, conversões para a base, expressão substituída, resultado, documento de origem, motivo (obrigatório a partir da R2), autor e data.
- **Sem dupla contagem (RN-DUP)**: cada âncora vira um conjunto de caminhos hierárquicos (cadastro, `pe:`, `net:/seg:`, `te:` de tipologia por unidade). Para o mesmo item × serviço, uma medição nova é recusada (409 `MEASUREMENT_OVERLAP`) se algum caminho dela for igual, ancestral ou descendente de um caminho existente. Gravações de medição e da EAP usam o mesmo lock consultivo por empreendimento.
- **Tipologia (RN-TIP)**: medição de elemento de tipologia vale para cada unidade da tipologia cuja revisão fixada + particularidades contém o elemento; a medição própria de uma unidade **substitui** a da tipologia para aquela unidade (nunca soma); excluir o elemento por particularidade tira a unidade da conta; unidades sem revisão fixada geram aviso.
- **Fórmula nova não recalcula nada**: medições com versão antiga aparecem como "fórmula desatualizada" e o recálculo é uma nova revisão feita pelo usuário.
- Itens da EAP com medição ativa ficam protegidos: não são excluídos, o serviço medido não é desvinculado e, na regeneração, o item vira `OBSOLETE` em vez de ser removido.

## Consequências
+ Toda quantidade é rastreável até as entradas e a versão da fórmula. + Consolidação (F7) parte de linhas efetivas já sem sobreposição.
− Constantes com unidade precisam ser declaradas como variável (ex.: folga de 0,10 m).
− O documento de origem é por enquanto uma referência textual; anexar arquivos fica para a F9 (importação/arquivos).
