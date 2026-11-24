# ADR-012 — Catálogo técnico por organização, copiado de um padrão

**Status:** Aceita · **Data:** 2026-11-24

## Contexto
Sistemas de infraestrutura e tipos de elemento (PV, boca de lobo, trecho de rede, pavimento, ambiente…) variam entre empresas, e a diretriz exige incluir novos sistemas sem reconstruir a aplicação. Um catálogo global imutável não atende; um catálogo vazio obriga cada organização a começar do zero.

## Decisão
Cada organização tem seu próprio catálogo (`infrastructure_system_type`, `element_type`, `element_attribute_definition`). Na criação da organização, o catálogo padrão de `packages/domain/src/catalog/defaults.ts` é copiado na mesma transação (organizações antigas recebem a cópia no primeiro acesso, de forma idempotente). OWNER/ADMIN editam o catálogo. Atributos com valores já cadastrados não podem ser removidos nem mudar de tipo, e um atributo não pode virar obrigatório quando já existem registros do tipo.

## Consequências
+ Extensível sem migração; cada empresa adapta nomes e atributos. + Nenhum preço ou custo no catálogo (regra 1).
− Melhorias no catálogo padrão não chegam automaticamente às organizações existentes (decisão consciente: não alterar dados do usuário sem ação explícita).
