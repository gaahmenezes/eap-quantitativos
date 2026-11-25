# ADR-020 — Fichas de levantamento (planilhas de quantitativos digitalizadas)

**Status:** Aceita · **Data:** 2026-11-25

## Contexto
A rotina de levantamento é: ler o projeto e preencher planilhas por disciplina (cerâmica por ambiente, área de parede, fôrma e concreto, aço por bitola/tela, redes enterradas por trecho, telhado…). Cada planilha tem colunas digitadas, colunas calculadas, constantes (perdas, transpasse, profundidade padrão) e tabelas de consulta (DN → largura de vala, bitola → kg/m). As medições da F6 (uma quantidade por âncora) não substituem essas planilhas: o engenheiro precisa digitar dezenas de linhas, conferir cada uma e só então obter o quantitativo.

## Decisão
- **Modelo de ficha** (`sheet_template` / `sheet_template_version`) por organização, versionado como fórmulas: rascunho editável, **publicação imutável** (trigger), uma única versão em rascunho. A definição (`SheetDef`) tem:
  - colunas **digitadas** (número com unidade, texto ou opções; obrigatória; valor padrão) e **calculadas** (expressão no parser seguro do ADR-004);
  - **parâmetros** nomeados com unidade (ex.: perda 5 %, transpasse 3,1 %), que a ficha do empreendimento pode sobrepor;
  - **tabelas de consulta** (`tabela("chave"; valor)`, busca exata ou por faixa, chave em texto ou número com unidade);
  - **saídas**: cada saída soma uma coluna numérica em todas as linhas e vira um quantitativo; pode sugerir um serviço pelo código.
- O motor (`packages/domain/src/sheet`) é puro e o **mesmo no navegador e no servidor**: validação estática (chaves, ciclos entre colunas, grandezas em soma/subtração, `se()` com ramos da mesma grandeza, `ceil/floor/round` só em adimensionais, unidade da coluna compatível com o resultado), avaliação decimal na unidade base, erros por linha sem derrubar a ficha. Célula numérica aceita conta só com números (`30,29+10,68`), como nas planilhas. O literal `0` é compatível com qualquer grandeza (`se(x > 0; x; 0)`). Linha em branco é ignorada.
- **Ficha do empreendimento** (`sheet`): versão publicada do modelo + linhas (JSONB) + parâmetros + **destino** (item da EAP e uma âncora — as mesmas da F6, com FKs compostas) + serviço por saída. Edição com `If-Match`; auditoria registra campos e número de linhas (não o conteúdo inteiro). Fichas não são apagadas (trigger), só arquivadas.
- **Lançar** grava, numa transação com o lock da EAP: para cada saída com serviço, uma medição com `sheetId` + `sheetOutputKey` e método `SHEET`; a quantidade é o total convertido para a unidade do serviço (grandeza incompatível ⇒ 422). Relançar cria **nova revisão** só quando a quantidade ou a contribuição das linhas muda; mudança de destino arquiva a medição anterior e cria outra; saída sem serviço ou zerada arquiva a medição. Linha com erro bloqueia o lançamento inteiro. A regra de **dupla contagem** (RN-DUP) vale como em qualquer medição. O vínculo serviço × item da EAP que faltar é criado e auditado.
- A **memória de cálculo** da revisão guarda o modelo e a versão, a coluna somada e sua expressão, os parâmetros efetivos e o valor de cada linha com sua identificação; `inputs` guarda as linhas e os parâmetros completos. Medição gerada por ficha **não é revisada nem arquivada manualmente** (409 `SHEET_OWNED`): a ficha é a fonte. Uma medição ativa por saída (índice único parcial).
- A ficha registra a impressão digital (SHA-256) do conteúdo no último lançamento; a interface mostra "não lançada", "lançada" ou "alterada — lançar de novo".
- Modelos iniciais (exemplos editáveis) reproduzem as planilhas recebidas: **CER**, **PAREDE**, **CONC**, **ACO**, **REDE**, **TELHADO**. Testes do domínio usam valores das planilhas reais (ex.: drenagem PEAD DN 600 com 184,63 m → escavação 344,1096903222 m³; cerâmica 25,18152 m² com perda de 5 %; aço 8,33 kg e 194,04 kg).
- Ficha de tipologia: âncora em um elemento da tipologia — o total vale para cada unidade vinculada (× n), pela replicação da F6/F7.

## Consequências
+ A planilha de levantamento vira dado estruturado, validado, auditável e ligado à EAP, aos serviços e ao cadastro físico por ID; nenhum cálculo por `eval`.
+ Colar blocos copiados de planilhas existentes preenche a grade (inclusive milhar `1.234,56`), facilitando a migração (F12).
− Uma ficha tem um único destino; fichas com linhas em destinos diferentes (ex.: cada linha num pavimento) ficam para a F13, se a rotina pedir.
− Medir a "unidade inteira" de uma tipologia exige um elemento-raiz na tipologia (ex.: "Apartamento"); âncora coringa ficou registrada no backlog.
