# Backlog técnico

## Próximo (F4 — Unidades de medida e biblioteca de serviços)
- `UnitOfMeasure` com vetor dimensional e fator para a base (NUMERIC) em `packages/domain/src/units`; conversões testadas com valores conhecidos.
- Ligar os atributos numéricos do catálogo (hoje com símbolo de unidade em texto) ao cadastro formal de unidades.
- Categorias e serviços (padrão da organização e específicos do empreendimento), duplicação, aviso de descrição similar (pg_trgm), código único.
- Sem preços, custos ou composições (regra 1).

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
