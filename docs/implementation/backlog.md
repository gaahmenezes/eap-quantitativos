# Backlog técnico

## Próximo (F7 — Consolidação)
- Serviço de consolidação em SQL a partir das linhas efetivas (replicação por tipologia aplicada) + implementação de referência em `packages/domain` e testes de equivalência.
- Dimensões: item/nível da EAP, serviço, categoria, módulo, torre/pavimento/quadra/lote, tipologia, sistema/rede; filtros e drill-down até a memória de cálculo.
- Conversão para a unidade do serviço quando a unidade de uma revisão antiga diferir da atual.
- Desempenho (RNF06): ≥ 200.000 linhas efetivas em < 2 s.

## Decisões da F6 a validar com o usuário
- Contagem (un, pç) é tratada como adimensional nas fórmulas; constantes com unidade (ex.: folga de 0,10 m) devem ser declaradas como variável.
- Medição de tipologia é ligada ao elemento pela chave estável (vale para todas as revisões que contêm o elemento); medição própria de uma unidade substitui a da tipologia.
- Disjunção vale por item da EAP × serviço; o mesmo serviço pode ser medido em itens diferentes da EAP.
- Fórmulas iniciais são exemplos editáveis.

## Decisões da F5 a validar com o usuário
- Templates iniciais (vertical, horizontal, loteamento, áreas comuns, infraestrutura) e seus serviços sugeridos são exemplos editáveis — ajuste ao padrão de EAP da empresa.
- Na tela da EAP, apenas módulos e o primeiro nível ficam abertos por padrão; o restante abre sob demanda ou pela busca.
- A chave estável dos nós de template não é editável (alterá-la equivaleria a remover e recriar os nós gerados).

## Decisões da F4 a validar com o usuário
- Unidades e serviços iniciais (exemplo editável); "verba" não foi incluída por ter conotação financeira — use "cj" (conjunto) ou "un".
- Limiar de similaridade de descrição: 0,45 (trigramas); ajuste se gerar avisos demais ou de menos.
- Código de serviço específico do empreendimento não pode repetir um código do catálogo da organização.

## Decisões da F3 a validar com o usuário
- Catálogo padrão inicial (sistemas, dispositivos, trechos e elementos com atributos) — ajuste os nomes e atributos ao padrão da empresa.
- Declividade calculada pelas cotas de fundo do trecho; na ausência delas, pelas cotas de fundo dos dispositivos.
- Propagação de revisão de tipologia sempre manual, com confirmação para unidades com particularidades em conflito.

## Decisões da F2 a validar com o usuário
- Numeração padrão de apartamentos: pavimento + final com 2 dígitos (Apto 101 … 1004). Térreo opcional, sem unidades.
- Casas em lotes: uma casa por lote, tipologias distribuídas em sequência na ordem das quadras e lotes.
- Mover itens entre módulos não é permitido (evita misturar domínios); use duplicar + arquivar.

## Dívidas e melhorias registradas
- Recuperação de senha por e-mail (exige serviço de e-mail — definir provedor).
- Troca de organização ativa na sessão para usuários com múltiplas organizações (hoje usa a primeira).
- Logs estruturados (pino) com `requestId` — hoje usa o Logger do Nest.
- Limpeza periódica de sessões expiradas.
- Rate limit em memória: trocar por store compartilhado se houver mais de uma instância da API.
- Avaliar RLS no PostgreSQL (F10).
- Playwright do projeto (1.65) difere do Chromium pré-instalado neste ambiente; usar `PW_CHROMIUM_PATH`.
- Códigos hierárquicos têm largura mínima por nível (2, 2, 3…); com mais de 99 itens num nível de largura 2 o código cresce para 3 dígitos — a ordenação usa a posição, não o texto do código.
- TypeScript fixado em 5.9 (TS 7 nativo ainda não validado com decorators do NestJS).
