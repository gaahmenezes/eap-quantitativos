import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  CreateNodeInput,
  CreateTypologyInput,
  ModuleKindDto,
  MoveNodeInput,
  StructureDto,
  TypologyDto,
  UpdateNodeInput,
  UpdateTypologyInput,
  WizardInput,
  WizardPreviewDto,
} from '@eapq/contracts';
import { api } from '../../lib/api';

export const structureKeys = {
  tree: (id: string) => ['project', id, 'structure'] as const,
  typologies: (id: string) => ['project', id, 'typologies'] as const,
};

export const useStructure = (projectId: string) =>
  useQuery({ queryKey: structureKeys.tree(projectId), queryFn: () => api<StructureDto>('GET', `/projects/${projectId}/structure`) });

export const useTypologies = (projectId: string) =>
  useQuery({ queryKey: structureKeys.typologies(projectId), queryFn: () => api<TypologyDto[]>('GET', `/projects/${projectId}/typologies`) });

function useRefresh(projectId: string) {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: structureKeys.tree(projectId) });
    void qc.invalidateQueries({ queryKey: structureKeys.typologies(projectId) });
    void qc.invalidateQueries({ queryKey: ['project', projectId, 'audit'] });
  };
}

export function useStructureMutations(projectId: string) {
  const refresh = useRefresh(projectId);
  const base = `/projects/${projectId}/structure`;
  // Chamado sempre na mesma ordem dentro deste hook (regra dos hooks preservada).
  const m = <V, R>(fn: (v: V) => Promise<R>) => useMutation<R, Error, V>({ mutationFn: fn, onSuccess: refresh });
  return {
    createModule: m((v: { kind: ModuleKindDto; name: string }) => api('POST', `${base}/modules`, { body: v })),
    renameModule: m((v: { id: string; version: number; name: string }) => api('PATCH', `${base}/modules/${v.id}`, { body: { name: v.name }, version: v.version })),
    createNode: m((v: CreateNodeInput) => api<{ id: string }>('POST', `${base}/nodes`, { body: v })),
    updateNode: m((v: { id: string; version: number; body: UpdateNodeInput }) => api('PATCH', `${base}/nodes/${v.id}`, { body: v.body, version: v.version })),
    moveNode: m((v: { id: string; version: number; body: MoveNodeInput }) => api('POST', `${base}/nodes/${v.id}/move`, { body: v.body, version: v.version })),
    duplicateNode: m((id: string) => api<{ id: string }>('POST', `${base}/nodes/${id}/duplicate`)),
    archiveNode: m((v: { id: string; version: number; archived: boolean; reason: string }) =>
      api('POST', `${base}/nodes/${v.id}/${v.archived ? 'archive' : 'unarchive'}`, { body: v.reason ? { reason: v.reason } : {}, version: v.version }),
    ),
    createTypology: m((v: CreateTypologyInput) => api<TypologyDto>('POST', `/projects/${projectId}/typologies`, { body: v })),
    updateTypology: m((v: { id: string; version: number; body: UpdateTypologyInput }) => api('PATCH', `/projects/${projectId}/typologies/${v.id}`, { body: v.body, version: v.version })),
    archiveTypology: m((v: { id: string; version: number; archived: boolean }) =>
      api('POST', `/projects/${projectId}/typologies/${v.id}/${v.archived ? 'archive' : 'unarchive'}`, { body: {}, version: v.version }),
    ),
  };
}

export const previewWizard = (projectId: string, body: WizardInput) =>
  api<WizardPreviewDto>('POST', `/projects/${projectId}/structure/wizard/preview`, { body });

export function useApplyWizard(projectId: string) {
  const refresh = useRefresh(projectId);
  return useMutation({
    mutationFn: (body: WizardInput) => api<{ totalNodes: number }>('POST', `/projects/${projectId}/structure/wizard/apply`, { body }),
    onSuccess: refresh,
  });
}
