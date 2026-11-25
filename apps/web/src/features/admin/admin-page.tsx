import { useState } from 'react';
import { Link } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { InvitationDto, MemberDto } from '@eapq/contracts';
import type { OrgRole } from '@eapq/domain';
import { Breadcrumbs, PageHeader } from '../../app/shell';
import { Button } from '../../components/ui/button';
import { ErrorState, Loading, Notice } from '../../components/ui/feedback';
import { SelectField, TextField } from '../../components/ui/field';
import { api, errorMessage } from '../../lib/api';
import { fmtDate } from '../../lib/format';
import { useSession } from '../auth/session';

const ROLE_LABEL: Record<OrgRole, string> = { OWNER: 'Proprietário', ADMIN: 'Administrador', MEMBER: 'Membro' };

export function AdminPage() {
  const { me, can } = useSession();
  const manage = can('org.members.manage');
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [link, setLink] = useState<string | null>(null);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<OrgRole>('MEMBER');

  const members = useQuery({ queryKey: ['org-members'], queryFn: () => api<MemberDto[]>('GET', '/organization/members') });
  const invitations = useQuery({
    queryKey: ['invitations'],
    queryFn: () => api<InvitationDto[]>('GET', '/organization/invitations'),
    enabled: manage,
  });
  const refresh = () => {
    setError(null);
    void qc.invalidateQueries({ queryKey: ['org-members'] });
    void qc.invalidateQueries({ queryKey: ['invitations'] });
  };
  const onError = (e: unknown) => setError(errorMessage(e));
  const changeRole = useMutation({
    mutationFn: (v: { userId: string; role: OrgRole }) => api('PATCH', `/organization/members/${v.userId}`, { body: { role: v.role } }),
    onSuccess: refresh,
    onError,
  });
  const remove = useMutation({ mutationFn: (userId: string) => api('DELETE', `/organization/members/${userId}`), onSuccess: refresh, onError });
  const invite = useMutation({
    mutationFn: () => api<InvitationDto>('POST', '/organization/invitations', { body: { email, role } }),
    onSuccess: (inv) => {
      setLink(`${window.location.origin}/convite?token=${inv.token}`);
      setEmail('');
      refresh();
    },
    onError,
  });
  const revoke = useMutation({ mutationFn: (id: string) => api('POST', `/organization/invitations/${id}/revoke`), onSuccess: refresh, onError });

  return (
    <>
      <Breadcrumbs items={[{ label: 'Administração' }]} />
      <PageHeader title="Administração" actions={<Link to="/administracao/catalogo" className="inline-flex h-9 items-center rounded-md border border-line-strong bg-sheet px-3.5 text-[14px] font-medium hover:bg-cyan-wash">Catálogo técnico</Link>}>Membros e convites de {me?.organization.name}</PageHeader>
      {error && <div className="mb-4"><Notice tone="danger">{error}</Notice></div>}

      <section aria-labelledby="membros" className="mb-8 max-w-4xl">
        <h2 id="membros" className="mb-2 font-display text-[19px] font-semibold">Membros</h2>
        {members.isPending ? <Loading /> : members.isError ? <ErrorState message={errorMessage(members.error)} onRetry={() => members.refetch()} /> : (
          <div className="overflow-x-auto">
            <table className="w-full border border-line bg-sheet text-left text-[14px]">
              <thead className="border-b border-line-strong text-[13px] text-muted">
                <tr><th className="px-3 py-2 font-medium">Nome</th><th className="px-3 py-2 font-medium">E-mail</th><th className="px-3 py-2 font-medium">Papel</th>{manage && <th className="px-3 py-2"><span className="sr-only">Ações</span></th>}</tr>
              </thead>
              <tbody>
                {members.data.map((m) => {
                  const self = m.userId === me?.user.id;
                  const editable = manage && !self && (m.role !== 'OWNER' || me?.orgRole === 'OWNER');
                  return (
                    <tr key={m.userId} className="border-b border-line last:border-0">
                      <td className="px-3 py-2">{m.name}{self && <span className="text-muted"> (você)</span>}</td>
                      <td className="px-3 py-2 text-muted">{m.email}</td>
                      <td className="px-3 py-2">
                        {editable ? (
                          <select aria-label={`Papel de ${m.name}`} value={m.role} onChange={(e) => changeRole.mutate({ userId: m.userId, role: e.target.value as OrgRole })} className="h-8 rounded-md border border-line-strong bg-sheet px-1.5">
                            {(Object.keys(ROLE_LABEL) as OrgRole[]).filter((r) => r !== 'OWNER' || me?.orgRole === 'OWNER').map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
                          </select>
                        ) : ROLE_LABEL[m.role]}
                      </td>
                      {manage && (
                        <td className="px-3 py-2 text-right">
                          {editable && <button type="button" className="text-[13px] text-danger hover:underline" onClick={() => { if (window.confirm(`Remover ${m.name} da organização? A pessoa perde acesso imediatamente.`)) remove.mutate(m.userId); }}>Remover</button>}
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {manage && (
        <section aria-labelledby="convites" className="max-w-4xl">
          <h2 id="convites" className="mb-2 font-display text-[19px] font-semibold">Convites</h2>
          <form className="mb-4 grid gap-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_auto] sm:items-end" onSubmit={(e) => { e.preventDefault(); setLink(null); invite.mutate(); }}>
            <TextField label="E-mail" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
            <SelectField label="Papel" value={role} onChange={(e) => setRole(e.target.value as OrgRole)}>
              {(Object.keys(ROLE_LABEL) as OrgRole[]).filter((r) => r !== 'OWNER' || me?.orgRole === 'OWNER').map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
            </SelectField>
            <Button type="submit" variant="primary" busy={invite.isPending}>Gerar convite</Button>
          </form>
          {link && (
            <div className="mb-4">
              <Notice tone="ok">
                Convite gerado. Envie este link à pessoa convidada — ele é exibido apenas agora e vale por 7 dias:
                <input readOnly value={link} onFocus={(e) => e.currentTarget.select()} aria-label="Link do convite" className="mt-2 block w-full rounded-md border border-line-strong bg-sheet px-2 py-1.5 font-mono text-[12.5px]" />
              </Notice>
            </div>
          )}
          {invitations.isPending ? <Loading /> : invitations.isError ? <ErrorState message={errorMessage(invitations.error)} /> : invitations.data.filter((i) => !i.acceptedAt).length === 0 ? (
            <p className="text-[14px] text-muted">Nenhum convite pendente.</p>
          ) : (
            <table className="w-full border border-line bg-sheet text-left text-[14px]">
              <thead className="border-b border-line-strong text-[13px] text-muted"><tr><th className="px-3 py-2 font-medium">E-mail</th><th className="px-3 py-2 font-medium">Papel</th><th className="px-3 py-2 font-medium">Expira em</th><th className="px-3 py-2"><span className="sr-only">Ações</span></th></tr></thead>
              <tbody>
                {invitations.data.filter((i) => !i.acceptedAt).map((i) => (
                  <tr key={i.id} className="border-b border-line last:border-0">
                    <td className="px-3 py-2">{i.email}</td>
                    <td className="px-3 py-2">{ROLE_LABEL[i.role]}</td>
                    <td className="px-3 py-2 text-muted">{fmtDate(i.expiresAt)}</td>
                    <td className="px-3 py-2 text-right"><button type="button" className="text-[13px] text-danger hover:underline" onClick={() => revoke.mutate(i.id)}>Revogar</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      )}
    </>
  );
}
