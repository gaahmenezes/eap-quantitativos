import { useState } from 'react';
import type { AttributeDefinitionDto, ElementTypeDto, SystemTypeDto } from '@eapq/contracts';
import { Breadcrumbs, PageHeader } from '../../app/shell';
import { useAction } from '../../components/ui/actions';
import { Button } from '../../components/ui/button';
import { ErrorState, Loading, Notice } from '../../components/ui/feedback';
import { SelectField, TextField } from '../../components/ui/field';
import { SidePanel } from '../../components/ui/panel';
import { api, errorMessage } from '../../lib/api';
import { useSession } from '../auth/session';
import { catalogKeys, useElementTypes, useSystemTypes } from './api';
import { useUnits } from '../library/api';

const CATEGORY = { NETWORK_NODE: 'Dispositivo de rede', NETWORK_SEGMENT: 'Trecho de rede', ELEMENT: 'Elemento' } as const;
const DTYPE = { NUMBER: 'Número', TEXT: 'Texto', BOOLEAN: 'Sim/não', ENUM: 'Lista' } as const;

export function CatalogPage() {
  const { can } = useSession();
  const canEdit = can('org.manage');
  const systems = useSystemTypes();
  const elements = useElementTypes();
  const [filter, setFilter] = useState<string>('');
  const [editing, setEditing] = useState<ElementTypeDto | 'new' | null>(null);
  const [newSystem, setNewSystem] = useState(false);
  if (systems.isPending || elements.isPending) return <Loading />;
  const failed = [systems, elements].find((q) => q.isError);
  if (failed) return <ErrorState message={errorMessage(failed.error)} onRetry={() => failed.refetch()} />;
  const sysById = new Map(systems.data!.map((s) => [s.id, s]));
  const list = elements.data!.filter((t) => (filter === '' ? true : filter === 'CONSTRUTIVO' ? t.domain === 'CONSTRUTIVO' : t.systemTypeId === filter));

  return (
    <>
      <Breadcrumbs items={[{ label: 'Administração', to: '/administracao' }, { label: 'Catálogo técnico' }]} />
      <PageHeader title="Catálogo técnico" actions={canEdit && <><Button onClick={() => setNewSystem(true)}>Novo sistema</Button><Button variant="primary" onClick={() => setEditing('new')}>Novo tipo de elemento</Button></>}>
        Sistemas de infraestrutura e tipos de elemento com seus atributos técnicos. Vale para todos os empreendimentos da organização.
      </PageHeader>
      <div className="grid gap-6 lg:grid-cols-[280px_minmax(0,1fr)]">
        <section aria-labelledby="sistemas">
          <h2 id="sistemas" className="mb-2 font-display text-[18px] font-semibold">Sistemas</h2>
          <ul className="border border-line bg-sheet">
            {[{ id: '', label: 'Todos os tipos', sub: `${elements.data!.length} tipos` }, ...systems.data!.map((s) => ({ id: s.id, label: s.name, sub: s.networkBased ? 'Organizado em redes' : 'Organizado em elementos' })), { id: 'CONSTRUTIVO', label: 'Construtivo', sub: 'Tipologias e áreas comuns' }].map((o) => (
              <li key={o.id || 'all'}>
                <button type="button" onClick={() => setFilter(o.id)} aria-current={filter === o.id ? 'true' : undefined}
                  className={`block w-full border-l-[3px] px-3 py-1.5 text-left ${filter === o.id ? 'border-signal bg-cyan-wash' : 'border-transparent hover:bg-paper'}`}>
                  <span className="block text-[14px]">{o.label}</span><span className="block text-[12px] text-muted">{o.sub}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
        <section aria-labelledby="tipos" className="min-w-0">
          <h2 id="tipos" className="mb-2 font-display text-[18px] font-semibold">Tipos de elemento</h2>
          <div className="overflow-x-auto border border-line bg-sheet">
            <table className="w-full text-left text-[14px]">
              <thead className="border-b border-line-strong text-[13px] text-muted"><tr><th className="px-3 py-2 font-medium">Código</th><th className="px-3 py-2 font-medium">Nome</th><th className="px-3 py-2 font-medium">Categoria</th><th className="px-3 py-2 font-medium">Sistema</th><th className="px-3 py-2 font-medium">Atributos</th>{canEdit && <th className="px-3 py-2"><span className="sr-only">Ações</span></th>}</tr></thead>
              <tbody>
                {list.map((t) => (
                  <tr key={t.id} className={`border-b border-line last:border-0 align-top ${t.archivedAt ? 'text-graphite-400' : ''}`}>
                    <td className="px-3 py-1.5 font-mono text-[13px]">{t.code}</td>
                    <td className="px-3 py-1.5">{t.name}</td>
                    <td className="px-3 py-1.5">{CATEGORY[t.category]}</td>
                    <td className="px-3 py-1.5">{t.systemTypeId ? sysById.get(t.systemTypeId)?.name : 'Construtivo'}</td>
                    <td className="px-3 py-1.5 text-[13px]">{t.attributes.map((a) => `${a.label}${a.unit ? ` (${a.unit})` : ''}${a.required ? '*' : ''}`).join(', ') || '—'}</td>
                    {canEdit && <td className="px-3 py-1.5 text-right"><button type="button" className="text-[13px] text-cyan-ink hover:underline" onClick={() => setEditing(t)}>Editar</button></td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-[13px] text-muted">* atributo obrigatório. Atributos que já têm valores cadastrados não podem ser removidos nem mudar de tipo.</p>
        </section>
      </div>
      <SidePanel open={!!editing} title={editing === 'new' ? 'Novo tipo de elemento' : 'Editar tipo de elemento'} onClose={() => setEditing(null)}>
        {editing && <ElementTypeForm initial={editing === 'new' ? undefined : editing} systems={systems.data!.filter((s) => !s.archivedAt)} onDone={() => setEditing(null)} />}
      </SidePanel>
      <SidePanel open={newSystem} title="Novo sistema de infraestrutura" onClose={() => setNewSystem(false)}>
        {newSystem && <SystemTypeForm onDone={() => setNewSystem(false)} />}
      </SidePanel>
    </>
  );
}

function SystemTypeForm({ onDone }: { onDone: () => void }) {
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [network, setNetwork] = useState(false);
  const act = useAction([catalogKeys.systems]);
  return (
    <form className="flex flex-col gap-4" onSubmit={async (e) => { e.preventDefault(); if (await act.run(() => api('POST', '/catalog/system-types', { body: { code: code.trim(), name: name.trim(), networkBased: network } }))) onDone(); }}>
      {act.error && <Notice tone="danger">{act.error}</Notice>}
      <TextField label="Código" className="font-mono uppercase" value={code} onChange={(e) => setCode(e.target.value)} error={act.fieldErrors.code} placeholder="GAS" />
      <TextField label="Nome" value={name} onChange={(e) => setName(e.target.value)} placeholder="Gás natural" />
      <label className="flex items-center gap-2 text-[14px]"><input type="checkbox" checked={network} onChange={(e) => setNetwork(e.target.checked)} /> Organizado em redes (dispositivos ligados por trechos)</label>
      <div><Button type="submit" variant="primary" busy={act.pending} disabled={!code.trim() || !name.trim()}>Cadastrar sistema</Button></div>
    </form>
  );
}

const emptyAttr = (): AttributeDefinitionDto => ({ key: '', label: '', dataType: 'NUMBER', unit: '', required: false, enumValues: null, min: null, max: null });

function ElementTypeForm({ initial, systems, onDone }: { initial?: ElementTypeDto; systems: SystemTypeDto[]; onDone: () => void }) {
  const [code, setCode] = useState(initial?.code ?? '');
  const [name, setName] = useState(initial?.name ?? '');
  const [domain, setDomain] = useState<'INFRA' | 'CONSTRUTIVO'>(initial?.domain ?? 'INFRA');
  const [systemTypeId, setSystemTypeId] = useState(initial?.systemTypeId ?? systems[0]?.id ?? '');
  const [category, setCategory] = useState<ElementTypeDto['category']>(initial?.category ?? 'ELEMENT');
  const [attrs, setAttrs] = useState<AttributeDefinitionDto[]>(initial?.attributes ?? []);
  const act = useAction([catalogKeys.elements]);
  const units = useUnits();
  const sys = systems.find((s) => s.id === systemTypeId);
  const set = (i: number, patch: Partial<AttributeDefinitionDto>) => setAttrs((a) => a.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const payloadAttrs = attrs.map((a) => ({
    key: a.key.trim(), label: a.label.trim(), dataType: a.dataType, required: a.required,
    unit: a.dataType === 'NUMBER' ? (a.unit?.trim() || null) : null,
    enumValues: a.dataType === 'ENUM' ? (a.enumValues ?? []).map((v) => v.trim()).filter(Boolean) : null,
    min: a.dataType === 'NUMBER' ? (a.min?.trim() || null) : null,
    max: a.dataType === 'NUMBER' ? (a.max?.trim() || null) : null,
  }));
  const ctl = 'h-8 rounded-md border border-line-strong bg-sheet px-2 text-[13.5px] min-w-0';
  return (
    <form className="flex flex-col gap-4" onSubmit={async (e) => {
      e.preventDefault();
      const r = await act.run(() => initial
        ? api('PATCH', `/catalog/element-types/${initial.id}`, { body: { name: name.trim(), attributes: payloadAttrs }, version: initial.version })
        : api('POST', '/catalog/element-types', { body: { code: code.trim(), name: name.trim(), domain, category: domain === 'CONSTRUTIVO' ? 'ELEMENT' : category, systemTypeId: domain === 'INFRA' ? systemTypeId : null, attributes: payloadAttrs } }));
      if (r) onDone();
    }}>
      {act.error && <Notice tone="danger">{act.error}{Object.keys(act.fieldErrors).length > 0 && <ul className="mt-1 list-disc pl-5">{Object.entries(act.fieldErrors).map(([k, v]) => <li key={k}>{k.replace(/^attributes\.(\d+)/, (_, i) => `Atributo ${Number(i) + 1}`)}: {v}</li>)}</ul>}</Notice>}
      <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,2fr)] gap-3">
        <TextField label="Código" className="font-mono uppercase" value={code} disabled={!!initial} onChange={(e) => setCode(e.target.value)} />
        <TextField label="Nome" value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      {!initial && (
        <>
          <SelectField label="Domínio" value={domain} onChange={(e) => setDomain(e.target.value as 'INFRA' | 'CONSTRUTIVO')}>
            <option value="INFRA">Infraestrutura</option><option value="CONSTRUTIVO">Construtivo (tipologias e áreas comuns)</option>
          </SelectField>
          {domain === 'INFRA' && (
            <div className="grid grid-cols-2 gap-3">
              <SelectField label="Sistema" value={systemTypeId} onChange={(e) => { setSystemTypeId(e.target.value); if (!systems.find((s) => s.id === e.target.value)?.networkBased) setCategory('ELEMENT'); }}>
                {systems.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </SelectField>
              <SelectField label="Categoria" value={category} onChange={(e) => setCategory(e.target.value as ElementTypeDto['category'])}>
                <option value="ELEMENT">Elemento</option>
                {sys?.networkBased && <><option value="NETWORK_NODE">Dispositivo de rede</option><option value="NETWORK_SEGMENT">Trecho de rede</option></>}
              </SelectField>
            </div>
          )}
        </>
      )}
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-[14px] font-medium">Atributos técnicos</legend>
        {attrs.map((a, i) => (
          <div key={i} className="flex flex-col gap-1.5 border border-line p-2">
            <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] gap-2">
              <input aria-label={`Chave do atributo ${i + 1}`} placeholder="chave (ex.: diametro)" className={`${ctl} font-mono`} value={a.key} onChange={(e) => set(i, { key: e.target.value })} />
              <input aria-label={`Rótulo do atributo ${i + 1}`} placeholder="Rótulo" className={ctl} value={a.label} onChange={(e) => set(i, { label: e.target.value })} />
              <button type="button" className="text-[13px] text-danger hover:underline" onClick={() => setAttrs((x) => x.filter((_, j) => j !== i))}>Remover</button>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <select aria-label={`Tipo do atributo ${i + 1}`} className={ctl} value={a.dataType} onChange={(e) => set(i, { dataType: e.target.value as AttributeDefinitionDto['dataType'] })}>
                {Object.entries(DTYPE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
              {a.dataType === 'NUMBER' && <>
                <select aria-label={`Unidade do atributo ${i + 1}`} className={`${ctl} w-28 font-mono`} value={a.unit ?? ''} onChange={(e) => set(i, { unit: e.target.value })}>
                  <option value="">sem unidade</option>
                  {(units.data ?? []).filter((u) => !u.archivedAt || u.symbol === a.unit).map((u) => <option key={u.id} value={u.symbol}>{u.symbol}</option>)}
                </select>
                <input aria-label={`Mínimo do atributo ${i + 1}`} placeholder="mín." className={`${ctl} w-20 font-mono`} value={a.min ?? ''} onChange={(e) => set(i, { min: e.target.value })} />
                <input aria-label={`Máximo do atributo ${i + 1}`} placeholder="máx." className={`${ctl} w-20 font-mono`} value={a.max ?? ''} onChange={(e) => set(i, { max: e.target.value })} />
              </>}
              {a.dataType === 'ENUM' && <input aria-label={`Opções do atributo ${i + 1}`} placeholder="opções separadas por vírgula" className={`${ctl} min-w-48 flex-1`} value={(a.enumValues ?? []).join(', ')} onChange={(e) => set(i, { enumValues: e.target.value.split(',') })} />}
              <label className="flex items-center gap-1.5 text-[13px]"><input type="checkbox" checked={a.required} onChange={(e) => set(i, { required: e.target.checked })} /> obrigatório</label>
            </div>
          </div>
        ))}
        <div><button type="button" className="text-[14px] font-medium text-cyan-ink hover:underline" onClick={() => setAttrs((a) => [...a, emptyAttr()])}>Adicionar atributo</button></div>
      </fieldset>
      <div className="flex justify-end border-t border-line pt-4"><Button type="submit" variant="primary" busy={act.pending} disabled={!name.trim() || (!initial && !code.trim())}>Salvar tipo de elemento</Button></div>
    </form>
  );
}
