import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { CalcPreviewDto, FormulaDto, FormulaVariableInput, FormulaVersionDto } from '@eapq/contracts';
import { compatibleDimensions, describeDimension } from '@eapq/domain';
import { Breadcrumbs, PageHeader } from '../../app/shell';
import { useAction } from '../../components/ui/actions';
import { Button } from '../../components/ui/button';
import { EmptyState, ErrorState, Loading, Notice } from '../../components/ui/feedback';
import { SelectField, TextArea, TextField } from '../../components/ui/field';
import { SidePanel } from '../../components/ui/panel';
import { api, errorMessage } from '../../lib/api';
import { fmtDateTime } from '../../lib/format';
import { useSession } from '../auth/session';
import { useUnits } from '../library/api';
import { MemoryView } from './memory-view';

export const formulaKeys = { list: ['formulas'] as const };
export const useFormulas = () => useQuery({ queryKey: formulaKeys.list, queryFn: () => api<FormulaDto[]>('GET', '/formulas') });

export function FormulasPage() {
  const { can } = useSession();
  const list = useFormulas();
  const [selected, setSelected] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  if (list.isPending) return <Loading />;
  if (list.isError) return <ErrorState message={errorMessage(list.error)} onRetry={() => list.refetch()} />;
  const current = list.data.find((f) => f.id === selected) ?? list.data[0];
  return (
    <>
      <Breadcrumbs items={[{ label: 'Fórmulas' }]} />
      <PageHeader title="Fórmulas" actions={can('org.manage') && <Button variant="primary" onClick={() => setCreating(true)}>Nova fórmula</Button>}>
        Fórmulas reutilizáveis para levantar quantitativos, com verificação de unidades. Versões publicadas não mudam; medições existentes só são recalculadas quando alguém pede.
      </PageHeader>
      {list.data.length === 0 ? <EmptyState title="Nenhuma fórmula" /> : (
        <div className="grid gap-4 lg:grid-cols-[260px_minmax(0,1fr)]">
          <nav aria-label="Fórmulas" className="self-start border border-line bg-sheet">
            <ul>{list.data.map((f) => {
              const v = f.versions[0];
              return (
                <li key={f.id}>
                  <button type="button" onClick={() => setSelected(f.id)} aria-current={f.id === current?.id ? 'true' : undefined}
                    className={`block w-full border-l-[3px] px-3 py-2 text-left ${f.id === current?.id ? 'border-signal bg-cyan-wash' : 'border-transparent hover:bg-paper'} ${f.archivedAt ? 'text-graphite-400' : ''}`}>
                    <span className="block text-[14px] font-medium">{f.name}</span>
                    <span className="block text-[12.5px] text-muted"><span className="font-mono">{f.code}</span> · R{v?.number} {v?.status === 'DRAFT' ? 'em elaboração' : 'publicada'}{v?.resultDescription && ` · ${v.resultDescription.toLowerCase()}`}</span>
                  </button>
                </li>
              );
            })}</ul>
          </nav>
          {current && <FormulaView key={current.id} formula={current} canEdit={can('org.manage')} />}
        </div>
      )}
      <SidePanel open={creating} title="Nova fórmula" onClose={() => setCreating(false)}>
        {creating && <NewFormula onDone={(id) => { setCreating(false); setSelected(id); }} />}
      </SidePanel>
    </>
  );
}

function NewFormula({ onDone }: { onDone: (id: string) => void }) {
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const act = useAction([formulaKeys.list]);
  return (
    <form className="flex flex-col gap-4" onSubmit={async (e) => {
      e.preventDefault();
      const r = await act.run(() => api<{ id: string }>('POST', '/formulas', { body: { code, name, expression: 'c * l', variables: [{ symbol: 'c', label: 'Comprimento', unit: 'm', constraint: 'positive' }, { symbol: 'l', label: 'Largura', unit: 'm', constraint: 'positive' }] } }));
      if (r && r !== true) onDone(r.id);
    }}>
      {act.error && <Notice tone="danger">{act.error}</Notice>}
      <TextField label="Código" className="font-mono uppercase" value={code} onChange={(e) => setCode(e.target.value)} error={act.fieldErrors.code} />
      <TextField label="Nome" value={name} onChange={(e) => setName(e.target.value)} error={act.fieldErrors.name} />
      <p className="text-[13px] text-muted">A fórmula começa como R1 em elaboração com um exemplo (comprimento × largura) que você edita antes de publicar.</p>
      <div><Button type="submit" variant="primary" busy={act.pending} disabled={!code.trim() || !name.trim()}>Criar fórmula</Button></div>
    </form>
  );
}

function FormulaView({ formula: f, canEdit }: { formula: FormulaDto; canEdit: boolean }) {
  const [vid, setVid] = useState<string | null>(null);
  const v = f.versions.find((x) => x.id === vid) ?? f.versions[0]!;
  const act = useAction([formulaKeys.list]);
  const draft = f.versions.find((x) => x.status === 'DRAFT');
  return (
    <section className="min-w-0" aria-label={f.name}>
      <header className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-mono text-[12.5px] text-muted">{f.code}</p>
          <h2 className="font-display text-[22px] font-semibold">{f.name}</h2>
          {f.description && <p className="max-w-prose text-[14px] text-muted">{f.description}</p>}
        </div>
        {canEdit && !draft && !f.archivedAt && (
          <Button variant="primary" busy={act.pending} onClick={async () => { const r = await act.run(() => api<{ id: string }>('POST', `/formulas/${f.id}/versions`, { body: {} })); if (r && r !== true) setVid(r.id); }}>Nova versão</Button>
        )}
      </header>
      {act.error && <div className="mb-3"><Notice tone="danger">{act.error}</Notice></div>}
      <div role="tablist" aria-label="Versões" className="mb-3 flex flex-wrap gap-1 border-b border-line">
        {f.versions.map((x) => (
          <button key={x.id} type="button" role="tab" aria-selected={x.id === v.id} onClick={() => setVid(x.id)}
            className={`-mb-px border-b-2 px-3 py-2 text-[14px] ${x.id === v.id ? 'border-cyan-ink font-medium' : 'border-transparent text-muted hover:text-ink'}`}>
            <span className="font-mono">R{x.number}</span> {x.status === 'DRAFT' ? 'em elaboração' : 'publicada'}{x.measurementCount > 0 && <span className="ml-1 text-[12px] text-muted">· {x.measurementCount} med.</span>}
          </button>
        ))}
      </div>
      <VersionView key={v.id} formula={f} v={v} editable={canEdit && v.status === 'DRAFT'} onDiscarded={() => setVid(null)} />
    </section>
  );
}

function VersionView({ formula: f, v, editable, onDiscarded }: { formula: FormulaDto; v: FormulaVersionDto; editable: boolean; onDiscarded: () => void }) {
  const units = useUnits();
  const [expression, setExpression] = useState(v.expression);
  const [variables, setVariables] = useState<FormulaVariableInput[]>(v.variables);
  const [confirm, setConfirm] = useState(false);
  const [testing, setTesting] = useState(false);
  const act = useAction([formulaKeys.list]);
  const base = `/formulas/${f.id}/versions/${v.id}`;
  // jsonb reordena chaves: compara em forma normalizada
  const norm = (xs: FormulaVariableInput[]) => JSON.stringify(xs.map((x) => [x.symbol, x.label, x.unit, x.constraint ?? null]));
  const dirty = expression !== v.expression || norm(variables) !== norm(v.variables);
  const setVar = (i: number, patch: Partial<FormulaVariableInput>) => setVariables((xs) => xs.map((x, k) => (k === i ? { ...x, ...patch } : x)));
  const unitOptions = (units.data ?? []).filter((u) => !u.archivedAt);
  return (
    <div className="flex flex-col gap-4">
      <p className="text-[13.5px] text-muted">
        {v.status === 'PUBLISHED' ? `Publicada em ${fmtDateTime(v.publishedAt!)}` : 'Em elaboração'}
        {v.resultDescription && <> · resultado: <span className="text-ink">{v.resultDescription.toLowerCase()}</span></>}
        {v.measurementCount > 0 && <> · usada em <span className="font-mono text-ink">{v.measurementCount}</span> medição(ões)</>}
      </p>
      {act.error && <Notice tone="danger">{act.error}</Notice>}
      {editable ? (
        <TextArea label="Expressão" className="font-mono" rows={2} value={expression} onChange={(e) => setExpression(e.target.value)}
          hint="Operadores + − * / ^ e parênteses. Funções: min, max, abs, sqrt, round, ceil, floor, pi(). Separe argumentos com ponto e vírgula." />
      ) : (
        <div><p className="text-[13px] text-muted">Expressão</p><p className="font-mono text-[15px]">{v.expression}</p></div>
      )}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[560px] border border-line bg-sheet text-left text-[13.5px]">
          <caption className="mb-1 text-left text-[13px] font-medium">Variáveis</caption>
          <thead className="bg-paper text-[12px] text-muted"><tr><th className="px-2 py-1 font-normal">Símbolo</th><th className="px-2 py-1 font-normal">Descrição</th><th className="px-2 py-1 font-normal">Unidade</th><th className="px-2 py-1 font-normal">Restrição</th>{editable && <th />}</tr></thead>
          <tbody>
            {variables.map((x, i) => (
              <tr key={i} className="border-t border-line">
                {editable ? (
                  <>
                    <td className="px-2 py-1"><input aria-label={`Símbolo da variável ${i + 1}`} className="h-8 w-28 rounded-[3px] border border-line-strong px-2 font-mono" value={x.symbol} onChange={(e) => setVar(i, { symbol: e.target.value })} /></td>
                    <td className="px-2 py-1"><input aria-label={`Descrição da variável ${i + 1}`} className="h-8 w-full rounded-[3px] border border-line-strong px-2" value={x.label} onChange={(e) => setVar(i, { label: e.target.value })} /></td>
                    <td className="px-2 py-1"><select aria-label={`Unidade da variável ${i + 1}`} className="h-8 rounded-[3px] border border-line-strong px-1" value={x.unit} onChange={(e) => setVar(i, { unit: e.target.value })}>{unitOptions.map((u) => <option key={u.id} value={u.symbol}>{u.symbol}</option>)}</select></td>
                    <td className="px-2 py-1"><select aria-label={`Restrição da variável ${i + 1}`} className="h-8 rounded-[3px] border border-line-strong px-1" value={x.constraint ?? ''} onChange={(e) => setVar(i, { constraint: (e.target.value || null) as FormulaVariableInput['constraint'] })}><option value="">nenhuma</option><option value="positive">&gt; 0</option><option value="nonnegative">≥ 0</option></select></td>
                    <td className="px-2 py-1"><button type="button" className="text-danger hover:underline" onClick={() => setVariables((xs) => xs.filter((_, k) => k !== i))}>Remover</button></td>
                  </>
                ) : (
                  <><td className="px-2 py-1 font-mono">{x.symbol}</td><td className="px-2 py-1">{x.label}</td><td className="px-2 py-1 font-mono">{x.unit}</td><td className="px-2 py-1">{x.constraint === 'positive' ? '> 0' : x.constraint === 'nonnegative' ? '≥ 0' : '—'}</td></>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {editable && <div><Button onClick={() => setVariables((xs) => [...xs, { symbol: `v${xs.length + 1}`, label: '', unit: 'm', constraint: null }])}>Incluir variável</Button></div>}
      {!dirty && v.issues.length > 0 && editable && (
        <Notice tone="warn"><p className="font-medium">Corrija antes de publicar:</p><ul className="mt-1 list-disc pl-5">{v.issues.map((i, k) => <li key={k}>{i.message}</li>)}</ul></Notice>
      )}
      <div className="flex flex-wrap gap-2 border-t border-line pt-3">
        {editable && <Button variant={dirty ? 'primary' : 'secondary'} disabled={!dirty} busy={act.pending} onClick={() => act.run(() => api('PATCH', base, { body: { expression, variables } }))}>Salvar rascunho</Button>}
        <Button onClick={() => setTesting(true)}>Testar fórmula</Button>
        {editable && !dirty && !confirm && <Button variant="primary" disabled={v.issues.length > 0} onClick={() => setConfirm(true)}>Publicar R{v.number}</Button>}
        {editable && confirm && <><Button variant="ghost" onClick={() => setConfirm(false)}>Cancelar</Button><Button variant="primary" busy={act.pending} onClick={async () => { await act.run(() => api('POST', `${base}/publish`, { body: {} })); setConfirm(false); }}>Confirmar publicação</Button></>}
        {editable && f.versions.some((x) => x.status === 'PUBLISHED') && <Button variant="ghost" onClick={async () => { if (await act.run(() => api('DELETE', base))) onDiscarded(); }}>Descartar rascunho</Button>}
      </div>
      {confirm && <Notice tone="warn">Depois de publicada, a R{v.number} não pode ser alterada. Medições feitas com versões anteriores continuam como estão e aparecem como "fórmula desatualizada" para recálculo explícito.</Notice>}
      <SidePanel open={testing} title={`Testar ${f.code} R${v.number}`} onClose={() => setTesting(false)}>
        {testing && <FormulaTester expression={expression} variables={variables} />}
      </SidePanel>
    </div>
  );
}

function FormulaTester({ expression, variables }: { expression: string; variables: FormulaVariableInput[] }) {
  const units = useUnits();
  const all = useMemo(() => (units.data ?? []).filter((u) => !u.archivedAt), [units.data]);
  const [values, setValues] = useState<Record<string, { value: string; unit: string }>>(Object.fromEntries(variables.map((x) => [x.symbol, { value: '', unit: x.unit }])));
  const [target, setTarget] = useState('');
  const [result, setResult] = useState<CalcPreviewDto | null>(null);
  const act = useAction([]);
  const dimOf = (sym: string) => all.find((u) => u.symbol === sym)?.dimension;
  return (
    <form className="flex flex-col gap-3" onSubmit={async (e) => {
      e.preventDefault();
      setResult(null);
      const r = await act.run(() => api<CalcPreviewDto>('POST', '/formulas/evaluate', { body: { expression, variables, inputs: variables.map((x) => ({ symbol: x.symbol, ...values[x.symbol]! })), unit: target } }));
      if (r && r !== true) setResult(r);
    }}>
      {variables.map((x) => {
        const d = dimOf(x.unit);
        return (
          <div key={x.symbol} className="grid grid-cols-[minmax(0,1fr)_110px] items-end gap-2">
            <TextField label={`${x.label} (${x.symbol})`} inputMode="decimal" value={values[x.symbol]?.value ?? ''} onChange={(e) => setValues((s) => ({ ...s, [x.symbol]: { ...s[x.symbol]!, value: e.target.value } }))} />
            <SelectField label="Unidade" value={values[x.symbol]?.unit} onChange={(e) => setValues((s) => ({ ...s, [x.symbol]: { ...s[x.symbol]!, unit: e.target.value } }))}>
              {all.filter((u) => d && compatibleDimensions(u.dimension, d)).map((u) => <option key={u.id} value={u.symbol}>{u.symbol}</option>)}
            </SelectField>
          </div>
        );
      })}
      <SelectField label="Resultado em" value={target} onChange={(e) => setTarget(e.target.value)}>
        <option value="">Selecione</option>
        {all.map((u) => <option key={u.id} value={u.symbol}>{u.symbol} — {describeDimension(u.dimension).toLowerCase()}</option>)}
      </SelectField>
      {act.error && <Notice tone="danger">{act.error}</Notice>}
      <div><Button type="submit" variant="primary" busy={act.pending} disabled={!target}>Calcular</Button></div>
      {result && <section aria-label="Resultado do teste" className="border-t border-line pt-3"><MemoryView memory={result.memory} /></section>}
    </form>
  );
}
