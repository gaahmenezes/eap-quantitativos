# ADR-014 — Unidades com dimensão e fator exato; biblioteca de serviços em dois escopos

**Status:** Aceita · **Data:** 2026-11-24

## Contexto
Quantitativos (F6) precisam de unidades com verificação dimensional e conversão sem erro de ponto flutuante. Serviços são reutilizados entre empreendimentos, mas alguns são exclusivos de uma obra, e o catálogo padrão não pode ser comprometido por eles. Nenhuma informação financeira é permitida.

## Decisão
- `unit_of_measure` por organização: expoentes [L, M, T, N] e fator exato `NUMERIC(40,30)` para a base (m, kg, s, un). Conversão só entre dimensões iguais, em decimal (`packages/domain/src/units`). Dimensão e fator ficam imutáveis quando a unidade já é usada (trigger).
- `service` com `projectId` nulo = catálogo da organização (edição por OWNER/ADMIN); preenchido = específico do empreendimento (edição por quem edita o conteúdo do empreendimento). Código único por escopo (índices parciais) e código específico não pode repetir o do catálogo.
- Possível duplicidade é **aviso**, não bloqueio: similaridade de trigramas (`pg_trgm`) sobre a descrição normalizada (sem acentos, caixa ou pontuação).
- Duplicação registra `origin = DUPLICATE` e `derivedFromId`.
- Atributos numéricos do catálogo técnico só aceitam símbolos de unidades cadastradas.
- Nenhum campo de preço, custo, composição ou BDI (regra 1); há teste que verifica isso no DTO.

## Consequências
+ Base sólida para fórmulas com análise dimensional e consolidação. + Serviços específicos não poluem o catálogo.
− Atributos técnicos guardam o símbolo da unidade (texto validado), não a chave; renomear o símbolo de uma unidade em uso não é permitido.
