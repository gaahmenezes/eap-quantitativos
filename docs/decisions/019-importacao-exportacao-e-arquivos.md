# ADR-019 — Importação em área de preparação, exportações tabulares e arquivos de origem

**Status:** Aceita · **Data:** 2026-11-24

## Contexto
Os dados hoje vivem em planilhas: é preciso trazê-los (serviços, cadastro físico, medições) sem gravar nada errado, levá-los de volta (XLSX, CSV, PDF) sem perder códigos e quantidades, e anexar os documentos que originam cada medição. Arquivos enviados são entrada não confiável.

## Decisão
- **Arquivos** (`document`): tipo pela **assinatura** do conteúdo (não pela extensão): XLSX, CSV, PDF, PNG, JPEG. Limite de tamanho (`UPLOAD_MAX_MB`, padrão 20 MB); XLSX passa por verificação do diretório central do ZIP antes de ser aberto (tamanho descompactado, número de partes e taxa de compressão — zip bomb). Conteúdo em disco local (`STORAGE_DIR`, fora da raiz pública) com **nome aleatório**; nome original e SHA-256 só no banco; registro imutável. Download só com sessão e permissão no empreendimento, `Content-Disposition: attachment` e `nosniff`.
- **Importação em 9 etapas** (tipo → arquivo → leitura → mapeamento → validação → correções → prévia → confirmação → relatório): o arquivo vira linhas numa **área de preparação** (`import_job`, `import_row`); o mapeamento de colunas é sugerido pelos cabeçalhos (sem acento/caixa) e ajustável; a validação usa as mesmas regras do sistema (código e duplicidade, unidade e categoria existentes, hierarquia permitida, ciclos, unidade compatível, **dupla contagem** contra o banco e entre linhas do próprio arquivo). **Nada é gravado nas tabelas de domínio antes da confirmação**; na confirmação tudo é revalidado sob lock e gravado numa única transação, com auditoria por registro e referência ao arquivo. Linhas com erro bloqueiam, a menos que o usuário escolha ignorá-las. Limites: 20.000 linhas e 50 colunas.
- Medições importadas têm método `IMPORTED` e memória de cálculo com a conversão de unidade e a referência ao arquivo e à linha.
- **Exportações**: relatórios tabulares (cadastro, EAP, serviços, quantitativos, memórias, consolidação — atual ou de uma revisão — e comparação de revisões) em XLSX (exceljs), CSV (`;`, UTF-8 com BOM) e PDF (pdfkit, fonte padrão, A4 paisagem, cabeçalho repetido e paginação). Os **cabeçalhos das exportações são os rótulos dos campos de importação**, de modo que exportar → reimportar não exige mapeamento.
- **Injeção de fórmula**: textos que começam com `= + - @`, tabulação ou retorno são prefixados com apóstrofo em CSV e XLSX; quantidades saem como número quando o ponto flutuante as representa exatamente, senão como texto (sem perda).
- Arquivo de origem de uma medição é anexado a uma **revisão** da medição (imutável), por id de documento já verificado.

## Consequências
+ Planilhas existentes entram com validação completa e trilha de auditoria; ida e volta preserva códigos e quantidades.
− Armazenamento local exige backup do diretório junto com o banco (F10 avalia armazenamento de objetos).
− Leitura de XLSX carrega o arquivo em memória (limitado a 20 MB e às verificações acima).
