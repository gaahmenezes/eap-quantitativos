import { useMemo, useState } from 'react';
import { useParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import type { ElementTypeDto, PropagationPreviewDto, RevisionDetailDto, RevisionDto, TypologyDto, TypologyElementDto, UnitElementsDto } from '@eapq/contracts';
import { projectPermissions } from '@eapq/domain';
import { Breadcrumbs } from '../../app/shell';
import { AttributeFields, attributeSummary, cleanAttrs, type AttrValues } from '../../components/attribute-fields';
import { ArchiveButton, useAction } from '../../components/ui/actions';
import { Button } from '../../components/ui/button';
import { EmptyState, ErrorState, Loading, Notice } from '../../components/ui/feedback';
import { SelectField, TextField } from '../../components/ui/field';
import { SidePanel } from '../../components/ui/panel';
import { api, errorMessage } from '../../lib/api';
import { fmtDateTime } from '../../lib/format';
import { useSession } from '../auth/session';
import { useElementTypes } from '../catalog/api';
import { useProject } from '../projects/api';
import { structureKeys, useTypologies } from '../structure/api';

const K = {
  revisions: (p: string, t: string) => ['project', p, 'typology', t, 'revisions'] as const,
  revision: (p: string, t: string, r: string) => ['project', p, 'typology', t, 'revisions', r] as const,
  propagation: (p: string, t: string) => ['project', p, 'typology', t, 'propagation'] as const,
  unit: (p: string, u: string) => ['project', p, 'unit', u] as const,
};

export function ConstructivePage() {
  const { projectId = '' } = useParams();
  const project = useProject(projectId);
  const typologies = useTypologies(projectId);
  const types = useElementTypes();
  const { me } = useSession();
  const [selected, setSelected] = useState<string | null>(null);
  if (project.isPending || typologies.isPending || types.isPending) return <Loading />;
  const failed = [project, typologies, types].find((q) => q.isError);
  if (failed) return <ErrorState message={errorMessage(failed.error)} onRetry={() => failed.refetch()} />;
  const p = project.data!;
  const canEdit = projectPermissions(me!.orgRole, p.myProjectRole).has('project.content.edit') && p.status === 'ACTIVE';
  const list = typologies.data!.filter((t) => !t.archivedAt);
  const current = list.find((t) => t.id === selected) ?? list[0];
  const construtivo = types.data!.filter((t) => t.domain === 'CONSTRUTIVO' && !t.archivedAt);

  return (
    <>
      <Breadcrumbs items={[{ label: 'Empreendimentos', to: '/empreendimentos' }, { label: p.name, to: `/empreendimentos/${p.id}` }, { label: 'Construtivo' }]} />
      <div className="mb-4 border-b border-line pb-4">
        <h1 className="font-display text-[28px] font-semibold leading-tight tracking-tight">Construtivo</h1>
        <p className="mt-1 max-w-prose text-[14px] text-muted">Elementos de cada tipologia, organizados em revisões. Uma revisão publicada não muda; as unidades só passam a segui-la quando você atualiza, e particularidades de cada unidade são sempre mantidas.</p>
      </div>
      {list.length === 0 ? (
        <EmptyState title="Nenhuma tipologia cadastrada">Cadastre tipologias no cadastro físico (aba Tipologias) ou pelo assistente de estruturação.</EmptyState>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[240px_minmax(0,1fr)]">
          <nav aria-label="Tipologias" className="self-start border border-line bg-sheet">
            <ul>{list.map((t) => (
              <li key={t.id}>
                <button type="button" onClick={() => setSelected(t.id)} aria-current={t.id === current?.id ? 'true' : undefined}
                  className={`flex w-full items-baseline justify-between gap-2 border-l-[3px] px-3 py-2 text-left ${t.id === current?.id ? 'border-signal bg-cyan-wash' : 'border-transparent hover:bg-paper'}`}>
                  <span className="min-w-0"><span className="font-mono text-[13px]">{t.code}</span> <span className="text-[14px]">{t.name}</span></span>
                  <span className="shrink-0 font-mono text-[12px] text-muted">{t.unitCount}</span>
                </button>
              </li>
            ))}</ul>
          </nav>
          {current && <TypologyView key={current.id} projectId={p.id} typology={current} types={construtivo} allTypes={types.data!} canEdit={canEdit} />}
        </div>
      )}
    </>
  );
}

function TypologyView({ projectId, typology, types, allTypes, canEdit }: { projectId: string; typology: TypologyDto; types: ElementTypeDto[]; allTypes: ElementTypeDto[]; canEdit: boolean }) {
  const base = `/projects/${projectId}/typologies/${typology.id}`;
  const revisions = useQuery({ queryKey: K.revisions(projectId, typology.id), queryFn: () => api<RevisionDto[]>('GET', `${base}/revisions`) });
  const [selRev, setSelRev] = useState<string | null>(null);
  const act = useAction([K.revisions(projectId, typology.id), K.propagation(projectId, typology.id), ['project', projectId, 'typology', typology.id, 'revisions']]);
  if (revisions.isPending) return <Loading />;
  if (revisions.isError) return <ErrorState message={errorMessage(revisions.error)} onRetry={() => revisions.refetch()} />;
  const revs = revisions.data;
  const draft = revs.find((r) => r.status === 'DRAFT');
  const current = revs.find((r) => r.id === selRev) ?? draft ?? revs[0];

  return (
    <section className="min-w-0" aria-label={`Tipologia ${typology.code}`}>
      <header className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[12.5px] text-muted">{typology.kind === 'HOUSE' ? 'Casa' : 'Apartamento'} · {typology.unitCount} unidade(s)</p>
          <h2 className="font-display text-[22px] font-semibold"><span className="font-mono">{typology.code}</span> {typology.name}</h2>
        </div>
        {canEdit && !draft && (
          <Button variant="primary" busy={act.pending} onClick={async () => {
            const r = await act.run(() => api<{ id: string }>('POST', `${base}/revisions`, { body: {} }));
            if (r && r !== true) setSelRev(r.id);
          }}>{revs.length ? 'Nova revisão' : 'Criar a primeira revisão'}</Button>
        )}
      </header>
      {act.error && <div className="mb-3"><Notice tone="danger">{act.error}</Notice></div>}
      {revs.length === 0 ? (
        <EmptyState title="Tipologia sem elementos">Crie a primeira revisão para cadastrar ambientes, fundação, estrutura, vedações, esquadrias e demais elementos desta tipologia.</EmptyState>
      ) : (
        <>
          <div role="tablist" aria-label="Revisões" className="mb-3 flex flex-wrap gap-1 border-b border-line">
            {revs.map((r) => (
              <button key={r.id} type="button" role="tab" aria-selected={r.id === current?.id} onClick={() => setSelRev(r.id)}
                className={`-mb-px border-b-2 px-3 py-2 text-[14px] ${r.id === current?.id ? 'border-cyan-ink font-medium' : 'border-transparent text-muted hover:text-ink'}`}>
                <span className="font-mono">R{r.number}</span> {r.status === 'DRAFT' ? 'em elaboração' : 'publicada'}
              </button>
            ))}
          </div>
          {current && <RevisionView key={current.id} projectId={projectId} typologyId={typology.id} revisionId={current.id} types={types} allTypes={allTypes} canEdit={canEdit} onDiscarded={() => setSelRev(null)} />}
          <Propagation projectId={projectId} typology={typology} allTypes={allTypes} types={types} canEdit={canEdit} />
        </>
      )}
    </section>
  );
}

interface TreeItem extends TypologyElementDto { depth: number }
function asTree(elements: TypologyElementDto[]): TreeItem[] {
  const kids = new Map<string | null, TypologyElementDto[]>();
  for (const e of elements) kids.set(e.parentId, [...(kids.get(e.parentId) ?? []), e]);
  const out: TreeItem[] = [];
  const walk = (p: string | null, depth: number) => { for (const e of (kids.get(p) ?? []).sort((a, b) => a.position - b.position)) { out.push({ ...e, depth }); walk(e.id, depth + 1); } };
  walk(null, 0);
  return out;
}

function RevisionView({ projectId, typologyId, revisionId, types, allTypes, canEdit, onDiscarded }: { projectId: string; typologyId: string; revisionId: string; types: ElementTypeDto[]; allTypes: ElementTypeDto[]; canEdit: boolean; onDiscarded: () => void }) {
  const base = `/projects/${projectId}/typologies/${typologyId}/revisions/${revisionId}`;
  const q = useQuery({ queryKey: K.revision(projectId, typologyId, revisionId), queryFn: () => api<RevisionDetailDto>('GET', base) });
  const act = useAction([K.revision(projectId, typologyId, revisionId), K.revisions(projectId, typologyId), K.propagation(projectId, typologyId)]);
  const [panel, setPanel] = useState<{ parentId: string | null; element?: TypologyElementDto } | null>(null);
  const [confirmPublish, setConfirmPublish] = useState(false);
  const typeById = useMemo(() => new Map(allTypes.map((t) => [t.id, t])), [allTypes]);
  if (q.isPending) return <Loading />;
  if (q.isError) return <ErrorState message={errorMessage(q.error)} onRetry={() => q.refetch()} />;
  const r = q.data;
  const editable = canEdit && r.status === 'DRAFT';
  const items = asTree(r.elements);
  return (
    <div className="mb-6 border border-line bg-sheet">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-2.5 text-[13.5px]">
        <p className="text-muted">
          {r.status === 'PUBLISHED' ? `Publicada em ${fmtDateTime(r.publishedAt!)}` : 'Em elaboração — alterações permitidas até publicar'}
          {' · '}<span className="font-mono text-ink">{r.elementCount}</span> elemento(s)
          {r.status === 'PUBLISHED' && <> · <span className="font-mono text-ink">{r.unitCount}</span> unidade(s) nesta revisão</>}
          {r.diff && <> · em relação à anterior: <span className="font-mono text-ink">+{r.diff.added} −{r.diff.removed} ~{r.diff.changed}</span></>}
        </p>
        {editable && (
          <div className="flex gap-2">
            <Button variant="ghost" busy={act.pending} onClick={async () => { if (await act.run(() => api('DELETE', base))) onDiscarded(); }}>Descartar rascunho</Button>
            {!confirmPublish ? (
              <Button variant="primary" disabled={r.elementCount === 0} onClick={() => setConfirmPublish(true)}>Publicar R{r.number}</Button>
            ) : (
              <>
                <Button variant="ghost" onClick={() => setConfirmPublish(false)}>Cancelar</Button>
                <Button variant="primary" busy={act.pending} onClick={async () => { await act.run(() => api('POST', `${base}/publish`, { body: {} })); setConfirmPublish(false); }}>Confirmar publicação</Button>
              </>
            )}
          </div>
        )}
      </div>
      {confirmPublish && <div className="border-b border-line px-4 py-2"><Notice tone="warn">Depois de publicada, a R{r.number} não pode mais ser alterada. As unidades continuam na revisão atual até você atualizá-las abaixo.</Notice></div>}
      {act.error && <div className="px-4 pt-3"><Notice tone="danger">{act.error}</Notice></div>}
      {items.length === 0 ? <p className="px-4 py-4 text-[14px] text-muted">Nenhum elemento nesta revisão.</p> : (
        <ul className="py-1">
          {items.map((e) => (
            <li key={e.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 border-b border-line px-4 py-1.5 last:border-0" style={{ paddingLeft: 16 + e.depth * 22 }}>
              <span className="text-[14px] font-medium">{e.name}</span>
              <span className="text-[12.5px] text-muted">{typeById.get(e.elementTypeId)?.name}</span>
              <span className="min-w-0 flex-1 text-[12.5px]">{attributeSummary(typeById.get(e.elementTypeId), e.attributes)}</span>
              {editable && (
                <span className="flex shrink-0 gap-3 text-[13px]">
                  <button type="button" className="text-cyan-ink hover:underline" onClick={() => setPanel({ parentId: e.id })}>Subelemento</button>
                  <button type="button" className="text-cyan-ink hover:underline" onClick={() => setPanel({ parentId: e.parentId, element: e })}>Editar</button>
                  <button type="button" className="text-danger hover:underline" onClick={() => act.run(() => api('DELETE', `${base}/elements/${e.id}`))}>Remover</button>
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
      {editable && <div className="border-t border-line px-4 py-2.5"><Button onClick={() => setPanel({ parentId: null })}>Incluir elemento</Button></div>}
      <SidePanel open={!!panel} title={panel?.element ? 'Editar elemento' : 'Incluir elemento'} onClose={() => setPanel(null)}>
        {panel && <TypologyElementForm base={base} types={types} element={panel.element} parentId={panel.parentId} invalidate={[K.revision(projectId, typologyId, revisionId), K.revisions(projectId, typologyId)]} onDone={() => setPanel(null)} />}
      </SidePanel>
    </div>
  );
}

function TypologyElementForm({ base, types, element, parentId, invalidate, onDone }: { base: string; types: ElementTypeDto[]; element?: TypologyElementDto; parentId: string | null; invalidate: readonly (readonly unknown[])[]; onDone: () => void }) {
  const [typeId, setTypeId] = useState(element?.elementTypeId ?? types[0]?.id ?? '');
  const type = types.find((t) => t.id === typeId);
  const [name, setName] = useState(element?.name ?? type?.name ?? '');
  const [attrs, setAttrs] = useState<AttrValues>(element?.attributes ?? {});
  const act = useAction(invalidate.map((k) => [...k]));
  return (
    <form className="flex flex-col gap-4" onSubmit={async (e) => {
      e.preventDefault();
      const r = await act.run(() => element
        ? api('PATCH', `${base}/elements/${element.id}`, { body: { name: name.trim(), attributes: cleanAttrs(attrs) } })
        : api('POST', `${base}/elements`, { body: { elementTypeId: typeId, name: name.trim(), parentId, attributes: cleanAttrs(attrs) } }));
      if (r) onDone();
    }}>
      {act.error && <Notice tone="danger">{act.error}</Notice>}
      <SelectField label="Tipo de elemento" value={typeId} disabled={!!element} onChange={(e) => { setTypeId(e.target.value); setName(types.find((t) => t.id === e.target.value)?.name ?? ''); setAttrs({}); }}>
        {types.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
      </SelectField>
      <TextField label="Nome" value={name} onChange={(e) => setName(e.target.value)} hint="Ex.: Sala, Quarto 1, Piso da sala" />
      {type && <fieldset><legend className="mb-2 text-[14px] font-medium">Atributos técnicos</legend><AttributeFields idPrefix="tel" defs={type.attributes} values={attrs} onChange={setAttrs} errors={act.fieldErrors} /></fieldset>}
      <div className="flex justify-end border-t border-line pt-4"><Button type="submit" variant="primary" busy={act.pending} disabled={!name.trim()}>{element ? 'Salvar elemento' : 'Incluir elemento'}</Button></div>
    </form>
  );
}

const PAGE = 100;

function Propagation({ projectId, typology, allTypes, types, canEdit }: { projectId: string; typology: TypologyDto; allTypes: ElementTypeDto[]; types: ElementTypeDto[]; canEdit: boolean }) {
  const q = useQuery({ queryKey: K.propagation(projectId, typology.id), queryFn: () => api<PropagationPreviewDto>('GET', `/projects/${projectId}/typologies/${typology.id}/propagation`) });
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [ack, setAck] = useState(false);
  const [limit, setLimit] = useState(PAGE);
  const [unit, setUnit] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const act = useAction([K.propagation(projectId, typology.id), K.revisions(projectId, typology.id), structureKeys.typologies(projectId)]);
  if (q.isPending) return <Loading />;
  if (q.isError) return <ErrorState message={errorMessage(q.error)} onRetry={() => q.refetch()} />;
  const p = q.data;
  const pending = p.units.filter((u) => !u.upToDate);
  const selectedConflicts = p.units.filter((u) => chosen.has(u.unitId) && u.conflicts.length > 0);
  return (
    <section aria-labelledby="unidades" className="border border-line bg-sheet">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-2.5">
        <h3 id="unidades" className="font-display text-[18px] font-semibold">Unidades desta tipologia</h3>
        <p className="text-[13.5px] text-muted">
          {p.targetRevision ? <>Última publicada: <span className="font-mono text-ink">R{p.targetRevision.number}</span> · </> : 'Nenhuma revisão publicada · '}
          <span className="font-mono text-ink">{p.units.length - pending.length}</span> atualizadas, <span className="font-mono text-ink">{pending.length}</span> pendentes
        </p>
      </header>
      {done && <div className="px-4 pt-3"><Notice tone="ok">{done}</Notice></div>}
      {act.error && <div className="px-4 pt-3"><Notice tone="danger">{act.error}</Notice></div>}
      {canEdit && p.targetRevision && pending.length > 0 && (
        <div className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-2.5 text-[14px]">
          <Button onClick={() => setChosen(new Set(pending.map((u) => u.unitId)))}>Selecionar as {pending.length} pendentes</Button>
          {selectedConflicts.length > 0 && (
            <label className="flex items-center gap-2"><input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} />
              {selectedConflicts.length} unidade(s) com particularidades em conflito: atualizar mesmo assim (as particularidades são mantidas e sinalizadas)</label>
          )}
          <Button variant="primary" disabled={chosen.size === 0 || (selectedConflicts.length > 0 && !ack)} busy={act.pending} onClick={async () => {
            setDone(null);
            const r = await act.run(() => api<{ updated: number; revision: number }>('POST', `/projects/${projectId}/typologies/${typology.id}/propagation`, { body: { unitIds: [...chosen], acknowledgeConflicts: ack } }));
            if (r && r !== true) { setDone(`${r.updated} unidade(s) atualizadas para a R${r.revision}.`); setChosen(new Set()); setAck(false); }
          }}>Atualizar {chosen.size || ''} para R{p.targetRevision.number}</Button>
        </div>
      )}
      <div className="overflow-x-auto">
        <table className="w-full text-left text-[13.5px]">
          <thead className="border-b border-line-strong text-[12.5px] text-muted"><tr>
            {canEdit && <th className="w-8 px-3 py-2"><span className="sr-only">Selecionar</span></th>}
            <th className="px-3 py-2 font-medium">Código</th><th className="px-3 py-2 font-medium">Unidade</th><th className="px-3 py-2 font-medium">Revisão</th>
            <th className="px-3 py-2 text-right font-medium">Particularidades</th><th className="px-3 py-2 font-medium">Situação</th>
          </tr></thead>
          <tbody>
            {p.units.slice(0, limit).map((u) => (
              <tr key={u.unitId} className="border-b border-line last:border-0 hover:bg-paper">
                {canEdit && <td className="px-3 py-1.5">{!u.upToDate && p.targetRevision && <input type="checkbox" aria-label={`Selecionar ${u.name}`} checked={chosen.has(u.unitId)} onChange={(e) => setChosen((s) => { const n = new Set(s); if (e.target.checked) n.add(u.unitId); else n.delete(u.unitId); return n; })} />}</td>}
                <td className="px-3 py-1.5 font-mono">{u.code}</td>
                <td className="px-3 py-1.5"><button type="button" className="text-cyan-ink hover:underline" onClick={() => setUnit(u.unitId)}>{u.name}</button></td>
                <td className="px-3 py-1.5 font-mono">{u.pinnedRevisionNumber ? `R${u.pinnedRevisionNumber}` : '—'}</td>
                <td className="px-3 py-1.5 text-right font-mono">{u.overrides}</td>
                <td className="px-3 py-1.5">
                  {u.upToDate ? <span className="text-ok">Atualizada</span> : u.conflicts.length ? <span className="text-danger" title={u.conflicts.map((c) => c.reason).join(' ')}>Pendente, com conflito</span> : <span>Pendente</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {p.units.length > limit && <div className="border-t border-line px-4 py-2"><button type="button" className="text-[14px] font-medium text-cyan-ink hover:underline" onClick={() => setLimit((l) => l + PAGE)}>Mostrar mais {Math.min(PAGE, p.units.length - limit)}</button></div>}
      <SidePanel open={!!unit} title="Elementos da unidade" onClose={() => setUnit(null)}>
        {unit && <UnitPanel projectId={projectId} unitId={unit} typologyId={typology.id} allTypes={allTypes} types={types} canEdit={canEdit} />}
      </SidePanel>
    </section>
  );
}

function UnitPanel({ projectId, unitId, typologyId, allTypes, types, canEdit }: { projectId: string; unitId: string; typologyId: string; allTypes: ElementTypeDto[]; types: ElementTypeDto[]; canEdit: boolean }) {
  const q = useQuery({ queryKey: K.unit(projectId, unitId), queryFn: () => api<UnitElementsDto>('GET', `/projects/${projectId}/units/${unitId}/elements`) });
  const act = useAction([K.unit(projectId, unitId), K.propagation(projectId, typologyId)]);
  const [mode, setMode] = useState<'exclude' | 'add' | null>(null);
  const [target, setTarget] = useState('');
  const [reason, setReason] = useState('');
  const [typeId, setTypeId] = useState(types[0]?.id ?? '');
  const [name, setName] = useState('');
  const [parent, setParent] = useState('');
  const [attrs, setAttrs] = useState<AttrValues>({});
  const typeById = useMemo(() => new Map(allTypes.map((t) => [t.id, t])), [allTypes]);
  if (q.isPending) return <Loading />;
  if (q.isError) return <ErrorState message={errorMessage(q.error)} />;
  const u = q.data;
  const fromTypology = u.elements.filter((e) => e.source === 'TYPOLOGY');
  const active = u.overrides.filter((o) => !o.archivedAt);
  const submit = async () => {
    const body = mode === 'exclude'
      ? { op: 'EXCLUDE_ELEMENT', targetStableKey: target, reason: reason.trim() }
      : { op: 'ADD_ELEMENT', elementTypeId: typeId, name: name.trim(), parentStableKey: parent || null, attributes: cleanAttrs(attrs), reason: reason.trim() };
    if (await act.run(() => api('POST', `/projects/${projectId}/units/${unitId}/overrides`, { body }))) { setMode(null); setReason(''); setName(''); setAttrs({}); }
  };
  return (
    <div className="flex flex-col gap-5">
      <p className="text-[14px]">
        {u.typology ? <><span className="font-mono">{u.typology.code}</span> {u.typology.name} · </> : null}
        {u.pinnedRevision ? <>segue a <span className="font-mono">R{u.pinnedRevision.number}</span></> : 'ainda não vinculada a uma revisão publicada'}
        {u.latestRevision && u.pinnedRevision && u.latestRevision.number !== u.pinnedRevision.number && <> (a última publicada é a <span className="font-mono">R{u.latestRevision.number}</span>)</>}
      </p>
      {act.error && <Notice tone="danger">{act.error}</Notice>}
      {active.some((o) => o.orphanReason) && <Notice tone="warn">Há particularidades que não se aplicam à revisão atual. Elas foram mantidas; revise e remova as que não fizerem mais sentido.</Notice>}
      <section>
        <h3 className="mb-1.5 font-display text-[16px] font-semibold">Elementos efetivos</h3>
        {u.elements.length === 0 ? <p className="text-[14px] text-muted">Nenhum elemento.</p> : (
          <ul className="border border-line">{u.elements.map((e) => (
            <li key={e.stableKey} className="flex items-baseline justify-between gap-2 border-b border-line px-3 py-1.5 text-[14px] last:border-0">
              <span>{e.name} <span className="text-[12.5px] text-muted">{typeById.get(e.elementTypeId)?.name}</span></span>
              {e.source === 'UNIT' && <span className="shrink-0 rounded-md bg-warn-wash px-1.5 text-[12px]">particularidade</span>}
            </li>
          ))}</ul>
        )}
        {u.excluded.length > 0 && <p className="mt-2 text-[13px] text-muted">Excluídos nesta unidade: {u.excluded.map((e) => e.name).join(', ')}</p>}
      </section>
      <section>
        <h3 className="mb-1.5 font-display text-[16px] font-semibold">Particularidades</h3>
        {u.overrides.length === 0 ? <p className="text-[14px] text-muted">Esta unidade segue a tipologia sem diferenças.</p> : (
          <ul className="flex flex-col gap-2">{u.overrides.map((o) => (
            <li key={o.id} className={`border-l-4 px-3 py-2 text-[13.5px] ${o.archivedAt ? 'border-line text-graphite-400' : o.orphanReason ? 'border-signal bg-warn-wash' : 'border-cyan-ink bg-cyan-wash'}`}>
              <p className="font-medium">{o.op === 'EXCLUDE_ELEMENT' ? 'Exclusão de elemento' : `Inclusão: ${o.name}`}</p>
              <p>Motivo: {o.reason} — {o.createdBy}, {fmtDateTime(o.createdAt)}</p>
              {o.orphanReason && !o.archivedAt && <p className="text-danger">{o.orphanReason}</p>}
              {o.archivedAt && <p>Removida em {fmtDateTime(o.archivedAt)}</p>}
              {canEdit && !o.archivedAt && <div className="mt-1"><ArchiveButton label="Remover" what="particularidade" onConfirm={(r) => act.run(() => api('POST', `/projects/${projectId}/units/${unitId}/overrides/${o.id}/archive`, { body: { reason: r } }))} /></div>}
            </li>
          ))}</ul>
        )}
      </section>
      {canEdit && u.pinnedRevision && (
        <section className="flex flex-col gap-3 border-t border-line pt-4">
          <div className="flex gap-2">
            <Button variant={mode === 'exclude' ? 'primary' : 'secondary'} onClick={() => { setMode('exclude'); setTarget(fromTypology[0]?.stableKey ?? ''); }}>Excluir elemento da tipologia</Button>
            <Button variant={mode === 'add' ? 'primary' : 'secondary'} onClick={() => { setMode('add'); setName(types[0]?.name ?? ''); }}>Incluir elemento próprio</Button>
          </div>
          {mode === 'exclude' && (
            <SelectField label="Elemento a excluir nesta unidade" value={target} onChange={(e) => setTarget(e.target.value)}>
              {fromTypology.map((e) => <option key={e.stableKey} value={e.stableKey}>{e.name}</option>)}
            </SelectField>
          )}
          {mode === 'add' && (
            <>
              <SelectField label="Tipo" value={typeId} onChange={(e) => { setTypeId(e.target.value); setName(types.find((t) => t.id === e.target.value)?.name ?? ''); setAttrs({}); }}>{types.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</SelectField>
              <TextField label="Nome" value={name} onChange={(e) => setName(e.target.value)} />
              <SelectField label="Dentro de (opcional)" value={parent} onChange={(e) => setParent(e.target.value)}>
                <option value="">Raiz da unidade</option>
                {fromTypology.map((e) => <option key={e.stableKey} value={e.stableKey}>{e.name}</option>)}
              </SelectField>
              {types.find((t) => t.id === typeId) && <AttributeFields idPrefix="ov" defs={types.find((t) => t.id === typeId)!.attributes} values={attrs} onChange={setAttrs} errors={act.fieldErrors} />}
            </>
          )}
          {mode && (
            <>
              <TextField label="Motivo" value={reason} onChange={(e) => setReason(e.target.value)} hint="Fica registrado na unidade e no histórico." />
              <div><Button variant="primary" busy={act.pending} disabled={!reason.trim() || (mode === 'exclude' ? !target : !name.trim())} onClick={submit}>Registrar particularidade</Button></div>
            </>
          )}
        </section>
      )}
    </div>
  );
}
