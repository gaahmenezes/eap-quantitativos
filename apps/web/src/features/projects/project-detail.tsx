import { useState } from 'react';
import { useParams, useSearchParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { PROJECT_CLASSIFICATION_LABELS, type AuditEntryDto, type MemberDto, type ProjectDto } from '@eapq/contracts';
import { projectPermissions, type ProjectRole } from '@eapq/domain';
import { Breadcrumbs } from '../../app/shell';
import { Button } from '../../components/ui/button';
import { EmptyState, ErrorState, Loading, Notice, StatusTag } from '../../components/ui/feedback';
import { TextField } from '../../components/ui/field';
import { ConfirmDialog, SidePanel } from '../../components/ui/panel';
import { api, ApiError, errorMessage } from '../../lib/api';
import { fmtDateTime } from '../../lib/format';
import { useSession } from '../auth/session';
import { projectKeys, useArchiveProject, useProject, useProjectAudit, useProjectMembers, useUpdateProject } from './api';
import { ProjectForm } from './project-form';

const ROLE_LABEL: Record<ProjectRole, string> = { COORDINATOR: 'Coordenador', EDITOR: 'Editor', VIEWER: 'Leitor' };

export function ProjectDetailPage() {
  const { projectId = '' } = useParams();
  const project = useProject(projectId);
  if (project.isPending) return <Loading />;
  if (project.isError) {
    const nf = project.error instanceof ApiError && project.error.status === 404;
    return nf ? (
      <EmptyState title="Empreendimento não encontrado">Ele não existe ou você não tem acesso a ele.</EmptyState>
    ) : (
      <ErrorState message={errorMessage(project.error)} onRetry={() => project.refetch()} />
    );
  }
  return <ProjectView project={project.data} />;
}

function ProjectView({ project: p }: { project: ProjectDto }) {
  const { me } = useSession();
  const perms = projectPermissions(me!.orgRole, p.myProjectRole);
  const [params, setParams] = useSearchParams();
  const tab = params.get('aba') ?? 'geral';
  const [editing, setEditing] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);
  const update = useUpdateProject(p);
  const qc = useQueryClient();

  const tabs = [
    { id: 'geral', label: 'Visão geral', show: true },
    { id: 'membros', label: 'Membros', show: true },
    { id: 'historico', label: 'Histórico', show: perms.has('audit.read') },
  ].filter((t) => t.show);

  return (
    <>
      <Breadcrumbs items={[{ label: 'Empreendimentos', to: '/empreendimentos' }, { label: p.name }]} />
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-[28px] font-semibold leading-tight tracking-tight">{p.name}</h1>
        <div className="flex gap-2">
          {perms.has('project.update') && p.status === 'ACTIVE' && (
            <Button onClick={() => { setSaved(null); setEditing(true); }}>Editar dados</Button>
          )}
          {perms.has('project.archive') && (
            <Button variant={p.status === 'ACTIVE' ? 'ghost' : 'secondary'} onClick={() => setArchiving(true)}>
              {p.status === 'ACTIVE' ? 'Arquivar' : 'Reativar'}
            </Button>
          )}
        </div>
      </div>

      {saved && <div className="mb-3"><Notice tone="ok">{saved}</Notice></div>}
      {p.status === 'ARCHIVED' && (
        <div className="mb-3"><Notice tone="warn">Empreendimento arquivado em {fmtDateTime(p.archivedAt!)}. Os dados ficam disponíveis apenas para consulta.</Notice></div>
      )}

      <TitleBlock p={p} />

      <div role="tablist" aria-label="Seções do empreendimento" className="mt-6 flex gap-1 border-b border-line">
        {tabs.map((t) => (
          <button
            key={t.id}
            role="tab"
            type="button"
            aria-selected={tab === t.id}
            onClick={() => setParams(t.id === 'geral' ? {} : { aba: t.id }, { replace: true })}
            className={`-mb-px border-b-2 px-3 py-2 text-[14px] ${tab === t.id ? 'border-cyan-ink font-medium text-ink' : 'border-transparent text-muted hover:text-ink'}`}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div role="tabpanel" className="pt-5">
        {tab === 'membros' ? (
          <MembersTab project={p} canManage={perms.has('project.members.manage') && p.status === 'ACTIVE'} />
        ) : tab === 'historico' && perms.has('audit.read') ? (
          <HistoryTab projectId={p.id} />
        ) : (
          <Overview p={p} />
        )}
      </div>

      <SidePanel open={editing} title="Editar dados do empreendimento" onClose={() => setEditing(false)}>
        <ProjectForm
          initial={p}
          submitLabel="Salvar alterações"
          onCancel={() => setEditing(false)}
          onSubmit={async (values) => {
            try {
              await update.mutateAsync(values);
              setEditing(false);
              setSaved('Alterações salvas.');
            } catch (e) {
              if (e instanceof ApiError && e.code === 'VERSION_CONFLICT') {
                await qc.invalidateQueries({ queryKey: projectKeys.one(p.id) });
              }
              throw e;
            }
          }}
        />
      </SidePanel>
      <ArchiveDialog project={p} open={archiving} onClose={() => setArchiving(false)} onDone={(m) => setSaved(m)} />
    </>
  );
}

/** Carimbo do empreendimento, no formato do quadro de identificação de uma prancha técnica. */
function TitleBlock({ p }: { p: ProjectDto }) {
  const cell = 'border-line px-3 py-2';
  const label = 'block text-[12px] text-muted';
  return (
    <dl className="grid grid-cols-2 border border-graphite-800 bg-sheet md:grid-cols-[minmax(160px,1fr)_2fr_1.4fr_1fr]">
      <div className={`${cell} col-span-2 border-b bg-graphite-900 text-white md:col-span-1 md:row-span-2 md:border-r md:border-b-0 md:border-graphite-800`}>
        <dt className="block text-[12px] text-graphite-400">Código</dt>
        <dd className="mt-1 break-all font-mono text-[22px] font-medium leading-tight">{p.code}</dd>
      </div>
      <div className={`${cell} col-span-2 border-b md:col-span-1 md:border-r`}>
        <dt className={label}>Classificação</dt>
        <dd className="font-medium">{PROJECT_CLASSIFICATION_LABELS[p.classification]}</dd>
      </div>
      <div className={`${cell} border-b border-r`}>
        <dt className={label}>Localização</dt>
        <dd>{p.location ?? <span className="text-muted">Não informada</span>}</dd>
      </div>
      <div className={`${cell} border-b`}>
        <dt className={label}>Situação</dt>
        <dd><StatusTag status={p.status} /></dd>
      </div>
      <div className={`${cell} border-r md:border-r`}>
        <dt className={label}>Cadastrado em</dt>
        <dd>{fmtDateTime(p.createdAt)}</dd>
      </div>
      <div className={`${cell} md:border-r`}>
        <dt className={label}>Última alteração</dt>
        <dd>{fmtDateTime(p.updatedAt)}</dd>
      </div>
      <div className={`${cell} border-t md:border-t-0`}>
        <dt className={label}>Versão do registro</dt>
        <dd className="font-mono">{p.version}</dd>
      </div>
    </dl>
  );
}

function Overview({ p }: { p: ProjectDto }) {
  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
      <section>
        <h2 className="mb-2 font-display text-[18px] font-semibold">Descrição</h2>
        {p.description ? (
          <p className="max-w-prose whitespace-pre-line text-[15px]">{p.description}</p>
        ) : (
          <p className="text-muted">Sem descrição.</p>
        )}
      </section>
      <section className="border-l border-line pl-5">
        <h2 className="mb-2 font-display text-[18px] font-semibold">Próximas etapas do produto</h2>
        <p className="text-[14px] text-muted">
          O cadastro físico (fases, quadras, lotes, torres, pavimentos e unidades) e o assistente de estruturação chegam na fase 2.
          Até lá, este empreendimento guarda os dados de identificação, a equipe e o histórico de alterações.
        </p>
      </section>
    </div>
  );
}

function MembersTab({ project, canManage }: { project: ProjectDto; canManage: boolean }) {
  const members = useProjectMembers(project.id);
  const orgMembers = useQuery({
    queryKey: ['org-members'],
    queryFn: () => api<MemberDto[]>('GET', '/organization/members'),
    enabled: canManage,
  });
  const qc = useQueryClient();
  const [userId, setUserId] = useState('');
  const [role, setRole] = useState<ProjectRole>('EDITOR');
  const [error, setError] = useState<string | null>(null);
  const done = () => {
    setError(null);
    void qc.invalidateQueries({ queryKey: projectKeys.members(project.id) });
    void qc.invalidateQueries({ queryKey: projectKeys.audit(project.id) });
  };
  const setMember = useMutation({
    mutationFn: (v: { userId: string; role: ProjectRole }) => api('PUT', `/projects/${project.id}/members/${v.userId}`, { body: { role: v.role } }),
    onSuccess: () => { setUserId(''); done(); },
    onError: (e) => setError(errorMessage(e)),
  });
  const remove = useMutation({
    mutationFn: (uid: string) => api('DELETE', `/projects/${project.id}/members/${uid}`),
    onSuccess: done,
    onError: (e) => setError(errorMessage(e)),
  });

  if (members.isPending) return <Loading />;
  if (members.isError) return <ErrorState message={errorMessage(members.error)} onRetry={() => members.refetch()} />;
  const inProject = new Set(members.data.map((m) => m.userId));
  const candidates = (orgMembers.data ?? []).filter((m) => !inProject.has(m.userId) && m.role === 'MEMBER');

  return (
    <div className="max-w-3xl">
      {error && <div className="mb-3"><Notice tone="danger">{error}</Notice></div>}
      <p className="mb-3 text-[14px] text-muted">Proprietários e administradores da organização acessam todos os empreendimentos. Os demais membros precisam ser vinculados aqui.</p>
      <table className="w-full border border-line bg-sheet text-left text-[14px]">
        <thead className="border-b border-line-strong text-[13px] text-muted">
          <tr><th className="px-3 py-2 font-medium">Nome</th><th className="px-3 py-2 font-medium">E-mail</th><th className="px-3 py-2 font-medium">Papel</th>{canManage && <th className="px-3 py-2"><span className="sr-only">Ações</span></th>}</tr>
        </thead>
        <tbody>
          {members.data.map((m) => (
            <tr key={m.userId} className="border-b border-line last:border-0">
              <td className="px-3 py-2">{m.name}</td>
              <td className="px-3 py-2 text-muted">{m.email}</td>
              <td className="px-3 py-2">
                {canManage ? (
                  <select aria-label={`Papel de ${m.name}`} value={m.role} onChange={(e) => setMember.mutate({ userId: m.userId, role: e.target.value as ProjectRole })} className="h-8 rounded-[3px] border border-line-strong bg-sheet px-1.5">
                    {Object.entries(ROLE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                ) : ROLE_LABEL[m.role]}
              </td>
              {canManage && (
                <td className="px-3 py-2 text-right">
                  <button type="button" className="text-[13px] text-danger hover:underline" onClick={() => remove.mutate(m.userId)}>Remover</button>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
      {canManage && (
        <form
          className="mt-4 flex flex-wrap items-end gap-2"
          onSubmit={(e) => { e.preventDefault(); if (userId) setMember.mutate({ userId, role }); }}
        >
          <label className="flex flex-col gap-1 text-[13px] font-medium text-graphite-800">
            Vincular membro
            <select aria-label="Vincular membro" value={userId} onChange={(e) => setUserId(e.target.value)} className="h-9 min-w-64 rounded-[3px] border border-line-strong bg-sheet px-2 text-[14px] font-normal">
              <option value="">{candidates.length ? 'Selecione' : 'Nenhum membro disponível'}</option>
              {candidates.map((m) => <option key={m.userId} value={m.userId}>{m.name} — {m.email}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-[13px] font-medium text-graphite-800">
            Papel
            <select aria-label="Papel" value={role} onChange={(e) => setRole(e.target.value as ProjectRole)} className="h-9 rounded-[3px] border border-line-strong bg-sheet px-2 text-[14px] font-normal">
              {Object.entries(ROLE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </label>
          <Button type="submit" disabled={!userId} busy={setMember.isPending}>Vincular</Button>
        </form>
      )}
    </div>
  );
}

const ACTION_LABEL: Record<string, string> = {
  CREATE: 'Cadastro',
  UPDATE: 'Alteração',
  ARCHIVE: 'Arquivamento',
  UNARCHIVE: 'Reativação',
  ADD: 'Membro vinculado',
  REMOVE: 'Membro removido',
  ROLE_CHANGED: 'Papel alterado',
};
const FIELD_LABEL: Record<string, string> = {
  code: 'Código', name: 'Nome', description: 'Descrição', classification: 'Classificação', location: 'Localização', status: 'Situação', role: 'Papel',
};

const VALUE_LABEL: Record<string, Record<string, string>> = {
  classification: PROJECT_CLASSIFICATION_LABELS,
  status: { ACTIVE: 'Ativo', ARCHIVED: 'Arquivado' },
  role: ROLE_LABEL,
};

function changes(e: AuditEntryDto): { field: string; before: string; after: string }[] {
  const b = (e.before ?? {}) as Record<string, unknown>;
  const a = (e.after ?? {}) as Record<string, unknown>;
  const show = (k: string, v: unknown) =>
    v === null || v === undefined || v === '' ? '—' : (VALUE_LABEL[k]?.[String(v)] ?? String(v));
  return [...new Set([...Object.keys(b), ...Object.keys(a)])]
    .filter((k) => JSON.stringify(b[k]) !== JSON.stringify(a[k]))
    .map((k) => ({ field: FIELD_LABEL[k] ?? k, before: show(k, b[k]), after: show(k, a[k]) }));
}

function HistoryTab({ projectId }: { projectId: string }) {
  const audit = useProjectAudit(projectId, true);
  if (audit.isPending) return <Loading />;
  if (audit.isError) return <ErrorState message={errorMessage(audit.error)} onRetry={() => audit.refetch()} />;
  if (audit.data.length === 0) return <EmptyState title="Sem registros no histórico" />;
  return (
    <ol className="max-w-4xl border-l border-line-strong">
      {audit.data.map((e) => (
        <li key={e.id} className="relative pb-5 pl-5">
          <span className="absolute -left-[5px] top-1.5 h-2.5 w-2.5 rounded-full border-2 border-cyan-ink bg-sheet" aria-hidden />
          <p className="text-[14px]">
            <span className="font-medium">{ACTION_LABEL[e.action] ?? e.action}</span>
            {e.entityType === 'ProjectMember' && <span className="text-muted"> (membro)</span>}
            <span className="text-muted"> por {e.actor?.name ?? 'sistema'} em {fmtDateTime(e.at)}</span>
          </p>
          {e.reason && <p className="text-[14px] text-muted">Motivo: {e.reason}</p>}
          {changes(e).length > 0 && (
            <table className="mt-1.5 text-[13.5px]">
              <tbody>
                {changes(e).map((c) => (
                  <tr key={c.field}>
                    <th scope="row" className="py-0.5 pr-3 text-left font-normal text-muted">{c.field}</th>
                    <td className="py-0.5 pr-2 text-muted line-through decoration-graphite-400">{c.before}</td>
                    <td className="py-0.5">{c.after}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </li>
      ))}
    </ol>
  );
}

function ArchiveDialog({ project, open, onClose, onDone }: { project: ProjectDto; open: boolean; onClose: () => void; onDone: (msg: string) => void }) {
  const mutation = useArchiveProject(project);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const archiving = project.status === 'ACTIVE';
  const submit = async () => {
    setError(null);
    if (archiving && !reason.trim()) return setError('Informe o motivo do arquivamento.');
    try {
      await mutation.mutateAsync(reason.trim());
      setReason('');
      onClose();
      onDone(archiving ? 'Empreendimento arquivado.' : 'Empreendimento reativado.');
    } catch (e) {
      setError(errorMessage(e));
    }
  };
  return (
    <ConfirmDialog
      open={open}
      onClose={onClose}
      title={archiving ? 'Arquivar empreendimento' : 'Reativar empreendimento'}
      footer={<><Button variant="ghost" onClick={onClose}>Cancelar</Button><Button variant={archiving ? 'danger' : 'primary'} busy={mutation.isPending} onClick={submit}>{archiving ? 'Arquivar' : 'Reativar'}</Button></>}
    >
      <p className="mb-3">
        {archiving
          ? 'O empreendimento deixa de aparecer na lista de ativos e não poderá ser editado. Nenhum dado é apagado.'
          : 'O empreendimento volta a aceitar edições.'}
      </p>
      {error && <div className="mb-3"><Notice tone="danger">{error}</Notice></div>}
      <TextField label={archiving ? 'Motivo' : 'Motivo (opcional)'} value={reason} onChange={(e) => setReason(e.target.value)} />
    </ConfirmDialog>
  );
}
