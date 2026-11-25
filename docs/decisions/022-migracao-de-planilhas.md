# ADR-022 — Migração das planilhas de levantamento

**Status:** Aceita · **Data:** 2026-11-25

## Contexto
Os levantamentos existentes vivem em pastas de trabalho com dezenas de abas (Viva Mais Barra: 105; Reserva Marupi: 113; SMR I: 11). Cada aba é uma disciplina: cerâmica, concreto, telhado, esquadrias, hidráulica… Há títulos mesclados, cabeçalho na 3ª/4ª linha, linhas de total/SUBTOTAL, blocos lado a lado, entradas digitadas como conta (`=29.11+53.35+…`), colunas calculadas e colunas de custo. Aposentar as planilhas exige trazê-las para fichas (ADR-020) e quadros (ADR-021) **e provar que nada mudou** no caminho.

## Decisão
- **Envio**: o XLSX passa pelas verificações de arquivo da F9 (assinatura, tamanho, zip bomb) e fica como documento do empreendimento. Cada aba vira um **extrato** imutável (`workbook_import_sheet`, trigger): valor calculado e texto da fórmula de cada célula, **sem executar fórmulas**. Células mescladas: só a mestre. Limites: 200 abas, 3.000 linhas e 60 colunas por aba.
- **Plano por aba** (`workbook_import.plan`, validado pelo contrato): ignorar, ficha (modelo publicado) ou quadro (tipo); linha do cabeçalho, primeira e última linha de dados; mapeamento coluna da planilha → campo, com a **unidade da coluna** (ex.: peça em m na planilha, cm no modelo); parâmetros; colunas de **conferência**.
- **Sugestões** (domínio puro, `migration/workbook.ts`): destino pelo nome da aba e pelos cabeçalhos (aba de rede com "und" + "quantidade" é lista de materiais); cabeçalho = linha com mais rótulos distintos seguida de números; colunas pelos rótulos e sinônimos (pontuação mínima); unidade detectada pelo conteúdo ("Dimensão" com m/und); par "L x A" em três colunas; conferência só em coluna com números e cabeçalho bem parecido. Tudo é sugestão: o usuário confere e corrige.
- **Montagem**: conta simples na célula (só números e + − × ÷) vira a conta da ficha (memória preservada); fórmula com referências usa o valor gravado (sem ruído de ponto flutuante); linhas de total, de título de grupo e vazias são ignoradas e listadas; opções normalizadas (sim → Sim); cada célula montada guarda a **referência de origem** (`Cerâmica MAT!C6`).
- **Conferência**: o motor das fichas recalcula cada linha e compara com a coluna da planilha (tolerância 0,001 ou 1 milionésimo); quadros comparam quantidade × nº de repetições com a coluna de total da obra. A tela mostra totais e as linhas divergentes com Δ.
- **Aplicar** cria, numa transação, as fichas e os quadros (com o documento de origem e a referência "arquivo › aba"), audita cada criação e grava o relatório (o que foi criado, linhas, ignoradas, conferência). **Nada é lançado em quantitativos**: destino (EAP + âncora) e serviços dos quadros são escolhidos depois, com as regras de sempre. Migração aplicada ou cancelada não muda (trigger).
- Colunas de custo/preço/INCC simplesmente não são mapeadas (fora do escopo).

## Consequências
+ Cada planilha antiga entra com rastreio de célula e uma prova numérica de equivalência; divergências viram decisão explícita (modelo errado, coluna errada ou erro da planilha).
+ Ensaio com as três planilhas reais: leitura em ~1 s; 60/55/3 abas com destino sugerido; na "Cerâmica MAT" o mapeamento sugerido gera 12 linhas e o total com perda (92,44158 m²) confere com a planilha.
− Abas com estrutura própria (dois blocos lado a lado, cálculos que não existem nos modelos) exigem ajuste do mapeamento ou um modelo de ficha novo.
− A migração cria registros novos; não atualiza fichas já existentes.
