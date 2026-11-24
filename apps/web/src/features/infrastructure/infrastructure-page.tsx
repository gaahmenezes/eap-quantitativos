import { useMemo, useState } from 'react';
import { useParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import type { ElementTypeDto, NetworkDto, NetworkNodeDto, PhysicalElementDto, ProjectDto, SegmentDto, StructureNodeDto, SystemDetailDto, SystemDto, SystemTypeDto } from '@eapq/contracts';
import { NODE_KIND_LABELS, projectPermissions, type NodeKind } from '@eapq/domain';
import { Breadcrumbs } from '../../app/shell';
import { AttributeFields, attributeSummary, cleanAttrs, fmtDecimal, type AttrValues } from '../../components/attribute-fields';
import { ArchiveButton, useAction } from '../../components/ui/actions';
import { Button } from '../../components/ui/button';
import { EmptyState, ErrorState, Loading, Notice } from '../../components/ui/feedback';
import { SelectField, TextField } from '../../components/ui/field';
import { SidePanel } from '../../components/ui/panel';
import { api, errorMessage } from '../../lib/api';
import { useSession } from '../auth/session';
import { useElementTypes, useSystemTypes } from '../catalog/api';
import { useProject } from '../projects/api';
import { useStructure } from '../structure/api';

const keys = {
  list: (p: string) => ['project', p, 'infra'] as const,
  system: (p: string, s: string) => ['project', p, 'infra', s] as const,
};

export function InfrastructurePage() {
  const { projectId = '' } = useParams();
  const project = useProject(projectId);
  const systems = useQuery({ queryKey: keys.list(projectId), queryFn: () => api<SystemDto[]>('GET', `/projects/${projectId}/infrastructure/systems`) });
  const systemTypes = useSystemTypes();
  const elementTypes = useElementTypes();
  const structure = useStructure(projectId);
  const { me } = useSession();
  const [selected, setSelected] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  if (project.isPending || systems.isPending || systemTypes.isPending || elementTypes.isPending || structure.isPending) return <Loading />;
  const failed = [project, systems, systemTypes, elementTypes, structure].find((q) => q.isError);
  if (failed) return <ErrorState message={errorMessage(failed.error)} onRetry={() => failed.refetch()} />;
  const p = project.data!;
  const canEdit = projectPermissions(me!.orgRole, p.myProjectRole).has('project.content.edit') && p.status === 'ACTIVE';
  const typeById = new Map(systemTypes.data!.map((t) => [t.id, t]));
  const active = systems.data!.filter((s) => !s.archivedAt);
  const current = selected ?? active[0]?.id ?? null;
  const nodes = structure.data!.nodes.filter((n) => !n.archivedAt);

  return (
    <>
      <Breadcrumbs items={[{ label: 'Empreendimentos', to: '/empreendimentos' }, { label: p.name, to: `/empreendimentos/${p.id}` }, { label: 'Infraestrutura' }]} />
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3 border-b border-line pb-4">
        <div>
          <h1 className="font-display text-[28px] font-semibold leading-tight tracking-tight">Infraestrutura</h1>
          <p className="mt-1 text-[14px] text-muted"><span className="font-mono text-ink">{p.code}</span> {p.name}</p>
        </div>
        {canEdit && <Button variant="primary" onClick={() => setCreating(true)}>Novo sistema</Button>}
      </div>
      {active.length === 0 ? (
        <EmptyState title="Nenhum sistema de infraestrutura" action={canEdit && <Button variant="primary" onClick={() => setCreating(true)}>Cadastrar sistema</Button>}>
          Cadastre drenagem, água, esgoto, terraplenagem, pavimentação, guias e sarjetas, iluminação e outros sistemas do catálogo técnico.
        </EmptyState>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[260px_minmax(0,1fr)]">
          <nav aria-label="Sistemas" className="self-start border border-line bg-sheet">
            <ul>
              {active.map((s) => (
                <li key={s.id}>
                  <button type="button" onClick={() => setSelected(s.id)} aria-current={s.id === current ? 'true' : undefined}
                    className={`block w-full border-l-[3px] px-3 py-2 text-left ${s.id === current ? 'border-signal bg-cyan-wash' : 'border-transparent hover:bg-paper'}`}>
                    <span className="block text-[14px] font-medium">{s.name}</span>
                    <span className="block text-[12.5px] text-muted">
                      {typeById.get(s.systemTypeId)?.name}
                      {typeById.get(s.systemTypeId)?.networkBased ? ` · ${s.networkCount} rede(s)` : ''}
                      {s.elementCount ? ` · ${s.elementCount} elemento(s)` : ''}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </nav>
          {current && <SystemView key={current} project={p} systemId={current} systemTypes={systemTypes.data!} elementTypes={elementTypes.data!} nodes={nodes} canEdit={canEdit} onArchived={() => setSelected(null)} />}
        </div>
      )}
      <SidePanel open={creating} title="Novo sistema de infraestrutura" onClose={() => setCreating(false)}>
        {creating && <NewSystemForm project={p} systemTypes={systemTypes.data!.filter((t) => !t.archivedAt)} nodes={nodes} onDone={(id) => { setCreating(false); setSelected(id); }} />}
      </SidePanel>
    </>
  );
}

const scopeKinds: NodeKind[] = ['PHASE', 'STAGE', 'SECTOR', 'BLOCK_QUADRA', 'STREET'];
const nodeLabel = (n: StructureNodeDto) => `${n.code} ${NODE_KIND_LABELS[n.kind as NodeKind]} ${n.name}`;

function NewSystemForm({ project, systemTypes, nodes, onDone }: { project: ProjectDto; systemTypes: SystemTypeDto[]; nodes: StructureNodeDto[]; onDone: (id: string) => void }) {
  const [typeId, setTypeId] = useState(systemTypes[0]?.id ?? '');
  const type = systemTypes.find((t) => t.id === typeId);
  const [name, setName] = useState(type?.name ?? '');
  const [scope, setScope] = useState('');
  const act = useAction([keys.list(project.id)]);
  return (
    <form className="flex flex-col gap-4" onSubmit={async (e) => {
      e.preventDefault();
      const r = await act.run(() => api<{ id: string }>('POST', `/projects/${project.id}/infrastructure/systems`, { body: { systemTypeId: typeId, name: name.trim(), scopeNodeId: scope || null } }));
      if (r && r !== true) onDone(r.id);
    }}>
      {act.error && <Notice tone="danger">{act.error}</Notice>}
      <SelectField label="Sistema" value={typeId} onChange={(e) => { setTypeId(e.target.value); setName(systemTypes.find((t) => t.id === e.target.value)?.name ?? ''); }}
        hint={type ? (type.networkBased ? 'Organizado em redes: dispositivos e trechos.' : 'Organizado em elementos (áreas, trechos, quantidades).') : undefined}>
        {systemTypes.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
      </SelectField>
      <TextField label="Nome no empreendimento" value={name} onChange={(e) => setName(e.target.value)} hint="Ex.: Drenagem pluvial da Fase 1" />
      <SelectField label="Abrangência no cadastro (opcional)" value={scope} onChange={(e) => setScope(e.target.value)}>
        <option value="">Todo o empreendimento</option>
        {nodes.filter((n) => scopeKinds.includes(n.kind as NodeKind)).map((n) => <option key={n.id} value={n.id}>{nodeLabel(n)}</option>)}
      </SelectField>
      <div><Button type="submit" variant="primary" busy={act.pending} disabled={!typeId || !name.trim()}>Cadastrar sistema</Button></div>
    </form>
  );
}

type Panel =
  | { kind: 'node'; network: NetworkDto; node?: NetworkNodeDto }
  | { kind: 'segment'; network: NetworkDto; segment?: SegmentDto }
  | { kind: 'element'; element?: PhysicalElementDto }
  | null;

function SystemView({ project, systemId, systemTypes, elementTypes, nodes, canEdit, onArchived }: {
  project: ProjectDto; systemId: string; systemTypes: SystemTypeDto[]; elementTypes: ElementTypeDto[]; nodes: StructureNodeDto[]; canEdit: boolean; onArchived: () => void;
}) {
  const q = useQuery({ queryKey: keys.system(project.id, systemId), queryFn: () => api<SystemDetailDto>('GET', `/projects/${project.id}/infrastructure/systems/${systemId}`) });
  const act = useAction([keys.system(project.id, systemId), keys.list(project.id)]);
  const [panel, setPanel] = useState<Panel>(null);
  const [netCode, setNetCode] = useState('');
  const [netName, setNetName] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  const typeName = useMemo(() => new Map(elementTypes.map((t) => [t.id, t])), [elementTypes]);
  const nodeById = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);
  if (q.isPending) return <Loading />;
  if (q.isError) return <ErrorState message={errorMessage(q.error)} onRetry={() => q.refetch()} />;
  const s = q.data;
  const st = systemTypes.find((t) => t.id === s.systemTypeId)!;
  const base = `/projects/${project.id}/infrastructure`;
  const vis = <T extends { archivedAt: string | null }>(xs: T[]) => (showArchived ? xs : xs.filter((x) => !x.archivedAt));
  const systemElementTypes = elementTypes.filter((t) => t.systemTypeId === st.id && !t.archivedAt);

  return (
    <section aria-label={s.name} className="min-w-0">
      <header className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[12.5px] text-muted">{st.name}{s.scopeNodeId && nodeById.get(s.scopeNodeId) ? ` · ${nodeLabel(nodeById.get(s.scopeNodeId)!)}` : ''}</p>
          <h2 className="font-display text-[22px] font-semibold">{s.name}</h2>
        </div>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-1.5 text-[13px] text-muted"><input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} /> Mostrar arquivados</label>
          {canEdit && <ArchiveButton what="sistema" label="Arquivar sistema" onConfirm={async (reason) => { const r = await act.run(() => api('POST', `${base}/systems/${s.id}/archive`, { body: { reason }, version: s.version })); if (r) onArchived(); }} />}
        </div>
      </header>
      {act.error && <div className="mb-3"><Notice tone="danger">{act.error}</Notice></div>}

      {st.networkBased && (
        <div className="flex flex-col gap-6">
          {vis(s.networks).length === 0 && <EmptyState title="Nenhuma rede cadastrada">Cadastre a primeira rede deste sistema para incluir dispositivos e trechos.</EmptyState>}
          {vis(s.networks).map((n) => (
            <NetworkView key={n.id} network={n} showArchived={showArchived} canEdit={canEdit && !n.archivedAt} typeName={typeName} nodeById={nodeById}
              onPanel={setPanel} onArchive={(reason) => act.run(() => api('POST', `${base}/networks/${n.id}/archive`, { body: { reason }, version: n.version }))}
              onArchiveItem={(kind, id, version, reason) => act.run(() => api('POST', `${base}/${kind}/${id}/archive`, { body: { reason }, version }))} />
          ))}
          {canEdit && (
            <form className="flex flex-wrap items-end gap-2 border-t border-line pt-4" onSubmit={async (e) => {
              e.preventDefault();
              const r = await act.run(() => api('POST', `${base}/systems/${s.id}/networks`, { body: { code: netCode.trim(), name: netName.trim() } }));
              if (r) { setNetCode(''); setNetName(''); }
            }}>
              <div className="w-32"><TextField label="Código da rede" className="font-mono uppercase" value={netCode} onChange={(e) => setNetCode(e.target.value)} placeholder="D-01" /></div>
              <div className="min-w-0 flex-1"><TextField label="Nome da rede" value={netName} onChange={(e) => setNetName(e.target.value)} placeholder="Rede da Rua das Palmeiras" /></div>
              <Button type="submit" busy={act.pending} disabled={!netCode.trim() || !netName.trim()}>Incluir rede</Button>
            </form>
          )}
        </div>
      )}

      {(!st.networkBased || s.elements.length > 0 || systemElementTypes.some((t) => t.category === 'ELEMENT')) && (
        <section className="mt-6">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="font-display text-[18px] font-semibold">Elementos</h3>
            {canEdit && systemElementTypes.some((t) => t.category === 'ELEMENT') && <Button onClick={() => setPanel({ kind: 'element' })}>Novo elemento</Button>}
          </div>
          {vis(s.elements).length === 0 ? <p className="text-[14px] text-muted">Nenhum elemento cadastrado.</p> : (
            <div className="overflow-x-auto border border-line bg-sheet">
              <table className="w-full text-left text-[14px]">
                <thead className="border-b border-line-strong text-[13px] text-muted"><tr><th className="px-3 py-2 font-medium">Elemento</th><th className="px-3 py-2 font-medium">Tipo</th><th className="px-3 py-2 font-medium">Local</th><th className="px-3 py-2 font-medium">Atributos</th>{canEdit && <th className="px-3 py-2"><span className="sr-only">Ações</span></th>}</tr></thead>
                <tbody>
                  {vis(s.elements).map((e) => (
                    <tr key={e.id} className={`border-b border-line last:border-0 align-top ${e.archivedAt ? 'text-graphite-400' : ''}`}>
                      <td className="px-3 py-2">{e.name}</td>
                      <td className="px-3 py-2">{typeName.get(e.elementTypeId)?.name}</td>
                      <td className="px-3 py-2">{e.structureNodeId && nodeById.get(e.structureNodeId) ? nodeLabel(nodeById.get(e.structureNodeId)!) : '—'}</td>
                      <td className="px-3 py-2 text-[13px]">{attributeSummary(typeName.get(e.elementTypeId), e.attributes)}</td>
                      {canEdit && <td className="whitespace-nowrap px-3 py-2 text-right">{!e.archivedAt && <>
                        <button type="button" className="mr-2 text-[13px] text-cyan-ink hover:underline" onClick={() => setPanel({ kind: 'element', element: e })}>Editar</button>
                        <ArchiveButton what="elemento" onConfirm={(reason) => act.run(() => api('POST', `/projects/${project.id}/elements/${e.id}/archive`, { body: { reason }, version: e.version }))} />
                      </>}</td>}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      <SidePanel open={!!panel} title={panel?.kind === 'node' ? (panel.node ? `Dispositivo ${panel.node.code}` : 'Novo dispositivo') : panel?.kind === 'segment' ? (panel.segment ? `Trecho ${panel.segment.code}` : 'Novo trecho') : panel?.element ? 'Editar elemento' : 'Novo elemento'} onClose={() => setPanel(null)}>
        {panel?.kind === 'node' && <NodeForm project={project} network={panel.network} node={panel.node} types={systemElementTypes.filter((t) => t.category === 'NETWORK_NODE')} nodes={nodes} systemId={s.id} onDone={() => setPanel(null)} />}
        {panel?.kind === 'segment' && <SegmentForm project={project} network={panel.network} segment={panel.segment} types={systemElementTypes.filter((t) => t.category === 'NETWORK_SEGMENT')} nodes={nodes} systemId={s.id} onDone={() => setPanel(null)} />}
        {panel?.kind === 'element' && <ElementForm project={project} systemId={s.id} element={panel.element} types={systemElementTypes.filter((t) => t.category === 'ELEMENT')} nodes={nodes} onDone={() => setPanel(null)} />}
      </SidePanel>
    </section>
  );
}

function NetworkView({ network: n, showArchived, canEdit, typeName, nodeById, onPanel, onArchive, onArchiveItem }: {
  network: NetworkDto; showArchived: boolean; canEdit: boolean; typeName: Map<string, ElementTypeDto>; nodeById: Map<string, StructureNodeDto>;
  onPanel: (p: Panel) => void; onArchive: (reason: string) => Promise<unknown>; onArchiveItem: (kind: 'nodes' | 'segments', id: string, version: number, reason: string) => Promise<unknown>;
}) {
  const devices = showArchived ? n.nodes : n.nodes.filter((x) => !x.archivedAt);
  const segments = showArchived ? n.segments : n.segments.filter((x) => !x.archivedAt);
  const code = new Map(n.nodes.map((x) => [x.id, x.code]));
  const th = 'px-3 py-2 font-medium';
  const td = 'px-3 py-1.5';
  return (
    <section className="border border-line bg-sheet" aria-label={`Rede ${n.code}`}>
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-2.5">
        <div className="flex items-baseline gap-3">
          <span className="font-mono text-[14px]">{n.code}</span>
          <h3 className="font-medium">{n.name}</h3>
          {n.archivedAt && <span className="text-[12.5px] text-muted">arquivada</span>}
        </div>
        <div className="flex items-center gap-4 text-[13px] text-muted">
          <span><span className="font-mono text-ink">{n.totals.segments}</span> trechos · <span className="font-mono text-ink">{fmtDecimal(n.totals.length, 2)}</span> m</span>
          {canEdit && <ArchiveButton what="rede" label="Arquivar rede" onConfirm={onArchive} />}
        </div>
      </header>
      <div className="flex flex-col">
        <div className="min-w-0 border-b border-line">
          <div className="flex items-center justify-between px-4 py-2">
            <h4 className="text-[14px] font-medium">Dispositivos <span className="font-mono text-[12.5px] text-muted">{devices.length}</span></h4>
            {canEdit && <button type="button" className="text-[13px] font-medium text-cyan-ink hover:underline" onClick={() => onPanel({ kind: 'node', network: n })}>Incluir dispositivo</button>}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[13.5px]">
              <thead className="border-y border-line text-[12.5px] text-muted"><tr><th className={th}>Código</th><th className={th}>Tipo</th><th className={`${th} text-right`}>Tampa (m)</th><th className={`${th} text-right`}>Fundo (m)</th></tr></thead>
              <tbody>
                {devices.map((x) => (
                  <tr key={x.id} className={`border-b border-line last:border-0 ${x.archivedAt ? 'text-graphite-400' : canEdit ? 'cursor-pointer hover:bg-cyan-wash' : ''}`} onClick={() => canEdit && !x.archivedAt && onPanel({ kind: 'node', network: n, node: x })}>
                    <td className={`${td} whitespace-nowrap font-mono`}>{x.code}</td>
                    <td className={td} title={attributeSummary(typeName.get(x.elementTypeId), x.attributes)}>{typeName.get(x.elementTypeId)?.name}</td>
                    <td className={`${td} text-right font-mono`}>{fmtDecimal(x.coverElevation)}</td>
                    <td className={`${td} text-right font-mono`}>{fmtDecimal(x.bottomElevation)}</td>
                  </tr>
                ))}
                {devices.length === 0 && <tr><td colSpan={4} className={`${td} text-muted`}>Nenhum dispositivo.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
        <div className="min-w-0">
          <div className="flex items-center justify-between px-4 py-2">
            <h4 className="text-[14px] font-medium">Trechos <span className="font-mono text-[12.5px] text-muted">{segments.length}</span></h4>
            {canEdit && devices.filter((d) => !d.archivedAt).length >= 2 && <button type="button" className="text-[13px] font-medium text-cyan-ink hover:underline" onClick={() => onPanel({ kind: 'segment', network: n })}>Incluir trecho</button>}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[13.5px]">
              <thead className="border-y border-line text-[12.5px] text-muted"><tr>
                <th className={th}>Trecho</th><th className={th}>Montante → jusante</th><th className={`${th} text-right`}>L (m)</th><th className={`${th} text-right`}>DN (mm)</th>
                <th className={`${th} text-right`}>i (%)</th><th className={`${th} text-right`}>Prof. média (m)</th><th className={th}>Local</th>{canEdit && <th className={th}><span className="sr-only">Ações</span></th>}
              </tr></thead>
              <tbody>
                {segments.map((x) => (
                  <tr key={x.id} className={`border-b border-line last:border-0 ${x.archivedAt ? 'text-graphite-400' : ''}`}>
                    <td className={`${td} whitespace-nowrap font-mono`}>{x.code}</td>
                    <td className={`${td} whitespace-nowrap font-mono`}>{code.get(x.fromNodeId)} → {code.get(x.toNodeId)}</td>
                    <td className={`${td} text-right font-mono`}>{fmtDecimal(x.length, 2)}</td>
                    <td className={`${td} text-right font-mono`}>{x.diameter ? fmtDecimal(x.diameter, 0) : '—'}</td>
                    <td className={`${td} text-right font-mono ${x.geometry.adverseSlope ? 'text-danger' : ''}`} title={x.geometry.adverseSlope ? 'Declividade adversa: o fundo sobe no sentido do escoamento.' : undefined}>
                      {x.geometry.slopePercent ? fmtDecimal(x.geometry.slopePercent, 3) : '—'}{x.geometry.adverseSlope && ' ⚠'}
                    </td>
                    <td className={`${td} text-right font-mono`}>{fmtDecimal(x.geometry.averageDepth, 2)}</td>
                    <td className={td}>{x.streetSectionId ? nodeById.get(x.streetSectionId)?.name ?? '—' : '—'}</td>
                    {canEdit && <td className={`${td} whitespace-nowrap text-right`}>{!x.archivedAt && <>
                      <button type="button" className="mr-2 text-[13px] text-cyan-ink hover:underline" onClick={() => onPanel({ kind: 'segment', network: n, segment: x })}>Editar</button>
                      <ArchiveButton what="trecho" onConfirm={(reason) => onArchiveItem('segments', x.id, x.version, reason)} />
                    </>}</td>}
                  </tr>
                ))}
                {segments.length === 0 && <tr><td colSpan={8} className={`${td} text-muted`}>Nenhum trecho.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </section>
  );
}

function useTypeChoice(types: ElementTypeDto[], initial?: string) {
  const [typeId, setTypeId] = useState(initial ?? types[0]?.id ?? '');
  return { typeId, setTypeId, type: types.find((t) => t.id === typeId) };
}

function NodeForm({ project, network, node, types, nodes, systemId, onDone }: { project: ProjectDto; network: NetworkDto; node?: NetworkNodeDto; types: ElementTypeDto[]; nodes: StructureNodeDto[]; systemId: string; onDone: () => void }) {
  const { typeId, setTypeId, type } = useTypeChoice(types, node?.elementTypeId);
  const [code, setCode] = useState(node?.code ?? '');
  const [cover, setCover] = useState(node?.coverElevation ?? '');
  const [bottom, setBottom] = useState(node?.bottomElevation ?? '');
  const [location, setLocation] = useState(node?.locationNodeId ?? '');
  const [attrs, setAttrs] = useState<AttrValues>(node?.attributes ?? {});
  const act = useAction([keys.system(project.id, systemId)]);
  if (!types.length) return <Notice tone="warn">Não há tipos de dispositivo para este sistema no catálogo técnico.</Notice>;
  const body = { code: code.trim(), coverElevation: cover.trim() || null, bottomElevation: bottom.trim() || null, locationNodeId: location || null, attributes: cleanAttrs(attrs) };
  return (
    <form className="flex flex-col gap-4" onSubmit={async (e) => {
      e.preventDefault();
      const r = await act.run(() => node
        ? api('PATCH', `/projects/${project.id}/infrastructure/nodes/${node.id}`, { body, version: node.version })
        : api('POST', `/projects/${project.id}/infrastructure/networks/${network.id}/nodes`, { body: { ...body, elementTypeId: typeId } }));
      if (r) onDone();
    }}>
      {act.error && <Notice tone="danger">{act.error}</Notice>}
      <SelectField label="Tipo de dispositivo" value={typeId} disabled={!!node} onChange={(e) => { setTypeId(e.target.value); setAttrs({}); }}>
        {types.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
      </SelectField>
      <TextField label="Código" className="font-mono uppercase" value={code} onChange={(e) => setCode(e.target.value)} placeholder="PV-01" error={act.fieldErrors.code} />
      <div className="grid grid-cols-2 gap-3">
        <TextField label="Cota de tampa (m)" inputMode="decimal" className="text-right font-mono" value={cover} onChange={(e) => setCover(e.target.value)} error={act.fieldErrors.coverElevation} />
        <TextField label="Cota de fundo (m)" inputMode="decimal" className="text-right font-mono" value={bottom} onChange={(e) => setBottom(e.target.value)} error={act.fieldErrors.bottomElevation} />
      </div>
      <SelectField label="Localização no cadastro (opcional)" value={location} onChange={(e) => setLocation(e.target.value)}>
        <option value="">Não informada</option>
        {nodes.filter((n) => ['STREET', 'STREET_SECTION', 'BLOCK_QUADRA', 'LOT', 'COMMON_AREA', 'GREEN_AREA', 'INSTITUTIONAL_AREA', 'TECHNICAL_AREA'].includes(n.kind)).map((n) => <option key={n.id} value={n.id}>{nodeLabel(n)}</option>)}
      </SelectField>
      {type && <fieldset><legend className="mb-2 text-[14px] font-medium">Atributos técnicos</legend><AttributeFields idPrefix="node" defs={type.attributes} values={attrs} onChange={setAttrs} errors={act.fieldErrors} /></fieldset>}
      <div className="flex justify-between gap-2 border-t border-line pt-4">
        {node ? <ArchiveButton what="dispositivo" onConfirm={async (reason) => { const r = await act.run(() => api('POST', `/projects/${project.id}/infrastructure/nodes/${node.id}/archive`, { body: { reason }, version: node.version })); if (r) onDone(); }} /> : <span />}
        <Button type="submit" variant="primary" busy={act.pending}>{node ? 'Salvar dispositivo' : 'Incluir dispositivo'}</Button>
      </div>
    </form>
  );
}

function SegmentForm({ project, network, segment, types, nodes, systemId, onDone }: { project: ProjectDto; network: NetworkDto; segment?: SegmentDto; types: ElementTypeDto[]; nodes: StructureNodeDto[]; systemId: string; onDone: () => void }) {
  const devices = network.nodes.filter((x) => !x.archivedAt);
  const { typeId, setTypeId, type } = useTypeChoice(types, segment?.elementTypeId);
  const [v, setV] = useState({
    code: segment?.code ?? `T-${String(network.segments.length + 1).padStart(2, '0')}`,
    fromNodeId: segment?.fromNodeId ?? devices[0]?.id ?? '',
    toNodeId: segment?.toNodeId ?? devices[1]?.id ?? '',
    length: segment?.length ?? '',
    diameter: segment?.diameter ?? '',
    material: segment?.material ?? '',
    upstreamInvert: segment?.upstreamInvert ?? '',
    downstreamInvert: segment?.downstreamInvert ?? '',
    streetSectionId: segment?.streetSectionId ?? '',
  });
  const [attrs, setAttrs] = useState<AttrValues>(segment?.attributes ?? {});
  const act = useAction([keys.system(project.id, systemId)]);
  if (!types.length) return <Notice tone="warn">Não há tipos de trecho para este sistema no catálogo técnico.</Notice>;
  const set = (k: keyof typeof v) => (e: { target: { value: string } }) => setV((x) => ({ ...x, [k]: e.target.value }));
  const body = {
    code: v.code.trim(), fromNodeId: v.fromNodeId, toNodeId: v.toNodeId, length: v.length.trim(),
    diameter: v.diameter.trim() || null, material: v.material.trim() || null,
    upstreamInvert: v.upstreamInvert.trim() || null, downstreamInvert: v.downstreamInvert.trim() || null,
    streetSectionId: v.streetSectionId || null, attributes: cleanAttrs(attrs),
  };
  const fe = act.fieldErrors;
  return (
    <form className="flex flex-col gap-4" onSubmit={async (e) => {
      e.preventDefault();
      const r = await act.run(() => segment
        ? api('PATCH', `/projects/${project.id}/infrastructure/segments/${segment.id}`, { body, version: segment.version })
        : api('POST', `/projects/${project.id}/infrastructure/networks/${network.id}/segments`, { body: { ...body, elementTypeId: typeId } }));
      if (r) onDone();
    }}>
      {act.error && <Notice tone="danger">{act.error}</Notice>}
      <SelectField label="Tipo de trecho" value={typeId} disabled={!!segment} onChange={(e) => { setTypeId(e.target.value); setAttrs({}); }}>
        {types.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
      </SelectField>
      <TextField label="Código" className="font-mono uppercase" value={v.code} onChange={set('code')} error={fe.code} />
      <div className="grid grid-cols-2 gap-3">
        <SelectField label="Montante (de)" className="font-mono" value={v.fromNodeId} onChange={set('fromNodeId')}>{devices.map((d) => <option key={d.id} value={d.id}>{d.code}</option>)}</SelectField>
        <SelectField label="Jusante (para)" className="font-mono" value={v.toNodeId} onChange={set('toNodeId')} error={fe.toNodeId}>{devices.map((d) => <option key={d.id} value={d.id}>{d.code}</option>)}</SelectField>
        <TextField label="Comprimento (m) *" inputMode="decimal" className="text-right font-mono" value={v.length} onChange={set('length')} error={fe.length} />
        <TextField label="Diâmetro nominal (mm)" inputMode="decimal" className="text-right font-mono" value={v.diameter} onChange={set('diameter')} error={fe.diameter} />
        <TextField label="Cota de fundo montante (m)" inputMode="decimal" className="text-right font-mono" value={v.upstreamInvert} onChange={set('upstreamInvert')} hint="Vazio: usa a cota de fundo do dispositivo." error={fe.upstreamInvert} />
        <TextField label="Cota de fundo jusante (m)" inputMode="decimal" className="text-right font-mono" value={v.downstreamInvert} onChange={set('downstreamInvert')} error={fe.downstreamInvert} />
      </div>
      <TextField label="Material" value={v.material} onChange={set('material')} placeholder="Concreto, PVC, PEAD…" />
      <SelectField label="Rua ou trecho de rua (opcional)" value={v.streetSectionId} onChange={set('streetSectionId')}>
        <option value="">Não informado</option>
        {nodes.filter((n) => n.kind === 'STREET' || n.kind === 'STREET_SECTION').map((n) => <option key={n.id} value={n.id}>{nodeLabel(n)}</option>)}
      </SelectField>
      {type && type.attributes.length > 0 && <fieldset><legend className="mb-2 text-[14px] font-medium">Atributos técnicos</legend><AttributeFields idPrefix="seg" defs={type.attributes} values={attrs} onChange={setAttrs} errors={fe} /></fieldset>}
      <div className="flex justify-end border-t border-line pt-4"><Button type="submit" variant="primary" busy={act.pending} disabled={!v.length.trim()}>{segment ? 'Salvar trecho' : 'Incluir trecho'}</Button></div>
    </form>
  );
}

export function ElementForm({ project, systemId, structureNodeId, element, types, nodes, onDone }: {
  project: ProjectDto | { id: string }; systemId?: string; structureNodeId?: string; element?: PhysicalElementDto; types: ElementTypeDto[]; nodes: StructureNodeDto[]; onDone: () => void;
}) {
  const { typeId, setTypeId, type } = useTypeChoice(types, element?.elementTypeId);
  const [name, setName] = useState(element?.name ?? types[0]?.name ?? '');
  const [location, setLocation] = useState(element?.structureNodeId ?? structureNodeId ?? '');
  const [attrs, setAttrs] = useState<AttrValues>(element?.attributes ?? {});
  const act = useAction([['project', project.id, 'infra'], ['project', project.id, 'elements']]);
  if (!types.length) return <Notice tone="warn">Não há tipos de elemento disponíveis no catálogo técnico.</Notice>;
  return (
    <form className="flex flex-col gap-4" onSubmit={async (e) => {
      e.preventDefault();
      const body = { name: name.trim(), structureNodeId: location || null, attributes: cleanAttrs(attrs) };
      const r = await act.run(() => element
        ? api('PATCH', `/projects/${project.id}/elements/${element.id}`, { body, version: element.version })
        : api('POST', `/projects/${project.id}/elements`, { body: { ...body, elementTypeId: typeId, systemId: systemId ?? null } }));
      if (r) onDone();
    }}>
      {act.error && <Notice tone="danger">{act.error}</Notice>}
      <SelectField label="Tipo de elemento" value={typeId} disabled={!!element} onChange={(e) => { setTypeId(e.target.value); setName(types.find((t) => t.id === e.target.value)?.name ?? ''); setAttrs({}); }}>
        {types.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
      </SelectField>
      <TextField label="Nome" value={name} onChange={(e) => setName(e.target.value)} error={act.fieldErrors.name} />
      {!structureNodeId && (
        <SelectField label={type?.domain === 'CONSTRUTIVO' ? 'Local no cadastro *' : 'Local no cadastro (opcional)'} value={location} onChange={(e) => setLocation(e.target.value)} error={act.fieldErrors.structureNodeId}>
          <option value="">Não informado</option>
          {nodes.filter((n) => n.kind !== 'DWELLING_UNIT').map((n) => <option key={n.id} value={n.id}>{nodeLabel(n)}</option>)}
        </SelectField>
      )}
      {type && <fieldset><legend className="mb-2 text-[14px] font-medium">Atributos técnicos</legend><AttributeFields idPrefix="el" defs={type.attributes} values={attrs} onChange={setAttrs} errors={act.fieldErrors} /></fieldset>}
      <div className="flex justify-end border-t border-line pt-4"><Button type="submit" variant="primary" busy={act.pending}>{element ? 'Salvar elemento' : 'Incluir elemento'}</Button></div>
    </form>
  );
}
