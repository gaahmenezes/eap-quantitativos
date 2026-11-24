import { StrictMode, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import '@fontsource/barlow/400.css';
import '@fontsource/barlow/500.css';
import '@fontsource/barlow-semi-condensed/600.css';
import '@fontsource/ibm-plex-mono/400.css';
import '@fontsource/ibm-plex-mono/500.css';
import './styles.css';
import { Shell } from './app/shell';
import { Loading, EmptyState } from './components/ui/feedback';
import { ApiError } from './lib/api';
import { AcceptInvitationPage, LoginPage, SignupPage } from './features/auth/auth-pages';
import { SessionProvider, useSession } from './features/auth/session';
import { DashboardPage } from './features/dashboard/dashboard-page';
import { ProjectsPage } from './features/projects/projects-page';
import { ProjectDetailPage } from './features/projects/project-detail';
import { AdminPage } from './features/admin/admin-page';
import { StructurePage } from './features/structure/structure-page';
import { WizardPage } from './features/structure/wizard-page';
import { InfrastructurePage } from './features/infrastructure/infrastructure-page';
import { ConstructivePage } from './features/constructive/constructive-page';
import { CatalogPage } from './features/catalog/catalog-page';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: (count, e) => !(e instanceof ApiError && e.status >= 400 && e.status < 500) && count < 2,
      refetchOnWindowFocus: false,
    },
  },
});

function RequireAuth({ children }: { children: ReactNode }) {
  const { me, loading } = useSession();
  const location = useLocation();
  if (loading) return <Loading label="Verificando sessão…" />;
  if (!me) return <Navigate to={`/entrar?voltar=${encodeURIComponent(location.pathname + location.search)}`} replace />;
  return children;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <SessionProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/entrar" element={<LoginPage />} />
            <Route path="/criar-conta" element={<SignupPage />} />
            <Route path="/convite" element={<AcceptInvitationPage />} />
            <Route element={<RequireAuth><Shell /></RequireAuth>}>
              <Route index element={<DashboardPage />} />
              <Route path="empreendimentos" element={<ProjectsPage />} />
              <Route path="empreendimentos/:projectId" element={<ProjectDetailPage />} />
              <Route path="empreendimentos/:projectId/cadastro" element={<StructurePage />} />
              <Route path="empreendimentos/:projectId/cadastro/assistente" element={<WizardPage />} />
              <Route path="empreendimentos/:projectId/infraestrutura" element={<InfrastructurePage />} />
              <Route path="empreendimentos/:projectId/construtivo" element={<ConstructivePage />} />
              <Route path="administracao" element={<AdminPage />} />
              <Route path="administracao/catalogo" element={<CatalogPage />} />
              <Route path="*" element={<EmptyState title="Página não encontrada">Verifique o endereço ou use o menu lateral.</EmptyState>} />
            </Route>
          </Routes>
        </BrowserRouter>
      </SessionProvider>
    </QueryClientProvider>
  </StrictMode>,
);
