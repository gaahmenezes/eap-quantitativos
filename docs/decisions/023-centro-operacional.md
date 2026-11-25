# ADR-023 — Centro operacional: painel, fila de trabalho e destino por linha

**Status:** Aceita · **Data:** 2026-11-25

## Contexto
Com fichas, quadros e migração, o trabalho de levantamento já não vive em planilhas — mas a equipe (um engenheiro com ~90 % do volume e um gestor que revisa) precisa saber **o que falta**: o que está digitado e não lançado, o que mudou depois do lançamento, quanto da EAP já tem quantitativo, o que mudou desde a última revisão emitida e quem está fazendo o quê. Além disso, fichas por trecho/ambiente precisavam de um destino diferente por linha (cada trecho de rede, cada pavimento).

## Decisão
- **Painel do empreendimento** (`GET /projects/:id/operations`, só leitura, calculado na hora):
  - pendências de fichas e quadros com **motivos** (sem item da EAP, sem âncora, saída sem serviço, linhas/itens com erro — pelo mesmo motor do lançamento —, item sem serviço, destino incompleto, alterada após o lançamento, pronta para lançar) e migrações não aplicadas;
  - **cobertura da EAP**: itens quantificáveis ativos com ao menos uma medição ativa, total e por grupo de 1º nível;
  - vínculos serviço × item da EAP sem medição; medições com fórmula desatualizada;
  - **desde a última revisão emitida**: medições novas, revisadas e arquivadas;
  - tarefas por situação, atrasadas e sem responsável; atividade recente (auditoria).
  Nenhum indicador financeiro.
- **Fila de trabalho** (`work_task`): tarefa com vínculo opcional a ficha, quadro, item da EAP ou migração (FK composta por empreendimento, coerência por CHECK), responsável, revisor, prazo. Responsável e revisor precisam ter edição no empreendimento. Fluxo: a fazer ⇄ em andamento → em revisão → concluída; **com revisor, só ele aprova ou devolve**, e devolver/reabrir exige comentário; sem revisor, quem edita conclui direto. Cada transição é auditada com o comentário; tarefas não são apagadas (trigger), só arquivadas; edição com `If-Match`. "Minhas tarefas" (`GET /tasks/mine`) reúne, em todos os empreendimentos acessíveis, as tarefas abertas do usuário e as que aguardam sua revisão.
- **Destino por linha nas fichas**: `sheet.rowAnchors` alinhado com as linhas (null = destino da ficha), âncoras validadas como as demais. O lançamento agrupa as linhas por destino e grava **uma medição por saída × destino** (chave `saida@hash-da-âncora`; o destino da ficha mantém a chave antiga, preservando lançamentos anteriores). A memória mostra o destino e só as linhas daquele destino. A regra de dupla contagem vale entre os destinos (ex.: linha na Torre A e outra num pavimento da Torre A ⇒ 409).

## Consequências
+ O gestor vê num só lugar o que está pendente e o que mudou; o engenheiro tem sua fila; a revisão tem registro.
+ Fichas de rede por trecho e de acabamento por ambiente lançam direto nas âncoras certas, sem uma ficha por destino.
− O painel recalcula fichas e quadros a cada consulta; em empreendimentos muito grandes pode precisar de cache (F15).
− Notificações (e-mail) de tarefas não fazem parte desta fase.
