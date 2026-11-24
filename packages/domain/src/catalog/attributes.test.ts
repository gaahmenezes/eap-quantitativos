import { describe, expect, it } from 'vitest';
import { validateAttributes, validateDefinitions, type AttributeDefinition } from './attributes.js';
import { DEFAULT_ELEMENT_TYPES, DEFAULT_SYSTEM_TYPES } from './defaults.js';

const defs: AttributeDefinition[] = [
  { key: 'diametro', label: 'Diâmetro', dataType: 'NUMBER', unit: 'mm', required: true, min: '0' },
  { key: 'material', label: 'Material', dataType: 'ENUM', enumValues: ['PVC', 'Concreto'], required: false },
  { key: 'enterrado', label: 'Enterrado', dataType: 'BOOLEAN', required: false },
  { key: 'obs', label: 'Observação', dataType: 'TEXT', required: false },
];

describe('validateAttributes', () => {
  it('normaliza números como texto decimal (vírgula aceita, sem float)', () => {
    const r = validateAttributes(defs, { diametro: '600,50', material: 'PVC', enterrado: true });
    expect(r.issues).toEqual([]);
    expect(r.values).toEqual({ diametro: '600.5', material: 'PVC', enterrado: true });
  });
  it('rejeita obrigatório ausente, opção inválida, chave desconhecida e limite', () => {
    const r = validateAttributes(defs, { material: 'Aço', cor: 'azul', obs: 'x' });
    expect(r.issues.map((i) => i.path).sort()).toEqual(['attributes.cor', 'attributes.diametro', 'attributes.material']);
    expect(validateAttributes(defs, { diametro: '-1' }).issues[0]?.message).toMatch(/maior ou igual a 0/);
    expect(validateAttributes(defs, { diametro: '1e3' }).issues).toHaveLength(1);
  });
});

describe('validateDefinitions e catálogo padrão', () => {
  it('rejeita chaves inválidas/repetidas e listas sem opções', () => {
    const issues = validateDefinitions([
      { key: 'Diametro', label: 'x', dataType: 'NUMBER', required: false },
      { key: 'a', label: 'a', dataType: 'ENUM', required: false },
      { key: 'a', label: 'b', dataType: 'TEXT', required: false, unit: 'm' },
    ]);
    expect(issues.map((i) => i.path)).toEqual(['attributes.0.key', 'attributes.1.enumValues', 'attributes.2.key', 'attributes.2']);
  });
  it('catálogo padrão é válido e cada tipo aponta para um sistema existente', () => {
    const codes = new Set(DEFAULT_SYSTEM_TYPES.map((s) => s.code));
    for (const t of DEFAULT_ELEMENT_TYPES) {
      expect(validateDefinitions(t.attributes), t.code).toEqual([]);
      if (t.systemCode) expect(codes.has(t.systemCode), t.code).toBe(true);
      if (t.category !== 'ELEMENT') expect(DEFAULT_SYSTEM_TYPES.find((s) => s.code === t.systemCode)?.networkBased, t.code).toBe(true);
    }
    expect(new Set(DEFAULT_ELEMENT_TYPES.map((t) => t.code)).size).toBe(DEFAULT_ELEMENT_TYPES.length);
  });
});
