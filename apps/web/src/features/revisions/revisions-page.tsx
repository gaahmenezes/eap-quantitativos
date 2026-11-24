import { useState } from 'react';
import { Link, useParams } from 'react-router';
import type { RevisionCompareDto } from '@eapq/contracts';
import { projectPermissions } from '@eapq/domain';
import { Breadcrumbs } from '../../app/shell';
import { useAction } from '../../components/ui/actions';
import { Button } from '../../components/ui/button';
import { EmptyState, ErrorState, Loading, Notice } from '../../components/ui/feedback';
import { SelectField, TextArea, TextField } from '../../components/ui/field';
import { SidePanel } from '../../components/ui/panel';
import { api, errorMessage } from '../../lib/api';
import { fmtDateTime, fmtQty } from '../../lib/format';
import { useSession } from '../auth/session';
import { useProject } from '../projects/api';
import { ExportButton } from '../../components/export-button';
import { revKeys, useCompare, useRevisions } from './api';

const nextCode = (n: number) => `R${String(n).padStart(2, '0')}`;

export function RevisionsPage() {
  const { projectId = '' } = useParams();
  const project = useProject(projectId);
  const revisions = useRevisions(projectId);
  const { me } = useSession();
  const [issuing, setIssuing] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [to, setTo] = useState<string | null>(null);
  if (project.isPending || revisions.isPending) return <Loading />;
  if (project.isError) return <ErrorState message={errorMessage(project.error)} onRetry={() => project.refetch()} />;
  if (revisions.isError) return <ErrorState message={errorMessage(revisions.error)} onRetry={() => revisions.refetch()} />;
  const p = project.data;
  const list = revisions.data;
  const canIssue = projectPermissions(me!.orgRole, p.myProjectRole).has('project.revisions.issue') && p.status === 'ACTIVE';
  const latest = list[0];
  const sel = list.find((r) => r.id === selected) ?? latest;
  const target = to ?? (sel ? list.find((r) => r.number === sel.number + 1)?.id ?? 'current' : null);

  return (
    <>
      <Breadcrumbs items={[{ label: 'Empreendimentos', to: '/empreendimentos' }, { label: p.name, to: `/empreendimentos/${p.id}` }, { label: 'Revisões' }]} />
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3 border-b border-line pb-4">
        <div>
          <h1 className="font-display text-[28px] font-semibold leading-tight tracking-tight">Revisões</h1>
          <p className="mt-1 text-[14px] text-muted"><span className="font-mono text-ink">{p.code}</span> {p.name} · cada revisão congela EAP, cadastro físico e quantitativos; nada emitido muda depois.</p>
        </div>
        {canIssue && <Button variant="primary" onClick={() => setIssuing(true)}>Emitir {nextCode(latest ? latest.number + 1 : 0)}</Button>}
      </div>
      {list.length === 0 ? (
        <EmptyState title="Nenhuma revisão emitida" action={canIssue && <Button variant="primary" onClick={() => setIssuing(true)}>Emitir R00</Button>}>
          Emita a R00 quando a EAP e os quantitativos estiverem prontos para uma entrega. As alterações seguintes podem ser comparadas com ela.
        </EmptyState>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[300px_minmax(0,1fr)]">
          <nav aria-label="Revisões emitidas" className="self-start border border-line bg-sheet">
            <ul>{list.map((r) => (
              <li key={r.id}>
                <button type="button" onClick={() => { setSelected(r.id); setTo(null); }} aria-current={r.id === sel?.id ? 'true' : undefined}
                  className={`block w-full border-l-[3px] px-3 py-2 text-left ${r.id === sel?.id ? 'border-signal bg-cyan-wash' : 'border-transparent hover:bg-paper'}`}>
                  <span className="block text-[14px]"><span className="font-mono font-semibold">{r.code}</span> {r.title}</span>
                  <span className="block text-[12.5px] text-muted">{fmtDateTime(r.issuedAt)} · {r.issuedBy}</span>
                </button>
              </li>
            ))}</ul>
          </nav>
          {sel && (
            <section aria-label={`Revisão ${sel.code}`} className="flex min-w-0 flex-col gap-4">
              <div className="border border-line bg-sheet p-3">
                <h2 className="font-display text-[20px] font-semibold"><span className="font-mono">{sel.code}</span> {sel.title}</h2>
                <p className="text-[13px] text-muted">Emitida em {fmtDateTime(sel.issuedAt)} por {sel.issuedBy}</p>
                {sel.notes && <p className="mt-1 whitespace-pre-line text-[14px]">{sel.notes}</p>}
                <dl className="mt-2 flex flex-wrap gap-x-6 gap-y-1 text-[13.5px]">
                  <div><dt className="inline text-muted">Nós da EAP </dt><dd className="inline font-mono">{sel.summary.wbsNodes}</dd></div>
                  <div><dt className="inline text-muted">Itens do cadastro </dt><dd className="inline font-mono">{sel.summary.structureNodes}</dd></div>
                  <div><dt className="inline text-muted">Medições </dt><dd className="inline font-mono">{sel.summary.measurements}</dd></div>
                  <div><dt className="inline text-muted">Linhas efetivas </dt><dd className="inline font-mono">{sel.summary.lines}</dd></div>
                  {sel.summary.totals.map((t) => <div key={t.unit}><dt className="inline text-muted">Total </dt><dd className="inline font-mono">{fmtQty(t.total)} {t.unit}</dd></div>)}
                </dl>
                <Link className="mt-2 inline-block text-[13.5px] text-cyan-ink hover:underline" to={`/empreendimentos/${p.id}/consolidacoes?base=${sel.id}`}>Consolidar quantitativos da {sel.code}</Link>
              </div>
              <div className="max-w-sm">
                <SelectField label={`Comparar ${sel.code} com`} value={target ?? ''} onChange={(e) => setTo(e.target.value)}>
                  <option value="current">Estado atual</option>
                  {list.filter((r) => r.id !== sel.id).map((r) => <option key={r.id} value={r.id}>{r.code} — {r.title}</option>)}
                </SelectField>
              </div>
              {target && <div><ExportButton label="Exportar comparação" path={`/projects/${p.id}/exports`} body={{ report: 'revision-compare', revisionId: sel.id, compareTo: target }} /></div>}
              <CompareView projectId={p.id} from={sel.id} to={target} />
            </section>
          )}
        </div>
      )}
      <SidePanel open={issuing} title={`Emitir ${nextCode(latest ? latest.number + 1 : 0)}`} onClose={() => setIssuing(false)}>
        {issuing && <IssueForm projectId={p.id} code={nextCode(latest ? latest.number + 1 : 0)} lastId={latest?.id ?? null} lastCode={latest?.code ?? null} onDone={(id) => { setIssuing(false); setSelected(id); setTo(null); }} />}
      </SidePanel>
    </>
  );
}

function IssueForm({ projectId, code, lastId, lastCode, onDone }: { projectId: string; code: string; lastId: string | null; lastCode: string | null; onDone: (id: string) => void }) {
  const [title, setTitle] = useState('');
  const [notes, setNotes] = useState('');
  const act = useAction([revKeys.list(projectId)]);
  return (
    <form className="flex flex-col gap-4" onSubmit={async (e) => {
      e.preventDefault();
      const r = await act.run(() => api<{ id: string }>('POST', `/projects/${projectId}/revisions`, { body: { title: title.trim(), notes: notes.trim() || null } }));
      if (r && r !== true) onDone(r.id);
    }}>
      <Notice tone="warn">A {code} congela a EAP, o cadastro físico, as medições vigentes (com a memória de cálculo de cada uma) e os quantitativos consolidados. Depois de emitida, não pode ser alterada nem excluída.</Notice>
      {act.error && <Notice tone="danger">{act.error}</Notice>}
      <TextField label="Título" value={title} onChange={(e) => setTitle(e.target.value)} hint="Ex.: Projeto legal, Projeto executivo, Revisão de arquitetura" error={act.fieldErrors.title} />
      <TextArea label="Observações (opcional)" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
      {lastId && <section aria-label="Alterações desde a última revisão"><h3 className="mb-1 text-[14px] font-medium">Alterações desde a {lastCode}</h3><CompareView projectId={projectId} from={lastId} to="current" compact /></section>}
      <div className="border-t border-line pt-4"><Button type="submit" variant="primary" busy={act.pending} disabled={!title.trim()}>Emitir {code}</Button></div>
    </form>
  );
}

const KIND = { added: 'Incluído', removed: 'Excluído', changed: 'Alterado' } as const;
const deltaClass = (d: string) => (d.startsWith('-') ? 'text-danger' : d === '0' ? '' : 'text-ok');
const signed = (d: string) => (d.startsWith('-') ? fmtQty(d) : `+${fmtQty(d)}`);

function CompareView({ projectId, from, to, compact }: { projectId: string; from: string; to: string | null; compact?: boolean }) {
  const q = useCompare(projectId, from, to);
  if (!to) return null;
  if (q.isPending) return <Loading />;
  if (q.isError) return <ErrorState message={errorMessage(q.error)} onRetry={() => q.refetch()} />;
  const c: RevisionCompareDto = q.data;
  const nothing = c.quantities.length + c.measurements.added.length + c.measurements.removed.length + c.measurements.changed.length + c.wbs.added.length + c.wbs.removed.length + c.wbs.changed.length + c.structure.added.length + c.structure.removed.length + c.structure.changed.length === 0;
  if (nothing) return <Notice tone="info">Nenhuma diferença entre {c.from.code} e {c.to.code === 'Estado atual' ? 'o estado atual' : c.to.code}.</Notice>;
  return (
    <div className="flex flex-col gap-4 text-[13.5px]" aria-label={`Comparação ${c.from.code} × ${c.to.code}`} role="region">
      {c.truncated && <Notice tone="warn">Há mais de 500 diferenças em alguma lista; mostrando as primeiras.</Notice>}
      {c.quantities.length > 0 && (
        <section aria-label="Quantitativos">
          <h3 className="mb-1 font-medium">Quantitativos (item da EAP × serviço)</h3>
          <div className="overflow-x-auto border border-line bg-sheet">
            <table className="w-full min-w-[560px] text-left">
              <thead className="bg-paper text-[12px] text-muted"><tr><th className="px-2 py-1 font-normal">Item da EAP</th><th className="px-2 py-1 font-normal">Serviço</th><th className="px-2 py-1 text-right font-normal">{c.from.code}</th><th className="px-2 py-1 text-right font-normal">{c.to.code}</th><th className="px-2 py-1 text-right font-normal">Diferença</th><th className="px-2 py-1 font-normal">Un.</th></tr></thead>
              <tbody>{c.quantities.map((x, i) => (
                <tr key={i} className="border-t border-line">
                  <td className="px-2 py-1">{x.wbs}</td><td className="px-2 py-1">{x.service}</td>
                  <td className="px-2 py-1 text-right font-mono">{x.before ? fmtQty(x.before) : '—'}</td>
                  <td className="px-2 py-1 text-right font-mono">{x.after ? fmtQty(x.after) : '—'}</td>
                  <td className={`px-2 py-1 text-right font-mono ${deltaClass(x.delta)}`}>{signed(x.delta)}</td>
                  <td className="px-2 py-1 font-mono">{x.unit}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        </section>
      )}
      {!compact && (c.measurements.added.length + c.measurements.removed.length + c.measurements.changed.length > 0) && (
        <section aria-label="Medições">
          <h3 className="mb-1 font-medium">Medições</h3>
          <ul className="border border-line bg-sheet">
            {c.measurements.changed.map((m) => <li key={m.id} className="border-b border-line px-2 py-1 last:border-0"><span className="text-muted">Alterada (R{m.fromRevision} → R{m.toRevision}):</span> {m.label} · <span className="font-mono">{fmtQty(m.before)} → {fmtQty(m.after)} {m.unit}</span> <span className={`font-mono ${deltaClass(m.delta)}`}>({signed(m.delta)})</span></li>)}
            {c.measurements.added.map((m) => <li key={m.id} className="border-b border-line px-2 py-1 last:border-0"><span className="text-muted">Incluída:</span> {m.label} · <span className="font-mono">{fmtQty(m.quantity)} {m.unit}</span></li>)}
            {c.measurements.removed.map((m) => <li key={m.id} className="border-b border-line px-2 py-1 last:border-0"><span className="text-muted">Excluída:</span> {m.label} · <span className="font-mono">{fmtQty(m.quantity)} {m.unit}</span></li>)}
          </ul>
        </section>
      )}
      {(['wbs', 'structure'] as const).map((k) => {
        const d = c[k];
        const total = d.added.length + d.removed.length + d.changed.length;
        if (!total) return null;
        const rows = [
          ...d.changed.map((x) => ({ kind: 'changed' as const, text: `${'code' in x ? `${x.code} ${x.title}` : x.label} (antes: ${x.before})` })),
          ...d.added.map((x) => ({ kind: 'added' as const, text: 'code' in x ? `${x.code} ${x.title}` : x.label })),
          ...d.removed.map((x) => ({ kind: 'removed' as const, text: 'code' in x ? `${x.code} ${x.title}` : x.label })),
        ];
        return (
          <section key={k} aria-label={k === 'wbs' ? 'EAP' : 'Cadastro físico'}>
            <h3 className="mb-1 font-medium">{k === 'wbs' ? 'EAP' : 'Cadastro físico'} <span className="font-normal text-muted">({total})</span></h3>
            <ul className="max-h-64 overflow-auto border border-line bg-sheet">
              {rows.slice(0, compact ? 10 : undefined).map((r, i) => <li key={i} className="border-b border-line px-2 py-1 last:border-0"><span className="text-muted">{KIND[r.kind]}:</span> {r.text}</li>)}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
