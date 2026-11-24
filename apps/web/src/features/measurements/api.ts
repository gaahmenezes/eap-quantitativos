import { useQuery } from '@tanstack/react-query';
import type { AnchorOptionsDto, MeasurementDetailDto, MeasurementDto, MeasurementSummaryDto } from '@eapq/contracts';
import { api } from '../../lib/api';

export const mKeys = {
  all: (p: string) => ['project', p, 'measurements'] as const,
  list: (p: string, wbsNodeId: string) => ['project', p, 'measurements', 'list', wbsNodeId] as const,
  summary: (p: string) => ['project', p, 'measurements', 'summary'] as const,
  detail: (p: string, id: string) => ['project', p, 'measurements', 'detail', id] as const,
  anchors: (p: string) => ['project', p, 'measurements', 'anchors'] as const,
  outdated: (p: string) => ['project', p, 'measurements', 'outdated'] as const,
  revisions: (p: string) => ['project', p, 'measurements', 'revisions'] as const,
};

export const useMeasurements = (p: string, wbsNodeId: string | null) =>
  useQuery({ queryKey: mKeys.list(p, wbsNodeId ?? '-'), enabled: !!wbsNodeId, queryFn: () => api<MeasurementDto[]>('GET', `/projects/${p}/measurements?wbsNodeId=${wbsNodeId}`) });
export const useSummary = (p: string) => useQuery({ queryKey: mKeys.summary(p), queryFn: () => api<MeasurementSummaryDto>('GET', `/projects/${p}/measurements/summary`) });
export const useOutdated = (p: string) => useQuery({ queryKey: mKeys.outdated(p), queryFn: () => api<MeasurementDto[]>('GET', `/projects/${p}/measurements?outdated=true`) });
export const useAnchors = (p: string) => useQuery({ queryKey: mKeys.anchors(p), queryFn: () => api<AnchorOptionsDto>('GET', `/projects/${p}/measurements/anchors`), staleTime: 30_000 });
export const useMeasurement = (p: string, id: string) => useQuery({ queryKey: mKeys.detail(p, id), queryFn: () => api<MeasurementDetailDto>('GET', `/projects/${p}/measurements/${id}`) });
