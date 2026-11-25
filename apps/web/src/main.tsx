import { OperationsPage } from './features/operations/operations-page';
import { WorkbooksPage } from './features/workbooks/workbooks-page';
import { WorkbookWizardPage } from './features/workbooks/workbook-wizard';
import { SchedulesPage } from './features/schedules/schedules-page';
import { ScheduleEditorPage } from './features/schedules/schedule-editor';
import { SheetTemplatesPage } from './features/sheets/templates-page';
import { SheetsPage } from './features/sheets/sheets-page';
import { SheetEditorPage } from './features/sheets/sheet-editor';
import { ImportsPage } from './features/imports/imports-page';
import { RevisionsPage } from './features/revisions/revisions-page';
import { ConsolidationPage } from './features/consolidation/consolidation-page';
import { FormulasPage } from './features/measurements/formulas-page';
import { MemoriesPage } from './features/measurements/memories-page';
import { QuantitiesPage } from './features/measurements/quantities-page';
import { TemplatesPage } from './features/templates/templates-page';
import { WbsPage } from './features/wbs/wbs-page';
import { StrictMode, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, MemoryRouter, Navigate, Route, Routes, useLocation } from 'react-router';
import { DEMO, demoMeta, loadSnapshot } from './lib/demo';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import '@fontsource-variable/inter/opsz.css';
import '@fontsource-variable/jetbrains-mono/wght.css';
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
import { LibraryPage } from './features/library/library-page';

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

// Demonstração: rotas em memória (o endereço da página hospedeira não muda) e faixa de aviso.
const Router = DEMO ? MemoryRouter : BrowserRouter;

function DemoBanner() {
  if (!DEMO || !demoMeta) return null;
  return (
    <div role="note" className="sticky top-0 z-40 bg-signal px-4 py-1.5 text-center text-[13px] font-medium text-graphite-950">
      Demonstração somente leitura · dados reais criados e gravados pela aplicação em {new Date(demoMeta.recordedAt).toLocaleDateString('pt-BR')} · alterações, envios e downloads ficam desativados
    </div>
  );
}

async function start() {
  if (DEMO) await loadSnapshot();
  createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <SessionProvider>
        <Router>
          <DemoBanner />
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
              <Route path="empreendimentos/:projectId/eap" element={<WbsPage />} />
              <Route path="servicos" element={<LibraryPage />} />
              <Route path="templates" element={<TemplatesPage />} />
              <Route path="formulas" element={<FormulasPage />} />
              <Route path="fichas" element={<SheetTemplatesPage />} />
              <Route path="empreendimentos/:projectId/fichas" element={<SheetsPage />} />
              <Route path="empreendimentos/:projectId/fichas/:sheetId" element={<SheetEditorPage />} />
              <Route path="empreendimentos/:projectId/quadros" element={<SchedulesPage />} />
              <Route path="empreendimentos/:projectId/painel" element={<OperationsPage />} />
              <Route path="empreendimentos/:projectId/migracao" element={<WorkbooksPage />} />
              <Route path="empreendimentos/:projectId/migracao/:importId" element={<WorkbookWizardPage />} />
              <Route path="empreendimentos/:projectId/quadros/:scheduleId" element={<ScheduleEditorPage />} />
              <Route path="empreendimentos/:projectId/quantitativos" element={<QuantitiesPage />} />
              <Route path="empreendimentos/:projectId/memorias" element={<MemoriesPage />} />
              <Route path="empreendimentos/:projectId/consolidacoes" element={<ConsolidationPage />} />
              <Route path="empreendimentos/:projectId/revisoes" element={<RevisionsPage />} />
              <Route path="empreendimentos/:projectId/importacoes" element={<ImportsPage />} />
              <Route path="importacoes" element={<ImportsPage />} />
              <Route path="administracao" element={<AdminPage />} />
              <Route path="administracao/catalogo" element={<CatalogPage />} />
              <Route path="*" element={<EmptyState title="Página não encontrada">Verifique o endereço ou use o menu lateral.</EmptyState>} />
            </Route>
          </Routes>
        </Router>
      </SessionProvider>
    </QueryClientProvider>
  </StrictMode>,
);
}
void start();

