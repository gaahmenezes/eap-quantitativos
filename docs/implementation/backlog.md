# Backlog técnico

## Próximo (F2 — Cadastro físico)
- Migração: `ProjectModule`, `StructureNode` (adjacência + `path`), `DwellingUnit`, `LotDetail`, `DwellingTypology` (básico).
- `packages/domain`: matriz de pais permitidos por `kind`; geração do cadastro a partir dos parâmetros do assistente (função pura, determinística); recálculo de códigos ao mover.
- API: árvore (listar subárvore, criar, mover, reordenar, duplicar, arquivar) com auditoria e If-Match.
- Web: assistente condicional por classificação com prévia; árvore virtualizada com inspector lateral.
- Aceite: cenários A (2 torres × 10 pav.) e B (120 casas 60/40/20) com contagens exatas.

## Dívidas e melhorias registradas
- Recuperação de senha por e-mail (exige serviço de e-mail — definir provedor).
- Troca de organização ativa na sessão para usuários com múltiplas organizações (hoje usa a primeira).
- Logs estruturados (pino) com `requestId` — hoje usa o Logger do Nest.
- Limpeza periódica de sessões expiradas.
- Rate limit em memória: trocar por store compartilhado se houver mais de uma instância da API.
- Avaliar RLS no PostgreSQL (F10).
- Playwright do projeto (1.65) difere do Chromium pré-instalado neste ambiente; usar `PW_CHROMIUM_PATH`.
- TypeScript fixado em 5.9 (TS 7 nativo ainda não validado com decorators do NestJS).
