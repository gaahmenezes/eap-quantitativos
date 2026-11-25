import { useQuery } from '@tanstack/react-query';
import type { ScheduleDetailDto, ScheduleKind, ScheduleListItemDto } from '@eapq/contracts';
import { api } from '../../lib/api';

export const scheduleKeys = {
  all: (p: string) => ['project', p, 'schedules'] as const,
  list: (p: string, archived: boolean) => ['project', p, 'schedules', 'list', archived] as const,
  detail: (p: string, id: string) => ['project', p, 'schedules', 'detail', id] as const,
  sources: ['schedule-sources'] as const,
};

export const useSchedules = (p: string, archived = false) =>
  useQuery({ queryKey: scheduleKeys.list(p, archived), queryFn: () => api<ScheduleListItemDto[]>('GET', `/projects/${p}/schedules${archived ? '?archived=true' : ''}`) });
export const useSchedule = (p: string, id: string) => useQuery({ queryKey: scheduleKeys.detail(p, id), queryFn: () => api<ScheduleDetailDto>('GET', `/projects/${p}/schedules/${id}`) });
export const useScheduleSources = () =>
  useQuery({ queryKey: scheduleKeys.sources, queryFn: () => api<{ id: string; title: string; kind: ScheduleKind; project: string; rowCount: number }[]>('GET', '/schedule-sources') });

export const KIND_LABEL: Record<ScheduleKind, string> = {
  ESQUADRIAS: 'Esquadrias',
  LOUCAS_METAIS: 'Louças e metais',
  INSTALACOES_HIDRAULICAS: 'Materiais de instalações hidráulicas',
  INSTALACOES_ELETRICAS: 'Materiais de instalações elétricas',
  OUTROS: 'Outros componentes',
};

export const SCHEDULE_STATUS_LABEL = { DRAFT: 'não lançado', LAUNCHED: 'lançado', PENDING: 'alterado — lançar de novo' } as const;
