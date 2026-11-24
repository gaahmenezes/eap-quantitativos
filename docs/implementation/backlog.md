# Backlog técnico

## Próximo (F3 — Infraestrutura e construtivo)
- Catálogo `InfrastructureSystemType` por organização (extensível sem migração) e `InfrastructureSystem` no empreendimento.
- Redes, dispositivos (PV, BL, caixas) e segmentos PV-a-PV com atributos tipados (comprimento, diâmetro, material, cotas, profundidades, declividade derivada) — ADR-010.
- `ElementType` + definições de atributos; `PhysicalElement` validado contra o tipo.
- Tipologias com revisões imutáveis (`TypologyRevision`) e elementos com `stableKey`; vínculo da unidade a uma revisão publicada; `UnitOverride` estrutural.
- Aceite: cenário C com drenagem, água e esgoto por trechos; particularidade de unidade preservada após nova revisão da tipologia.

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
