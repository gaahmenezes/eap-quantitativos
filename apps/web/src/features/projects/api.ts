import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  AuditEntryDto,
  CreateProjectInput,
  ListProjectsQuery,
  ProjectDto,
  ProjectMemberDto,
  UpdateProjectInput,
} from '@eapq/contracts';
import { api } from '../../lib/api';

export const projectKeys = {
  list: (q: Partial<ListProjectsQuery>) => ['projects', q] as const,
  one: (id: string) => ['project', id] as const,
  members: (id: string) => ['project', id, 'members'] as const,
  audit: (id: string) => ['project', id, 'audit'] as const,
};

export function useProjects(q: Partial<ListProjectsQuery>) {
  const params = new URLSearchParams(Object.entries(q).filter(([, v]) => v) as [string, string][]);
  return useQuery({
    queryKey: projectKeys.list(q),
    queryFn: ({ signal }) => api<ProjectDto[]>('GET', `/projects?${params}`, { signal }),
    placeholderData: (prev) => prev,
  });
}

export const useProject = (id: string) =>
  useQuery({ queryKey: projectKeys.one(id), queryFn: () => api<ProjectDto>('GET', `/projects/${id}`), enabled: !!id });

export const useProjectMembers = (id: string) =>
  useQuery({ queryKey: projectKeys.members(id), queryFn: () => api<ProjectMemberDto[]>('GET', `/projects/${id}/members`) });

export const useProjectAudit = (id: string, enabled: boolean) =>
  useQuery({ queryKey: projectKeys.audit(id), queryFn: () => api<AuditEntryDto[]>('GET', `/projects/${id}/audit`), enabled });

function useInvalidate() {
  const qc = useQueryClient();
  return (p?: ProjectDto) => {
    void qc.invalidateQueries({ queryKey: ['projects'] });
    if (p) {
      qc.setQueryData(projectKeys.one(p.id), p);
      void qc.invalidateQueries({ queryKey: projectKeys.audit(p.id) });
    }
  };
}

export function useCreateProject() {
  const inv = useInvalidate();
  return useMutation({
    mutationFn: (body: CreateProjectInput) => api<ProjectDto>('POST', '/projects', { body }),
    onSuccess: inv,
  });
}

export function useUpdateProject(p: ProjectDto) {
  const inv = useInvalidate();
  return useMutation({
    mutationFn: (body: UpdateProjectInput) => api<ProjectDto>('PATCH', `/projects/${p.id}`, { body, version: p.version }),
    onSuccess: inv,
  });
}

export function useArchiveProject(p: ProjectDto) {
  const inv = useInvalidate();
  return useMutation({
    mutationFn: (reason: string) =>
      api<ProjectDto>('POST', `/projects/${p.id}/${p.status === 'ACTIVE' ? 'archive' : 'unarchive'}`, {
        body: { reason },
        version: p.version,
      }),
    onSuccess: inv,
  });
}
