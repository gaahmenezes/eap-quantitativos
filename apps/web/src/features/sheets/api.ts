import { useQuery } from '@tanstack/react-query';
import type { SheetDetailDto, SheetListItemDto, SheetTemplateDto } from '@eapq/contracts';
import { api } from '../../lib/api';

export const sheetKeys = {
  templates: ['sheet-templates'] as const,
  all: (p: string) => ['project', p, 'sheets'] as const,
  list: (p: string, archived: boolean) => ['project', p, 'sheets', 'list', archived] as const,
  detail: (p: string, id: string) => ['project', p, 'sheets', 'detail', id] as const,
};

export const useSheetTemplates = () => useQuery({ queryKey: sheetKeys.templates, queryFn: () => api<SheetTemplateDto[]>('GET', '/sheet-templates') });
export const useSheets = (p: string, archived = false) =>
  useQuery({ queryKey: sheetKeys.list(p, archived), queryFn: () => api<SheetListItemDto[]>('GET', `/projects/${p}/sheets${archived ? '?archived=true' : ''}`) });
export const useSheet = (p: string, id: string) => useQuery({ queryKey: sheetKeys.detail(p, id), queryFn: () => api<SheetDetailDto>('GET', `/projects/${p}/sheets/${id}`) });

export const STATUS_LABEL = { DRAFT: 'não lançada', LAUNCHED: 'lançada', PENDING: 'alterada — lançar de novo' } as const;
export const STATUS_TONE = { DRAFT: 'bg-paper text-muted', LAUNCHED: 'bg-ok-wash text-ok', PENDING: 'bg-warn-wash text-warn' } as const;
