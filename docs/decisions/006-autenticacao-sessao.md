# ADR-006 — Sessão em cookie + argon2id + CSRF

**Status:** Aceita · **Data:** 2026-11-23

## Contexto
SPA própria servida no mesmo site da API. Necessidade de revogação imediata e proteção contra roubo de token por XSS.

## Decisão
Sessões opacas guardadas no Postgres (apenas hash SHA-256 do token). Cookie httpOnly, SameSite=Lax, Secure em produção (prefixo __Host- em produção). Senhas com argon2id. CSRF: token sincronizador por sessão enviado no header X-CSRF-Token em métodos mutáveis + verificação de Origin. Throttling no login.

## Consequências
+ Revogação, sem tokens em JavaScript. − Requer mesmo site (proxy do Vite em dev; mesmo domínio em produção).
