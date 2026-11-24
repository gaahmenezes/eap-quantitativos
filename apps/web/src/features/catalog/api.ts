import { useQuery } from '@tanstack/react-query';
import type { ElementTypeDto, SystemTypeDto } from '@eapq/contracts';
import { api } from '../../lib/api';

export const catalogKeys = { systems: ['catalog', 'system-types'] as const, elements: ['catalog', 'element-types'] as const };

export const useSystemTypes = () => useQuery({ queryKey: catalogKeys.systems, queryFn: () => api<SystemTypeDto[]>('GET', '/catalog/system-types'), staleTime: 60_000 });
export const useElementTypes = () => useQuery({ queryKey: catalogKeys.elements, queryFn: () => api<ElementTypeDto[]>('GET', '/catalog/element-types'), staleTime: 60_000 });
