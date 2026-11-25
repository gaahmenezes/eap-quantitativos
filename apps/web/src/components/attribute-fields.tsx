import type { AttributeDefinitionDto, ElementTypeDto } from '@eapq/contracts';

export type AttrValues = Record<string, string | boolean>;

const control = 'h-9 w-full rounded-md border border-line-strong bg-sheet px-2.5 text-[14px] aria-[invalid=true]:border-danger';

/** Campos gerados a partir das definições de atributos do tipo de elemento (ADR-010). */
export function AttributeFields({ defs, values, onChange, errors, idPrefix }: {
  defs: AttributeDefinitionDto[];
  values: AttrValues;
  onChange: (v: AttrValues) => void;
  errors?: Record<string, string>;
  idPrefix: string;
}) {
  if (!defs.length) return <p className="text-[13px] text-muted">Este tipo não possui atributos técnicos.</p>;
  const set = (k: string, v: string | boolean) => onChange({ ...values, [k]: v });
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {defs.map((d) => {
        const id = `${idPrefix}-${d.key}`;
        const err = errors?.[`attributes.${d.key}`];
        const label = `${d.label}${d.unit ? ` (${d.unit})` : ''}${d.required ? ' *' : ''}`;
        return (
          <div key={d.key} className="flex flex-col gap-1">
            {d.dataType === 'BOOLEAN' ? (
              <label htmlFor={id} className="flex items-center gap-2 pt-6 text-[14px]">
                <input id={id} type="checkbox" checked={values[d.key] === true} onChange={(e) => set(d.key, e.target.checked)} /> {label}
              </label>
            ) : (
              <>
                <label htmlFor={id} className="text-[13px] font-medium text-graphite-800">{label}</label>
                {d.dataType === 'ENUM' ? (
                  <select id={id} className={control} aria-invalid={!!err} value={String(values[d.key] ?? '')} onChange={(e) => set(d.key, e.target.value)}>
                    <option value="">{d.required ? 'Selecione' : 'Não informado'}</option>
                    {(d.enumValues ?? []).map((o) => <option key={o} value={o}>{o}</option>)}
                  </select>
                ) : (
                  <input id={id} className={`${control} ${d.dataType === 'NUMBER' ? 'text-right font-mono' : ''}`} aria-invalid={!!err}
                    inputMode={d.dataType === 'NUMBER' ? 'decimal' : undefined} value={String(values[d.key] ?? '')} onChange={(e) => set(d.key, e.target.value)} />
                )}
              </>
            )}
            {err && <p className="text-[12.5px] text-danger">{err}</p>}
          </div>
        );
      })}
    </div>
  );
}

/** Remove valores vazios antes de enviar (a API trata ausente como "não informado"). */
export const cleanAttrs = (v: AttrValues): AttrValues => Object.fromEntries(Object.entries(v).filter(([, x]) => x !== '' && x !== false));

const fmtNum = (v: string) => (/^-?\d+(\.\d+)?$/.test(v) ? Number(v).toLocaleString('pt-BR', { maximumFractionDigits: 6 }) : v);

/** Resumo legível dos atributos (rótulo: valor unidade). */
export function attributeSummary(type: ElementTypeDto | undefined, values: Record<string, unknown> | null | undefined): string {
  if (!type || !values) return '';
  return type.attributes
    .filter((d) => values[d.key] !== undefined && values[d.key] !== '')
    .map((d) => {
      const v = values[d.key];
      const shown = typeof v === 'boolean' ? (v ? 'sim' : 'não') : d.dataType === 'NUMBER' ? fmtNum(String(v)) : String(v);
      return `${d.label}: ${shown}${d.unit && d.dataType === 'NUMBER' ? ` ${d.unit}` : ''}`;
    })
    .join('; ');
}

export const fmtDecimal = (v: string | null | undefined, digits = 3) =>
  v == null ? '—' : Number(v).toLocaleString('pt-BR', { minimumFractionDigits: digits, maximumFractionDigits: digits });
