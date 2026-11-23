# CLAUDE.md — eap-quantitativos

Plataforma web para **levantamento cadastral + modelagem física + EAP + quantitativos** de empreendimentos de engenharia civil. Plano completo: `docs/architecture/fase-0-diagnostico-e-plano.md`. Status: `docs/implementation/status.md`.

## Regras inegociáveis
1. **Nada financeiro**: sem orçamento, preço, custo, BDI, compras, cronograma financeiro. Recuse e registre se surgir.
2. Cadastro físico (`StructureNode`), EAP (`WbsNode`), serviços (`Service`) e quantitativos (`Measurement`) são entidades separadas, ligadas por ID. Nunca vincular por nome.
3. Quantidades em decimal (`decimal.js` / `NUMERIC`). Nunca `number`/`float` para quantitativos persistidos.
4. Sem `eval`/`Function`/`$queryRawUnsafe`. Fórmulas só pelo parser de `packages/domain/src/formula`.
5. Geração de EAP determinística, baseada em regras de templates versionados. IA generativa não estrutura EAP.
6. Templates publicados, revisões de tipologia, versões de fórmula, revisões de medição e auditoria são **imutáveis**.
7. Toda mutação relevante grava `AuditLog` **na mesma transação** (`AuditService.record(tx, …)`).
8. Todo acesso passa por organização + projeto + papel no backend. Recurso de outra organização ⇒ 404.
9. Toda tabela de tenant tem `organizationId`; relacionamentos entre tenants protegidos por FK composta.
10. Não declarar funcionalidade pronta sem testes passando e `status.md` atualizado.

## Estrutura
```
apps/api        NestJS 12 + Prisma 7 (PostgreSQL 16). Módulos em src/modules/<módulo>
apps/web        React 19 + Vite + Tailwind 4 + TanStack Query + React Router
packages/domain Regras puras (sem framework/IO): fórmulas, unidades, EAP, consolidação
packages/contracts Schemas zod compartilhados (validação front + back)
docs/           arquitetura, domínio, banco, decisões (ADRs), implementação
```
Camadas da API: controller (HTTP fino) → service (caso de uso: autorização, transação, auditoria) → domain (puro) → Prisma.

## Comandos
```
pnpm install
pnpm db:up               # Postgres via docker compose (ou Postgres local) — ver README
pnpm --filter @eapq/api prisma:migrate   # aplica migrações
pnpm dev                 # api :3000 + web :5173
pnpm typecheck && pnpm lint && pnpm test
pnpm e2e                  # Playwright (PW_CHROMIUM_PATH se necessário)
```

## Convenções
- Código/identificadores em inglês; UI, mensagens de erro e docs de produto em pt-BR.
- Erros HTTP no formato problem+json (`{ type, title, status, detail, code, errors? }`).
- Entidades editáveis têm `version` (bloqueio otimista): cliente envia `If-Match: <version>`; divergência ⇒ 409.
- Exclusão de dado referenciado = arquivamento (`archivedAt`).
- Testes: Vitest. API testa contra Postgres real (`DATABASE_URL` de teste). Casos críticos com resultados conhecidos.
- Novas decisões arquiteturais ⇒ novo ADR em `docs/decisions/`.
