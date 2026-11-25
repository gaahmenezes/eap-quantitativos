# FASE 0 — Diagnóstico, Arquitetura e Plano de Implementação
**Plataforma de Levantamento Cadastral, EAP e Quantitativos para Engenharia Civil**

---

## 1. Contexto

Engenheiros trabalham hoje com várias planilhas desconectadas para cadastrar empreendimentos, montar a EAP e levantar quantitativos. O objetivo é um produto web real (persistente, seguro, multi-organização, testado) que represente o empreendimento como **modelo digital estruturado** — cadastro físico → EAP gerada por regras → serviços → medições com memória de cálculo → consolidação → revisões — **sem nenhuma funcionalidade financeira**.

Esta etapa é somente de análise. Nenhum arquivo de projeto foi criado ou alterado.

---

## 2. Diagnóstico do repositório e do ambiente (verificado)

| Item | Situação encontrada |
|---|---|
| Diretório de trabalho `/home/user` | **Vazio**, não é repositório Git. Nenhum README, CLAUDE.md, package.json, teste ou código. |
| Repositório anexado à sessão | **Nenhum.** Você confirmou: construir em **repositório novo**. (Existem na conta `quantiflow`, `quantitativos-dwg`, `infocustos-civil` — não serão usados agora; `quantitativos-dwg` pode virar fonte de importação CSV no futuro.) |
| Node / npm / pnpm | Node 22.23, npm 10.9, **pnpm 10.28** disponíveis |
| PostgreSQL | **16.15 instalado localmente**, cluster parado (pode ser iniciado para dev/testes) |
| Docker | CLI presente, **daemon indisponível** neste container → não consigo testar `docker-compose` aqui |
| Playwright/Chromium | Pré-instalados (E2E viável) |
| Recursos | 4 vCPU, 15 GB RAM, disco suficiente |
| Registro npm | Acessível. Versões atuais: NestJS 12.6, React 19.3, Vite 8.3, Tailwind 4.3, TanStack Query 5.108, zod 4.6, decimal.js 10.6, exceljs 4.4, Vitest 5.1, Playwright 1.65, argon2 0.45, pdfmake 0.3 |
| **Atenção: Prisma** | A tag `latest` do npm aponta para **8.0.0-rc.35 (release candidate)**. A última estável é **7.10.1** → fixar Prisma 7.10.x. |

**Problema crítico de ambiente:** o container é efêmero. Todo trabalho precisa ser commitado e enviado a um repositório GitHub, senão é perdido. **Pré‑requisito da Fase 1:** você cria um repositório vazio (ex.: `gaahmenezes/<nome-do-produto>`) ou me autoriza a criá-lo; eu o anexo à sessão e trabalho em branch, sem push para `main` sem sua autorização.

Como o repositório é vazio, adoto a arquitetura de referência da diretriz, com os ajustes justificados abaixo.

---

## 3. Requisitos

### 3.1 Funcionais (síntese rastreável à diretriz)
- **RF01** Multi-organização, usuários, papéis por organização e por empreendimento.
- **RF02** CRUD de empreendimentos com classificação (vertical, horizontal, loteamento, misto).
- **RF03** Assistente guiado condicional que gera o cadastro físico inicial (torres×pavimentos×unidades, quadras×lotes, fases/setores, áreas comuns, sistemas de infra).
- **RF04** Cadastro físico hierárquico editável (fase, setor, quadra, lote, rua, trecho, torre, bloco, pavimento, unidade, área comum).
- **RF05** Infraestrutura: sistemas extensíveis (catálogo), redes, trechos/segmentos, dispositivos (PV, BL, caixas…), elementos com atributos técnicos por tipo.
- **RF06** Construtivo: tipologias com estrutura de elementos, vínculo de unidades, particularidades por unidade, propagação controlada.
- **RF07** Templates de EAP versionados (criar, editar rascunho, publicar imutável, duplicar, arquivar, comparar).
- **RF08** Motor determinístico de geração de EAP com prévia (novos/mantidos/alterados/removidos) e regeneração por diff.
- **RF09** Editor de EAP (árvore, busca, filtros, mover, reordenar, duplicar, exclusão controlada, vínculos, indicadores de preenchimento).
- **RF10** Biblioteca de serviços (catálogo padrão + específicos do empreendimento), unidades de medida, detecção de duplicidade.
- **RF11** Fórmulas reutilizáveis versionadas; medições manuais, por fórmula ou importadas; memória de cálculo completa.
- **RF12** Consolidações por qualquer dimensão física/EAP/serviço/tipologia sem dupla contagem.
- **RF13** Revisões formais do empreendimento (R00, R01…) com congelamento e comparação; auditoria de toda alteração.
- **RF14** Importação XLSX/CSV em etapas com validação e staging; exportação XLSX/CSV/PDF.

### 3.2 Não funcionais
- **RNF01 Isolamento de dados** por organização garantido no backend e no banco (FKs compostas).
- **RNF02 Determinismo**: mesma entrada + mesma versão de template ⇒ mesma EAP (teste de snapshot/hash).
- **RNF03 Precisão**: aritmética decimal (decimal.js, precisão 34) e `NUMERIC` no banco; nunca `float` em quantitativos.
- **RNF04 Rastreabilidade**: auditoria append-only na mesma transação da alteração.
- **RNF05 Concorrência**: bloqueio otimista (`version` + `If-Match`) em entidades editáveis.
- **RNF06 Desempenho**: árvores e tabelas virtualizadas; alvo ≥ 5.000 nós de EAP e ≥ 200.000 linhas efetivas de quantitativo consolidadas em < 2 s.
- **RNF07 Segurança**: OWASP ASVS nível 2 como referência.
- **RNF08 Idioma**: código/identificadores em inglês; interface, mensagens e documentação de produto em pt‑BR.
- **RNF09 Desktop-first**, responsivo para tablet; celular com consulta funcional.

---

## 4. Arquitetura recomendada

### 4.1 Decisões principais (viram ADRs em `docs/decisions/`)
| # | Decisão | Justificativa |
|---|---|---|
| ADR‑001 | **Monólito modular** em monorepo pnpm | Um time, um banco, domínio fortemente relacionado; microsserviços não se justificam. |
| ADR‑002 | Pacotes: `apps/api` (NestJS), `apps/web` (React/Vite), `packages/domain` (TS puro), `packages/contracts` (schemas zod) | `domain` concentra a inteligência (motor de fórmulas, unidades, gerador de EAP, diff, consolidação) **sem dependência de framework/banco** → testável com resultados conhecidos. `contracts` dá tipagem e validação idênticas no front e no back. Não criar mais pacotes sem necessidade. |
| ADR‑003 | PostgreSQL 16 + **Prisma 7.10 (estável)**; SQL bruto versionado nas migrações para CHECKs, índices parciais, triggers de auditoria e `pg_trgm` | Prisma não expressa tudo; restrições críticas ficam no banco. Proibido `$queryRawUnsafe`. |
| ADR‑004 | **Parser matemático próprio** (Pratt parser, ~400 linhas) sobre decimal.js, com análise dimensional | Sem `eval`; whitelist de operadores/funções; controle total de precisão e dimensões; mathjs seria pesado e já teve CVEs no avaliador. |
| ADR‑005 | Hierarquias por **lista de adjacência + caminho materializado de IDs** (`path`), código hierárquico **derivado** e armazenado só para leitura | ID estável nunca muda; mover nó recalcula `code`/`path` da subárvore em transação. |
| ADR‑006 | Autenticação por **sessão em cookie** (`__Host-`, httpOnly, Secure, SameSite=Lax) com sessões no Postgres; senhas **argon2id**; CSRF por token sincronizador + checagem de `Origin` | Mais seguro que JWT em localStorage para app web próprio; revogação imediata. |
| ADR‑007 | Isolamento: `organizationId` em toda tabela de tenant + **FKs compostas `(id, organizationId)`** + guarda de acesso em cada caso de uso | Impede no banco que um registro referencie outro de outra organização. RLS do Postgres avaliado na Fase 10 como defesa extra. |
| ADR‑008 | Templates publicados e revisões de tipologia são **imutáveis**; edição sempre em nova versão rascunho | Atende “não alterar retroativamente”. |
| ADR‑009 | Revisões de projeto como **snapshots normalizados** (tabelas `revision_*` referenciando versões imutáveis de medição) | Comparação via SQL, relatórios históricos estáveis. |
| ADR‑010 | Atributos técnicos variáveis: **colunas tipadas** para o núcleo (comprimento, diâmetro, cotas, profundidade, declividade, material em segmentos) + **JSONB validado contra o schema do `ElementType`** para atributos extras | Evita EAV genérico e evita dezenas de tabelas por sistema; novos sistemas sem migração. |
| ADR‑011 | Empreendimento **misto = composição de módulos** (`ProjectModule`), não uma quinta estrutura rígida | Vertical, horizontal e loteamento são módulos; misto combina vários no mesmo projeto, cada um com sua subárvore e seus templates. |

### 4.2 Stack
- **Web:** React 19, TypeScript, Vite 8, Tailwind 4, componentes próprios sobre Radix (padrão shadcn, código no repo), React Router, TanStack Query (estado servidor), TanStack Table + TanStack Virtual (tabelas/árvores grandes), react-hook-form + zod. Estado local mínimo (sem Redux).
- **API:** NestJS 12, REST, pipe de validação zod (`contracts`), filtro global de exceções (formato RFC 9457 *problem details*), helmet, throttler, logs estruturados (pino) com `requestId`.
- **Arquivos:** abstração `StorageService` (disco local em dev; S3 compatível depois). exceljs (XLSX), csv-parse/csv-stringify (CSV), pdfmake (PDF).
- **Testes:** Vitest (domain, api, web), Supertest + Postgres real (banco de teste isolado por execução), Testing Library, Playwright E2E.
- **Qualidade:** ESLint + Prettier, `tsc --noEmit` estrito, CI GitHub Actions (lint, typecheck, testes com serviço Postgres).

### 4.3 Estrutura de pastas
```
apps/api/src/modules/{auth,organizations,projects,structure,infrastructure,
                      typologies,services,units,formulas,wbs-templates,wbs,
                      measurements,consolidation,revisions,imports,exports,audit,documents}
apps/api/prisma/{schema.prisma,migrations/,seed/}
apps/web/src/{app,routes,features/<módulo>,components/ui,lib/api}
packages/domain/src/{formula,units,wbs-generator,wbs-diff,consolidation,typology-resolution,codes}
packages/contracts/src/<módulo>.ts
docs/{architecture,product,domain,database,decisions,implementation}
CLAUDE.md  README.md
```
Cada módulo da API: `controller` (HTTP fino) → `application service` (caso de uso, transação, autorização, auditoria) → `domain` (regras puras) → `repository` (Prisma).

---

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

## 6. Regras de negócio centrais

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

## 8. Interface (padrões)
- Shell: navegação lateral (13 seções da diretriz; seções de empreendimento ficam sob o projeto selecionado), breadcrumbs, pesquisa global (Ctrl+K), seletor de empreendimento.
- Visual técnico: tipografia densa, códigos em fonte monoespaçada, números alinhados à direita com unidade, paleta neutra com cor apenas para status/validação, tema claro/escuro.
- Árvore virtualizada com teclado (setas, Enter, F2), arrastar com confirmação, indicadores de preenchimento (% de itens quantificáveis com medição).
- Tabelas: ordenação, filtros por coluna, colunas configuráveis, virtualização.
- Estados obrigatórios em toda tela: carregando, vazio (com ação útil), erro, salvando/salvo, conflito de versão.
- Sem gráficos decorativos; Dashboard mostra pendências reais (EAP sem medição, conflitos de propagação, importações pendentes, revisões em rascunho).

---

## 9. Segurança
argon2id; cookie de sessão `__Host-` httpOnly/Secure/SameSite=Lax com rotação no login; CSRF (token sincronizador + `Origin`); throttling no login e bloqueio progressivo; helmet/CSP restritiva; CORS fechado; validação zod em toda entrada; Prisma parametrizado; autorização em todo caso de uso (org + projeto + papel) retornando 404 para recurso de outra org; teste automático que falha se algum endpoint não declarar permissão; upload com limite de tamanho, verificação de assinatura do arquivo, nome aleatório, fora da raiz pública, limites de linhas/zip‑bomb no XLSX; exportação CSV/XLSX neutralizando injeção de fórmula (`= + - @`); segredos só em variáveis de ambiente (`.env.example` versionado, `.env` ignorado); auditoria append-only.

---

## 10. Plano de implementação por fases

> Ajuste de ordem em relação à diretriz (justificado por dependências): **unidades de medida e biblioteca de serviços antes dos templates** (templates sugerem serviços); **auditoria desde a Fase 1** (rastreabilidade não pode ser retroativa); replicação por tipologia dividida entre estrutura (F3) e quantitativos (F6). Cada fase termina com testes verdes, documentação atualizada, `docs/implementation/status.md` atualizado e commit/push em branch.

### F1 — Fundação
**Entregáveis:** monorepo pnpm, TS estrito, lint, CI; Postgres + Prisma 7.10 + migrações; auth (registro por convite, login, logout, sessão, CSRF); organizações, membros, papéis, membros de projeto; `AuditLog` + serviço de auditoria transacional; CRUD de empreendimentos (sem assistente); shell da UI (navegação, breadcrumbs, estados); CLAUDE.md, README, docs iniciais, ADRs 001–011; seed de desenvolvimento.
**Aceite:** usuário de org B recebe 404 em qualquer recurso da org A (teste automatizado por endpoint); senha nunca em texto puro; criar/editar/arquivar empreendimento gera auditoria com before/after; conflito de versão retorna 409; CI verde.

### F2 — Cadastro físico + assistente
**Entregáveis:** `ProjectModule`, `StructureNode` com matriz de hierarquia, `DwellingUnit`, `LotDetail`, `DwellingTypology` (cadastro básico); assistente condicional com prévia; árvore editável (criar, mover, reordenar, duplicar, arquivar).
**Aceite:** assistente gera Teste A (2 torres × 10 pavimentos × N unidades, 2 tipologias) e Teste B (120 casas: 60/40/20) com contagens exatas; hierarquia inválida rejeitada; mover nó preserva ID e recalcula códigos.

### F3 — Infraestrutura e construtivo
**Entregáveis:** catálogo de sistemas, `ElementType` + definições de atributos, redes, nós, segmentos (atributos tipados + extras validados), `PhysicalElement`; tipologias com `TypologyRevision`/`TypologyElement`, publicação, vínculo de unidades, `UnitOverride` estrutural (excluir/adicionar elemento).
**Aceite:** Teste C cadastra fases, quadras, lotes, ruas, redes de drenagem/água/esgoto com trechos PV‑a‑PV e declividade derivada; atributo obrigatório ausente bloqueia; novo sistema criado sem migração; particularidade de unidade sobrevive a nova revisão da tipologia.

### F4 — Unidades de medida e biblioteca de serviços
**Entregáveis:** `UnitOfMeasure` com dimensões e conversões (`domain/units`), categorias, serviços padrão e específicos, duplicação, aviso de similaridade, seed de catálogo inicial (sem preços).
**Aceite:** código duplicado bloqueado; descrição similar avisa; serviço específico de projeto não aparece no catálogo padrão de outros projetos; conversões cm→m, m²→cm² testadas com valores conhecidos.

### F5 — Templates e motor de EAP (entrega central)
**Entregáveis:** gerenciador de templates (rascunho, publicar, duplicar, arquivar, comparar versões); linguagem de condições; `generateWbs` e `diffWbs` em `domain`; prévia de geração/regeneração; editor de EAP completo; templates iniciais para os 5 tipos de módulo; `WbsGenerationRun`.
**Aceite:** geração determinística (hash idêntico em execuções repetidas); Testes A–D geram EAP organizada por torre/pavimento/tipologia, quadra/lote, rede/trecho; regeneração após incluir 1 torre mostra apenas os nós novos; nó com medição nunca é apagado; publicar nova versão não altera projeto existente.

### F6 — Motor de quantitativos e memórias
**Entregáveis:** parser/avaliador (`domain/formula`) com análise dimensional; fórmulas versionadas; medições manuais/por fórmula; memória de cálculo; documentos de origem; medições de tipologia + overrides REPLACE/ADD por unidade; assistente de propagação de revisão de tipologia (afetadas, particularidades, conflitos); recálculo explícito.
**Aceite:** bateria de casos conhecidos (área, volume, parede − aberturas, escavação; precisão decimal, ex. 0,1+0,2 = 0,3 exato); expressão maliciosa/inválida rejeitada; soma m + m² rejeitada; violação de disjunção de âncoras rejeitada; alteração de fórmula não muda medições sem ação explícita.

### F7 — Consolidação
**Entregáveis:** serviço de consolidação (SQL) + referência em `domain`; tela com dimensões, filtros e drill‑down até a memória de cálculo.
**Aceite:** Teste B: total por tipologia × unidades = total geral; unidade personalizada reflete o override; testes de equivalência SQL × referência; nenhuma dupla contagem nos cenários A–D; desempenho RNF06.

### F8 — Revisões e rastreabilidade
**Entregáveis:** emissão de revisões, snapshots, comparação de revisões (EAP, medições, cadastro), histórico por entidade na UI.
**Aceite:** alterar medição após R00 não altera relatório da R00; comparação R00×R01 lista inclusões/exclusões/alterações com deltas corretos.

### F9 — Importação e exportação
**Entregáveis:** importação em 9 etapas (XLSX/CSV) para serviços, cadastro físico e medições; exportações XLSX/CSV/PDF de cadastro, EAP, quantitativos, memórias, consolidações e revisões.
**Aceite:** arquivo com duplicados/unidades inválidas/referências inexistentes gera relatório e nada é gravado sem confirmação; exportar → reimportar preserva códigos e quantidades; injeção de fórmula neutralizada.

### F10 — Fichas de levantamento (roteiro revisto em 2026-11-24, após análise das planilhas reais)
**Entregáveis:** motor de fichas no domínio; modelos de ficha versionados com 6 modelos iniciais (cerâmica, parede, fôrma/concreto, aço, rede enterrada, telhado); fichas do empreendimento em grade; lançamento em medições com memória por linha (ADR-020).
**Aceite:** valores das planilhas reais reproduzidos; lançamento sem dupla contagem; relançamento com revisão; medição de ficha não editável à mão; isolamento por organização.

### F11 — Quadros de componentes e materiais
**Entregáveis:** quadros (esquadrias, louças e metais, materiais de instalações) com itens × destinos, L × A, lista padrão e lançamento do quadro de resumo em medições (ADR-021).
**Aceite:** valores das planilhas reproduzidos (ex.: esquadrias 13,1 m²/casa × 362 = 4.742,2 m²); itens do mesmo material somam numa medição por destino; sem dupla contagem; isolamento por organização.

### F12 — Migração das planilhas
**Entregáveis:** envio do XLSX, extrato por aba, plano sugerido (destino, cabeçalho, colunas, unidades), conferência linha a linha contra a planilha e criação de fichas e quadros (ADR-022).
**Aceite:** nenhuma fórmula executada; abas reais reproduzidas com conferência (ex.: Cerâmica MAT 92,44158 m²); plano com problema não grava nada; isolamento por organização.

### F13 — Centro operacional
**Entregáveis:** painel do empreendimento (pendências com motivos, cobertura da EAP, alterações desde a última revisão, atividade), fila de trabalho com revisão e "Minhas tarefas", destino por linha nas fichas (ADR-023).
**Aceite:** pendências somem ao lançar e voltam ao alterar; cobertura conta itens com medição; só o revisor aprova; destinos sobrepostos bloqueados; isolamento por organização.

### F14 — Integração com a outra plataforma
Escopo resumido em `docs/implementation/backlog.md`; detalhamento no início de cada fase.

### F15 — Qualidade e preparação para produção (antes F10)
**Entregáveis:** E2E dos cenários A–D completos, auditoria de segurança independente (subagente dedicado), testes de carga, avaliação de RLS, backup/restore documentado, guia de deploy.
**Aceite:** suíte completa verde; sem achados críticos/altos abertos; documentação de operação.

**Dependências:** F1 → … → F9 → F10 → F11 → F12 → F13 → F14 → F15. F4 pode correr em paralelo a F3 (arquivos distintos); `domain/formula` e `domain/units` podem ser antecipados como pacote puro. Não abrir mais de uma fase de UI ao mesmo tempo.

---

## 11. Estratégia de testes
- `packages/domain`: unitários com resultados conhecidos + testes de propriedade (determinismo, ausência de dupla contagem, diff idempotente).
- API: integração com Postgres real (migrações aplicadas, banco limpo por suíte); matriz de autorização (papéis × endpoints × org/projeto alheio).
- Web: componentes críticos (árvore, formulário de medição, prévia de diff).
- E2E Playwright: um fluxo completo por cenário A–D, cumulativo por fase.
- Regressão: snapshot da EAP gerada por cenário + versão de template.

---

## 12. Riscos e incertezas
| Risco | Impacto | Mitigação |
|---|---|---|
| Escopo muito grande (13 módulos) | Alto | Fases verticais, status registrado, nada declarado pronto sem teste. Cada fase provavelmente exige várias sessões. |
| **Conteúdo técnico dos templates e do catálogo** (grupos padrão da EAP, codificação, serviços, critérios de medição) não fornecido | Alto | Preciso de suas planilhas/EAPs de referência; até lá, templates iniciais próprios marcados como "exemplo editável". |
| Propagação de tipologias e overrides | Alto | Modelo delta + stableKey; testes de cenário antes de UI. |
| Regras de dupla contagem podem não cobrir casos reais | Médio | Validar RN‑DUP com você usando planilhas reais antes da F7. |
| Container efêmero | Alto | Repositório GitHub obrigatório antes da F1; commits frequentes. |
| Docker indisponível aqui | Baixo | Dev/testes com Postgres local; `docker-compose.yml` entregue mas testado só por você. |
| Prisma: `latest` é RC; recursos avançados exigem SQL bruto | Médio | Fixar 7.10.x; SQL bruto revisado em migrações. |
| Desempenho de árvores/consolidações grandes | Médio | Caminho materializado, índices, agregação SQL, virtualização; testes de carga na F10. |
| Formatos de importação desconhecidos | Médio | Mapeamento configurável; preciso de exemplos reais. |
| Integração CAD/BIM futura | Baixo | Apenas pontos de extensão (import CSV, IDs estáveis); nada fictício. |

---

## 13. Insumos que preciso de você
1. **Repositório GitHub** vazio criado (ou autorização para eu criar) e nome do produto.
2. Planilhas reais de levantamento e EAPs de referência (para templates, catálogo e importação).
3. Confirmação dos papéis (OWNER/ADMIN/MEMBER na org; COORDINATOR/EDITOR/VIEWER no projeto).
4. Padrão de codificação da EAP desejado (ex.: `01.02.003`).

---

## 14. Verificação ao fim de cada fase
```
pnpm install && pnpm -r typecheck && pnpm -r lint
pnpm --filter @app/domain test
pnpm --filter @app/api test            # integração contra Postgres local
pnpm --filter @app/web test
pnpm --filter @app/web e2e -- --trace off
```
+ execução real da aplicação (API + web) e verificação manual/Playwright do fluxo entregue; atualização de `docs/implementation/status.md` (Planejada / Em desenvolvimento / Implementada / Testada / Concluída / Bloqueada).

**Primeiro passo após aprovação:** F1, começando por anexar o repositório, criar a documentação permanente (CLAUDE.md, README, ADRs, domínio, banco, regras, backlog) e o esqueleto do monorepo.
