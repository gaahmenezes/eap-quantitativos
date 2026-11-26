# ADR-025 — Modelos de ficha para as abas restantes e atualização pela nova versão da planilha

- Status: Aceita
- Data: 2026-11-26
- Relacionada: ADR-020 (fichas), ADR-021 (quadros), ADR-022 (migração), ADR-023 (destino por linha)

## Contexto
O ensaio da migração (ADR-022) com as três planilhas reais deixou 98 abas sem destino. As mais comuns tinham estruturas
repetidas que os modelos existentes não cobriam: impermeabilização, muros, calçadas e acabamentos ("Tipologia | Local |
Perímetro | H parede | Área de piso | Área parede sem/com desconto | Nº de Rep | Área total da obra"), mármore e granito
("Dimensões da peça L x C | Quantidade | Quant. utilização | Área | Metros") e movimento de terra (volume geométrico,
taxa de empolamento escrita como fração, vala = largura × perímetro × profundidade). Além disso, as planilhas são
revisadas (R00, R01…) e a migração só criava registros novos: migrar a nova versão duplicava fichas e quadros e perdia
o que só existe no sistema (destino por linha, serviços dos itens, lançamentos).

## Decisão
### Modelos novos (exemplos editáveis, instalados por código)
- **SUP — Superfícies**: piso/teto + parede (perímetro × altura − desconto, ou "parede informada" quando a planilha só
  traz a área) × repetições; saídas área total e comprimento (perímetro × repetições).
- **MARM — Mármore e granito**: comprimento × largura × quantidade × repetições; saídas área e metros lineares.
- **TERRA — Movimento de terra**: volume informado ou largura × comprimento × profundidade; volume empolado
  (transporte) e área de limpeza/compactação, × repetições.
- Os modelos padrão passam a ser instalados **por código que falta** (não só em organização vazia): organizações
  existentes recebem os novos sem tocar nos seus. Trava consultiva por organização evita duplicar em acessos simultâneos.

### Sugestão da migração
- Destino por nome com abreviações das áreas comuns (`Churras-ESQ`, `INST.ELET`, `Pav-BEA`…) e, sem regra pelo nome,
  pela **assinatura dos cabeçalhos**: perímetro + altura + área ⇒ SUP; unidade + quantidade (rótulo ou conteúdo) ⇒ quadro.
- Abas com mais de um bloco: o cabeçalho escolhido é o que mais casa com o modelo (colunas numéricas reconhecidas +
  obrigatórias presentes) e o intervalo para antes do próximo cabeçalho diferente.
- Sugestão que não monta nenhuma linha vira "ignorar" (ou lista, se couber) — o usuário não herda abas quebradas.
- Rótulos parecidos mas errados não são aceitos (ex.: "Área Parede (sem desconto)" não é o desconto).
- Linhas-modelo vazias da planilha (fórmulas sem valor e zeros) e títulos sem números são ignorados.
- **Unidade "fração"** só na migração: porcentagem escrita como decimal (0,35 = 35%), sugerida quando o cabeçalho
  diz "%" ou "m/m" e todos os valores estão entre 0 e 1.

### Atualização pela nova versão
- Fichas e quadros criados pela migração guardam a **aba de origem** (`sourceSheetName`). Na nova versão do arquivo, a
  aba de mesmo nome é sugerida como **atualização** da ficha (mesmo modelo) ou do quadro (mesmo número de colunas de
  quantidade). O usuário pode trocar para "criar novo" ou escolher outra ficha/quadro ativo do empreendimento.
- O plano grava `updateOf = { id, version }`. A prévia compara com o estado atual: linhas casadas pela **chave**
  (colunas de texto/escolha da ficha; código ou descrição + especificação do item), na ordem, sobrevivendo a
  inserções no meio; mostra novas, retiradas, alteradas (campo antes → depois), totais das saídas antes × depois e
  quantos destinos por linha/serviços se perdem com linhas retiradas.
- Se a ficha/quadro mudou depois do plano, a prévia avisa e aplicar é recusado até o usuário confirmar sobre a versão
  atual (bloqueio otimista, sem sobrescrever trabalho alheio).
- Aplicar usa os mesmos casos de uso da edição (`SheetsService.updateIn`, `SchedulesService.saveIn`) na transação da
  migração: valida destinos, grava auditoria com o motivo "Atualização pela planilha arquivo › aba". Linhas casadas
  mantêm destino por linha (fichas) e chave + serviços (quadros); parâmetros da ficha são preservados.
- **Nada é relançado automaticamente**: o lançado fica "alterado desde o lançamento" e o relançamento revisa as
  medições (memória e histórico preservados). Duas abas não podem atualizar o mesmo destino.

## Consequências
+ Ensaio real: abas com destino 60 → 78 (VMB) e 55 → 78 (Marupi); abas sem erro de linha 22 → 51 e 22 → 56;
  conferências que batem com a planilha 0 → 14 e 0 → 16. As divergências restantes são valores digitados à mão na
  planilha (ex.: parede 10,15 onde perímetro × altura = 8,01) e ficam visíveis linha a linha.
+ Revisar a planilha deixa de duplicar fichas e preserva o trabalho feito no sistema.
− Linha cuja chave muda (ambiente renomeado) entra como nova + retirada e perde o destino por linha (a prévia avisa).
− Abas de matriz (seções de terraplenagem, materiais por coluna de quadras) continuam fora; pedem modelo próprio.
