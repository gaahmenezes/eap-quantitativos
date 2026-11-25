# Backlog técnico

## Roteiro a partir da F10 (centro operacional de levantamento)
- ~~F11 — Quadros de componentes e materiais~~ (concluída, ADR-021).
- **F12 — Migração das planilhas**: importar planilhas existentes (Marupi, Viva Mais Barra, SMR I…) para fichas, com mapeamento por aba e conferência dos totais.
- **F13 — Centro operacional**: painel por empreendimento (fichas pendentes de lançamento, cobertura da EAP, revisões), destino por linha nas fichas, fila de trabalho da equipe.
- **F14 — Integração com a outra plataforma** (definir formato e autenticação com o usuário).
- **F15 — Qualidade e produção** (itens abaixo, antes "F10").

## Decisões da F11 a validar com o usuário
- Lançamento soma por serviço × destino (quadro de resumo); o detalhe por item fica na memória de cálculo.
- Medida por peça só por largura × altura (esquadrias); serviço em m² sem L × A é erro do item.
- Até 3 serviços por item (ex.: janela em un e em m²).
- Lista padrão copia itens e serviços do catálogo; serviços específicos de outro empreendimento são descartados com aviso.
- Avaliar âncora "unidade inteira" de tipologia (hoje exige elemento-raiz, ex.: "Casa").

## Decisões da F10 a validar com o usuário
- Uma ficha tem um único destino (item da EAP + âncora); para pavimentos/trechos diferentes, uma ficha por destino.
- Relançar só cria revisão quando a quantidade ou o valor de alguma linha muda; mudar só um parâmetro que não altera a saída não gera revisão.
- Linha com erro bloqueia o lançamento inteiro (não há lançamento parcial).
- Perda de aço inicial 0 %; transpasse 3,1 %, peça de 6 m e colchão de 0,10 m na rede (valores ajustáveis por ficha).
- Medir a unidade inteira de uma tipologia exige um elemento-raiz (ex.: "Apartamento"); avaliar âncora coringa "unidade inteira".

## F15 — Qualidade e preparação para produção (antes F10)
- E2E completos dos cenários A–D pela interface.
- Auditoria de segurança independente; testes de carga; avaliação de RLS no Postgres como defesa adicional.
- Backup/restore (banco + diretório de arquivos) documentado; guia de implantação; armazenamento de objetos (S3) para os arquivos.
- Avaliar crescimento das fotografias de revisão (linhas efetivas) e estratégia de arquivamento.
- Falha intermitente observada uma vez no `beforeAll` do cenário B de `measurements.test.ts` (não reproduzida em 8 execuções); investigar sob carga.

## Decisões da F9 a validar com o usuário
- Separador padrão do CSV exportado é `;` (Excel em português); na leitura, `;`, `,` e tabulação são detectados.
- Âncoras na planilha de medições: código do cadastro; `REDE/TRECHO` e `REDE/DISPOSITIVO`; nome do elemento físico (precisa ser único); `TIPOLOGIA › caminho do elemento` com a coluna "Unidade habitacional" para medição própria.
- Importação não atualiza registros existentes (só inclui); códigos repetidos são erro.
- Limites: 20 MB por arquivo, 20.000 linhas e 50 colunas por importação.

## Decisões da F8 a validar com o usuário
- Numeração começa em R00 e é sequencial; revisões não têm rascunho: emitir já congela.
- Só coordenadores do empreendimento e administradores da organização emitem revisões.
- A comparação de quantitativos é por item da EAP × serviço; detalhes por outras dimensões estão na consolidação sobre cada revisão.

## Decisões da F7 a validar com o usuário
- Dimensões disponíveis e atalhos (por serviço, por item da EAP, por tipologia, por torre e pavimento, por quadra e lote, por sistema e rede).
- Localização física de trechos pela seção de rua; de dispositivos pela localização informada; de elementos pelo nó do cadastro.
- Unidades arquivadas no cadastro deixam de receber a replicação por tipologia.

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
