# ADR-021 — Quadros de componentes e materiais

**Status:** Aceita · **Data:** 2026-11-25

## Contexto
Além das fichas de cálculo (ADR-020), as planilhas de levantamento têm **listas de itens contados por unidade habitacional**: quadro de esquadrias (Id, L × A, qtde por casa × nº de repetições → qtde e área por obra), louças e metais, materiais de instalações hidráulicas e elétricas (tubo por diâmetro em m, conexões em un), sempre com um **quadro de resumo** que soma itens do mesmo material (ex.: fio 1,5 mm² vermelho + azul + branco). O resultado vai para serviços medidos em un, m ou m².

## Decisão
- **Quadro** (`schedule`) no empreendimento, com tipo (esquadrias, louças e metais, instalações hidráulicas, instalações elétricas, outros) apenas para orientar a tela.
  - **Destinos** (`schedule_column`): nome, item da EAP e âncora (as da F6), com FKs compostas por empreendimento. Um destino em elemento de tipologia vale para cada unidade vinculada (× n), pela replicação da F6/F7.
  - **Itens** (`schedule_row`): Id, descrição, especificação, unidade de entrada, largura × altura (opcional) e até 3 serviços (`schedule_row_service`, FK por organização); quantidades por destino em JSONB (texto digitado; aceita conta só com números).
- Cálculo puro em `packages/domain/src/schedule` (o mesmo no navegador e no servidor): por serviço do item, a quantidade é a contagem (serviço em contagem), a conversão de unidade (m, cm, kg…) ou **contagem × L × A** (serviço em área). Unidade incompatível, valor inválido/negativo, item sem descrição ou sem serviço ⇒ erro do item; qualquer erro bloqueia o lançamento.
- **Lançar = quadro de resumo**: uma medição por **serviço × destino** (`scheduleId` + `scheduleKey` = `serviçoId:destino`, método `SCHEDULE`), somando todos os itens daquele serviço — por isso itens diferentes do mesmo material não geram dupla medição. A memória lista cada item que contribuiu (quantidade, área por peça, valor).
- O lançamento usa o mesmo mecanismo das fichas, agora comum (`measurements/owned.ts`): cria, revisa só quando a quantidade ou a contribuição muda, arquiva o que saiu ou mudou de destino, vincula serviço × item da EAP que faltar, respeita a dupla contagem (RN-DUP), tudo numa transação com o lock da EAP. Medição de quadro não é revisada nem arquivada à mão (409 `SCHEDULE_OWNED`); uma medição tem no máximo uma origem (ficha **ou** quadro).
- **Lista padrão**: um quadro novo pode copiar os itens (sem destinos nem quantidades) de qualquer quadro da organização; serviços específicos de outro empreendimento não são copiados e o usuário é avisado.
- A grade é gravada inteira (`PUT`, com `If-Match`); a auditoria registra destinos e número de itens. Quadros não são apagados (trigger), só arquivados — e arquivar arquiva seus quantitativos.
- Colunas de preço/custo das planilhas **não** são trazidas (fora do escopo).

## Consequências
+ Esquadrias, louças/metais e materiais de instalações saem da planilha para dados ligados a serviços, EAP e tipologias por ID, com total por obra calculado pelas unidades reais.
+ Uma lista padrão (ex.: hidráulica da casa) é reaproveitada entre empreendimentos.
− A medida por peça é só L × A; outras derivações (perímetro de batente, peso por peça) ficam para fichas (ADR-020) ou evolução futura.
− Destino "unidade inteira" de tipologia ainda exige um elemento-raiz (ex.: "Casa").
