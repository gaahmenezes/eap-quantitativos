import { createContext, useContext, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { MeResponse } from '@eapq/contracts';
import { api, ApiError, setCsrfToken } from '../../lib/api';

interface SessionValue {
  me: MeResponse | null;
  loading: boolean;
  can: (permission: string) => boolean;
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
}

const SessionContext = createContext<SessionValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: ['me'],
    queryFn: async () => {
      try {
        const me = await api<MeResponse>('GET', '/auth/me');
        // antes de qualquer tela usar a sessão: efeitos dos filhos rodam antes dos do provedor
        setCsrfToken(me.csrfToken);
        return me;
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) return null;
        throw e;
      }
    },
    staleTime: 60_000,
    retry: false,
  });
  const me = query.data ?? null;
  // mantém o token em sincronia também quando a sessão é atualizada por setQueryData (login)
  if (me?.csrfToken) setCsrfToken(me.csrfToken);

  const value: SessionValue = {
    me,
    loading: query.isPending,
    can: (p) => !!me?.permissions.includes(p),
    refresh: async () => {
      await qc.invalidateQueries({ queryKey: ['me'] });
      await qc.refetchQueries({ queryKey: ['me'] });
    },
    logout: async () => {
      try {
        await api('POST', '/auth/logout');
      } finally {
        setCsrfToken(null);
        qc.clear();
        qc.setQueryData(['me'], null);
      }
    },
  };
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionValue {
  const v = useContext(SessionContext);
  if (!v) throw new Error('useSession fora de SessionProvider');
  return v;
}
