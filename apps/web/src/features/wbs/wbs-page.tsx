import { useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { ModuleDto, ServiceDto, TemplateDto, WbsDto, WbsNodeDto, WbsPlanDto } from '@eapq/contracts';
import { MODULE_KIND_LABELS, projectPermissions, type ModuleKind } from '@eapq/domain';
import { Breadcrumbs } from '../../app/shell';
import { ArchiveButton, useAction } from '../../components/ui/actions';
import { Button } from '../../components/ui/button';
import { EmptyState, ErrorState, Loading, Notice } from '../../components/ui/feedback';
import { SelectField, TextField } from '../../components/ui/field';
import { SidePanel } from '../../components/ui/panel';
import { api, ApiError, errorMessage } from '../../lib/api';
import { fmtDateTime } from '../../lib/format';
import { useSession } from '../auth/session';
import { useProject } from '../projects/api';
import { EntityHistory } from '../../components/entity-history';
import { useStructure } from '../structure/api';

const wbsKey = (id: string) => ['project', id, 'wbs'] as const;
const ROW_H = 30;

interface Row extends WbsNodeDto { hasChildren: boolean }

export function WbsPage() {
  const { projectId = '' } = useParams();
  const project = useProject(projectId);
  const wbs = useQuery({ queryKey: wbsKey(projectId), queryFn: () => api<WbsDto>('GET', `/projects/${projectId}/wbs`) });
  const structure = useStructure(projectId);
  const { me } = useSession();
  const [generating, setGenerating] = useState(false);

  if (project.isPending || wbs.isPending || structure.isPending) return <Loading />;
  if (project.isError) return <ErrorState message={errorMessage(project.error)} onRetry={() => project.refetch()} />;
  if (wbs.isError) return <ErrorState message={errorMessage(wbs.error)} onRetry={() => wbs.refetch()} />;
  if (structure.isError) return <ErrorState message={errorMessage(structure.error)} onRetry={() => structure.refetch()} />;
  const p = project.data;
  const canEdit = projectPermissions(me!.orgRole, p.myProjectRole).has('project.content.edit') && p.status === 'ACTIVE';
  const modules = structure.data.modules.filter((m) => !m.archivedAt);
  const w = wbs.data;
  const active = w.nodes.filter((n) => !n.archivedAt);
  const items = active.filter((n) => n.nodeType === 'ITEM');
  const filled = items.filter((n) => n.serviceIds.length > 0).length;

  return (
    <>
      <Breadcrumbs items={[{ label: 'Empreendimentos', to: '/empreendimentos' }, { label: p.name, to: `/empreendimentos/${p.id}` }, { label: 'EAP' }]} />
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3 border-b border-line pb-4">
        <div>
          <h1 className="font-display text-[28px] font-semibold leading-tight tracking-tight">EAP</h1>
          <p className="mt-1 text-[14px] text-muted"><span className="font-mono text-ink">{p.code}</span> {p.name}</p>
        </div>
        {canEdit && modules.length > 0 && <Button variant="primary" onClick={() => setGenerating(true)}>{w.runs.length ? 'Regenerar EAP' : 'Gerar EAP'}</Button>}
      </div>
      {p.status === 'ARCHIVED' && <div className="mb-4"><Notice tone="warn">Empreendimento arquivado: a EAP está disponível apenas para consulta.</Notice></div>}

      {modules.length === 0 ? (
        <EmptyState title="Cadastro físico vazio" action={<Link className="text-cyan-ink hover:underline" to={`/empreendimentos/${p.id}/cadastro`}>Ir para o cadastro físico</Link>}>
          A EAP é gerada a partir dos módulos, torres, pavimentos, quadras, ruas e sistemas cadastrados. Cadastre a estrutura física primeiro.
        </EmptyState>
      ) : w.nodes.length === 0 ? (
        <EmptyState title="EAP ainda não gerada" action={canEdit && <Button variant="primary" onClick={() => setGenerating(true)}>Gerar EAP</Button>}>
          Escolha um template para cada módulo e revise a prévia antes de gravar. A mesma estrutura e a mesma versão de template sempre geram a mesma EAP.
        </EmptyState>
      ) : (
        <>
          <dl className="mb-4 flex flex-wrap border border-line bg-sheet">
            <Stat label="Nós ativos" value={active.length} />
            <Stat label="Itens quantificáveis" value={items.length} />
            <Stat label="Itens com serviço" value={`${filled} (${items.length ? Math.round((filled / items.length) * 100) : 0}%)`} />
            <Stat label="Obsoletos" value={active.filter((n) => n.status === 'OBSOLETE').length} />
          </dl>
          {w.moduleTemplates.length > 0 && (
            <ul className="mb-4 flex flex-wrap gap-x-6 gap-y-1 text-[13px] text-muted">
              {w.moduleTemplates.map((mt) => {
                const m = modules.find((x) => x.id === mt.moduleId);
                return (
                  <li key={mt.moduleId}>
                    {m?.name ?? 'Módulo'}: <span className="text-ink">{mt.templateName}</span> <span className="font-mono">R{mt.versionNumber}</span>
                    {mt.latestVersionNumber > mt.versionNumber && <span className="ml-1 text-warn">(disponível R{mt.latestVersionNumber})</span>}
                  </li>
                );
              })}
            </ul>
          )}
          <WbsEditor projectId={p.id} wbs={w} canEdit={canEdit} />
          {w.runs.length > 0 && (
            <details className="mt-6 text-[13.5px]">
              <summary className="cursor-pointer font-medium">Histórico de gerações ({w.runs.length})</summary>
              <table className="mt-2 w-full border border-line bg-sheet text-left">
                <thead className="text-[12px] text-muted"><tr><th className="px-2 py-1">Data</th><th className="px-2 py-1">Por</th><th className="px-2 py-1">Criados</th><th className="px-2 py-1">Atualizados</th><th className="px-2 py-1">Removidos</th><th className="px-2 py-1">Obsoletos</th><th className="px-2 py-1">Hash do resultado</th></tr></thead>
                <tbody>{w.runs.map((r) => (
                  <tr key={r.id} className="border-t border-line"><td className="px-2 py-1">{fmtDateTime(r.createdAt)}</td><td className="px-2 py-1">{r.createdBy}</td>
                    <td className="px-2 py-1 font-mono">{r.summary.create}</td><td className="px-2 py-1 font-mono">{r.summary.update}</td><td className="px-2 py-1 font-mono">{r.summary.remove}</td><td className="px-2 py-1 font-mono">{r.summary.obsolete}</td>
                    <td className="px-2 py-1 font-mono text-[12px]">{r.resultHash.slice(0, 12)}</td></tr>
                ))}</tbody>
              </table>
            </details>
          )}
        </>
      )}
      <SidePanel open={generating} title={w.runs.length ? 'Regenerar EAP' : 'Gerar EAP'} onClose={() => setGenerating(false)}>
        {generating && <GenerationPanel projectId={p.id} modules={modules} wbs={w} onDone={() => setGenerating(false)} />}
      </SidePanel>
    </>
  );
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return <div className="min-w-[140px] flex-1 border-r border-line px-3 py-2 last:border-r-0"><dt className="text-[12px] text-muted">{label}</dt><dd className="font-mono text-[18px]">{value}</dd></div>;
}

function GenerationPanel({ projectId, modules, wbs, onDone }: { projectId: string; modules: ModuleDto[]; wbs: WbsDto; onDone: () => void }) {
  const templates = useQuery({ queryKey: ['wbs-templates'], queryFn: () => api<TemplateDto[]>('GET', '/wbs-templates') });
  const [choice, setChoice] = useState<Record<string, string>>({});
  const [plan, setPlan] = useState<WbsPlanDto | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const act = useAction([wbsKey(projectId), ['wbs-templates']]);
  if (templates.isPending) return <Loading />;
  if (templates.isError) return <ErrorState message={errorMessage(templates.error)} onRetry={() => templates.refetch()} />;
  const optionsFor = (m: ModuleDto) =>
    templates.data.filter((t) => !t.archivedAt && t.moduleKinds.includes(m.kind)).flatMap((t) => t.versions.filter((v) => v.status === 'PUBLISHED').map((v) => ({ id: v.id, label: `${t.name} — R${v.number}` })));
  const defaultFor = (m: ModuleDto) => {
    const used = wbs.moduleTemplates.find((x) => x.moduleId === m.id);
    if (used) return used.templateVersionId;
    return optionsFor(m)[0]?.id ?? '';
  };
  const value = (m: ModuleDto) => choice[m.id] ?? defaultFor(m);
  const selections = modules.filter((m) => value(m)).map((m) => ({ moduleId: m.id, templateVersionId: value(m) }));
  const preview = async () => {
    setNotice(null);
    const r = await act.run(() => api<WbsPlanDto>('POST', `/projects/${projectId}/wbs/preview`, { body: { selections } }));
    if (r && r !== true) setPlan(r);
  };
  return (
    <div className="flex flex-col gap-4">
      <p className="text-[13.5px] text-muted">Escolha a versão de template de cada módulo. Nós com edição manual de título ou posição são preservados; nós criados manualmente não são tocados; nós que deixariam de existir mas estão protegidos ficam marcados como obsoletos.</p>
      {modules.map((m) => {
        const opts = optionsFor(m);
        return (
          <SelectField key={m.id} label={`${m.name} (${MODULE_KIND_LABELS[m.kind as ModuleKind]})`} value={value(m)} onChange={(e) => { setChoice((c) => ({ ...c, [m.id]: e.target.value })); setPlan(null); }}>
            <option value="">Não gerar para este módulo</option>
            {opts.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
          </SelectField>
        );
      })}
      {act.error && <Notice tone="danger">{act.error}</Notice>}
      {notice && <Notice tone="warn">{notice}</Notice>}
      {!plan ? (
        <div><Button variant="primary" busy={act.pending} disabled={selections.length === 0} onClick={preview}>Pré-visualizar</Button></div>
      ) : (
        <section aria-label="Prévia da geração" className="flex flex-col gap-3">
          <dl className="grid grid-cols-3 border border-line bg-sheet text-center">
            {([['Novos', plan.totals.create], ['Alterados', plan.totals.update], ['Mantidos', plan.totals.unchanged], ['Removidos', plan.totals.remove], ['Obsoletos', plan.totals.obsolete], ['Total desejado', plan.totals.desired]] as const).map(([l, v]) => (
              <div key={l} className="border-b border-r border-line px-2 py-1.5"><dt className="text-[12px] text-muted">{l}</dt><dd className="font-mono text-[17px]">{v}</dd></div>
            ))}
          </dl>
          <PlanList title="Novos" items={plan.create.map((c) => `${'  '.repeat(Math.max(0, c.depth))}${c.title}${c.parentTitle ? ` — em ${c.parentTitle}` : ''}`)} />
          <PlanList title="Alterados" items={plan.update.map((u) => `${u.title} (${u.changes.join(', ')})`)} />
          <PlanList title="Removidos" items={plan.remove.map((r) => r.title)} />
          <PlanList title="Marcados como obsoletos" items={plan.obsolete.map((o) => `${o.title} — ${o.reason}`)} />
          {plan.totals.create + plan.totals.update + plan.totals.remove + plan.totals.obsolete === 0 ? (
            <Notice tone="info">A EAP já está de acordo com o cadastro e os templates escolhidos. Nada a aplicar.</Notice>
          ) : (
            <div className="flex gap-2 border-t border-line pt-4">
              <Button variant="ghost" onClick={() => setPlan(null)}>Voltar</Button>
              <Button variant="primary" busy={act.pending} onClick={async () => {
                const r = await act.run(async () => {
                  try { return await api('POST', `/projects/${projectId}/wbs/apply`, { body: { selections, planHash: plan.planHash } }); }
                  catch (e) { if (e instanceof ApiError && e.status === 409) { setPlan(null); setNotice('O cadastro ou a EAP mudaram desde a prévia. Gere a prévia novamente.'); return null; } throw e; }
                });
                if (r !== false && r !== null) onDone();
              }}>Aplicar</Button>
            </div>
          )}
        </section>
      )}
    </div>
  );
}

function PlanList({ title, items }: { title: string; items: string[] }) {
  if (items.length === 0) return null;
  return (
    <details open={items.length <= 12}>
      <summary className="cursor-pointer text-[13.5px] font-medium">{title} ({items.length})</summary>
      <ul className="mt-1 max-h-64 overflow-auto border border-line bg-sheet px-2 py-1 font-mono text-[12.5px] whitespace-pre">{items.map((t, i) => <li key={i}>{t}</li>)}</ul>
    </details>
  );
}

function WbsEditor({ projectId, wbs, canEdit }: { projectId: string; wbs: WbsDto; canEdit: boolean }) {
  const [showArchived, setShowArchived] = useState(false);
  const [q, setQ] = useState('');
  // Por padrão mostra módulos e o primeiro nível; o restante abre sob demanda.
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const isOpen = (n: WbsNodeDto) => n.depth < 1 || expanded.has(n.id);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const parentRef = useRef<HTMLDivElement>(null);
  const { rows, byId } = useMemo(() => {
    const nodes = wbs.nodes.filter((n) => showArchived || !n.archivedAt);
    const kids = new Map<string | null, WbsNodeDto[]>();
    for (const n of nodes) kids.set(n.parentId, [...(kids.get(n.parentId) ?? []), n]);
    const byId = new Map(wbs.nodes.map((n) => [n.id, n]));
    const needle = q.trim().toLowerCase();
    const match = new Set<string>();
    if (needle) for (const n of nodes) if (`${n.code} ${n.title}`.toLowerCase().includes(needle)) { let c: WbsNodeDto | undefined = n; while (c) { match.add(c.id); c = c.parentId ? byId.get(c.parentId) : undefined; } }
    const out: Row[] = [];
    const walk = (p: string | null) => {
      for (const n of (kids.get(p) ?? []).sort((a, b) => a.position - b.position)) {
        if (needle && !match.has(n.id)) continue;
        out.push({ ...n, hasChildren: kids.has(n.id) });
        if (needle || isOpen(n)) walk(n.id);
      }
    };
    walk(null);
    return { rows: out, byId };
  }, [wbs.nodes, showArchived, q, expanded]);
  const v = useVirtualizer({ count: rows.length, getScrollElement: () => parentRef.current, estimateSize: () => ROW_H, overscan: 20 });
  const selected = selectedId ? byId.get(selectedId) : undefined;
  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
      <div className="min-w-0">
        <div className="mb-2 flex flex-wrap items-center gap-3">
          <input type="search" aria-label="Buscar na EAP" placeholder="Buscar por código ou título" value={q} onChange={(e) => setQ(e.target.value)} className="h-8 w-64 max-w-full rounded-[3px] border border-line-strong bg-sheet px-2 text-[13.5px]" />
          <label className="flex items-center gap-1.5 text-[13.5px]"><input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} /> Mostrar arquivados</label>
          <button type="button" className="text-[13.5px] text-cyan-ink hover:underline" onClick={() => setExpanded(new Set())}>Recolher</button>
          <button type="button" className="text-[13.5px] text-cyan-ink hover:underline" onClick={() => setExpanded(new Set(wbs.nodes.map((n) => n.id)))}>Expandir tudo</button>
          {canEdit && <AddRoot projectId={projectId} onCreated={setSelectedId} />}
        </div>
        <div ref={parentRef} role="tree" aria-label="EAP" className="h-[min(70vh,720px)] overflow-auto border border-line bg-sheet">
          <div style={{ height: v.getTotalSize(), position: 'relative' }}>
            {v.getVirtualItems().map((vi) => {
              const n = rows[vi.index]!;
              const isSel = n.id === selectedId;
              return (
                <div key={n.id} role="treeitem" aria-level={n.depth + 1} aria-selected={isSel} aria-expanded={n.hasChildren ? isOpen(n) : undefined}
                  style={{ position: 'absolute', top: 0, left: 0, right: 0, height: ROW_H, transform: `translateY(${vi.start}px)`, paddingLeft: 6 + n.depth * 18 }}
                  className={`flex items-center gap-2 border-b border-line/60 pr-2 text-[13.5px] ${isSel ? 'bg-cyan-wash' : 'hover:bg-paper'} ${n.archivedAt ? 'text-graphite-400 line-through' : ''}`}>
                  <button type="button" aria-label={isOpen(n) ? 'Recolher' : 'Expandir'} className={`w-4 text-muted ${n.hasChildren ? '' : 'invisible'}`} onClick={() => setExpanded((s) => { const x = new Set(s); if (isOpen(n)) { x.delete(n.id); } else { x.add(n.id); } return x; })} disabled={n.depth < 1}>{isOpen(n) ? '▾' : '▸'}</button>
                  <button type="button" className="flex min-w-0 flex-1 items-center gap-2 text-left" onClick={() => setSelectedId(n.id)}>
                    <span className="w-[76px] shrink-0 font-mono text-[12.5px] text-muted">{n.code}</span>
                    <span className="truncate">{n.title}</span>
                    {n.status === 'OBSOLETE' && <span className="shrink-0 rounded-[3px] bg-warn-wash px-1.5 text-[11.5px] text-warn">obsoleto</span>}
                    {n.origin === 'MANUAL' && <span className="shrink-0 rounded-[3px] bg-paper px-1.5 text-[11.5px] text-muted">manual</span>}
                    {n.nodeType === 'ITEM' && <span className={`ml-auto shrink-0 font-mono text-[12px] ${n.serviceIds.length ? 'text-cyan-ink' : 'text-graphite-400'}`} title="Serviços vinculados">{n.serviceIds.length} serv.</span>}
                  </button>
                </div>
              );
            })}
          </div>
        </div>
        {rows.length === 0 && <p className="mt-2 text-[13.5px] text-muted">Nenhum nó corresponde à busca.</p>}
      </div>
      <aside aria-label="Detalhes do nó" className="self-start border border-line bg-sheet p-4">
        {selected ? <Inspector key={`${selected.id}:${selected.version}`} projectId={projectId} node={selected} parent={selected.parentId ? byId.get(selected.parentId) : undefined} canEdit={canEdit} onSelect={setSelectedId} /> : <p className="text-[13.5px] text-muted">Selecione um nó para ver detalhes, vincular serviços ou editar.</p>}
      </aside>
    </div>
  );
}

function AddRoot({ projectId, onCreated }: { projectId: string; onCreated: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="text-[13.5px] text-cyan-ink hover:underline" onClick={() => setOpen(true)}>Incluir nó na raiz</button>
      <SidePanel open={open} title="Incluir nó manual na raiz" onClose={() => setOpen(false)}>
        {open && <NewNodeForm projectId={projectId} parentId={null} onDone={(id) => { setOpen(false); if (id) onCreated(id); }} />}
      </SidePanel>
    </>
  );
}

function NewNodeForm({ projectId, parentId, onDone }: { projectId: string; parentId: string | null; onDone: (id?: string) => void }) {
  const [title, setTitle] = useState('');
  const [nodeType, setNodeType] = useState<'GROUP' | 'ITEM'>('ITEM');
  const act = useAction([wbsKey(projectId)]);
  return (
    <form className="flex flex-col gap-4" onSubmit={async (e) => {
      e.preventDefault();
      const r = await act.run(() => api<WbsNodeDto>('POST', `/projects/${projectId}/wbs/nodes`, { body: { parentId, title: title.trim(), nodeType } }));
      if (r && r !== true) onDone(r.id);
    }}>
      {act.error && <Notice tone="danger">{act.error}</Notice>}
      <TextField label="Título" value={title} onChange={(e) => setTitle(e.target.value)} error={act.fieldErrors.title} />
      <SelectField label="Tipo" value={nodeType} onChange={(e) => setNodeType(e.target.value as 'GROUP' | 'ITEM')}>
        <option value="ITEM">Item quantificável</option><option value="GROUP">Agrupador</option>
      </SelectField>
      <p className="text-[13px] text-muted">Nós manuais nunca são alterados ou removidos pela regeneração da EAP.</p>
      <div><Button type="submit" variant="primary" busy={act.pending} disabled={!title.trim()}>Incluir nó</Button></div>
    </form>
  );
}

const ORIGIN = { GENERATED: 'Gerado por template', MANUAL: 'Manual' } as const;

function Inspector({ projectId, node: n, parent, canEdit, onSelect }: { projectId: string; node: WbsNodeDto; parent?: WbsNodeDto; canEdit: boolean; onSelect: (id: string | null) => void }) {
  const base = `/projects/${projectId}/wbs/nodes/${n.id}`;
  const act = useAction([wbsKey(projectId)]);
  const [title, setTitle] = useState(n.title);
  const [adding, setAdding] = useState(false);
  const editable = canEdit && !n.archivedAt;
  return (
    <div className="flex flex-col gap-4 text-[13.5px]">
      <header>
        <p className="font-mono text-[12.5px] text-muted">{n.code}</p>
        <h2 className="font-display text-[18px] font-semibold leading-snug">{n.title}</h2>
        <p className="text-muted">{n.nodeType === 'ITEM' ? 'Item quantificável' : 'Agrupador'} · {ORIGIN[n.origin]}{n.titleOverridden && ' · título editado'}{n.placementOverridden && ' · posição editada'}</p>
      </header>
      {n.status === 'OBSOLETE' && <Notice tone="warn">Este nó não é mais produzido pelo template, mas foi preservado porque tem vínculos ou edições manuais. Decida se arquiva ou mantém.</Notice>}
      {n.archivedAt && <Notice tone="info">Arquivado em {fmtDateTime(n.archivedAt)}.</Notice>}
      {act.error && <Notice tone="danger">{act.error}</Notice>}
      {editable && (
        <form className="flex items-end gap-2" onSubmit={async (e) => { e.preventDefault(); await act.run(() => api('PATCH', base, { body: { title: title.trim() }, version: n.version })); }}>
          <div className="flex-1"><TextField label="Título" value={title} onChange={(e) => setTitle(e.target.value)} /></div>
          <Button type="submit" busy={act.pending} disabled={!title.trim() || title.trim() === n.title}>Salvar</Button>
        </form>
      )}
      {n.nodeType === 'ITEM' && <NodeServices projectId={projectId} node={n} editable={editable} />}
      {editable && (
        <div className="flex flex-wrap gap-2 border-t border-line pt-3">
          {n.nodeType === 'GROUP' && <Button onClick={() => setAdding(true)}>Incluir subnó</Button>}
          <Button disabled={n.position === 1} onClick={() => act.run(() => api('POST', `${base}/move`, { body: { parentId: n.parentId, position: n.position - 1 }, version: n.version }))}>Subir</Button>
          <Button onClick={() => act.run(() => api('POST', `${base}/move`, { body: { parentId: n.parentId, position: n.position + 1 }, version: n.version }))}>Descer</Button>
          {parent && <Button onClick={() => act.run(() => api('POST', `${base}/move`, { body: { parentId: parent.parentId, position: parent.position + 1 }, version: n.version }))}>Mover para o nível acima</Button>}
          <Button onClick={async () => { const r = await act.run(() => api<WbsNodeDto>('POST', `${base}/duplicate`, { body: {} })); if (r && r !== true) onSelect(r.id); }}>Duplicar</Button>
          <ArchiveButton what="nó da EAP" onConfirm={(reason) => act.run(() => api('POST', `${base}/archive`, { body: { reason }, version: n.version }))} />
        </div>
      )}
      {canEdit && n.archivedAt && <div><Button onClick={() => act.run(() => api('POST', `${base}/unarchive`, { body: {}, version: n.version }))}>Restaurar</Button></div>}
      <EntityHistory projectId={projectId} entityId={n.id} />
      <SidePanel open={adding} title={`Incluir subnó em ${n.code}`} onClose={() => setAdding(false)}>
        {adding && <NewNodeForm projectId={projectId} parentId={n.id} onDone={(id) => { setAdding(false); if (id) onSelect(id); }} />}
      </SidePanel>
    </div>
  );
}

function NodeServices({ projectId, node: n, editable }: { projectId: string; node: WbsNodeDto; editable: boolean }) {
  const services = useQuery({ queryKey: ['project', projectId, 'services', 'all'], queryFn: () => api<{ items: ServiceDto[] }>('GET', `/projects/${projectId}/services?limit=200`) });
  const [q, setQ] = useState('');
  const act = useAction([wbsKey(projectId)]);
  const list = services.data?.items ?? [];
  const byId = new Map(list.map((s) => [s.id, s]));
  const set = (ids: string[]) => act.run(() => api('PUT', `/projects/${projectId}/wbs/nodes/${n.id}/services`, { body: { serviceIds: ids } }));
  const found = q ? list.filter((s) => !n.serviceIds.includes(s.id) && `${s.code} ${s.description}`.toLowerCase().includes(q.toLowerCase())).slice(0, 8) : [];
  return (
    <section aria-label="Serviços vinculados" className="flex flex-col gap-2">
      <h3 className="font-medium">Serviços vinculados</h3>
      {act.error && <Notice tone="danger">{act.error}</Notice>}
      {n.serviceIds.length === 0 && <p className="text-muted">Nenhum serviço vinculado. Itens sem serviço não poderão receber quantitativos.</p>}
      <ul className="flex flex-col gap-1">
        {n.serviceIds.map((id) => {
          const s = byId.get(id);
          return (
            <li key={id} className="flex items-baseline justify-between gap-2">
              <span><span className="font-mono">{s?.code ?? '…'}</span> {s?.description} {s && <span className="font-mono text-muted">({s.unitSymbol})</span>}</span>
              {editable && <button type="button" className="shrink-0 text-danger hover:underline" onClick={() => set(n.serviceIds.filter((x) => x !== id))}>Remover</button>}
            </li>
          );
        })}
      </ul>
      {editable && (
        <>
          <input type="search" aria-label="Buscar serviço para vincular" placeholder="Buscar serviço para vincular" value={q} onChange={(e) => setQ(e.target.value)} className="h-8 rounded-[3px] border border-line-strong bg-sheet px-2 text-[13.5px]" />
          {found.length > 0 && <ul className="border border-line">{found.map((s) => <li key={s.id}><button type="button" className="block w-full px-2 py-1 text-left text-[13px] hover:bg-cyan-wash" onClick={async () => { await set([...n.serviceIds, s.id]); setQ(''); }}><span className="font-mono">{s.code}</span> {s.description} <span className="font-mono text-muted">({s.unitSymbol})</span>{s.projectId && <span className="ml-1 text-muted">· do empreendimento</span>}</button></li>)}</ul>}
        </>
      )}
    </section>
  );
}
