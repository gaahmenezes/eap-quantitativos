# ADR-017 — Consolidação em SQL validada por uma implementação de referência no domínio

**Status:** Aceita · **Data:** 2026-11-24

## Contexto
Consolidar quantitativos exige somar centenas de milhares de linhas efetivas (medição × unidade em que vale) por dimensões físicas, da EAP e dos serviços, sem dupla contagem, em menos de 2 s (RNF06). Fazer isso em memória na API não escala; fazer só em SQL torna a regra difícil de verificar.

## Decisão
- **Linhas efetivas no banco**: uma consulta com CTEs reproduz a semântica de `expandMeasurements` (ADR-016): medição comum = 1 linha; elemento de tipologia = 1 linha por unidade não arquivada da tipologia cuja revisão fixada contém o elemento e não o exclui (nem um ancestral) por particularidade; medição própria da unidade substitui a geral; elementos incluídos numa unidade valem só nela. A existência do elemento é verificada pelo índice `(revisionId, stableKey)`.
- **Dimensões** (lista fixa, sem identificadores vindos do usuário): níveis 1–3 e item da EAP, serviço, categoria, módulo, fase/etapa/setor/quadra/lote/rua/torre/bloco/pavimento (ancestral da localização física), tipologia, unidade, sistema e rede. Filtros por ids ou "sem valor". Agrupamento sempre separado pela unidade do serviço; quantidades de revisões em outra unidade da mesma grandeza são convertidas pelo fator exato.
- **Referência pura** `consolidate()` em `packages/domain` + montagem das linhas em TypeScript (`reference.ts`). Teste de integração compara SQL × referência em vários agrupamentos e filtros nos cenários B e C.
- **Desempenho**: CTEs pequenas são incorporadas (`NOT MATERIALIZED`) para o planejador usar estatísticas reais; teste com 200.000 linhas efetivas (1.000 unidades × 200 elementos) exige < 2 s por consulta (medido: ~0,5–0,7 s neste ambiente).
- Detalhamento: as mesmas linhas, filtradas pelo grupo, levam à medição e à memória de cálculo.
- Troca da unidade de um serviço medido só para outra unidade da mesma grandeza.

## Consequências
+ Uma única fonte de verdade da regra (domínio), com o SQL verificado contra ela. + Sem tabelas derivadas para manter em sincronia.
− A consulta recalcula tudo a cada pedido; se o volume crescer muito além do testado, avaliar visão materializada atualizada por evento.
− Resultado limitado a 5.000 grupos por consulta (os totais gerais consideram tudo).
