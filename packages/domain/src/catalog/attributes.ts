/**
 * Atributos técnicos variáveis por tipo de elemento (ADR-010).
 * Definições vêm do catálogo (ElementType); valores ficam em JSONB validado aqui.
 * Números são normalizados para texto decimal (nunca float) — RNF03.
 */
import { Decimal } from 'decimal.js';

export type AttributeDataType = 'NUMBER' | 'TEXT' | 'BOOLEAN' | 'ENUM';

export interface AttributeDefinition {
  key: string;
  label: string;
  dataType: AttributeDataType;
  /** Símbolo da unidade de engenharia (m, m², mm, %…). Catálogo de unidades formal: F4. */
  unit?: string | null;
  required: boolean;
  enumValues?: string[] | null;
  /** Limites para NUMBER (inclusive). */
  min?: string | null;
  max?: string | null;
}

export type AttributeValue = string | boolean;
export type AttributeValues = Record<string, AttributeValue>;

export interface AttributeIssue {
  path: string;
  message: string;
}

const NUMBER_RE = /^-?\d{1,12}([.,]\d{1,6})?$/;
export const ATTRIBUTE_KEY_RE = /^[a-z][a-zA-Z0-9]{0,39}$/;

/** Valida e normaliza valores contra as definições. Chaves desconhecidas são rejeitadas. */
export function validateAttributes(
  defs: readonly AttributeDefinition[],
  input: Record<string, unknown> | null | undefined,
): { values: AttributeValues; issues: AttributeIssue[] } {
  const issues: AttributeIssue[] = [];
  const values: AttributeValues = {};
  const raw = input ?? {};
  const byKey = new Map(defs.map((d) => [d.key, d]));
  for (const key of Object.keys(raw)) {
    if (!byKey.has(key)) issues.push({ path: `attributes.${key}`, message: 'Atributo não definido para este tipo de elemento.' });
  }
  for (const d of defs) {
    const path = `attributes.${d.key}`;
    const v = raw[d.key];
    const empty = v === undefined || v === null || (typeof v === 'string' && v.trim() === '');
    if (empty) {
      if (d.required) issues.push({ path, message: `${d.label} é obrigatório.` });
      continue;
    }
    switch (d.dataType) {
      case 'NUMBER': {
        const s = typeof v === 'number' ? String(v) : typeof v === 'string' ? v.trim() : '';
        if (!NUMBER_RE.test(s)) {
          issues.push({ path, message: `${d.label} deve ser um número com até 6 casas decimais.` });
          break;
        }
        const n = new Decimal(s.replace(',', '.'));
        if (d.min != null && n.lt(d.min)) issues.push({ path, message: `${d.label} deve ser maior ou igual a ${d.min}.` });
        else if (d.max != null && n.gt(d.max)) issues.push({ path, message: `${d.label} deve ser menor ou igual a ${d.max}.` });
        else values[d.key] = n.toString();
        break;
      }
      case 'TEXT': {
        if (typeof v !== 'string') issues.push({ path, message: `${d.label} deve ser texto.` });
        else if (v.trim().length > 200) issues.push({ path, message: `${d.label}: máximo de 200 caracteres.` });
        else values[d.key] = v.trim();
        break;
      }
      case 'BOOLEAN': {
        if (typeof v !== 'boolean') issues.push({ path, message: `${d.label} deve ser sim ou não.` });
        else values[d.key] = v;
        break;
      }
      case 'ENUM': {
        if (typeof v !== 'string' || !(d.enumValues ?? []).includes(v)) {
          issues.push({ path, message: `${d.label}: escolha uma das opções (${(d.enumValues ?? []).join(', ')}).` });
        } else values[d.key] = v;
        break;
      }
    }
  }
  return { values, issues };
}

/** Valida as próprias definições (cadastro de tipos de elemento no catálogo). */
export function validateDefinitions(defs: readonly AttributeDefinition[]): AttributeIssue[] {
  const issues: AttributeIssue[] = [];
  const seen = new Set<string>();
  defs.forEach((d, i) => {
    const p = `attributes.${i}`;
    if (!ATTRIBUTE_KEY_RE.test(d.key)) issues.push({ path: `${p}.key`, message: 'Chave deve começar com letra minúscula e conter só letras e números (ex.: diametroInterno).' });
    if (seen.has(d.key)) issues.push({ path: `${p}.key`, message: `Chave repetida: ${d.key}` });
    seen.add(d.key);
    if (d.dataType === 'ENUM' && (!d.enumValues || d.enumValues.length === 0)) issues.push({ path: `${p}.enumValues`, message: 'Informe as opções da lista.' });
    if (d.dataType !== 'ENUM' && d.enumValues?.length) issues.push({ path: `${p}.enumValues`, message: 'Opções só se aplicam a atributos do tipo lista.' });
    if (d.dataType !== 'NUMBER' && (d.min != null || d.max != null || d.unit)) issues.push({ path: p, message: 'Unidade e limites só se aplicam a atributos numéricos.' });
    if (d.min != null && d.max != null && new Decimal(d.min).gt(d.max)) issues.push({ path: `${p}.min`, message: 'Mínimo maior que o máximo.' });
  });
  return issues;
}
