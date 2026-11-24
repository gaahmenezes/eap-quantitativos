import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { PhysicalElementDto, StructureNodeDto } from '@eapq/contracts';
import { attributeSummary } from '../../components/attribute-fields';
import { ArchiveButton, useAction } from '../../components/ui/actions';
import { Button } from '../../components/ui/button';
import { Notice } from '../../components/ui/feedback';
import { SidePanel } from '../../components/ui/panel';
import { api } from '../../lib/api';
import { useElementTypes } from '../catalog/api';
import { ElementForm } from '../infrastructure/infrastructure-page';

/** Elementos físicos localizados num item do cadastro (áreas comuns, ruas, lotes…). */
export function NodeElements({ projectId, node, canEdit }: { projectId: string; node: StructureNodeDto; canEdit: boolean }) {
  const key = ['project', projectId, 'elements', node.id];
  const q = useQuery({ queryKey: key, queryFn: () => api<PhysicalElementDto[]>('GET', `/projects/${projectId}/elements?structureNodeId=${node.id}`) });
  const types = useElementTypes();
  const act = useAction([key]);
  const [panel, setPanel] = useState<PhysicalElementDto | 'new' | null>(null);
  const byId = new Map((types.data ?? []).map((t) => [t.id, t]));
  const construtivo = (types.data ?? []).filter((t) => t.domain === 'CONSTRUTIVO' && !t.archivedAt);
  const items = (q.data ?? []).filter((e) => !e.archivedAt);
  return (
    <section className="border-t border-line pt-4">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="font-display text-[16px] font-semibold">Elementos físicos</h3>
        {canEdit && !node.archivedAt && <Button onClick={() => setPanel('new')}>Incluir elemento</Button>}
      </div>
      {act.error && <Notice tone="danger">{act.error}</Notice>}
      {q.isPending ? <p className="text-[13px] text-muted">Carregando…</p> : items.length === 0 ? <p className="text-[13px] text-muted">Nenhum elemento neste item.</p> : (
        <ul className="border border-line">{items.map((e) => (
          <li key={e.id} className="flex items-start justify-between gap-2 border-b border-line px-3 py-1.5 text-[13.5px] last:border-0">
            <span className="min-w-0"><span className="font-medium">{e.name}</span> <span className="text-muted">{byId.get(e.elementTypeId)?.name}</span><br /><span className="text-[12.5px]">{attributeSummary(byId.get(e.elementTypeId), e.attributes)}</span></span>
            {canEdit && <span className="flex shrink-0 items-center gap-1">
              <button type="button" className="text-[13px] text-cyan-ink hover:underline" onClick={() => setPanel(e)}>Editar</button>
              <ArchiveButton what="elemento" onConfirm={(reason) => act.run(() => api('POST', `/projects/${projectId}/elements/${e.id}/archive`, { body: { reason }, version: e.version }))} />
            </span>}
          </li>
        ))}</ul>
      )}
      <p className="mt-1.5 text-[12px] text-muted">Elementos de redes e de sistemas de infraestrutura são cadastrados em Infraestrutura.</p>
      <SidePanel open={!!panel} title={panel === 'new' ? `Novo elemento em ${node.name}` : 'Editar elemento'} onClose={() => setPanel(null)}>
        {panel && <ElementForm project={{ id: projectId }} structureNodeId={node.id} element={panel === 'new' ? undefined : panel} types={panel === 'new' ? construtivo : (types.data ?? [])} nodes={[]} onDone={() => setPanel(null)} />}
      </SidePanel>
    </section>
  );
}
