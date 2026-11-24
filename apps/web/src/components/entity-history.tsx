import { useQuery } from '@tanstack/react-query';
import type { AuditEntryDto } from '@eapq/contracts';
import { api, ApiError } from '../lib/api';
import { fmtDateTime } from '../lib/format';
import { Loading } from './ui/feedback';

const ACTION: Record<string, string> = {
  CREATE: 'Cadastro', UPDATE: 'Alteração', ARCHIVE: 'Arquivamento', UNARCHIVE: 'Restauração', MOVE: 'Movimentação', DUPLICATE: 'Duplicação',
  SET_SERVICES: 'Serviços vinculados', PUBLISH: 'Publicação', ISSUE: 'Emissão', DELETE: 'Exclusão de rascunho',
};
const FIELD: Record<string, string> = {
  title: 'Título', name: 'Nome', code: 'Código', quantity: 'Quantidade', revision: 'Revisão', method: 'Método', unit: 'Unidade', nodeType: 'Tipo',
  serviceIds: 'Serviços', parentId: 'Nó superior', position: 'Posição', description: 'Descrição',
};

const VALUE: Record<string, string> = { MANUAL: 'Manual', FORMULA: 'Fórmula', IMPORTED: 'Importada', GROUP: 'Agrupador', ITEM: 'Item quantificável' };
const show = (v: unknown): string => {
  if (v === null || v === undefined || v === '') return '—';
  if (Array.isArray(v)) return `${v.length} item(ns)`;
  if (typeof v === 'object') return '…';
  const s = String(v);
  return VALUE[s] ?? (/^-?\d+\.\d+$/.test(s) ? s.replace('.', ',') : s);
};

function changes(e: AuditEntryDto) {
  const b = (e.before ?? {}) as Record<string, unknown>;
  const a = (e.after ?? {}) as Record<string, unknown>;
  return [...new Set([...Object.keys(b), ...Object.keys(a)])]
    .filter((k) => FIELD[k] && JSON.stringify(b[k]) !== JSON.stringify(a[k]))
    .map((k) => ({ field: FIELD[k]!, before: show(b[k]), after: show(a[k]) }));
}

/** Histórico de auditoria de uma entidade (somente para quem pode ler a auditoria). */
export function EntityHistory({ projectId, entityId }: { projectId: string; entityId: string }) {
  const q = useQuery({
    queryKey: ['project', projectId, 'audit', entityId],
    queryFn: () => api<AuditEntryDto[]>('GET', `/projects/${projectId}/audit?entityId=${entityId}`),
    retry: (n, e) => !(e instanceof ApiError && e.status === 403) && n < 2,
  });
  if (q.isPending) return <Loading />;
  if (q.isError) return q.error instanceof ApiError && q.error.status === 403 ? null : <p className="text-[13px] text-muted">Histórico indisponível.</p>;
  return (
    <section aria-label="Histórico de alterações" className="flex flex-col gap-2 text-[13px]">
      <h3 className="font-medium">Histórico de alterações</h3>
      {q.data.length === 0 ? <p className="text-muted">Sem registros.</p> : (
        <ol className="border-l border-line-strong">
          {q.data.map((e) => (
            <li key={e.id} className="relative pb-3 pl-4">
              <span className="absolute -left-[4px] top-1.5 h-2 w-2 rounded-full border-2 border-cyan-ink bg-sheet" aria-hidden />
              <p><span className="font-medium">{ACTION[e.action] ?? e.action}</span><span className="text-muted"> por {e.actor?.name ?? 'sistema'} em {fmtDateTime(e.at)}</span></p>
              {e.reason && <p className="text-muted">Motivo: {e.reason}</p>}
              {changes(e).map((c) => (
                <p key={c.field}><span className="text-muted">{c.field}:</span> <span className="text-muted line-through decoration-graphite-400">{c.before}</span> → {c.after}</p>
              ))}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
