# EAP Quantitativos

Plataforma web para **levantamento cadastral, modelagem física, EAP e quantitativos** de empreendimentos de engenharia civil (vertical, horizontal, loteamento e misto). Substitui planilhas desconectadas por um modelo digital estruturado e rastreável. **Não possui módulos de custo ou orçamento** — por decisão de escopo.

- Plano completo (Fase 0): [`docs/architecture/fase-0-diagnostico-e-plano.md`](docs/architecture/fase-0-diagnostico-e-plano.md)
- Situação de cada funcionalidade: [`docs/implementation/status.md`](docs/implementation/status.md)
- Decisões arquiteturais: [`docs/decisions/`](docs/decisions/README.md)
- Instruções para agentes: [`CLAUDE.md`](CLAUDE.md)

## Stack
React 19 + Vite + Tailwind 4 · NestJS 12 · PostgreSQL 16 + Prisma 7.10 · Vitest · Playwright · pnpm workspaces.

## Primeiros passos
Requisitos: Node 22+, pnpm 10, PostgreSQL 16 (local ou via Docker).

```bash
pnpm install
cp apps/api/.env.example apps/api/.env
pnpm db:up                                   # ou use um PostgreSQL local com os bancos eapq_dev e eapq_test
pnpm --filter @eapq/api prisma:generate
pnpm --filter @eapq/api prisma:migrate
pnpm --filter @eapq/api seed                 # usuário demo@eapq.local (apenas desenvolvimento)
pnpm dev                                     # API em :3000/api, web em :5173
```

Arquivos enviados (planilhas de importação e documentos de origem das medições) ficam em `STORAGE_DIR` (padrão `apps/api/storage`, fora da raiz pública e fora do Git). Faça backup dessa pasta junto com o banco. O limite de upload é `UPLOAD_MAX_MB` (padrão 20).

## Testes
```bash
pnpm lint
pnpm typecheck
pnpm test        # domínio, componentes e integração da API contra o banco de teste (recriado a cada execução)
pnpm e2e         # Playwright: sobe API (:3100) + web (:5174) contra o banco de teste
```
Se o Chromium do Playwright não estiver instalado na versão exata, defina `PW_CHROMIUM_PATH` com o caminho de um Chromium existente.

## Estrutura
```
apps/api            API NestJS (módulos em src/modules), Prisma (prisma/)
apps/web            SPA React (features/<módulo>, components/ui)
packages/domain     Regras de negócio puras e testáveis
packages/contracts  Schemas zod compartilhados entre API e web
docs/               Arquitetura, domínio, banco, regras, ADRs, status
```
