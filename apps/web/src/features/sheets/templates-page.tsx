import { useMemo, useState } from 'react';
import type { SheetDefInput, SheetTemplateDto, SheetTemplateVersionDto } from '@eapq/contracts';
import { compileSheet, type SheetDef } from '@eapq/domain';
import { Breadcrumbs, PageHeader } from '../../app/shell';
import { useAction } from '../../components/ui/actions';
import { Button } from '../../components/ui/button';
import { EmptyState, ErrorState, Loading, Notice } from '../../components/ui/feedback';
import { TextArea, TextField } from '../../components/ui/field';
import { SidePanel } from '../../components/ui/panel';
import { api, errorMessage } from '../../lib/api';
import { fmtDateTime } from '../../lib/format';
import { useSession } from '../auth/session';
import { useUnits } from '../library/api';
import { sheetKeys, useSheetTemplates } from './api';

type Col = SheetDefInput['columns'][number];
const KIND: Record<string, string> = { input: 'digitada', calc: 'calculada' };
const TYPE: Record<string, string> = { number: 'número', text: 'texto', choice: 'opções' };

export function SheetTemplatesPage() {
  const { can } = useSession();
  const list = useSheetTemplates();
  const [selected, setSelected] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  if (list.isPending) return <Loading />;
  if (list.isError) return <ErrorState message={errorMessage(list.error)} onRetry={() => list.refetch()} />;
  const current = list.data.find((t) => t.id === selected) ?? list.data[0];
  return (
    <>
      <Breadcrumbs items={[{ label: 'Modelos de ficha' }]} />
      <PageHeader title="Modelos de ficha" actions={can('org.manage') && <Button variant="primary" onClick={() => setCreating(true)}>Novo modelo</Button>}>
        Fichas de levantamento no lugar das planilhas: colunas digitadas a partir do projeto, colunas calculadas, parâmetros (perdas, transpasse) e tabelas de consulta. Versões publicadas não mudam.
      </PageHeader>
      {list.data.length === 0 ? <EmptyState title="Nenhum modelo de ficha" /> : (
        <div className="grid gap-4 lg:grid-cols-[260px_minmax(0,1fr)]">
          <nav aria-label="Modelos de ficha" className="self-start border border-line bg-sheet">
            <ul>{list.data.map((t) => {
              const v = t.versions[0];
              return (
                <li key={t.id}>
                  <button type="button" onClick={() => setSelected(t.id)} aria-current={t.id === current?.id ? 'true' : undefined}
                    className={`block w-full border-l-[3px] px-3 py-2 text-left ${t.id === current?.id ? 'border-signal bg-cyan-wash' : 'border-transparent hover:bg-paper'} ${t.archivedAt ? 'text-graphite-400' : ''}`}>
                    <span className="block text-[14px] font-medium">{t.name}</span>
                    <span className="block text-[12.5px] text-muted"><span className="font-mono">{t.code}</span> · R{v?.number} {v?.status === 'DRAFT' ? 'em elaboração' : 'publicada'}</span>
                  </button>
                </li>
              );
            })}</ul>
          </nav>
          {current && <TemplateView key={current.id} template={current} canEdit={can('org.manage')} />}
        </div>
      )}
      <SidePanel open={creating} title="Novo modelo de ficha" onClose={() => setCreating(false)}>
        {creating && <NewTemplate onDone={(id) => { setCreating(false); setSelected(id); }} />}
      </SidePanel>
    </>
  );
}

const STARTER: SheetDefInput = {
  columns: [
    { key: 'local', label: 'Local', kind: 'input', type: 'text', required: true },
    { key: 'comprimento', label: 'Comprimento', kind: 'input', type: 'number', unit: 'm', required: true },
    { key: 'largura', label: 'Largura', kind: 'input', type: 'number', unit: 'm', required: true },
    { key: 'area', label: 'Área', kind: 'calc', type: 'number', unit: 'm²', expression: 'comprimento * largura' },
  ],
  params: [], tables: [], outputs: [{ key: 'area', label: 'Área', column: 'area' }],
};

function NewTemplate({ onDone }: { onDone: (id: string) => void }) {
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const act = useAction([sheetKeys.templates]);
  return (
    <form className="flex flex-col gap-4" onSubmit={async (e) => {
      e.preventDefault();
      const r = await act.run(() => api<{ id: string }>('POST', '/sheet-templates', { body: { code, name, definition: STARTER } }));
      if (r && r !== true) onDone(r.id);
    }}>
      {act.error && <Notice tone="danger">{act.error}</Notice>}
      <TextField label="Código" className="font-mono uppercase" value={code} onChange={(e) => setCode(e.target.value)} error={act.fieldErrors.code} />
      <TextField label="Nome" value={name} onChange={(e) => setName(e.target.value)} error={act.fieldErrors.name} />
      <p className="text-[13px] text-muted">O modelo começa como R1 em elaboração com um exemplo (comprimento × largura), que você edita antes de publicar.</p>
      <div><Button type="submit" variant="primary" busy={act.pending} disabled={!code.trim() || !name.trim()}>Criar modelo</Button></div>
    </form>
  );
}

function TemplateView({ template: t, canEdit }: { template: SheetTemplateDto; canEdit: boolean }) {
  const [vid, setVid] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const act = useAction([sheetKeys.templates]);
  const v = t.versions.find((x) => x.id === vid) ?? t.versions[0]!;
  const draft = t.versions.find((x) => x.status === 'DRAFT');
  return (
    <section aria-label={t.name} className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3 border border-line bg-sheet p-4">
        <div>
          <h2 className="text-[18px] font-semibold">{t.name} <span className="font-mono text-[14px] text-muted">{t.code}</span></h2>
          {t.description && <p className="text-[13.5px] text-muted">{t.description}</p>}
          <div className="mt-2 flex flex-wrap gap-1.5" role="tablist" aria-label="Versões">
            {t.versions.map((x) => (
              <button key={x.id} type="button" role="tab" aria-selected={x.id === v.id} onClick={() => { setVid(x.id); setEditing(false); }}
                className={`rounded-[3px] border px-2 py-0.5 font-mono text-[12.5px] ${x.id === v.id ? 'border-signal bg-cyan-wash' : 'border-line'}`}>
                R{x.number} {x.status === 'DRAFT' ? '· rascunho' : ''}
              </button>
            ))}
          </div>
        </div>
        {canEdit && !t.archivedAt && (
          <div className="flex flex-wrap gap-2">
            {!draft && <Button onClick={async () => { const r = await act.run(() => api<{ id: string }>('POST', `/sheet-templates/${t.id}/versions`, { body: {} })); if (r && r !== true) { setVid(r.id); setEditing(true); } }}>Nova versão</Button>}
            {v.status === 'DRAFT' && !editing && <Button onClick={() => setEditing(true)}>Editar rascunho</Button>}
            {v.status === 'DRAFT' && <Button variant="primary" busy={act.pending} disabled={v.issues.length > 0} onClick={() => act.run(() => api('POST', `/sheet-templates/${t.id}/versions/${v.id}/publish`, { body: {} }))}>Publicar R{v.number}</Button>}
            {v.status === 'DRAFT' && t.versions.length > 1 && <Button variant="ghost" onClick={() => act.run(() => api('DELETE', `/sheet-templates/${t.id}/versions/${v.id}`))}>Descartar rascunho</Button>}
          </div>
        )}
      </div>
      {act.error && <Notice tone="danger">{act.error}</Notice>}
      {v.status === 'DRAFT' && v.issues.length > 0 && !editing && (
        <Notice tone="warn"><p className="font-medium">Corrija antes de publicar:</p><ul className="list-disc pl-5">{v.issues.map((i, k) => <li key={k}>{i.message}</li>)}</ul></Notice>
      )}
      {editing && v.status === 'DRAFT' ? <DefinitionEditor templateId={t.id} version={v} onDone={() => setEditing(false)} /> : <DefinitionView version={v} />}
    </section>
  );
}

function DefinitionView({ version: v }: { version: SheetTemplateVersionDto }) {
  const d = v.definition;
  return (
    <div className="flex flex-col gap-4 text-[13.5px]">
      <p className="text-muted">{v.status === 'PUBLISHED' ? `Publicada em ${fmtDateTime(v.publishedAt!)}` : 'Em elaboração'} · {v.sheetCount} ficha(s) ativa(s) usam esta versão{v.notes && ` · ${v.notes}`}</p>
      <div className="overflow-x-auto border border-line bg-sheet">
        <table className="w-full min-w-[640px] text-left">
          <caption className="px-3 py-2 text-left font-medium">Colunas</caption>
          <thead className="bg-paper text-[12px] text-muted"><tr><th className="px-3 py-1 font-normal">Chave</th><th className="px-3 py-1 font-normal">Título</th><th className="px-3 py-1 font-normal">Tipo</th><th className="px-3 py-1 font-normal">Unidade</th><th className="px-3 py-1 font-normal">Cálculo / opções</th></tr></thead>
          <tbody>{d.columns.map((c) => (
            <tr key={c.key} className="border-t border-line">
              <td className="px-3 py-1.5 font-mono">{c.key}</td>
              <td className="px-3 py-1.5">{c.label}{c.required && <span className="text-danger"> *</span>}</td>
              <td className="px-3 py-1.5">{KIND[c.kind]} · {TYPE[c.type]}</td>
              <td className="px-3 py-1.5 font-mono">{c.unit ?? ''}</td>
              <td className="px-3 py-1.5 font-mono text-[12.5px]">{c.kind === 'calc' ? c.expression : c.options?.join(' | ')}{c.defaultValue ? <span className="font-sans text-muted"> padrão: {c.defaultValue}</span> : null}</td>
            </tr>
          ))}</tbody>
        </table>
      </div>
      {d.params.length > 0 && (
        <p><span className="font-medium">Parâmetros: </span>{d.params.map((p) => <span key={p.key} className="mr-3"><span className="font-mono">{p.key}</span> {p.label} = {p.value.replace('.', ',')} {p.unit}</span>)}</p>
      )}
      {d.tables.map((t) => (
        <details key={t.key} className="border border-line bg-sheet p-3">
          <summary className="cursor-pointer font-medium">Tabela {t.label} <span className="font-mono text-muted">tabela("{t.key}"; …)</span></summary>
          <p className="mt-1 text-[12.5px] text-muted">Chave {t.keyType === 'number' ? `em ${t.keyUnit ?? 'número'}` : 'em texto'} → valor em {t.valueUnit} · {t.mode === 'exact' ? 'busca exata' : 'primeira faixa ≥ valor'}</p>
          <p className="mt-1 font-mono text-[12.5px]">{t.rows.map((r) => `${r.key} → ${r.value}`).join(' · ')}</p>
        </details>
      ))}
      <p><span className="font-medium">Saídas (viram quantitativos): </span>{d.outputs.map((o) => <span key={o.key} className="mr-3">{o.label} <span className="text-muted">= Σ {o.column}{o.suggestedService && ` → ${o.suggestedService}`}</span></span>)}</p>
    </div>
  );
}

const lines = (rows: { key: string; value: string }[]) => rows.map((r) => `${r.key}; ${r.value}`).join('\n');
const parseLines = (s: string) => s.split('\n').map((l) => l.split(';').map((x) => x.trim())).filter((p) => p[0]).map(([key, value]) => ({ key: key!, value: (value ?? '').replace(',', '.') }));

/** Editor do rascunho com verificação imediata (mesmo motor do servidor). */
function DefinitionEditor({ templateId, version, onDone }: { templateId: string; version: SheetTemplateVersionDto; onDone: () => void }) {
  const units = useUnits();
  const [d, setD] = useState<SheetDefInput>(version.definition);
  const [tables, setTables] = useState(() => version.definition.tables.map((t) => ({ ...t, text: lines(t.rows) })));
  const act = useAction([sheetKeys.templates]);
  const def: SheetDefInput = { ...d, tables: tables.map(({ text, ...t }) => ({ ...t, rows: parseLines(text) })) };
  const issues = useMemo(() => (units.data ? compileSheet(def as SheetDef, units.data.filter((u) => !u.archivedAt)).issues : []), [def, units.data]);
  const setCol = (i: number, patch: Partial<Col>) => setD((x) => ({ ...x, columns: x.columns.map((c, k) => (k === i ? { ...c, ...patch } : c)) }));
  const move = (i: number, dir: -1 | 1) => setD((x) => { const cs = [...x.columns]; const j = i + dir; if (j < 0 || j >= cs.length) return x; [cs[i], cs[j]] = [cs[j]!, cs[i]!]; return { ...x, columns: cs }; });
  const input = 'h-8 w-full rounded-[3px] border border-line-strong bg-sheet px-2 text-[13px]';
  return (
    <form className="flex flex-col gap-4" onSubmit={async (e) => {
      e.preventDefault();
      const r = await act.run(() => api('PATCH', `/sheet-templates/${templateId}/versions/${version.id}`, { body: { definition: def } }));
      if (r) onDone();
    }}>
      <div className="overflow-x-auto border border-line bg-sheet">
        <table className="w-full min-w-[980px] text-left text-[13px]">
          <caption className="px-3 py-2 text-left font-medium">Colunas <span className="font-normal text-muted">— calculadas usam as chaves das colunas e dos parâmetros: + − * / ^, se(cond; a; b), tabela("chave"; valor), min, max, ceil, floor, round, pi()</span></caption>
          <thead className="bg-paper text-[12px] text-muted"><tr>{['Chave', 'Título', 'Tipo', 'Valor', 'Unid.', 'Obrig.', 'Opções (|) ou cálculo', 'Padrão', ''].map((h) => <th key={h} className="px-2 py-1 font-normal">{h}</th>)}</tr></thead>
          <tbody>{d.columns.map((c, i) => (
            <tr key={i} className="border-t border-line align-top">
              <td className="p-1 w-28"><input aria-label={`Chave da coluna ${i + 1}`} className={`${input} font-mono`} value={c.key} onChange={(e) => setCol(i, { key: e.target.value })} /></td>
              <td className="p-1 w-40"><input aria-label={`Título da coluna ${i + 1}`} className={input} value={c.label} onChange={(e) => setCol(i, { label: e.target.value })} /></td>
              <td className="p-1 w-28"><select aria-label={`Tipo da coluna ${i + 1}`} className={input} value={c.kind} onChange={(e) => setCol(i, { kind: e.target.value as Col['kind'], ...(e.target.value === 'calc' && { type: c.type === 'choice' ? 'number' : c.type, expression: c.expression ?? '' }) })}><option value="input">digitada</option><option value="calc">calculada</option></select></td>
              <td className="p-1 w-24"><select aria-label={`Valor da coluna ${i + 1}`} className={input} value={c.type} onChange={(e) => setCol(i, { type: e.target.value as Col['type'] })}><option value="number">número</option><option value="text">texto</option>{c.kind === 'input' && <option value="choice">opções</option>}</select></td>
              <td className="p-1 w-20">{c.type === 'number' && <input aria-label={`Unidade da coluna ${i + 1}`} list="sheet-units" className={`${input} font-mono`} value={c.unit ?? ''} onChange={(e) => setCol(i, { unit: e.target.value || null })} />}</td>
              <td className="p-1 w-12 text-center">{c.kind === 'input' && <input type="checkbox" aria-label={`Obrigatória (coluna ${i + 1})`} checked={!!c.required} onChange={(e) => setCol(i, { required: e.target.checked })} />}</td>
              <td className="p-1">
                {c.kind === 'calc' ? <input aria-label={`Cálculo da coluna ${i + 1}`} className={`${input} font-mono`} value={c.expression ?? ''} onChange={(e) => setCol(i, { expression: e.target.value })} />
                  : c.type === 'choice' ? <input aria-label={`Opções da coluna ${i + 1}`} className={input} value={(c.options ?? []).join(' | ')} onChange={(e) => setCol(i, { options: e.target.value.split('|').map((x) => x.trim()).filter(Boolean) })} /> : null}
              </td>
              <td className="p-1 w-24">{c.kind === 'input' && <input aria-label={`Padrão da coluna ${i + 1}`} className={input} value={c.defaultValue ?? ''} onChange={(e) => setCol(i, { defaultValue: e.target.value || null })} />}</td>
              <td className="whitespace-nowrap p-1">
                <button type="button" className="px-1 text-muted hover:text-ink" aria-label={`Subir coluna ${i + 1}`} onClick={() => move(i, -1)}>↑</button>
                <button type="button" className="px-1 text-muted hover:text-ink" aria-label={`Descer coluna ${i + 1}`} onClick={() => move(i, 1)}>↓</button>
                <button type="button" className="px-1 text-danger" aria-label={`Remover coluna ${i + 1}`} onClick={() => setD((x) => ({ ...x, columns: x.columns.filter((_, k) => k !== i) }))}>×</button>
              </td>
            </tr>
          ))}</tbody>
        </table>
        <div className="flex gap-2 border-t border-line p-2">
          <Button onClick={() => setD((x) => ({ ...x, columns: [...x.columns, { key: `col${x.columns.length + 1}`, label: 'Nova coluna', kind: 'input', type: 'number', unit: 'm' }] }))}>Coluna digitada</Button>
          <Button onClick={() => setD((x) => ({ ...x, columns: [...x.columns, { key: `calc${x.columns.length + 1}`, label: 'Novo cálculo', kind: 'calc', type: 'number', unit: null, expression: '' }] }))}>Coluna calculada</Button>
        </div>
        <datalist id="sheet-units">{(units.data ?? []).filter((u) => !u.archivedAt).map((u) => <option key={u.id} value={u.symbol}>{u.name}</option>)}</datalist>
      </div>

      <fieldset className="border border-line bg-sheet p-3">
        <legend className="px-1 font-medium">Parâmetros</legend>
        <div className="flex flex-col gap-2">
          {d.params.map((p, i) => (
            <div key={i} className="grid grid-cols-[120px_minmax(0,1fr)_90px_80px_auto] gap-2">
              <input aria-label={`Chave do parâmetro ${i + 1}`} className={`${input} font-mono`} value={p.key} onChange={(e) => setD((x) => ({ ...x, params: x.params.map((q, k) => (k === i ? { ...q, key: e.target.value } : q)) }))} />
              <input aria-label={`Título do parâmetro ${i + 1}`} className={input} value={p.label} onChange={(e) => setD((x) => ({ ...x, params: x.params.map((q, k) => (k === i ? { ...q, label: e.target.value } : q)) }))} />
              <input aria-label={`Valor do parâmetro ${i + 1}`} className={`${input} font-mono`} value={p.value} onChange={(e) => setD((x) => ({ ...x, params: x.params.map((q, k) => (k === i ? { ...q, value: e.target.value.replace(',', '.') } : q)) }))} />
              <input aria-label={`Unidade do parâmetro ${i + 1}`} list="sheet-units" className={`${input} font-mono`} value={p.unit} onChange={(e) => setD((x) => ({ ...x, params: x.params.map((q, k) => (k === i ? { ...q, unit: e.target.value } : q)) }))} />
              <button type="button" className="px-1 text-danger" aria-label={`Remover parâmetro ${i + 1}`} onClick={() => setD((x) => ({ ...x, params: x.params.filter((_, k) => k !== i) }))}>×</button>
            </div>
          ))}
          <div><Button onClick={() => setD((x) => ({ ...x, params: [...x.params, { key: `perda${x.params.length + 1}`, label: 'Perda', unit: '%', value: '0' }] }))}>Adicionar parâmetro</Button></div>
        </div>
      </fieldset>

      <fieldset className="border border-line bg-sheet p-3">
        <legend className="px-1 font-medium">Tabelas de consulta</legend>
        <div className="flex flex-col gap-3">
          {tables.map((t, i) => (
            <div key={i} className="grid gap-2 border-b border-line pb-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
              <div className="grid grid-cols-2 gap-2">
                <TextField label="Chave" className="font-mono" value={t.key} onChange={(e) => setTables((x) => x.map((q, k) => (k === i ? { ...q, key: e.target.value } : q)))} />
                <TextField label="Título" value={t.label} onChange={(e) => setTables((x) => x.map((q, k) => (k === i ? { ...q, label: e.target.value } : q)))} />
                <label className="text-[13px]">Consulta por
                  <select className={input} value={t.keyType} onChange={(e) => setTables((x) => x.map((q, k) => (k === i ? { ...q, keyType: e.target.value as 'text' | 'number' } : q)))}><option value="number">número</option><option value="text">texto</option></select>
                </label>
                <label className="text-[13px]">Busca
                  <select className={input} value={t.mode} onChange={(e) => setTables((x) => x.map((q, k) => (k === i ? { ...q, mode: e.target.value as 'exact' | 'range' } : q)))}><option value="exact">exata</option><option value="range">por faixa (até)</option></select>
                </label>
                {t.keyType === 'number' && <TextField label="Unidade da chave" list="sheet-units" className="font-mono" value={t.keyUnit ?? ''} onChange={(e) => setTables((x) => x.map((q, k) => (k === i ? { ...q, keyUnit: e.target.value || null } : q)))} />}
                <TextField label="Unidade do valor" list="sheet-units" className="font-mono" value={t.valueUnit} onChange={(e) => setTables((x) => x.map((q, k) => (k === i ? { ...q, valueUnit: e.target.value } : q)))} />
              </div>
              <div>
                <TextArea label="Linhas (chave; valor — uma por linha)" rows={7} className="font-mono" value={t.text} onChange={(e) => setTables((x) => x.map((q, k) => (k === i ? { ...q, text: e.target.value } : q)))} />
                <button type="button" className="text-[13px] text-danger" onClick={() => setTables((x) => x.filter((_, k) => k !== i))}>Remover tabela</button>
              </div>
            </div>
          ))}
          <div><Button onClick={() => setTables((x) => [...x, { key: `tabela${x.length + 1}`, label: 'Nova tabela', keyType: 'number', keyUnit: 'mm', valueUnit: 'mm', mode: 'exact', rows: [], text: '100; 0' }])}>Adicionar tabela</Button></div>
        </div>
      </fieldset>

      <fieldset className="border border-line bg-sheet p-3">
        <legend className="px-1 font-medium">Saídas — cada uma vira um quantitativo (soma da coluna em todas as linhas)</legend>
        <div className="flex flex-col gap-2">
          {d.outputs.map((o, i) => (
            <div key={i} className="grid grid-cols-[120px_minmax(0,1fr)_160px_120px_auto] gap-2">
              <input aria-label={`Chave da saída ${i + 1}`} className={`${input} font-mono`} value={o.key} onChange={(e) => setD((x) => ({ ...x, outputs: x.outputs.map((q, k) => (k === i ? { ...q, key: e.target.value } : q)) }))} />
              <input aria-label={`Título da saída ${i + 1}`} className={input} value={o.label} onChange={(e) => setD((x) => ({ ...x, outputs: x.outputs.map((q, k) => (k === i ? { ...q, label: e.target.value } : q)) }))} />
              <select aria-label={`Coluna da saída ${i + 1}`} className={input} value={o.column} onChange={(e) => setD((x) => ({ ...x, outputs: x.outputs.map((q, k) => (k === i ? { ...q, column: e.target.value } : q)) }))}>
                {d.columns.filter((c) => c.type === 'number').map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
              </select>
              <input aria-label={`Serviço sugerido da saída ${i + 1}`} placeholder="serviço (código)" className={`${input} font-mono uppercase`} value={o.suggestedService ?? ''} onChange={(e) => setD((x) => ({ ...x, outputs: x.outputs.map((q, k) => (k === i ? { ...q, suggestedService: e.target.value.toUpperCase() || null } : q)) }))} />
              <button type="button" className="px-1 text-danger" aria-label={`Remover saída ${i + 1}`} onClick={() => setD((x) => ({ ...x, outputs: x.outputs.filter((_, k) => k !== i) }))}>×</button>
            </div>
          ))}
          <div><Button onClick={() => setD((x) => ({ ...x, outputs: [...x.outputs, { key: `saida${x.outputs.length + 1}`, label: 'Nova saída', column: x.columns.find((c) => c.type === 'number')?.key ?? '' }] }))}>Adicionar saída</Button></div>
        </div>
      </fieldset>

      {issues.length > 0 ? (
        <Notice tone="warn"><p className="font-medium">Verificação: {issues.length} problema(s)</p><ul className="list-disc pl-5">{issues.map((i, k) => <li key={k}>{i.message}</li>)}</ul></Notice>
      ) : <Notice tone="ok">Definição válida: grandezas e cálculos conferidos.</Notice>}
      {act.error && <Notice tone="danger">{act.error}</Notice>}
      <div className="flex gap-2 border-t border-line pt-3">
        <Button type="submit" variant="primary" busy={act.pending}>Salvar rascunho</Button>
        <Button variant="ghost" onClick={onDone}>Cancelar</Button>
      </div>
    </form>
  );
}
