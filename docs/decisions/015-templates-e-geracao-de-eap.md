# ADR-015 — Templates de EAP versionados e geração determinística por diff

**Status:** Aceita · **Data:** 2026-11-24

## Contexto
A EAP precisa nascer do cadastro físico (torres, pavimentos, tipologias, quadras, ruas, sistemas, redes) sem IA generativa e sem vínculo por nome, ser reproduzível e poder ser regenerada depois de mudanças no cadastro ou no template sem destruir edições manuais nem (a partir da F6) nós com quantitativos.

## Decisão
- **Template** por organização, com tipos de módulo a que se aplica e **versões** (`DRAFT` → `PUBLISHED`). Versão publicada é imutável (triggers em versão e nós); há no máximo um rascunho por template. Nova versão copia a última publicada preservando o `stableKey` de cada nó.
- **Nó de template**: título com variáveis (`{torre.nome}`, `{qtd.unidades}`…), tipo `GROUP`/`ITEM`, **repetição** sobre um escopo do cadastro (torre, pavimento, tipologia presente, quadra, rua, trecho de rua, sistema, rede, área comum, fase) e **condição** opcional escrita na linguagem segura de expressões (`packages/domain/src/expression`: parser Pratt próprio, operadores `e/ou/não`, tipos estritos, sem `eval`). Itens podem sugerir serviços do catálogo (por ID).
- **Geração** (`generateWbs`, função pura): fatos do empreendimento ordenados por posição e ID → árvore desejada com `generationKey = templateId:moduleId:stableKey + cadeia de IDs das repetições`. Mesmos fatos + mesmas versões ⇒ mesmo hash (FNV-1a 64 bits).
- **Regeneração** (`diffWbs`): compara a EAP existente com a desejada pela `generationKey`: cria, atualiza (preservando ID), mantém, remove ou marca **OBSOLETE** quando o nó está protegido (filhos manuais, serviços alterados à mão; na F6, medições). Título ou posição editados à mão (`titleOverridden`, `placementOverridden`) são respeitados; nós `MANUAL` nunca são tocados.
- **Prévia obrigatória**: `preview` devolve o plano e um `planHash`; `apply` recalcula e recusa (409 `PLAN_CHANGED`) se o cadastro, a EAP ou os templates mudaram desde a prévia. Cada aplicação grava `WbsGenerationRun` (versões usadas, hash dos fatos e do resultado, resumo) e auditoria na mesma transação.
- Publicar nova versão de template **não altera** empreendimentos: a tela da EAP indica que há versão mais nova, e a adoção acontece só numa regeneração com prévia.

## Consequências
+ EAP reproduzível e auditável; regeneração incremental (incluir uma torre mostra apenas os nós novos).
+ Edições manuais convivem com a geração automática sem serem sobrescritas.
− `generationKey` depende do `stableKey`: renomear a chave de um nó num template equivale a remover e criar (por isso ela não é editável na interface).
− Nós obsoletos exigem decisão do usuário (arquivar ou manter); não há remoção automática de nada protegido.
