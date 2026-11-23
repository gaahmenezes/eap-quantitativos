# Regras de negócio


**RN‑GER (geração de EAP)** — função pura `generateWbs(templateVersions, projectFacts) → DesiredTree`:
1. Fatos do projeto = snapshot normalizado do cadastro físico, tipologias, módulos e sistemas (ordenado por `position`, depois `id` ⇒ determinístico).
2. Percorre o template; nó entra se `condition` for verdadeira; `repeatOver` expande uma instância por entidade, ordenada deterministicamente.
3. `generationKey` = `stableKey` + IDs vinculados; códigos derivados por posição.
4. Teste: mesma entrada ⇒ mesmo hash da árvore.

**RN‑REG (regeneração)** — `diffWbs(existing, desired)` por `generationKey`:
- novo → criar; existente igual → manter; título/posição/pai diferentes → atualizar (ID preservado); ausente no desejado →
  - sem medições: remover (com prévia);
  - **com medições: nunca apagar** → marcar `OBSOLETE` e exigir decisão (manter, mover medições, ou arquivar).
- Nós `MANUAL` jamais são tocados pelo gerador.
- Prévia obrigatória; aplicação só com confirmação, em transação, registrada em `WbsGenerationRun` + auditoria.

**RN‑TPL (templates)** — publicar congela a versão; projetos registram a versão usada; nova versão não afeta projetos até regeneração explícita com prévia.

**RN‑TIP (tipologias e unidades)**
- Unidade fixa uma revisão publicada da tipologia. Quantidade efetiva da unidade = medições da tipologia (revisão fixada) ± `UnitOverride`.
- Publicar nova revisão da tipologia **não altera unidades**; o assistente de propagação mostra: unidades afetadas, unidades com particularidades, conflitos (override cujo `targetStableKey` foi removido/alterado). Aplicação por unidade ou em lote; conflitos exigem resolução; overrides nunca são apagados automaticamente.

**RN‑DUP (sem dupla contagem)**
- Para um mesmo par (WbsNode, Service), as âncoras das medições devem ser **disjuntas**: proibido medir num ancestral e num descendente do mesmo ramo físico (validado no serviço e no import).
- Medição de tipologia conta 1× por unidade vinculada (multiplicador), nunca somada também como medição avulsa da unidade para o mesmo elemento (override REPLACE substitui, não soma).
- Consolidação agrega somente linhas cuja âncora pertence ao escopo selecionado; implementação SQL validada contra implementação de referência do `domain` (testes de equivalência).

**RN‑FOR (fórmulas e cálculo)**
- Gramática: números, variáveis, `+ − × ÷ ^`, parênteses, funções whitelist (`min, max, abs, sqrt, round, ceil, floor, pi`). Sem acesso a objetos, sem strings executáveis.
- Validação: variáveis declaradas, divisão por zero, dimensões compatíveis em soma/subtração, resultado com a dimensão da unidade do serviço; conversão explícita (cm→m) registrada na memória.
- Resultado armazenado; alteração de fórmula cria nova `FormulaVersion`; medições existentes **não recalculam sozinhas** — o sistema lista as afetadas e o usuário recalcula explicitamente (nova `MeasurementRevision`).

**RN‑REV (revisões)** — emitir revisão congela EAP + medições (por referência a revisões imutáveis); relatórios de revisões emitidas leem o snapshot; comparação lista inclusões, exclusões e alterações com delta de quantidade.

**RN‑IMP (importação)** — arquivo → staging (`ImportJob`, `ImportRow`) → mapeamento → validação (duplicados, obrigatórios, unidades, referências, disjunção) → prévia → confirmação → gravação em transação única → relatório. Nada é gravado em tabelas de domínio antes da confirmação.

---


## 7. Fluxos operacionais
1. **Criar empreendimento** → assistente: identificação → classificação → módulos (misto permite vários) → parâmetros condicionais (torres/pavimentos/unidades por pavimento; fases/quadras/lotes; tipologias e quantidades; áreas comuns; sistemas de infra) → prévia do cadastro físico → confirmar.
2. **Ajustar cadastro físico** na árvore (inspector lateral), cadastrar redes/trechos/dispositivos, elementos.
3. **Tipologias** → montar elementos → medições compartilhadas → publicar revisão → vincular unidades.
4. **Gerar EAP** → escolher templates por módulo → prévia → aplicar → editar manualmente.
5. **Levantar** por nó da EAP × serviço × âncora (manual ou fórmula) com documento de origem.
6. **Consolidar** por dimensão/filtro → exportar.
7. **Emitir revisão** → comparar com anterior.

---

