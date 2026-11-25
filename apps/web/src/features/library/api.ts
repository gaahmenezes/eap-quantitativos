import { useQuery } from '@tanstack/react-query';
import type { CategoryDto, ServiceDto, UnitDto } from '@eapq/contracts';
import { api } from '../../lib/api';

export const libKeys = {
  units: ['catalog', 'units'] as const,
  categories: ['catalog', 'service-categories'] as const,
  services: (scope: string) => ['services', scope] as const,
};

export const useUnits = () => useQuery({ queryKey: libKeys.units, queryFn: () => api<UnitDto[]>('GET', '/catalog/units'), staleTime: 60_000 });
export const useCategories = () => useQuery({ queryKey: libKeys.categories, queryFn: () => api<CategoryDto[]>('GET', '/catalog/service-categories') });

export function useServices(projectId: string | null, params: Record<string, string | number | undefined>, enabled = true) {
  const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined && v !== '').map(([k, v]) => [k, String(v)]));
  const base = projectId ? `/projects/${projectId}/services` : '/catalog/services';
  return useQuery({
    queryKey: [...libKeys.services(projectId ?? 'catalog'), params],
    queryFn: ({ signal }) => api<{ total: number; items: ServiceDto[] }>('GET', `${base}?${qs}`, { signal }),
    placeholderData: (prev) => prev,
    enabled,
  });
}

/** Categorias em ordem de árvore, com profundidade (para seletores e listas). */
export function categoryTree(cats: CategoryDto[]) {
  const kids = new Map<string | null, CategoryDto[]>();
  for (const c of cats) kids.set(c.parentId, [...(kids.get(c.parentId) ?? []), c]);
  const out: (CategoryDto & { depth: number })[] = [];
  const walk = (p: string | null, depth: number) => {
    for (const c of (kids.get(p) ?? []).sort((a, b) => a.position - b.position)) { out.push({ ...c, depth }); walk(c.id, depth + 1); }
  };
  walk(null, 0);
  return out;
}
