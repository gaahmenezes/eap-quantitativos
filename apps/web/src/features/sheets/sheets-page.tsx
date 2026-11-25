import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { projectPermissions } from '@eapq/domain';
import { Breadcrumbs, PageHeader } from '../../app/shell';
import { useAction } from '../../components/ui/actions';
import { Button } from '../../components/ui/button';
import { EmptyState, ErrorState, Loading, Notice } from '../../components/ui/feedback';
import { SelectField, TextField } from '../../components/ui/field';
import { SidePanel } from '../../components/ui/panel';
import { api, errorMessage } from '../../lib/api';
import { fmtDateTime } from '../../lib/format';
import { useSession } from '../auth/session';
import { useProject } from '../projects/api';
import { sheetKeys, STATUS_LABEL, STATUS_TONE, useSheets, useSheetTemplates } from './api';

export function SheetsPage() {
  const { projectId = '' } = useParams();
  const { me } = useSession();
  const project = useProject(projectId);
  const [archived, setArchived] = useState(false);
  const list = useSheets(projectId, archived);
  const [creating, setCreating] = useState(false);
  if (project.isPending || list.isPending) return <Loading />;
  if (project.isError) return <ErrorState message={errorMessage(project.error)} />;
  if (list.isError) return <ErrorState message={errorMessage(list.error)} onRetry={() => list.refetch()} />;
  const p = project.data;
  const canEdit = projectPermissions(me!.orgRole, p.myProjectRole).has('project.content.edit') && p.status === 'ACTIVE';
  const rows = list.data;
  return (
    <>
      <Breadcrumbs items={[{ label: 'Empreendimentos', to: '/empreendimentos' }, { label: p.name, to: `/empreendimentos/${p.id}` }, { label: 'Fichas de levantamento' }]} />
      <PageHeader title="Fichas de levantamento" actions={canEdit && <Button variant="primary" onClick={() => setCreating(true)}>Nova ficha</Button>}>
        Digite os dados lidos no projeto (ambientes, trechos, peças) e a ficha calcula. Ao lançar, os totais viram quantitativos com memória de cálculo, no item da EAP e na âncora escolhidos.
      </PageHeader>
      <label className="mb-3 flex items-center gap-2 text-[13.5px]"><input type="checkbox" checked={archived} onChange={(e) => setArchived(e.target.checked)} /> Mostrar arquivadas</label>
      {rows.length === 0 ? (
        <EmptyState title="Nenhuma ficha" action={canEdit && <Button variant="primary" onClick={() => setCreating(true)}>Nova ficha</Button>}>Comece por um modelo: cerâmica, área de parede, fôrma e concreto, aço, rede enterrada ou telhado.</EmptyState>
      ) : (
        <div className="overflow-x-auto border border-line bg-sheet">
          <table className="w-full min-w-[760px] text-left text-[13.5px]">
            <thead className="bg-paper text-[12px] text-muted"><tr><th className="px-3 py-1.5 font-normal">Ficha</th><th className="px-3 py-1.5 font-normal">Modelo</th><th className="px-3 py-1.5 font-normal">Destino</th><th className="px-3 py-1.5 text-right font-normal">Linhas</th><th className="px-3 py-1.5 font-normal">Situação</th><th className="px-3 py-1.5 font-normal">Atualizada</th></tr></thead>
            <tbody>{rows.map((s) => (
              <tr key={s.id} className={`border-t border-line ${s.archivedAt ? 'text-graphite-400' : ''}`}>
                <td className="px-3 py-2"><Link className="font-medium text-cyan-ink hover:underline" to={`/empreendimentos/${p.id}/fichas/${s.id}`}>{s.title}</Link></td>
                <td className="px-3 py-2"><span className="font-mono text-[12.5px]">{s.templateCode} R{s.versionNumber}</span> <span className="text-muted">{s.templateName}</span></td>
                <td className="px-3 py-2">{s.wbsCode ? <span><span className="font-mono text-[12.5px]">{s.wbsCode}</span> {s.wbsTitle}</span> : <span className="text-muted">item da EAP não escolhido</span>}
                  <span className="block text-[12.5px] text-muted">{s.anchorLabel ?? 'âncora não escolhida'}</span></td>
                <td className="px-3 py-2 text-right font-mono">{s.rowCount}</td>
                <td className="px-3 py-2">{s.archivedAt ? 'arquivada' : <span className={`rounded-[3px] px-1.5 py-0.5 text-[12px] ${STATUS_TONE[s.status]}`}>{STATUS_LABEL[s.status]}</span>}
                  {s.measurementCount > 0 && <span className="block text-[12px] text-muted">{s.measurementCount} quantitativo(s)</span>}</td>
                <td className="px-3 py-2 text-[12.5px] text-muted">{fmtDateTime(s.updatedAt)}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
      <SidePanel open={creating} title="Nova ficha de levantamento" onClose={() => setCreating(false)}>
        {creating && <NewSheet projectId={p.id} />}
      </SidePanel>
    </>
  );
}

function NewSheet({ projectId }: { projectId: string }) {
  const templates = useSheetTemplates();
  const navigate = useNavigate();
  const [versionId, setVersionId] = useState('');
  const [title, setTitle] = useState('');
  const act = useAction([sheetKeys.all(projectId)]);
  if (templates.isPending) return <Loading />;
  if (templates.isError) return <ErrorState message={errorMessage(templates.error)} />;
  const options = templates.data.filter((t) => !t.archivedAt).flatMap((t) => {
    const v = t.versions.find((x) => x.status === 'PUBLISHED');
    return v ? [{ id: v.id, label: `${t.code} R${v.number} — ${t.name}`, description: t.description, name: t.name }] : [];
  });
  const chosen = options.find((o) => o.id === versionId);
  return (
    <form className="flex flex-col gap-4" onSubmit={async (e) => {
      e.preventDefault();
      const r = await act.run(() => api<{ id: string }>('POST', `/projects/${projectId}/sheets`, { body: { templateVersionId: versionId, title } }));
      if (r && r !== true) navigate(`/empreendimentos/${projectId}/fichas/${r.id}`);
    }}>
      {act.error && <Notice tone="danger">{act.error}</Notice>}
      <SelectField label="Modelo" value={versionId} onChange={(e) => { setVersionId(e.target.value); const o = options.find((x) => x.id === e.target.value); if (o && !title) setTitle(o.name); }}>
        <option value="">Selecione</option>
        {options.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
      </SelectField>
      {chosen?.description && <p className="text-[13px] text-muted">{chosen.description}</p>}
      <TextField label="Título" value={title} onChange={(e) => setTitle(e.target.value)} hint="Ex.: Cerâmica — apartamento tipo 2Q" error={act.fieldErrors.title} />
      <p className="text-[13px] text-muted">O item da EAP, a âncora e os serviços de cada saída são escolhidos dentro da ficha.</p>
      <div><Button type="submit" variant="primary" busy={act.pending} disabled={!versionId || !title.trim()}>Criar e abrir</Button></div>
    </form>
  );
}
