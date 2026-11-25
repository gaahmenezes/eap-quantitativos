import { useQuery } from '@tanstack/react-query';
import type { MyTaskDto, OperationsDto, TaskDto, TaskKind, TaskStatus, TeamMemberDto } from '@eapq/contracts';
import { api } from '../../lib/api';

export const opsKeys = {
  overview: (p: string) => ['project', p, 'operations'] as const,
  tasks: (p: string) => ['project', p, 'tasks'] as const,
  team: (p: string) => ['project', p, 'team'] as const,
  mine: ['tasks', 'mine'] as const,
};
export const useOperations = (p: string) => useQuery({ queryKey: opsKeys.overview(p), queryFn: () => api<OperationsDto>('GET', `/projects/${p}/operations`) });
export const useTasks = (p: string) => useQuery({ queryKey: opsKeys.tasks(p), queryFn: () => api<TaskDto[]>('GET', `/projects/${p}/tasks`) });
export const useTeam = (p: string) => useQuery({ queryKey: opsKeys.team(p), queryFn: () => api<TeamMemberDto[]>('GET', `/projects/${p}/team`), staleTime: 60_000 });
export const useMyTasks = () => useQuery({ queryKey: opsKeys.mine, queryFn: () => api<MyTaskDto[]>('GET', '/tasks/mine') });

export const STATUS_LABEL: Record<TaskStatus, string> = { TODO: 'A fazer', DOING: 'Em andamento', REVIEW: 'Em revisão', DONE: 'Concluída' };
export const KIND_LABEL: Record<TaskKind, string> = { SHEET: 'Ficha', SCHEDULE: 'Quadro', WBS_ITEM: 'Item da EAP', WORKBOOK_IMPORT: 'Migração', OTHER: 'Geral' };
export const linkPath = (projectId: string, l: { kind: TaskKind; id: string } | null) =>
  !l ? null : l.kind === 'SHEET' ? `/empreendimentos/${projectId}/fichas/${l.id}` : l.kind === 'SCHEDULE' ? `/empreendimentos/${projectId}/quadros/${l.id}`
    : l.kind === 'WORKBOOK_IMPORT' ? `/empreendimentos/${projectId}/migracao/${l.id}` : l.kind === 'WBS_ITEM' ? `/empreendimentos/${projectId}/quantitativos` : null;
export const fmtDay = (d: string) => d.split('-').reverse().join('/');
