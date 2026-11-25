# Modelo de domínio

> Fonte: Fase 0. Atualizar quando o schema evoluir. Entidades implementadas estão marcadas em docs/database/README.md.

## Glossário
| Termo (pt-BR) | Entidade | Significado |
|---|---|---|
| Empreendimento | Project | Projeto completo de uma organização |
| Módulo | ProjectModule | Parte do empreendimento com tipologia própria (vertical, horizontal, loteamento, áreas comuns, infraestrutura) |
| Cadastro físico | StructureNode | Árvore de elementos físicos/organizacionais (fase, quadra, lote, torre, pavimento, unidade…) |
| Tipologia | DwellingTypology | Modelo construtivo reutilizável (casa tipo A, apto tipo 2Q) |
| Particularidade | UnitOverride | Diferença de uma unidade em relação à tipologia |
| EAP | WbsNode | Árvore de escopo, independente do cadastro físico |
| Serviço | Service | Item técnico quantificável com unidade e critério de medição |
| Medição / Quantitativo | Measurement + MeasurementRevision | Quantidade de um serviço, num nó da EAP, numa âncora física |
| Memória de cálculo | MeasurementRevision | Registro imutável de como a quantidade foi obtida |
| Revisão | ProjectRevision | Congelamento formal (R00, R01…) |
| Modelo de ficha | SheetTemplate + SheetTemplateVersion | Planilha de levantamento padronizada da organização (colunas, cálculos, parâmetros, tabelas, saídas) |
| Tarefa | WorkTask | Item da fila de trabalho (levantar, lançar, revisar, migrar), com responsável, revisor e prazo |
| Quadro de componentes | Schedule + ScheduleColumn + ScheduleRow | Lista de itens (esquadrias, louças, materiais) com quantidade por destino; lançado como quadro de resumo |
| Ficha de levantamento | Sheet | Planilha preenchida num empreendimento; ao lançar, as saídas viram medições |

## 5. Modelagem de domínio (inicial)

### 5.1 As cinco estruturas, separadas
```
Project ─┬─ StructureNode (cadastro físico, árvore)          ← "onde"
         ├─ WbsNode (EAP, árvore independente)               ← "escopo"
         ├─ Service (catálogo org + específicos)              ← "o quê se mede"
         └─ Measurement (quantitativo)  = WbsNode × Service × Âncora física
```
Medição é a única entidade que liga as três. EAP nunca é derivada de nomes; vínculos sempre por ID.

### 5.2 Entidades
**Acesso e tenancy**
- `Organization`, `User` (email, passwordHash argon2id, status), `Session` (hash do token, expiração, ip, ua)
- `Membership` (org, user, role: OWNER | ADMIN | MEMBER)
- `ProjectMember` (project, user, role: COORDINATOR | EDITOR | VIEWER)
- Papéis como enum + matriz de permissões em código (tabela `Role` só se surgir papel customizável — YAGNI).

**Empreendimento e cadastro físico**
- `Project` (code único na org, name, description, classification: VERTICAL | HORIZONTAL | LOTEAMENTO | MISTO, status, archivedAt, version)
- `ProjectModule` (kind: VERTICAL_RESIDENTIAL | HORIZONTAL_RESIDENTIAL | LAND_SUBDIVISION | COMMON_AREAS | INFRASTRUCTURE, rootStructureNodeId)
- `StructureNode` (parentId, kind: PHASE | STAGE | SECTOR | BLOCK_QUADRA | LOT | STREET | STREET_SECTION | TOWER | BUILDING_BLOCK | FLOOR | DWELLING_UNIT | COMMON_AREA | TECHNICAL_AREA | INSTITUTIONAL_AREA | GREEN_AREA, name, position, path, depth, code derivado, version)
  - Matriz de pais permitidos por `kind` no `domain` (ex.: FLOOR só sob TOWER/BUILDING_BLOCK; LOT só sob BLOCK_QUADRA), validada no serviço.
  - Detalhes 1:1 tipados apenas onde há atributos próprios: `DwellingUnit` (typologyId, pinnedTypologyRevisionId, identificador), `LotDetail` (área, testada).

**Construtivo / tipologias**
- `DwellingTypology` (code, name, kind: APARTMENT | HOUSE, currentRevisionId)
- `TypologyRevision` (number, status DRAFT | PUBLISHED, publishedAt) — imutável após publicada
- `TypologyElement` (revisionId, parentId, **stableKey** constante entre revisões, elementTypeId, name, attributes)
- `UnitOverride` (dwellingUnitId, targetStableKey, op: EXCLUDE_ELEMENT | ADD_ELEMENT | REPLACE_MEASUREMENT | ADD_MEASUREMENT, payload validado, reason, autor) — **modelo delta**: a unidade herda da revisão fixada da tipologia; particularidades são registros próprios e nunca são sobrescritos.

**Infraestrutura**
- `InfrastructureSystemType` (catálogo por org: TERRAPLENAGEM, DRENAGEM, AGUA, ESGOTO, PAVIMENTACAO, GUIAS_SARJETAS, ILUMINACAO, PAISAGISMO… — tabela, não enum ⇒ extensível sem deploy)
- `InfrastructureSystem` (project, systemType, escopo opcional em StructureNode: fase/setor)
- `InfrastructureNetwork` (system, name, code)
- `NetworkNode` (network, elementTypeId — PV, BL, caixa, registro…; cotas de tampa/fundo, StructureNode de localização)
- `NetworkSegment` (network, fromNodeId, toNodeId, streetSectionId?, length, diameter, material, depthStart, depthEnd, slope derivada, extraAttributes)
- `ElementType` (org, domain INFRA | CONSTRUTIVO, systemTypeId?, name) + `ElementAttributeDefinition` (key, label, dataType, dimensão/unidade, obrigatório, enumValues)
- `PhysicalElement` (âncora exclusiva: structureNode | networkNode | networkSegment, elementTypeId, attributes JSONB validado) — para áreas de terraplenagem, camadas de pavimento, elementos de áreas comuns etc.

**Serviços e unidades**
- `UnitOfMeasure` (code m, m², m³, kg, t, un, vb…, vetor dimensional [L, M, T, N_contagem], factorToBase NUMERIC, casas decimais de exibição)
- `ServiceCategory` (árvore), `Service` (org, projectId nulo = catálogo padrão, code, description, normalizedDescription, unitId, measurementCriterion, technicalDescription, status, origin, derivedFromServiceId, version)
- `ServiceFormula` (serviço ↔ fórmulas compatíveis)
- Duplicidade: `UNIQUE(org, projectId, code)` bloqueia; similaridade `pg_trgm` na descrição normalizada **avisa** (não bloqueia).

**Fórmulas e quantitativos**
- `Formula` (code, name, status) → `FormulaVersion` (imutável: expression, resultDimension) → `FormulaVariable` (symbol, label, dimensão, unidade padrão, restrições ex. `> 0`)
- `Measurement` (project, wbsNodeId, serviceId, âncora exclusiva: structureNode | typologyElement | networkSegment | networkNode | physicalElement — CHECK “exatamente uma”, currentRevisionId, status)
- `MeasurementRevision` (**append‑only = memória de cálculo**: method MANUAL | FORMULA | IMPORTED, formulaVersionId, inputs [símbolo, valor, unidade], conversões aplicadas, expressão substituída, resultado na unidade do serviço NUMERIC(28,10), observações, documentId, responsável, data, motivo)
- `Document` (arquivo de origem: nome, mime verificado, sha256, tamanho, storageKey)

**EAP**
- `WbsTemplate` (code, name, applicableModuleKinds) → `WbsTemplateVersion` (number, status DRAFT | PUBLISHED | ARCHIVED, imutável publicada) → `WbsTemplateNode` (parentId, stableKey, titlePattern ex. `Torre {tower.name}`, nodeType GROUP | QUANTIFIABLE, required, **condition** (expressão booleana segura sobre fatos do projeto), **repeatOver** (TOWER | FLOOR | DWELLING_TYPOLOGY | DWELLING_UNIT | COMMON_AREA | PHASE | SECTOR | BLOCK_QUADRA | STREET | INFRA_SYSTEM | NETWORK…), codeSegmentFormat, suggestedServiceIds, position).
  - `WbsRule` da diretriz é incorporado como colunas do nó de template (condição + repetição); tabela separada só se uma regra precisar ser compartilhada entre nós.
- `WbsNode` (project, parentId, title, code derivado, level, position, path, nodeType, origin GENERATED | MANUAL | IMPORTED, status ACTIVE | OBSOLETE, **generationKey** = stableKey do template + IDs das entidades ligadas na repetição, sourceTemplateVersionId, binding opcional para StructureNode/Typology/InfraSystem/Network, version)
- `WbsGenerationRun` (versões de template usadas, hash dos fatos de entrada, resumo do diff, autor, data) → reprodutibilidade auditável.

**Revisões e auditoria**
- `ProjectRevision` (code R00…, status DRAFT | ISSUED, motivo, emitida por/em) + `RevisionWbsNode`, `RevisionMeasurement` (aponta para `MeasurementRevision` imutável), `RevisionStructureNode`
- `AuditLog` (org, project, actor, entityType, entityId, action, before, after, reason, requestId, at) — trigger bloqueia UPDATE/DELETE.

**Regras transversais de banco:** `NUMERIC` para quantidades; `archivedAt` em vez de DELETE para dados referenciados; DELETE físico só para rascunhos sem vínculos; índices em `(organizationId, projectId)`, `path` (text_pattern_ops), `generationKey` único por projeto.

---

