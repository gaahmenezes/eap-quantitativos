import { useQuery } from '@tanstack/react-query';
import type { WorkbookImportDto, WorkbookImportListItemDto, WorkbookSheetDto } from '@eapq/contracts';
import { api } from '../../lib/api';

export const wbKeys = {
  all: (p: string) => ['project', p, 'workbook-imports'] as const,
  detail: (p: string, id: string) => ['project', p, 'workbook-imports', id] as const,
  sheet: (p: string, id: string, i: number, h: number | null) => ['project', p, 'workbook-imports', id, 'sheet', i, h] as const,
};
export const useWorkbookImports = (p: string) => useQuery({ queryKey: wbKeys.all(p), queryFn: () => api<WorkbookImportListItemDto[]>('GET', `/projects/${p}/workbook-imports`) });
export const useWorkbookImport = (p: string, id: string) => useQuery({ queryKey: wbKeys.detail(p, id), queryFn: () => api<WorkbookImportDto>('GET', `/projects/${p}/workbook-imports/${id}`) });
export const useWorkbookSheet = (p: string, id: string, index: number | null, headerRow: number | null) =>
  useQuery({ queryKey: wbKeys.sheet(p, id, index ?? -1, headerRow), enabled: index !== null, staleTime: Infinity, placeholderData: (prev) => prev,
    queryFn: () => api<WorkbookSheetDto>('GET', `/projects/${p}/workbook-imports/${id}/sheets/${index}${headerRow !== null ? `?headerRow=${headerRow}` : ''}`) });
export const STATUS = { DRAFT: 'em preparação', APPLIED: 'aplicada', CANCELLED: 'cancelada' } as const;
