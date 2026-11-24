import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { ModuleDto, NodeKindDto, ProjectDto, StructureDto, TypologyDto } from '@eapq/contracts';
import {
  allowedChildKinds,
  canPlace,
  MODULE_KIND_LABELS,
  MODULE_KINDS,
  NODE_KIND_LABELS,
  projectPermissions,
  type ModuleKind,
  type NodeKind,
} from '@eapq/domain';
import { Breadcrumbs } from '../../app/shell';
import { Button } from '../../components/ui/button';
import { EmptyState, ErrorState, Loading, Notice } from '../../components/ui/feedback';
import { SelectField, TextField } from '../../components/ui/field';
import { ConfirmDialog } from '../../components/ui/panel';
import { ApiError, errorMessage } from '../../lib/api';
import { useSession } from '../auth/session';
import { useProject } from '../projects/api';
import { useStructure, useStructureMutations, useTypologies } from './api';
import { ancestorsOf, indexStructure, isInSubtree, visibleRows, type TreeIndex, type TreeRow } from './tree-model';
import { TypologiesTab } from './typologies-tab';
import { ExportButton } from '../../components/export-button';
import { NodeElements } from './node-elements';

const SUMMARY_KINDS: NodeKindDto[] = ['PHASE', 'BLOCK_QUADRA', 'LOT', 'TOWER', 'FLOOR', 'DWELLING_UNIT', 'COMMON_AREA', 'STREET', 'STREET_SECTION'];

export function StructurePage() {
  const { projectId = '' } = useParams();
  const project = useProject(projectId);
  const structure = useStructure(projectId);
  const typologies = useTypologies(projectId);
  const [params, setParams] = useSearchParams();
  const tab = params.get('aba') === 'tipologias' ? 'tipologias' : 'arvore';
  const { me } = useSession();

  if (project.isPending || structure.isPending) return <Loading />;
  if (project.isError) return <ErrorState message={errorMessage(project.error)} onRetry={() => project.refetch()} />;
  if (structure.isError) return <ErrorState message={errorMessage(structure.error)} onRetry={() => structure.refetch()} />;
  const p = project.data;
  const canEdit = projectPermissions(me!.orgRole, p.myProjectRole).has('project.content.edit') && p.status === 'ACTIVE';
  const s = structure.data;
  const active = s.nodes.filter((n) => !n.archivedAt);

  return (
    <>
      <Breadcrumbs items={[{ label: 'Empreendimentos', to: '/empreendimentos' }, { label: p.name, to: `/empreendimentos/${p.id}` }, { label: 'Cadastro físico' }]} />
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3 border-b border-line pb-4">
        <div>
          <h1 className="font-display text-[28px] font-semibold leading-tight tracking-tight">Cadastro físico</h1>
          <p className="mt-1 text-[14px] text-muted">
            <span className="font-mono text-ink">{p.code}</span> {p.name}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {s.modules.length > 0 && <ExportButton path={`/projects/${p.id}/exports`} body={{ report: 'structure' }} />}
          {canEdit && <Link to={`/empreendimentos/${p.id}/importacoes`} className="inline-flex h-9 items-center rounded-[3px] border border-line-strong bg-sheet px-3.5 text-[14px] hover:bg-paper">Importar</Link>}
          {canEdit && (
            <Link to={`/empreendimentos/${p.id}/cadastro/assistente`} className="inline-flex h-9 items-center rounded-[3px] bg-cyan-ink px-3.5 text-[14px] font-medium text-white hover:bg-cyan-ink-dark">
              {s.modules.length ? 'Acrescentar pelo assistente' : 'Estruturar pelo assistente'}
            </Link>
          )}
        </div>
      </div>

      {p.status === 'ARCHIVED' && <div className="mb-4"><Notice tone="warn">Empreendimento arquivado: o cadastro está disponível apenas para consulta.</Notice></div>}

      {s.modules.length === 0 ? (
        <EmptyState
          title="Cadastro físico vazio"
          action={canEdit && <Link to={`/empreendimentos/${p.id}/cadastro/assistente`} className="inline-flex h-9 items-center rounded-[3px] bg-cyan-ink px-3.5 text-[14px] font-medium text-white">Estruturar pelo assistente</Link>}
        >
          O assistente cria torres, pavimentos, unidades, quadras, lotes, ruas e áreas comuns a partir de poucos parâmetros. Você revisa a prévia antes de gravar.
        </EmptyState>
      ) : (
        <>
          <dl className="mb-4 flex flex-wrap border border-line bg-sheet">
            {SUMMARY_KINDS.filter((k) => active.some((n) => n.kind === k)).map((k) => (
              <div key={k} className="min-w-[120px] flex-1 border-r border-line px-3 py-2 last:border-r-0">
                <dt className="text-[12px] text-muted">{NODE_KIND_LABELS[k]}</dt>
                <dd className="font-mono text-[18px]">{active.filter((n) => n.kind === k).length}</dd>
              </div>
            ))}
          </dl>
          <div role="tablist" aria-label="Seções do cadastro" className="mb-4 flex gap-1 border-b border-line">
            {[['arvore', 'Estrutura'], ['tipologias', 'Tipologias']].map(([id, label]) => (
              <button key={id} role="tab" type="button" aria-selected={tab === id} onClick={() => setParams(id === 'arvore' ? {} : { aba: id! }, { replace: true })}
                className={`-mb-px border-b-2 px-3 py-2 text-[14px] ${tab === id ? 'border-cyan-ink font-medium' : 'border-transparent text-muted hover:text-ink'}`}>
                {label}
                {id === 'tipologias' && typologies.data && <span className="ml-1.5 font-mono text-[12px] text-muted">{typologies.data.filter((t) => !t.archivedAt).length}</span>}
              </button>
            ))}
          </div>
          {tab === 'tipologias' ? (
            <TypologiesTab projectId={p.id} canEdit={canEdit} />
          ) : (
            <TreeEditor project={p} structure={s} typologies={typologies.data ?? []} canEdit={canEdit} />
          )}
        </>
      )}
    </>
  );
}

const ROW_H = 30;

function TreeEditor({ project, structure, typologies, canEdit }: { project: ProjectDto; structure: StructureDto; typologies: TypologyDto[]; canEdit: boolean }) {
  const [showArchived, setShowArchived] = useState(false);
  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(structure.modules.map((m) => m.id)));
  const [selected, setSelected] = useState<string | null>(null);
  const idx = useMemo(() => indexStructure(structure, showArchived), [structure, showArchived]);
  const rows = useMemo(() => visibleRows(idx, expanded, query), [idx, expanded, query]);
  const parentRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({ count: rows.length, getScrollElement: () => parentRef.current, estimateSize: () => ROW_H, overscan: 12 });
  const typologyCode = useMemo(() => new Map(typologies.map((t) => [t.id, t.code])), [typologies]);

  const toggle = (id: string) => setExpanded((prev) => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const select = (id: string) => {
    setSelected(id);
    setExpanded((prev) => new Set([...prev, ...ancestorsOf(idx, id)]));
  };
  const selIndex = rows.findIndex((r) => r.id === selected);
  useEffect(() => { if (selIndex >= 0) virtualizer.scrollToIndex(selIndex, { align: 'auto' }); }, [selIndex, virtualizer]);

  const onKey = (e: React.KeyboardEvent) => {
    const row = rows[selIndex];
    if (e.key === 'ArrowDown') { e.preventDefault(); setSelected(rows[Math.min(selIndex + 1, rows.length - 1)]?.id ?? null); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setSelected(rows[Math.max(selIndex - 1, 0)]?.id ?? null); }
    else if (row && e.key === 'ArrowRight' && row.childCount && !expanded.has(row.id)) { e.preventDefault(); toggle(row.id); }
    else if (row && e.key === 'ArrowLeft') {
      e.preventDefault();
      if (expanded.has(row.id) && row.childCount) toggle(row.id);
      else if (row.type === 'node') setSelected(row.node.parentId ?? row.node.moduleId);
    }
  };

  const selRow: TreeRow | undefined = rows[selIndex] ?? (selected ? findRow(idx, selected) : undefined);

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1.35fr)_minmax(320px,1fr)]">
      <section aria-label="Árvore do cadastro" className="flex min-w-0 flex-col border border-line bg-sheet">
        <div className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2">
          <input type="search" aria-label="Buscar no cadastro" placeholder="Buscar por nome ou código" value={query} onChange={(e) => setQuery(e.target.value)}
            className="h-8 min-w-0 flex-1 rounded-[3px] border border-line-strong bg-sheet px-2 text-[14px]" />
          <button type="button" className="text-[13px] text-cyan-ink hover:underline" onClick={() => setExpanded(new Set([...structure.modules.map((m) => m.id), ...structure.nodes.filter((n) => n.kind !== 'FLOOR' && n.kind !== 'BLOCK_QUADRA' && n.kind !== 'LOT' && n.kind !== 'STREET').map((n) => n.id)]))}>Expandir</button>
          <button type="button" className="text-[13px] text-cyan-ink hover:underline" onClick={() => setExpanded(new Set())}>Recolher</button>
          <label className="flex items-center gap-1.5 text-[13px] text-muted">
            <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} /> Arquivados
          </label>
        </div>
        <div ref={parentRef} role="tree" aria-label="Cadastro físico" tabIndex={0} onKeyDown={onKey}
          aria-activedescendant={selected ? `row-${selected}` : undefined}
          className="h-[min(62vh,640px)] overflow-auto outline-none focus-visible:ring-2 focus-visible:ring-signal">
          {rows.length === 0 ? (
            <p className="px-4 py-6 text-[14px] text-muted">Nenhum item encontrado para “{query}”.</p>
          ) : (
            <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
              {virtualizer.getVirtualItems().map((v) => {
                const r = rows[v.index]!;
                const isSel = r.id === selected;
                const open = expanded.has(r.id) || !!query;
                return (
                  <div key={r.id} id={`row-${r.id}`} role="treeitem" aria-level={r.depth + 1} aria-selected={isSel} aria-expanded={r.childCount ? open : undefined}
                    onClick={() => setSelected(r.id)}
                    className={`absolute left-0 right-0 flex cursor-default items-center gap-1.5 border-l-[3px] pr-3 text-[14px] ${isSel ? 'border-signal bg-cyan-wash' : 'border-transparent hover:bg-paper'} ${r.type === 'node' && r.node.archivedAt ? 'text-graphite-400 line-through' : ''}`}
                    style={{ top: v.start, height: ROW_H, paddingLeft: 8 + r.depth * 18 }}>
                    <button type="button" tabIndex={-1} aria-label={open ? 'Recolher' : 'Expandir'} onClick={(e) => { e.stopPropagation(); if (r.childCount) toggle(r.id); }}
                      className={`grid h-5 w-5 shrink-0 place-items-center text-[11px] text-muted ${r.childCount ? '' : 'invisible'}`}>{open ? '▾' : '▸'}</button>
                    {r.type === 'module' ? (
                      <>
                        <span className="truncate font-medium">{r.module.name}</span>
                        <span className="shrink-0 text-[12px] text-muted">{MODULE_KIND_LABELS[r.module.kind as ModuleKind]}</span>
                      </>
                    ) : (
                      <>
                        <span className="shrink-0 text-[12px] text-muted">{NODE_KIND_LABELS[r.node.kind as NodeKind]}</span>
                        <span className="truncate">{r.node.name}</span>
                        {r.node.typologyId && <span className="shrink-0 rounded-[3px] bg-paper px-1.5 font-mono text-[11.5px] text-graphite-800">{typologyCode.get(r.node.typologyId)}</span>}
                      </>
                    )}
                    {r.childCount > 0 && !open && <span className="shrink-0 text-[12px] text-muted">{r.descendants}</span>}
                    <span className="ml-auto shrink-0 pl-2 font-mono text-[12px] text-muted">{r.type === 'module' ? r.module.code : r.node.code}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
        <p className="border-t border-line px-3 py-1.5 text-[12px] text-muted">Setas navegam; → abre e ← fecha um item.</p>
      </section>

      <section aria-label="Detalhes do item" className="min-w-0 border border-line bg-sheet">
        {!selRow ? (
          <div className="px-5 py-6 text-[14px] text-muted">
            Selecione um item da árvore para ver os detalhes, editar ou incluir subitens.
            {canEdit && <AddModule projectId={project.id} />}
          </div>
        ) : selRow.type === 'module' ? (
          <ModuleInspector key={selRow.id + selRow.module.version} projectId={project.id} module={selRow.module} canEdit={canEdit} onCreated={select} />
        ) : (
          <NodeInspector key={selRow.id + selRow.node.version} projectId={project.id} row={selRow} idx={idx} typologies={typologies} canEdit={canEdit} onSelect={select} />
        )}
      </section>
    </div>
  );
}

function findRow(idx: TreeIndex, id: string): TreeRow | undefined {
  const m = idx.modules.find((x) => x.id === id);
  if (m) return { type: 'module', id, depth: 0, module: m, childCount: idx.children.get(id)?.length ?? 0, descendants: idx.descendants.get(id) ?? 0 };
  const n = idx.byId.get(id);
  if (!n) return undefined;
  const module = idx.modules.find((x) => x.id === n.moduleId)!;
  return { type: 'node', id, depth: n.depth + 1, node: n, module, childCount: idx.children.get(id)?.length ?? 0, descendants: idx.descendants.get(id) ?? 0 };
}

function useFeedback() {
  const [msg, setMsg] = useState<{ tone: 'ok' | 'danger'; text: string } | null>(null);
  return {
    msg,
    ok: (text: string) => setMsg({ tone: 'ok', text }),
    fail: (e: unknown) => setMsg({ tone: 'danger', text: errorMessage(e) }),
    clear: () => setMsg(null),
  };
}

function AddModule({ projectId }: { projectId: string }) {
  const mut = useStructureMutations(projectId);
  const [kind, setKind] = useState<ModuleKind>('COMMON_AREAS');
  const [name, setName] = useState('');
  const fb = useFeedback();
  return (
    <form className="mt-5 flex flex-col gap-3 border-t border-line pt-4" onSubmit={async (e) => {
      e.preventDefault();
      try { await mut.createModule.mutateAsync({ kind, name: name.trim() || MODULE_KIND_LABELS[kind] }); setName(''); fb.ok('Módulo criado.'); } catch (err) { fb.fail(err); }
    }}>
      <h3 className="font-display text-[16px] font-semibold text-ink">Novo módulo vazio</h3>
      {fb.msg && <Notice tone={fb.msg.tone}>{fb.msg.text}</Notice>}
      <SelectField label="Tipo de módulo" value={kind} onChange={(e) => setKind(e.target.value as ModuleKind)}>
        {MODULE_KINDS.map((k) => <option key={k} value={k}>{MODULE_KIND_LABELS[k]}</option>)}
      </SelectField>
      <TextField label="Nome do módulo" value={name} placeholder={MODULE_KIND_LABELS[kind]} onChange={(e) => setName(e.target.value)} />
      <div><Button type="submit" busy={mut.createModule.isPending}>Criar módulo</Button></div>
    </form>
  );
}

function InspectorHeader({ kind, title, code }: { kind: string; title: string; code: string }) {
  return (
    <header className="border-b border-line px-5 py-3">
      <p className="text-[12px] text-muted">{kind}</p>
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="min-w-0 break-words font-display text-[20px] font-semibold">{title}</h2>
        <span className="shrink-0 font-mono text-[13px] text-muted">{code}</span>
      </div>
    </header>
  );
}

function AddChild({ projectId, moduleId, moduleKind, parentId, parentKind, onCreated }: { projectId: string; moduleId: string; moduleKind: ModuleKind; parentId: string | null; parentKind: NodeKind | null; onCreated: (id: string) => void }) {
  const kinds = allowedChildKinds(moduleKind, parentKind);
  const mut = useStructureMutations(projectId);
  const [kind, setKind] = useState<NodeKind>(kinds[0] ?? 'COMMON_AREA');
  const [name, setName] = useState('');
  const fb = useFeedback();
  if (!kinds.length) return <p className="text-[13px] text-muted">Este item não aceita subitens.</p>;
  return (
    <form className="flex flex-col gap-3" onSubmit={async (e) => {
      e.preventDefault();
      fb.clear();
      try {
        const created = await mut.createNode.mutateAsync({ moduleId, parentId, kind, name: name.trim() });
        setName('');
        onCreated(created.id);
      } catch (err) { fb.fail(err); }
    }}>
      {fb.msg && <Notice tone={fb.msg.tone}>{fb.msg.text}</Notice>}
      <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] gap-2">
        <SelectField label="Tipo" value={kind} onChange={(e) => setKind(e.target.value as NodeKind)}>
          {kinds.map((k) => <option key={k} value={k}>{NODE_KIND_LABELS[k]}</option>)}
        </SelectField>
        <TextField label="Nome" value={name} onChange={(e) => setName(e.target.value)} required />
      </div>
      <div><Button type="submit" busy={mut.createNode.isPending} disabled={!name.trim()}>Incluir subitem</Button></div>
    </form>
  );
}

function ModuleInspector({ projectId, module, canEdit, onCreated }: { projectId: string; module: ModuleDto; canEdit: boolean; onCreated: (id: string) => void }) {
  const mut = useStructureMutations(projectId);
  const [name, setName] = useState(module.name);
  const fb = useFeedback();
  return (
    <div>
      <InspectorHeader kind={`Módulo · ${MODULE_KIND_LABELS[module.kind as ModuleKind]}`} title={module.name} code={module.code} />
      <div className="flex flex-col gap-5 px-5 py-4">
        {fb.msg && <Notice tone={fb.msg.tone}>{fb.msg.text}</Notice>}
        {canEdit ? (
          <form className="flex items-end gap-2" onSubmit={async (e) => {
            e.preventDefault();
            try { await mut.renameModule.mutateAsync({ id: module.id, version: module.version, name: name.trim() }); fb.ok('Nome do módulo salvo.'); } catch (err) { fb.fail(err); }
          }}>
            <div className="flex-1"><TextField label="Nome do módulo" value={name} onChange={(e) => setName(e.target.value)} /></div>
            <Button type="submit" busy={mut.renameModule.isPending} disabled={!name.trim() || name.trim() === module.name}>Salvar</Button>
          </form>
        ) : null}
        {canEdit && (
          <section>
            <h3 className="mb-2 font-display text-[16px] font-semibold">Incluir na raiz do módulo</h3>
            <AddChild projectId={projectId} moduleId={module.id} moduleKind={module.kind as ModuleKind} parentId={null} parentKind={null} onCreated={onCreated} />
          </section>
        )}
      </div>
    </div>
  );
}

function NodeInspector({ projectId, row, idx, typologies, canEdit, onSelect }: {
  projectId: string; row: Extract<TreeRow, { type: 'node' }>; idx: TreeIndex; typologies: TypologyDto[]; canEdit: boolean; onSelect: (id: string) => void;
}) {
  const n = row.node;
  const moduleKind = row.module.kind as ModuleKind;
  const mut = useStructureMutations(projectId);
  const fb = useFeedback();
  const editable = canEdit && !n.archivedAt;
  const [name, setName] = useState(n.name);
  const [typologyId, setTypologyId] = useState(n.typologyId ?? '');
  const [area, setArea] = useState(n.lot?.area ?? '');
  const [frontage, setFrontage] = useState(n.lot?.frontage ?? '');
  const [archiving, setArchiving] = useState(false);
  const [reason, setReason] = useState('');
  const [moveTo, setMoveTo] = useState('');
  const expectedTypology = moduleKind === 'VERTICAL_RESIDENTIAL' ? 'APARTMENT' : 'HOUSE';
  const siblings = idx.children.get(n.parentId ?? n.moduleId) ?? [];
  const sibIndex = siblings.findIndex((x) => x.id === n.id);

  const parentOptions = useMemo(() => {
    const opts: { id: string; label: string }[] = [];
    if (canPlace(moduleKind, null, n.kind as NodeKind)) opts.push({ id: '__root', label: `Raiz do módulo ${row.module.name}` });
    for (const c of idx.byId.values()) {
      if (c.moduleId !== n.moduleId || c.archivedAt || c.id === n.parentId || isInSubtree(idx, n.id, c.id)) continue;
      if (canPlace(moduleKind, c.kind as NodeKind, n.kind as NodeKind)) opts.push({ id: c.id, label: `${c.code} ${c.name}` });
    }
    return opts.sort((a, b) => a.label.localeCompare(b.label, 'pt-BR', { numeric: true })).slice(0, 500);
  }, [idx, n, moduleKind, row.module.name]);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    fb.clear();
    try {
      await mut.updateNode.mutateAsync({
        id: n.id,
        version: n.version,
        body: {
          ...(name.trim() !== n.name ? { name: name.trim() } : {}),
          ...(n.kind === 'DWELLING_UNIT' && typologyId !== (n.typologyId ?? '') ? { typologyId: typologyId || null } : {}),
          ...(n.kind === 'LOT' ? { lot: { area: area.trim() || null, frontage: frontage.trim() || null } } : {}),
        },
      });
      fb.ok('Alterações salvas.');
    } catch (err) {
      if (err instanceof ApiError && err.code === 'VALIDATION_FAILED' && err.problem.errors?.length) {
        fb.fail(new ApiError({ ...err.problem, detail: err.problem.errors.map((x) => x.message).join(' ') }));
      } else fb.fail(err);
    }
  };
  const move = async (body: { parentId: string | null; position?: number }) => {
    fb.clear();
    try { await mut.moveNode.mutateAsync({ id: n.id, version: n.version, body }); onSelect(n.id); } catch (err) { fb.fail(err); }
  };

  return (
    <div>
      <InspectorHeader kind={NODE_KIND_LABELS[n.kind as NodeKind] + (n.archivedAt ? ' · arquivado' : '')} title={n.name} code={n.code} />
      <div className="flex flex-col gap-5 px-5 py-4">
        {fb.msg && <Notice tone={fb.msg.tone}>{fb.msg.text}</Notice>}
        <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-[13.5px]">
          <dt className="text-muted">Módulo</dt><dd>{row.module.name}</dd>
          <dt className="text-muted">Subitens</dt><dd className="font-mono">{row.descendants}</dd>
          <dt className="text-muted">Origem</dt><dd>{{ WIZARD: 'Assistente', MANUAL: 'Inclusão manual', DUPLICATE: 'Duplicação' }[n.origin]}</dd>
        </dl>

        <form onSubmit={save} className="flex flex-col gap-3">
          <TextField label="Nome" value={name} onChange={(e) => setName(e.target.value)} disabled={!editable} />
          {n.kind === 'DWELLING_UNIT' && (
            <SelectField label="Tipologia" className="font-mono" value={typologyId} onChange={(e) => setTypologyId(e.target.value)} disabled={!editable}
              hint={typologies.some((t) => t.kind === expectedTypology && !t.archivedAt) ? undefined : 'Cadastre uma tipologia na aba Tipologias.'}>
              <option value="">Sem tipologia</option>
              {typologies.filter((t) => t.kind === expectedTypology && (!t.archivedAt || t.id === n.typologyId)).map((t) => <option key={t.id} value={t.id}>{t.code} · {t.name}</option>)}
            </SelectField>
          )}
          {n.kind === 'LOT' && (
            <div className="grid grid-cols-2 gap-2">
              <TextField label="Área (m²)" inputMode="decimal" value={area} onChange={(e) => setArea(e.target.value)} disabled={!editable} placeholder="360,00" />
              <TextField label="Testada (m)" inputMode="decimal" value={frontage} onChange={(e) => setFrontage(e.target.value)} disabled={!editable} placeholder="12,00" />
            </div>
          )}
          {editable && <div><Button type="submit" variant="primary" busy={mut.updateNode.isPending}>Salvar alterações</Button></div>}
        </form>

        {editable && (
          <>
            <section className="border-t border-line pt-4">
              <h3 className="mb-2 font-display text-[16px] font-semibold">Incluir subitem</h3>
              <AddChild projectId={projectId} moduleId={n.moduleId} moduleKind={moduleKind} parentId={n.id} parentKind={n.kind as NodeKind} onCreated={onSelect} />
            </section>
            <section className="flex flex-col gap-3 border-t border-line pt-4">
              <h3 className="font-display text-[16px] font-semibold">Organizar</h3>
              <div className="flex flex-wrap gap-2">
                <Button type="button" disabled={sibIndex <= 0} onClick={() => move({ parentId: n.parentId, position: sibIndex })}>Subir</Button>
                <Button type="button" disabled={sibIndex < 0 || sibIndex >= siblings.length - 1} onClick={() => move({ parentId: n.parentId, position: sibIndex + 2 })}>Descer</Button>
                <Button type="button" busy={mut.duplicateNode.isPending} onClick={async () => {
                  fb.clear();
                  try { const c = await mut.duplicateNode.mutateAsync(n.id); onSelect(c.id); } catch (err) { fb.fail(err); }
                }}>Duplicar com subitens</Button>
              </div>
              <form className="flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); if (moveTo) void move({ parentId: moveTo === '__root' ? null : moveTo }); }}>
                <div className="min-w-0 flex-1">
                  <SelectField label="Mover para" value={moveTo} onChange={(e) => setMoveTo(e.target.value)} hint="Somente destinos compatíveis com este tipo de item.">
                    <option value="">{parentOptions.length ? 'Selecione o destino' : 'Nenhum destino compatível'}</option>
                    {parentOptions.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
                  </SelectField>
                </div>
                <Button type="submit" disabled={!moveTo} busy={mut.moveNode.isPending}>Mover</Button>
              </form>
            </section>
          </>
        )}
        {n.kind !== 'DWELLING_UNIT' && <NodeElements projectId={projectId} node={n} canEdit={canEdit} />}
        {n.kind === 'DWELLING_UNIT' && (
          <p className="border-t border-line pt-4 text-[13px] text-muted">Os elementos desta unidade vêm da tipologia; particularidades são registradas em Construtivo.</p>
        )}
        {canEdit && (
          <section className="border-t border-line pt-4">
            <Button variant={n.archivedAt ? 'secondary' : 'ghost'} onClick={() => { setReason(''); setArchiving(true); }}>
              {n.archivedAt ? 'Reativar item' : `Arquivar${row.descendants ? ` com ${row.descendants} subitens` : ''}`}
            </Button>
          </section>
        )}
      </div>
      <ConfirmDialog open={archiving} onClose={() => setArchiving(false)} title={n.archivedAt ? 'Reativar item' : 'Arquivar item'}
        footer={<>
          <Button variant="ghost" onClick={() => setArchiving(false)}>Cancelar</Button>
          <Button variant={n.archivedAt ? 'primary' : 'danger'} busy={mut.archiveNode.isPending} disabled={!n.archivedAt && !reason.trim()} onClick={async () => {
            try { await mut.archiveNode.mutateAsync({ id: n.id, version: n.version, archived: !n.archivedAt, reason: reason.trim() }); setArchiving(false); fb.ok(n.archivedAt ? 'Item reativado.' : 'Item arquivado.'); } catch (err) { setArchiving(false); fb.fail(err); }
          }}>{n.archivedAt ? 'Reativar' : 'Arquivar'}</Button>
        </>}>
        <p className="mb-3">{n.archivedAt ? 'O item e os subitens arquivados junto com ele voltam a ficar ativos.' : `O item${row.descendants ? ` e seus ${row.descendants} subitens deixam` : ' deixa'} de aparecer na estrutura ativa. Nada é apagado.`}</p>
        <TextField label={n.archivedAt ? 'Motivo (opcional)' : 'Motivo'} value={reason} onChange={(e) => setReason(e.target.value)} />
      </ConfirmDialog>
    </div>
  );
}
