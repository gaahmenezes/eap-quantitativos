import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { ServiceDto, TemplateCompareDto, TemplateDto, TemplateNodeDto, TemplateVersionDetailDto } from '@eapq/contracts';
import { availableVariables, MODULE_KIND_LABELS, MODULE_KINDS, REPEAT_INFO, REPEAT_SCOPES, type ModuleKind, type RepeatScope } from '@eapq/domain';
import { Breadcrumbs, PageHeader } from '../../app/shell';
import { useAction } from '../../components/ui/actions';
import { Button } from '../../components/ui/button';
import { EmptyState, ErrorState, Loading, Notice } from '../../components/ui/feedback';
import { SelectField, TextArea, TextField } from '../../components/ui/field';
import { SidePanel } from '../../components/ui/panel';
import { api, errorMessage } from '../../lib/api';
import { fmtDateTime } from '../../lib/format';
import { useSession } from '../auth/session';

const K = { list: ['wbs-templates'] as const, version: (t: string, v: string) => ['wbs-templates', t, v] as const };

export function TemplatesPage() {
  const { can } = useSession();
  const list = useQuery({ queryKey: K.list, queryFn: () => api<TemplateDto[]>('GET', '/wbs-templates') });
  const [selected, setSelected] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  if (list.isPending) return <Loading />;
  if (list.isError) return <ErrorState message={errorMessage(list.error)} onRetry={() => list.refetch()} />;
  const current = list.data.find((t) => t.id === selected) ?? list.data[0];
  return (
    <>
      <Breadcrumbs items={[{ label: 'Templates de EAP' }]} />
      <PageHeader title="Templates de EAP" actions={can('org.manage') && <Button variant="primary" onClick={() => setCreating(true)}>Novo template</Button>}>
        Regras que geram a EAP a partir do cadastro físico. Versões publicadas não mudam; empreendimentos só adotam uma nova versão quando a EAP é regenerada.
      </PageHeader>
      {list.data.length === 0 ? <EmptyState title="Nenhum template" /> : (
        <div className="grid gap-4 lg:grid-cols-[260px_minmax(0,1fr)]">
          <nav aria-label="Templates" className="self-start border border-line bg-sheet">
            <ul>{list.data.map((t) => {
              const latest = t.versions[0];
              return (
                <li key={t.id}>
                  <button type="button" onClick={() => setSelected(t.id)} aria-current={t.id === current?.id ? 'true' : undefined}
                    className={`block w-full border-l-[3px] px-3 py-2 text-left ${t.id === current?.id ? 'border-signal bg-cyan-wash' : 'border-transparent hover:bg-paper'} ${t.archivedAt ? 'text-graphite-400' : ''}`}>
                    <span className="block text-[14px] font-medium">{t.name}</span>
                    <span className="block text-[12.5px] text-muted"><span className="font-mono">{t.code}</span> · R{latest?.number} {latest?.status === 'DRAFT' ? 'em elaboração' : 'publicada'}</span>
                  </button>
                </li>
              );
            })}</ul>
          </nav>
          {current && <TemplateView key={current.id} template={current} canEdit={can('org.manage')} />}
        </div>
      )}
      <SidePanel open={creating} title="Novo template de EAP" onClose={() => setCreating(false)}>
        {creating && <NewTemplateForm onDone={(id) => { setCreating(false); setSelected(id); }} />}
      </SidePanel>
    </>
  );
}

function NewTemplateForm({ onDone }: { onDone: (id: string) => void }) {
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [kinds, setKinds] = useState<ModuleKind[]>(['VERTICAL_RESIDENTIAL']);
  const act = useAction([K.list]);
  return (
    <form className="flex flex-col gap-4" onSubmit={async (e) => {
      e.preventDefault();
      const r = await act.run(() => api<{ id: string }>('POST', '/wbs-templates', { body: { code: code.trim(), name: name.trim(), description: description.trim() || null, moduleKinds: kinds } }));
      if (r && r !== true) onDone(r.id);
    }}>
      {act.error && <Notice tone="danger">{act.error}</Notice>}
      <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,2fr)] gap-3">
        <TextField label="Código" className="font-mono uppercase" value={code} onChange={(e) => setCode(e.target.value)} error={act.fieldErrors.code} />
        <TextField label="Nome" value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <TextArea label="Descrição" value={description} onChange={(e) => setDescription(e.target.value)} />
      <fieldset>
        <legend className="mb-1 text-[13px] font-medium text-graphite-800">Aplica-se a módulos do tipo</legend>
        {MODULE_KINDS.map((k) => (
          <label key={k} className="flex items-center gap-2 text-[14px]"><input type="checkbox" checked={kinds.includes(k)} onChange={(e) => setKinds((x) => (e.target.checked ? [...x, k] : x.filter((y) => y !== k)))} /> {MODULE_KIND_LABELS[k]}</label>
        ))}
      </fieldset>
      <p className="text-[13px] text-muted">O template começa com um nó raiz "{'{modulo.nome}'}" em uma versão R1 em elaboração.</p>
      <div><Button type="submit" variant="primary" busy={act.pending} disabled={!code.trim() || !name.trim() || kinds.length === 0}>Criar template</Button></div>
    </form>
  );
}

interface TreeItem extends TemplateNodeDto { depth: number }
function asTree(nodes: TemplateNodeDto[]): TreeItem[] {
  const kids = new Map<string | null, TemplateNodeDto[]>();
  for (const n of nodes) kids.set(n.parentId, [...(kids.get(n.parentId) ?? []), n]);
  const out: TreeItem[] = [];
  const walk = (p: string | null, depth: number) => { for (const n of (kids.get(p) ?? []).sort((a, b) => a.position - b.position)) { out.push({ ...n, depth }); walk(n.id, depth + 1); } };
  walk(null, 0);
  return out;
}

function TemplateView({ template: t, canEdit }: { template: TemplateDto; canEdit: boolean }) {
  const [vid, setVid] = useState<string | null>(null);
  const versionId = vid ?? t.versions[0]?.id;
  const act = useAction([K.list]);
  const draft = t.versions.find((v) => v.status === 'DRAFT');
  return (
    <section className="min-w-0" aria-label={t.name}>
      <header className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[12.5px] text-muted">{t.moduleKinds.map((k) => MODULE_KIND_LABELS[k as ModuleKind]).join(', ')}</p>
          <h2 className="font-display text-[22px] font-semibold">{t.name}</h2>
          {t.description && <p className="max-w-prose text-[14px] text-muted">{t.description}</p>}
        </div>
        {canEdit && !draft && !t.archivedAt && (
          <Button variant="primary" busy={act.pending} onClick={async () => {
            const r = await act.run(() => api<{ id: string }>('POST', `/wbs-templates/${t.id}/versions`, { body: {} }));
            if (r && r !== true) setVid(r.id);
          }}>Nova versão</Button>
        )}
      </header>
      {act.error && <div className="mb-3"><Notice tone="danger">{act.error}</Notice></div>}
      <div role="tablist" aria-label="Versões" className="mb-3 flex flex-wrap gap-1 border-b border-line">
        {t.versions.map((v) => (
          <button key={v.id} type="button" role="tab" aria-selected={v.id === versionId} onClick={() => setVid(v.id)}
            className={`-mb-px border-b-2 px-3 py-2 text-[14px] ${v.id === versionId ? 'border-cyan-ink font-medium' : 'border-transparent text-muted hover:text-ink'}`}>
            <span className="font-mono">R{v.number}</span> {v.status === 'DRAFT' ? 'em elaboração' : 'publicada'}{v.projectCount > 0 && <span className="ml-1 text-[12px] text-muted">· {v.projectCount} emp.</span>}
          </button>
        ))}
      </div>
      {versionId && <VersionView key={versionId} template={t} versionId={versionId} canEdit={canEdit} onDiscarded={() => setVid(null)} />}
    </section>
  );
}

function VersionView({ template: t, versionId, canEdit, onDiscarded }: { template: TemplateDto; versionId: string; canEdit: boolean; onDiscarded: () => void }) {
  const base = `/wbs-templates/${t.id}/versions/${versionId}`;
  const q = useQuery({ queryKey: K.version(t.id, versionId), queryFn: () => api<TemplateVersionDetailDto>('GET', base) });
  const services = useQuery({ queryKey: ['services', 'catalog', { limit: 200, all: true }], queryFn: () => api<{ items: ServiceDto[] }>('GET', '/catalog/services?limit=200') });
  const act = useAction([K.version(t.id, versionId), K.list]);
  const [panel, setPanel] = useState<{ parentId: string | null; node?: TemplateNodeDto } | null>(null);
  const [compare, setCompare] = useState<TemplateCompareDto | null>(null);
  const [confirm, setConfirm] = useState(false);
  const svcById = useMemo(() => new Map((services.data?.items ?? []).map((s) => [s.id, s])), [services.data]);
  if (q.isPending) return <Loading />;
  if (q.isError) return <ErrorState message={errorMessage(q.error)} onRetry={() => q.refetch()} />;
  const v = q.data;
  const editable = canEdit && v.status === 'DRAFT';
  const items = asTree(v.nodes);
  const previous = t.versions.find((x) => x.status === 'PUBLISHED' && x.number < v.number);
  const issueFor = (n: TemplateNodeDto) => v.issues.filter((i) => i.path.startsWith(`nodes.${n.stableKey}`));
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3 text-[13.5px]">
        <p className="text-muted">
          {v.status === 'PUBLISHED' ? `Publicada em ${fmtDateTime(v.publishedAt!)}` : 'Em elaboração'} · <span className="font-mono text-ink">{v.nodeCount}</span> nós
          {v.projectCount > 0 && <> · usada em <span className="font-mono text-ink">{v.projectCount}</span> empreendimento(s)</>}
        </p>
        <div className="flex flex-wrap gap-2">
          {previous && <Button onClick={async () => setCompare(await api<TemplateCompareDto>('GET', `/wbs-templates/${t.id}/compare?from=${previous.id}&to=${v.id}`))}>Comparar com R{previous.number}</Button>}
          {editable && previous && <Button variant="ghost" busy={act.pending} onClick={async () => { if (await act.run(() => api('DELETE', base))) onDiscarded(); }}>Descartar rascunho</Button>}
          {editable && !confirm && <Button variant="primary" disabled={v.issues.length > 0} onClick={() => setConfirm(true)}>Publicar R{v.number}</Button>}
          {editable && confirm && <><Button variant="ghost" onClick={() => setConfirm(false)}>Cancelar</Button><Button variant="primary" busy={act.pending} onClick={async () => { await act.run(() => api('POST', `${base}/publish`, { body: {} })); setConfirm(false); }}>Confirmar publicação</Button></>}
        </div>
      </div>
      {confirm && <Notice tone="warn">Depois de publicada, a R{v.number} não pode mais ser alterada. Empreendimentos que usam versões anteriores continuam como estão até a EAP ser regenerada.</Notice>}
      {act.error && <Notice tone="danger">{act.error}</Notice>}
      {editable && v.issues.length > 0 && (
        <Notice tone="warn"><p className="font-medium">Corrija antes de publicar:</p><ul className="mt-1 list-disc pl-5">{v.issues.map((i, k) => <li key={k}>{i.message}</li>)}</ul></Notice>
      )}
      {compare && (
        <Notice tone="info">
          <p className="font-medium">Diferenças em relação à R{previous?.number}:</p>
          {compare.added.length + compare.removed.length + compare.changed.length === 0 ? <p>Nenhuma.</p> : (
            <ul className="mt-1 list-disc pl-5">
              {compare.added.map((a) => <li key={a.stableKey}>Incluído: {a.title}</li>)}
              {compare.removed.map((a) => <li key={a.stableKey}>Removido: {a.title}</li>)}
              {compare.changed.map((a) => <li key={a.stableKey}>Alterado: {a.title} ({a.fields.join(', ')})</li>)}
            </ul>
          )}
        </Notice>
      )}
      <ul className="border border-line bg-sheet">
        {items.map((n) => (
          <li key={n.id} className="border-b border-line py-1.5 pr-3 last:border-0" style={{ paddingLeft: 12 + n.depth * 22 }}>
            <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-0.5">
              <span className={`rounded-[3px] px-1.5 text-[11.5px] ${n.nodeType === 'ITEM' ? 'bg-cyan-wash text-cyan-ink' : 'bg-paper text-muted'}`}>{n.nodeType === 'ITEM' ? 'item' : 'grupo'}</span>
              <span className="font-mono text-[13.5px]">{n.title}</span>
              {n.repeat && <span className="text-[12.5px] text-muted">↻ {REPEAT_INFO[n.repeat as RepeatScope].label.toLowerCase()}</span>}
              {n.condition && <span className="font-mono text-[12px] text-muted">se {n.condition}</span>}
              {n.serviceIds.length > 0 && <span className="text-[12.5px] text-muted" title={n.serviceIds.map((s) => svcById.get(s)?.code).join(', ')}>{n.serviceIds.length} serviço(s)</span>}
              {editable && (
                <span className="ml-auto flex shrink-0 gap-3 text-[13px]">
                  {n.nodeType === 'GROUP' && <button type="button" className="text-cyan-ink hover:underline" onClick={() => setPanel({ parentId: n.id })}>Incluir subnó</button>}
                  <button type="button" className="text-cyan-ink hover:underline" onClick={() => setPanel({ parentId: n.parentId, node: n })}>Editar</button>
                  <button type="button" className="text-cyan-ink hover:underline" disabled={n.position === 1} onClick={() => act.run(() => api('POST', `${base}/nodes/${n.id}/move`, { body: { parentId: n.parentId, position: n.position - 1 } }))}>Subir</button>
                  <button type="button" className="text-cyan-ink hover:underline" onClick={() => act.run(() => api('POST', `${base}/nodes/${n.id}/move`, { body: { parentId: n.parentId, position: n.position + 1 } }))}>Descer</button>
                  <button type="button" className="text-danger hover:underline" onClick={() => act.run(() => api('DELETE', `${base}/nodes/${n.id}`))}>Remover</button>
                </span>
              )}
            </div>
            {editable && issueFor(n).map((i, k) => <p key={k} className="text-[12.5px] text-danger">{i.message}</p>)}
          </li>
        ))}
      </ul>
      {editable && <div><Button onClick={() => setPanel({ parentId: null })}>Incluir nó na raiz</Button></div>}
      <SidePanel open={!!panel} title={panel?.node ? 'Editar nó do template' : 'Incluir nó no template'} onClose={() => setPanel(null)}>
        {panel && <NodeForm base={base} nodes={v.nodes} parentId={panel.parentId} node={panel.node} services={services.data?.items ?? []} invalidate={[K.version(t.id, versionId), K.list]} onDone={() => setPanel(null)} />}
      </SidePanel>
    </div>
  );
}

function NodeForm({ base, nodes, parentId, node, services, invalidate, onDone }: {
  base: string; nodes: TemplateNodeDto[]; parentId: string | null; node?: TemplateNodeDto; services: ServiceDto[]; invalidate: (readonly string[])[]; onDone: () => void;
}) {
  const [title, setTitle] = useState(node?.title ?? '');
  const [nodeType, setNodeType] = useState<'GROUP' | 'ITEM'>(node?.nodeType ?? 'GROUP');
  const [repeat, setRepeat] = useState<string>(node?.repeat ?? '');
  const [condition, setCondition] = useState(node?.condition ?? '');
  const [serviceIds, setServiceIds] = useState<string[]>(node?.serviceIds ?? []);
  const [q, setQ] = useState('');
  const act = useAction(invalidate.map((k) => [...k]));
  // variáveis disponíveis: repetições dos ancestrais + a deste nó
  const vars = useMemo(() => {
    const keyById = new Map(nodes.map((n) => [n.id, n.stableKey]));
    const defNodes = nodes.map((n) => ({ key: n.stableKey, parentKey: n.parentId ? keyById.get(n.parentId)! : null, repeat: n.repeat as RepeatScope | null }));
    const key = node?.stableKey ?? '__novo';
    const list = node ? defNodes.map((n) => (n.key === key ? { ...n, repeat: (repeat || null) as RepeatScope | null } : n)) : [...defNodes, { key, parentKey: parentId ? keyById.get(parentId)! : null, repeat: (repeat || null) as RepeatScope | null }];
    return availableVariables({ nodes: list.map((n) => ({ ...n, title: '', nodeType: 'GROUP', condition: null, position: 1, serviceIds: [] })) }, key);
  }, [nodes, node, parentId, repeat]);
  const filtered = services.filter((s) => !serviceIds.includes(s.id) && (!q || `${s.code} ${s.description}`.toLowerCase().includes(q.toLowerCase()))).slice(0, 8);
  return (
    <form className="flex flex-col gap-4" onSubmit={async (e) => {
      e.preventDefault();
      const body = { title: title.trim(), nodeType, repeat: repeat || null, condition: condition.trim() || null, serviceIds: nodeType === 'ITEM' ? serviceIds : [] };
      const r = await act.run(() => (node ? api('PATCH', `${base}/nodes/${node.id}`, { body }) : api('POST', `${base}/nodes`, { body: { ...body, parentId } })));
      if (r) onDone();
    }}>
      {act.error && <Notice tone="danger">{act.error}</Notice>}
      <TextField label="Título" className="font-mono" value={title} onChange={(e) => setTitle(e.target.value)} hint="Use variáveis entre chaves, por exemplo {torre.nome}." />
      <div className="grid grid-cols-2 gap-3">
        <SelectField label="Tipo" value={nodeType} onChange={(e) => setNodeType(e.target.value as 'GROUP' | 'ITEM')}>
          <option value="GROUP">Agrupador</option><option value="ITEM">Item quantificável</option>
        </SelectField>
        <SelectField label="Repetir para" value={repeat} onChange={(e) => setRepeat(e.target.value)}>
          <option value="">Não repetir</option>
          {REPEAT_SCOPES.map((s) => <option key={s} value={s}>{REPEAT_INFO[s].label}</option>)}
        </SelectField>
      </div>
      <TextField label="Condição (opcional)" className="font-mono" value={condition} onChange={(e) => setCondition(e.target.value)} hint='Ex.: qtd.unidades > 0 e sistema.tipo == "DRENAGEM"' />
      <details className="text-[13px]">
        <summary className="cursor-pointer text-cyan-ink">Variáveis disponíveis neste nó</summary>
        <p className="mt-1 font-mono text-[12.5px] leading-6 text-muted">{vars.map((v) => `{${v}}`).join('  ')}</p>
      </details>
      {nodeType === 'ITEM' && (
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-[14px] font-medium">Serviços sugeridos</legend>
          {serviceIds.map((id) => {
            const s = services.find((x) => x.id === id);
            return <div key={id} className="flex items-baseline justify-between gap-2 text-[13.5px]"><span><span className="font-mono">{s?.code ?? '?'}</span> {s?.description}</span><button type="button" className="text-danger hover:underline" onClick={() => setServiceIds((x) => x.filter((y) => y !== id))}>Remover</button></div>;
          })}
          <input type="search" aria-label="Buscar serviço para incluir" placeholder="Buscar serviço do catálogo" value={q} onChange={(e) => setQ(e.target.value)} className="h-8 rounded-[3px] border border-line-strong bg-sheet px-2 text-[13.5px]" />
          {q && <ul className="border border-line">{filtered.map((s) => <li key={s.id}><button type="button" className="block w-full px-2 py-1 text-left text-[13px] hover:bg-cyan-wash" onClick={() => { setServiceIds((x) => [...x, s.id]); setQ(''); }}><span className="font-mono">{s.code}</span> {s.description} <span className="font-mono text-muted">({s.unitSymbol})</span></button></li>)}</ul>}
        </fieldset>
      )}
      <div className="flex justify-end border-t border-line pt-4"><Button type="submit" variant="primary" busy={act.pending} disabled={!title.trim()}>{node ? 'Salvar nó' : 'Incluir nó'}</Button></div>
    </form>
  );
}
