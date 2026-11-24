import { useQuery } from '@tanstack/react-query';
import type { ProjectRevisionDto, RevisionCompareDto } from '@eapq/contracts';
import { api } from '../../lib/api';

export const revKeys = { list: (p: string) => ['project', p, 'revisions'] as const, compare: (p: string, from: string, to: string) => ['project', p, 'revisions', 'compare', from, to] as const };
export const useRevisions = (p: string) => useQuery({ queryKey: revKeys.list(p), queryFn: () => api<ProjectRevisionDto[]>('GET', `/projects/${p}/revisions`) });
export const useCompare = (p: string, from: string | null, to: string | null) =>
  useQuery({ queryKey: revKeys.compare(p, from ?? '-', to ?? '-'), enabled: !!from && !!to, queryFn: () => api<RevisionCompareDto>('GET', `/projects/${p}/revisions/compare?from=${from}&to=${to}`) });
