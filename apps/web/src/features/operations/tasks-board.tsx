import { useState } from 'react';
import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import type { TaskDto, TaskKind, TaskLinkInput, TaskStatus, WbsDto } from '@eapq/contracts';
import { useAction } from '../../components/ui/actions';
import { Button } from '../../components/ui/button';
import { ErrorState, Loading, Notice } from '../../components/ui/feedback';
import { SelectField, TextArea, TextField } from '../../components/ui/field';
import { ConfirmDialog, SidePanel } from '../../components/ui/panel';
import { api, errorMessage } from '../../lib/api';
import { useSession } from '../auth/session';
import { useSchedules } from '../schedules/api';
import { useSheets } from '../sheets/api';
import { useWorkbookImports } from '../workbooks/api';
import { fmtDay, KIND_LABEL, linkPath, opsKeys, STATUS_LABEL, useTasks, useTeam } from './api';

const COLUMNS: TaskStatus[] = ['TODO', 'DOING', 'REVIEW', 'DONE'];
export interface TaskDraft { title: string; link: TaskLinkInput }

export function TasksBoard({ projectId, canEdit, draft, onDraftUsed }: { projectId: string; canEdit: boolean; draft: TaskDraft | null; onDraftUsed: () => void }) {
  const tasks = useTasks(projectId);
  const { me } = useSession();
  const [editing, setEditing] = useState<TaskDto | 'new' | null>(null);
  const [ask, setAsk] = useState<{ task: TaskDto; to: TaskStatus; title: string } | null>(null);
  const [comment, setComment] = useState('');
  const act = useAction([opsKeys.tasks(projectId), opsKeys.overview(projectId), opsKeys.mine]);
  const open = editing ?? (draft ? 'new' : null);
  if (tasks.isPending) return <Loading />;
  if (tasks.isError) return <ErrorState message={errorMessage(tasks.error)} onRetry={() => tasks.refetch()} />;
  const move = (t: TaskDto, to: TaskStatus, c?: string) => act.run(() => api('POST', `/projects/${projectId}/tasks/${t.id}/transition`, { body: { to, ...(c && { comment: c }) }, version: t.version }));
  const actions = (t: TaskDto) => {
    const mine = me?.user.id;
    const out: { label: string; run: () => void; primary?: boolean }[] = [];
    if (t.status === 'TODO') { out.push({ label: 'Iniciar', run: () => void move(t, 'DOING'), primary: true }); if (!t.reviewer) out.push({ label: 'Concluir', run: () => void move(t, 'DONE') }); }
    if (t.status === 'DOING') {
      out.push(t.reviewer ? { label: 'Enviar para revisão', run: () => void move(t, 'REVIEW'), primary: true } : { label: 'Concluir', run: () => void move(t, 'DONE'), primary: true });
      out.push({ label: 'Voltar para a fazer', run: () => void move(t, 'TODO') });
    }
    if (t.status === 'REVIEW' && (!t.reviewer || t.reviewer.id === mine)) {
      out.push({ label: 'Aprovar', run: () => void move(t, 'DONE'), primary: true });
      out.push({ label: 'Devolver', run: () => { setComment(''); setAsk({ task: t, to: 'DOING', title: 'Devolver para correção' }); } });
    }
    if (t.status === 'DONE') out.push({ label: 'Reabrir', run: () => { setComment(''); setAsk({ task: t, to: 'DOING', title: 'Reabrir tarefa' }); } });
    return out;
  };
  const done = tasks.data.filter((t) => t.status === 'DONE').slice(-8);
  return (
    <section aria-label="Tarefas" className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h2 className="font-display text-[18px] font-semibold">Fila de trabalho</h2>
        {canEdit && <Button variant="primary" onClick={() => setEditing('new')}>Nova tarefa</Button>}
      </div>
      {act.error && <Notice tone="danger">{act.error}</Notice>}
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {COLUMNS.map((st) => {
          const list = st === 'DONE' ? done : tasks.data.filter((t) => t.status === st);
          return (
            <div key={st} role="region" aria-label={`Coluna ${STATUS_LABEL[st]}`} className="flex flex-col gap-2 border border-line bg-paper p-2">
              <h3 className="px-1 text-[13px] font-medium">{STATUS_LABEL[st]} <span className="font-mono text-muted">{tasks.data.filter((t) => t.status === st).length}</span></h3>
              {list.length === 0 && <p className="px-1 text-[12.5px] text-muted">Nada aqui.</p>}
              {list.map((t) => {
                const to = linkPath(projectId, t.link);
                return (
                  <article key={t.id} aria-label={`Tarefa ${t.title}`} className="border border-line bg-sheet p-2 text-[13px]">
                    <p className="font-medium">{t.title}</p>
                    {t.link && <p className="text-[12px]"><span className="text-muted">{KIND_LABEL[t.link.kind]}: </span>{to ? <Link className="text-cyan-ink hover:underline" to={to}>{t.link.label}</Link> : t.link.label}</p>}
                    <p className="text-[12px] text-muted">{t.assignee ? t.assignee.name : <span className="text-warn">sem responsável</span>}{t.reviewer && ` · revisa ${t.reviewer.name}`}</p>
                    {t.dueDate && <p className={`text-[12px] ${t.overdue ? 'font-medium text-danger' : 'text-muted'}`}>prazo {fmtDay(t.dueDate)}{t.overdue && ' — atrasada'}</p>}
                    {canEdit && (
                      <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1">
                        {actions(t).map((a) => <button key={a.label} type="button" onClick={a.run} className={`text-[12.5px] hover:underline ${a.primary ? 'font-medium text-cyan-ink' : 'text-muted'}`}>{a.label}</button>)}
                        <button type="button" onClick={() => setEditing(t)} className="text-[12.5px] text-muted hover:underline">Editar</button>
                      </div>
                    )}
                  </article>
                );
              })}
            </div>
          );
        })}
      </div>
      <SidePanel open={!!open} title={open === 'new' ? 'Nova tarefa' : 'Editar tarefa'} onClose={() => { setEditing(null); onDraftUsed(); }}>
        {open && <TaskForm projectId={projectId} task={open === 'new' ? null : open} draft={open === 'new' ? draft : null} onDone={() => { setEditing(null); onDraftUsed(); }} />}
      </SidePanel>
      <ConfirmDialog open={!!ask} title={ask?.title ?? ''} onClose={() => setAsk(null)} footer={<>
        <Button variant="ghost" onClick={() => setAsk(null)}>Cancelar</Button>
        <Button variant="primary" disabled={!comment.trim()} onClick={async () => { if (ask) await move(ask.task, ask.to, comment.trim()); setAsk(null); }}>Confirmar</Button>
      </>}>
        <TextField label="Comentário" value={comment} onChange={(e) => setComment(e.target.value)} hint="Fica no histórico da tarefa." />
      </ConfirmDialog>
    </section>
  );
}

function TaskForm({ projectId, task, draft, onDone }: { projectId: string; task: TaskDto | null; draft: TaskDraft | null; onDone: () => void }) {
  const team = useTeam(projectId);
  const sheets = useSheets(projectId);
  const schedules = useSchedules(projectId);
  const imports = useWorkbookImports(projectId);
  const wbs = useQuery({ queryKey: ['project', projectId, 'wbs'], queryFn: () => api<WbsDto>('GET', `/projects/${projectId}/wbs`) });
  const [title, setTitle] = useState(task?.title ?? draft?.title ?? '');
  const [description, setDescription] = useState(task?.description ?? '');
  const [kind, setKind] = useState<TaskKind>(task?.kind ?? draft?.link.kind ?? 'OTHER');
  const [linkId, setLinkId] = useState(task?.link?.id ?? (draft?.link.kind !== 'OTHER' ? (draft?.link as { id: string } | undefined)?.id ?? '' : ''));
  const [assigneeId, setAssignee] = useState(task?.assignee?.id ?? '');
  const [reviewerId, setReviewer] = useState(task?.reviewer?.id ?? '');
  const [dueDate, setDue] = useState(task?.dueDate ?? '');
  const [filter, setFilter] = useState('');
  const act = useAction([opsKeys.tasks(projectId), opsKeys.overview(projectId), opsKeys.mine]);
  const editors = (team.data ?? []).filter((m) => m.canEdit);
  const options = kind === 'SHEET' ? (sheets.data ?? []).map((x) => ({ id: x.id, label: x.title }))
    : kind === 'SCHEDULE' ? (schedules.data ?? []).map((x) => ({ id: x.id, label: x.title }))
    : kind === 'WORKBOOK_IMPORT' ? (imports.data ?? []).filter((x) => x.status === 'DRAFT' || x.id === linkId).map((x) => ({ id: x.id, label: x.fileName }))
    : kind === 'WBS_ITEM' ? (wbs.data?.nodes ?? []).filter((n) => n.nodeType === 'ITEM' && (!filter || `${n.code} ${n.title}`.toLowerCase().includes(filter.toLowerCase()) || n.id === linkId)).slice(0, 300).map((n) => ({ id: n.id, label: `${n.code} ${n.title}` })) : [];
  return (
    <form className="flex flex-col gap-3" onSubmit={async (e) => {
      e.preventDefault();
      const link: TaskLinkInput = kind === 'OTHER' ? { kind } : { kind, id: linkId } as TaskLinkInput;
      const body = { title, description: description || null, link, assigneeId: assigneeId || null, reviewerId: reviewerId || null, dueDate: dueDate || null };
      const r = task ? await act.run(() => api('PATCH', `/projects/${projectId}/tasks/${task.id}`, { body, version: task.version })) : await act.run(() => api('POST', `/projects/${projectId}/tasks`, { body }));
      if (r) onDone();
    }}>
      {act.error && <Notice tone="danger">{act.error}</Notice>}
      <TextField label="Tarefa" value={title} onChange={(e) => setTitle(e.target.value)} hint="Ex.: Levantar cerâmica do apto tipo 2Q" error={act.fieldErrors.title} />
      <SelectField label="Vincular a" value={kind} onChange={(e) => { setKind(e.target.value as TaskKind); setLinkId(''); }}>
        {(['OTHER', 'SHEET', 'SCHEDULE', 'WBS_ITEM', 'WORKBOOK_IMPORT'] as TaskKind[]).map((k) => <option key={k} value={k}>{k === 'OTHER' ? 'Nada (tarefa geral)' : KIND_LABEL[k]}</option>)}
      </SelectField>
      {kind === 'WBS_ITEM' && <TextField label="Filtrar itens da EAP" type="search" value={filter} onChange={(e) => setFilter(e.target.value)} />}
      {kind !== 'OTHER' && (
        <SelectField label={KIND_LABEL[kind]} value={linkId} onChange={(e) => setLinkId(e.target.value)}>
          <option value="">Selecione</option>
          {options.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
        </SelectField>
      )}
      <SelectField label="Responsável" value={assigneeId} onChange={(e) => setAssignee(e.target.value)}>
        <option value="">Sem responsável</option>
        {editors.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
      </SelectField>
      <SelectField label="Revisor" value={reviewerId} onChange={(e) => setReviewer(e.target.value)} hint="Com revisor, a tarefa passa por revisão e só ele aprova ou devolve.">
        <option value="">Sem revisão</option>
        {editors.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
      </SelectField>
      <TextField label="Prazo" type="date" value={dueDate} onChange={(e) => setDue(e.target.value)} />
      <TextArea label="Detalhes (opcional)" rows={3} value={description} onChange={(e) => setDescription(e.target.value)} />
      <div className="flex gap-2">
        <Button type="submit" variant="primary" busy={act.pending} disabled={!title.trim() || (kind !== 'OTHER' && !linkId)}>{task ? 'Salvar' : 'Criar tarefa'}</Button>
        {task && <Button variant="ghost" onClick={async () => { if (await act.run(() => api('POST', `/projects/${projectId}/tasks/${task.id}/archive`, { body: {}, version: task.version }))) onDone(); }}>Arquivar</Button>}
      </div>
    </form>
  );
}
