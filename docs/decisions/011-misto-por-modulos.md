# ADR-011 — Empreendimento misto como composição de módulos

**Status:** Aceita · **Data:** 2026-11-23

## Contexto
Empreendimentos reais combinam torres, casas, loteamento, infraestrutura e áreas comuns.

## Decisão
Project.classification descreve o tipo principal; a estrutura real é composta por ProjectModule (VERTICAL_RESIDENTIAL, HORIZONTAL_RESIDENTIAL, LAND_SUBDIVISION, COMMON_AREAS, INFRASTRUCTURE), cada um com sua subárvore física e seus templates de EAP. Misto = vários módulos.

## Consequências
+ Nenhuma hierarquia rígida imposta. − Gerador de EAP compõe templates por módulo (determinismo garantido por ordenação de módulos).
