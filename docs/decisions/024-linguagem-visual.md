# ADR-024 — Linguagem visual "precisão técnica premium" (etapas 1 e 2)

**Status:** Aceita · **Data:** 2026-11-25

## Contexto
A interface era funcional e densa, mas com aparência de ferramenta interna: borda de 1 px em todo bloco, cantos de 3 px, nenhum ícone, quantidades em fonte monoespaçada e um menu linear com ~20 itens. O público (engenharia de quantitativos) passa o dia em tabelas: a densidade deve ser preservada, com mais hierarquia e acabamento.

## Decisão
**Etapa 1 — base visual**
- **Tipografia**: Inter (variável, com tamanhos ópticos) para toda a interface; **quantidades e códigos com algarismos tabulares e zero cortado** (a classe `font-mono` passa a usar a Inter tabular); JetBrains Mono só para expressões e fórmulas (`font-code`). Fontes empacotadas (@fontsource), sem CDN.
- **Tokens** em `styles.css`: neutros frios, acento cobalto (`--color-cyan-ink`, nome mantido por compatibilidade), estados sóbrios, raios 6/8/12 px e sombras `xs`, `card`, `pop`. Os nomes antigos viram papéis semânticos, sem reescrever as telas.
- **Superfícies**: blocos "cartão" (borda + fundo branco) ganham cantos de 12 px e sombra suave por uma regra transitória de CSS (seletor `:where(...).border.bg-sheet`), até os componentes de superfície da etapa 3.
- **Ícones**: Lucide (SVG, `aria-hidden`, nomes acessíveis inalterados) no menu, botões (`<Button icon={…}>`), avisos por tom, estados vazios, exportação e arquivamento.
- **Componentes base**: botões com variantes e tamanhos; campos com foco em anel, seta de seleção própria; avisos com ícone; painéis com entrada animada (respeitando `prefers-reduced-motion`).

**Etapa 2 — navegação e cabeçalho**
- Menu lateral **agrupado por etapa do trabalho** (Geral, Bibliotecas, Organização; no empreendimento: Visão geral, Cadastro, Levantamento, Quantitativos, Controle), com ícones, indicador de item ativo e **modo recolhido** (só ícones, preferência guardada no navegador).
- **Seletor de empreendimento** no menu, com busca, mostrando nome e código; itens do empreendimento só aparecem com um empreendimento selecionado.
- **Barra superior** fixa com o empreendimento atual, botão de recolher e **busca/comandos (Ctrl/⌘ + K)**: páginas, empreendimentos e, no empreendimento, fichas e quadros, com navegação por teclado.
- Trilha com separadores, cabeçalho de página com título, descrição e ações alinhadas; conteúdo limitado a 1.600 px.
- Celular: menu em gaveta, inerte quando fechado (não recebe foco).

## Consequências
+ A percepção de acabamento muda em todas as telas sem alterar comportamento: os 16 cenários E2E passaram sem mudar seletores.
+ Os nomes acessíveis do menu e dos botões foram preservados.
− A regra de superfície por combinação de classes é provisória; a etapa 3 a substitui por componentes (Card, Table, Badge, Toolbar).
− Ainda não foram feitos: modo escuro, gráficos e as melhorias de grade (etapas 3–5).
