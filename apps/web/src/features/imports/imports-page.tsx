import { useState } from 'react';
import { useParams } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { ImportJobDto, ImportKindDto, ImportRowDto } from '@eapq/contracts';
import { projectPermissions } from '@eapq/domain';
import { Breadcrumbs, PageHeader } from '../../app/shell';
import { Button } from '../../components/ui/button';
import { EmptyState, ErrorState, Loading, Notice } from '../../components/ui/feedback';
import { SelectField } from '../../components/ui/field';
import { api, ApiError, downloadFile, errorMessage, uploadFile } from '../../lib/api';
import { fmtDateTime } from '../../lib/format';
import { useSession } from '../auth/session';
import { useProject } from '../projects/api';

const KIND_LABEL: Record<ImportKindDto, string> = { SERVICES: 'Serviços', STRUCTURE: 'Cadastro físico', MEASUREMENTS: 'Medições (quantitativos)' };
const KIND_HINT: Record<ImportKindDto, string> = {
  SERVICES: 'Código, descrição, unidade e categoria de cada serviço.',
  STRUCTURE: 'Itens do cadastro com referência e referência do item superior (torres, pavimentos, unidades, quadras, lotes…).',
  MEASUREMENTS: 'Item da EAP, serviço, âncora e quantidade. A exportação de Quantitativos já sai neste formato.',
};
const STEPS = ['Tipo', 'Arquivo', 'Leitura', 'Mapeamento', 'Validação', 'Correções', 'Prévia', 'Confirmação', 'Relatório'];

/** Importações do catálogo da organização (sem projectId) ou de um empreendimento. */
export function ImportsPage() {
  const { projectId } = useParams();
  const project = useProject(projectId ?? '');
  const { can, me } = useSession();
  const [jobId, setJobId] = useState<string | null>(null);
  const base = projectId ? `/projects/${projectId}/imports` : '/imports';
  const list = useQuery({ queryKey: ['imports', projectId ?? 'org'], queryFn: () => api<ImportJobDto[]>('GET', base) });
  if (projectId && project.isPending) return <Loading />;
  if (projectId && project.isError) return <ErrorState message={errorMessage(project.error)} onRetry={() => project.refetch()} />;
  const p = projectId ? project.data : undefined;
  const canEdit = projectId ? !!p && projectPermissions(me!.orgRole, p.myProjectRole).has('project.content.edit') && p.status === 'ACTIVE' : can('org.manage');
  const kinds: ImportKindDto[] = projectId ? ['MEASUREMENTS', 'STRUCTURE', 'SERVICES'] : ['SERVICES'];
  return (
    <>
      <Breadcrumbs items={p ? [{ label: 'Empreendimentos', to: '/empreendimentos' }, { label: p.name, to: `/empreendimentos/${p.id}` }, { label: 'Importações' }] : [{ label: 'Biblioteca de serviços', to: '/servicos' }, { label: 'Importação de serviços' }]} />
      <PageHeader title={p ? 'Importações' : 'Importação de serviços do catálogo'}>
        Planilhas XLSX ou CSV passam por leitura, mapeamento de colunas e validação numa área de preparação. Nada é gravado antes da confirmação.
      </PageHeader>
      {jobId ? (
        <Wizard key={jobId} base={base} jobId={jobId} canEdit={canEdit} onClose={() => { setJobId(null); void list.refetch(); }} />
      ) : (
        <div className="flex flex-col gap-5">
          {canEdit && <NewImport base={base} kinds={kinds} onCreated={setJobId} />}
          <section aria-label="Importações recentes">
            <h2 className="mb-2 font-display text-[18px] font-semibold">Importações recentes</h2>
            {list.isPending ? <Loading /> : list.isError ? <ErrorState message={errorMessage(list.error)} /> : list.data.length === 0 ? <EmptyState title="Nenhuma importação ainda" /> : (
              <div className="overflow-x-auto border border-line bg-sheet">
                <table className="w-full min-w-[560px] text-left text-[13.5px]">
                  <thead className="bg-paper text-[12px] text-muted"><tr><th className="px-3 py-1.5 font-normal">Arquivo</th><th className="px-3 py-1.5 font-normal">Tipo</th><th className="px-3 py-1.5 font-normal">Situação</th><th className="px-3 py-1.5 font-normal">Resultado</th><th className="px-3 py-1.5 font-normal">Quando</th></tr></thead>
                  <tbody>{list.data.map((j) => (
                    <tr key={j.id} className="border-t border-line">
                      <td className="px-3 py-1.5"><button type="button" className="text-cyan-ink hover:underline" onClick={() => setJobId(j.id)}>{j.fileName}</button></td>
                      <td className="px-3 py-1.5">{KIND_LABEL[j.kind]}</td>
                      <td className="px-3 py-1.5">{({ UPLOADED: 'Aguardando mapeamento', VALIDATED: 'Validada, não confirmada', APPLIED: 'Aplicada', CANCELLED: 'Cancelada' } as const)[j.status]}</td>
                      <td className="px-3 py-1.5 font-mono text-[12.5px]">{j.summary ? (j.status === 'APPLIED' ? `${j.summary.created} gravada(s), ${j.summary.skipped} ignorada(s)` : `${j.summary.valid + j.summary.warning} ok, ${j.summary.error} com erro`) : '—'}</td>
                      <td className="px-3 py-1.5 text-muted">{fmtDateTime(j.createdAt)} · {j.createdBy}</td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            )}
          </section>
        </div>
      )}
    </>
  );
}

function NewImport({ base, kinds, onCreated }: { base: string; kinds: ImportKindDto[]; onCreated: (id: string) => void }) {
  const [kind, setKind] = useState<ImportKindDto>(kinds[0]!);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <section aria-label="Nova importação" className="flex flex-col gap-3 border border-line bg-sheet p-4">
      <Stepper current={file ? 1 : 0} />
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-[14px] font-medium">1. O que importar</legend>
        {kinds.map((k) => (
          <label key={k} className="flex items-start gap-2 text-[14px]">
            <input type="radio" name="kind" className="mt-1" checked={kind === k} onChange={() => setKind(k)} />
            <span><span className="font-medium">{KIND_LABEL[k]}</span> <span className="text-muted">— {KIND_HINT[k]}</span></span>
          </label>
        ))}
        <button type="button" className="self-start text-[13px] text-cyan-ink hover:underline" onClick={() => downloadFile('GET', `/import-templates/${kind}?format=xlsx`).catch((e) => setError(errorMessage(e)))}>Baixar planilha modelo de {KIND_LABEL[kind].toLowerCase()}</button>
      </fieldset>
      <div>
        <label className="mb-1 block text-[14px] font-medium" htmlFor="import-file">2. Arquivo (XLSX ou CSV, até 20 MB)</label>
        <input id="import-file" type="file" accept=".xlsx,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="text-[13.5px]" />
      </div>
      {error && <Notice tone="danger">{error}</Notice>}
      <div><Button variant="primary" busy={busy} disabled={!file} onClick={async () => {
        setBusy(true); setError(null);
        try { const j = await uploadFile<ImportJobDto>(base, file!, { kind }); onCreated(j.id); } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
      }}>Enviar e ler arquivo</Button></div>
    </section>
  );
}

function Stepper({ current }: { current: number }) {
  return (
    <ol aria-label="Etapas da importação" className="flex flex-wrap gap-x-1 gap-y-1 text-[12px]">
      {STEPS.map((s, i) => (
        <li key={s} aria-current={i === current ? 'step' : undefined} className={`rounded-[3px] px-2 py-0.5 ${i === current ? 'bg-cyan-ink text-white' : i < current ? 'bg-cyan-wash text-cyan-ink' : 'bg-paper text-muted'}`}>{i + 1}. {s}</li>
      ))}
    </ol>
  );
}

function Wizard({ base, jobId, canEdit, onClose }: { base: string; jobId: string; canEdit: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const key = ['imports', 'job', jobId];
  const job = useQuery({ queryKey: key, queryFn: () => api<ImportJobDto>('GET', `${base}/${jobId}`) });
  const [mapping, setMapping] = useState<Record<string, number | null> | null>(null);
  const [sheet, setSheet] = useState<string | null>(null);
  const [skip, setSkip] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [details, setDetails] = useState<string[]>([]);
  if (job.isPending) return <Loading />;
  if (job.isError) return <ErrorState message={errorMessage(job.error)} />;
  const j = job.data;
  const m = mapping ?? j.mapping;
  const closed = j.status === 'APPLIED' || j.status === 'CANCELLED';
  const step = j.status === 'UPLOADED' ? 3 : j.status === 'VALIDATED' ? (j.summary?.error ? 5 : 6) : 8;
  const run = async (fn: () => Promise<ImportJobDto | void>) => {
    setBusy(true); setError(null); setDetails([]);
    try { const r = await fn(); if (r) qc.setQueryData(key, r); setMapping(null); } catch (e) { setError(errorMessage(e)); if (e instanceof ApiError) setDetails((e.problem.errors ?? []).map((x) => x.message)); } finally { setBusy(false); }
  };
  const ok = (j.summary?.valid ?? 0) + (j.summary?.warning ?? 0);
  return (
    <section aria-label="Importação" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="font-display text-[20px] font-semibold">{KIND_LABEL[j.kind]} · {j.fileName}</h2>
          <p className="text-[13px] text-muted">{j.rowCount} linha(s) de dados{j.sheet && j.sheets.length > 1 && ` na aba "${j.sheet}"`} · enviada por {j.createdBy} em {fmtDateTime(j.createdAt)}</p>
        </div>
        <Button variant="ghost" onClick={onClose}>← Voltar às importações</Button>
      </div>
      <Stepper current={step} />
      {error && <Notice tone="danger"><p>{error}</p>{details.length > 0 && <ul className="mt-1 list-disc pl-5">{details.map((d, i) => <li key={i}>{d}</li>)}</ul>}</Notice>}

      {j.status === 'APPLIED' && (
        <Notice tone="ok"><p className="font-medium">9. Relatório: importação aplicada em {fmtDateTime(j.appliedAt!)}.</p><p>{j.summary?.created} registro(s) gravado(s){j.summary?.skipped ? `, ${j.summary.skipped} linha(s) com erro ignorada(s)` : ''}. Cada registro tem auditoria com a referência deste arquivo.</p></Notice>
      )}
      {j.status === 'CANCELLED' && <Notice tone="info">Importação cancelada. Nada foi gravado.</Notice>}

      {!closed && (
        <section aria-label="Leitura e mapeamento" className="flex flex-col gap-3 border border-line bg-sheet p-3">
          <h3 className="text-[14px] font-medium">3. Leitura · 4. Mapeamento de colunas</h3>
          {j.sheets.length > 1 && (
            <div className="max-w-xs"><SelectField label="Aba da planilha" value={sheet ?? j.sheet ?? ''} onChange={(e) => setSheet(e.target.value)}>{j.sheets.map((s) => <option key={s} value={s}>{s}</option>)}</SelectField></div>
          )}
          <div className="grid gap-x-4 gap-y-2 sm:grid-cols-2 lg:grid-cols-3">
            {j.fields.map((f) => (
              <SelectField key={f.key} label={`${f.label}${f.required ? ' *' : ''}`} value={m[f.key] ?? ''} disabled={!canEdit} onChange={(e) => setMapping({ ...m, [f.key]: e.target.value === '' ? null : Number(e.target.value) })}>
                <option value="">{f.required ? 'Selecione a coluna' : '(não importar)'}</option>
                {j.headers.map((h, i) => <option key={i} value={i}>{h || `Coluna ${i + 1}`}</option>)}
              </SelectField>
            ))}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[480px] border border-line text-left text-[12.5px]">
              <caption className="mb-1 text-left text-[12.5px] text-muted">Primeiras linhas do arquivo</caption>
              <thead className="bg-paper text-muted"><tr>{j.headers.map((h, i) => <th key={i} className="px-2 py-1 font-normal">{h}</th>)}</tr></thead>
              <tbody>{j.sample.map((r, i) => <tr key={i} className="border-t border-line">{j.headers.map((_, k) => <td key={k} className="px-2 py-1">{r[k] ?? ''}</td>)}</tr>)}</tbody>
            </table>
          </div>
          {canEdit && <div className="flex gap-2">
            <Button variant="primary" busy={busy} onClick={() => run(() => api<ImportJobDto>('PUT', `${base}/${jobId}/mapping`, { body: { mapping: m, ...(sheet && sheet !== j.sheet && { sheet }) }, version: j.version }))}>{j.status === 'VALIDATED' ? 'Validar novamente' : 'Validar'}</Button>
            <Button variant="ghost" onClick={() => run(async () => { await api('POST', `${base}/${jobId}/cancel`, { body: {} }); await job.refetch(); })}>Cancelar importação</Button>
          </div>}
        </section>
      )}

      {j.summary && (
        <section aria-label="Validação" className="flex flex-col gap-3 border border-line bg-sheet p-3">
          <h3 className="text-[14px] font-medium">5. Validação</h3>
          <dl className="flex flex-wrap gap-x-6 text-[14px]">
            <div><dt className="inline text-muted">Válidas </dt><dd className="inline font-mono text-ok">{j.summary.valid}</dd></div>
            {j.summary.warning > 0 && <div><dt className="inline text-muted">Com aviso </dt><dd className="inline font-mono text-warn">{j.summary.warning}</dd></div>}
            <div><dt className="inline text-muted">Com erro </dt><dd className="inline font-mono text-danger">{j.summary.error}</dd></div>
          </dl>
          {j.summary.error > 0 && <ErrorRows base={base} jobId={jobId} headers={j.headers} version={j.version} />}
        </section>
      )}

      {j.status === 'VALIDATED' && canEdit && (
        <section aria-label="Confirmação" className="flex flex-col gap-3 border border-line bg-sheet p-3">
          <h3 className="text-[14px] font-medium">{j.summary?.error ? '6. Correções · ' : ''}7. Prévia · 8. Confirmação</h3>
          {j.summary!.error > 0 && (
            <label className="flex items-center gap-2 text-[14px]"><input type="checkbox" checked={skip} onChange={(e) => setSkip(e.target.checked)} /> Ignorar as {j.summary!.error} linha(s) com erro e importar só as válidas</label>
          )}
          <p className="text-[14px]">{ok} linha(s) serão gravadas como {KIND_LABEL[j.kind].toLowerCase()}, numa única operação, com auditoria. Para corrigir linhas com erro, ajuste o arquivo e envie de novo.</p>
          <div><Button variant="primary" busy={busy} disabled={!ok || (j.summary!.error > 0 && !skip)} onClick={() => run(() => api<ImportJobDto>('POST', `${base}/${jobId}/apply`, { body: { skipInvalid: skip }, version: j.version }))}>Confirmar importação</Button></div>
        </section>
      )}
    </section>
  );
}

function ErrorRows({ base, jobId, headers, version }: { base: string; jobId: string; headers: string[]; version: number }) {
  const q = useQuery({ queryKey: ['imports', 'job', jobId, 'errors', version], queryFn: () => api<{ total: number; rows: ImportRowDto[] }>('GET', `${base}/${jobId}/rows?status=ERROR&limit=200`) });
  if (q.isPending) return <Loading />;
  if (q.isError) return <ErrorState message={errorMessage(q.error)} />;
  return (
    <div className="max-h-80 overflow-auto border border-line">
      <table className="w-full text-left text-[13px]">
        <caption className="sr-only">Linhas com erro</caption>
        <thead className="sticky top-0 bg-paper text-[12px] text-muted"><tr><th className="px-2 py-1 font-normal">Linha</th><th className="px-2 py-1 font-normal">Problema</th><th className="px-2 py-1 font-normal">Conteúdo</th></tr></thead>
        <tbody>{q.data.rows.map((r) => (
          <tr key={r.rowNumber} className="border-t border-line align-top">
            <td className="px-2 py-1 font-mono">{r.rowNumber}</td>
            <td className="px-2 py-1 text-danger">{r.messages.join(' ')}</td>
            <td className="px-2 py-1 text-muted">{r.values.map((v, i) => (v ? `${headers[i] ?? i + 1}: ${v}` : null)).filter(Boolean).join(' · ')}</td>
          </tr>
        ))}</tbody>
      </table>
      {q.data.total > q.data.rows.length && <p className="p-2 text-[12.5px] text-muted">Mostrando {q.data.rows.length} de {q.data.total}.</p>}
    </div>
  );
}
