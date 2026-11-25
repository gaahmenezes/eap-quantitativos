import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation, useMatch, useNavigate } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import type { ProjectDto } from '@eapq/contracts';
import { api } from '../lib/api';
import { useSession } from '../features/auth/session';

interface NavItem {
  label: string;
  to?: string;
  /** Caminho relativo ao empreendimento selecionado. */
  projectPath?: string;
  /** Fase do plano em que o módulo será entregue (itens ainda não navegáveis). */
  phase?: number;
}

const GLOBAL: NavItem[] = [
  { label: 'Dashboard', to: '/' },
  { label: 'Empreendimentos', to: '/empreendimentos' },
  { label: 'Biblioteca de serviços', to: '/servicos' },
  { label: 'Templates de EAP', to: '/templates' },
  { label: 'Fórmulas', to: '/formulas' },
  { label: 'Modelos de ficha', to: '/fichas' },
  { label: 'Administração', to: '/administracao' },
];

const PROJECT: NavItem[] = [
  { label: 'Centro operacional', projectPath: 'painel' },
  { label: 'Cadastro físico', projectPath: 'cadastro' },
  { label: 'Infraestrutura', projectPath: 'infraestrutura' },
  { label: 'Construtivo', projectPath: 'construtivo' },
  { label: 'EAP', projectPath: 'eap' },
  { label: 'Fichas de levantamento', projectPath: 'fichas' },
  { label: 'Quadros de componentes', projectPath: 'quadros' },
  { label: 'Quantitativos', projectPath: 'quantitativos' },
  { label: 'Memórias de cálculo', projectPath: 'memorias' },
  { label: 'Consolidações', projectPath: 'consolidacoes' },
  { label: 'Revisões', projectPath: 'revisoes' },
  { label: 'Importações', projectPath: 'importacoes' },
  { label: 'Migração de planilhas', projectPath: 'migracao' },
];

function Item({ item: raw, projectId }: { item: NavItem; projectId?: string }) {
  const item = raw.projectPath ? { ...raw, to: projectId ? `/empreendimentos/${projectId}/${raw.projectPath}` : undefined } : raw;
  if (!item.to) {
    return (
      <li>
        <span
          aria-disabled="true"
          title={item.phase ? `Módulo previsto para a fase ${item.phase}` : 'Selecione um empreendimento'}
          className="flex items-center justify-between px-4 py-1.5 text-[14px] text-graphite-400"
        >
          {item.label}
          {item.phase && <span className="text-[11.5px] text-graphite-600">fase {item.phase}</span>}
        </span>
      </li>
    );
  }
  return (
    <li>
      <NavLink
        to={item.to}
        end={item.to === '/'}
        className={({ isActive }) =>
          `block border-l-[3px] px-[13px] py-1.5 text-[14px] ${
            isActive ? 'border-signal bg-graphite-800 text-white' : 'border-transparent text-graphite-400 hover:text-white'
          }`
        }
      >
        {item.label}
      </NavLink>
    </li>
  );
}

export function Shell() {
  const { me, logout } = useSession();
  const navigate = useNavigate();
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  useEffect(() => setMenuOpen(false), [location.pathname]);
  const match = useMatch('/empreendimentos/:projectId/*');
  const projectId = match?.params.projectId;
  const project = useQuery({
    queryKey: ['project', projectId],
    queryFn: () => api<ProjectDto>('GET', `/projects/${projectId}`),
    enabled: !!projectId,
  });

  return (
    <div className="flex min-h-dvh flex-col md:flex-row">
      <aside className="flex shrink-0 flex-col bg-graphite-900 text-white md:sticky md:top-0 md:h-dvh md:w-[248px]">
        <div className="flex items-center justify-between gap-3 border-b border-graphite-800 px-4 py-3 md:py-4">
          <div className="min-w-0">
            <p className="font-display text-[19px] font-semibold leading-tight tracking-tight">EAP Quantitativos</p>
            <p className="mt-0.5 truncate text-[12.5px] text-graphite-400">{me?.organization.name}</p>
          </div>
          <button
            type="button"
            className="rounded border border-graphite-600 px-2.5 py-1 text-[13px] md:hidden"
            aria-expanded={menuOpen}
            aria-controls="nav-principal"
            onClick={() => setMenuOpen((v) => !v)}
          >
            {menuOpen ? 'Fechar menu' : 'Menu'}
          </button>
        </div>
        <nav id="nav-principal" aria-label="Navegação principal" className={`${menuOpen ? 'block' : 'hidden'} flex-1 overflow-y-auto py-3 md:block`}>
          <ul>{GLOBAL.map((i) => <Item key={i.label} item={i} />)}</ul>
          <div className="mt-5 px-4 pb-1.5 text-[12px] text-graphite-400">
            {projectId ? (
              <span className="block truncate">
                Empreendimento{' '}
                <span className="font-mono text-white">{project.data?.code ?? '…'}</span>
              </span>
            ) : (
              'Selecione um empreendimento'
            )}
          </div>
          <ul>{PROJECT.map((i) => <Item key={i.label} item={i} projectId={projectId} />)}</ul>
        </nav>
        <div className={`${menuOpen ? 'flex' : 'hidden'} items-center justify-between gap-2 border-t border-graphite-800 px-4 py-3 text-[13px] md:flex`}>
          <span className="truncate text-graphite-400" title={me?.user.email}>
            {me?.user.name}
          </span>
          <button
            type="button"
            className="shrink-0 text-graphite-400 hover:text-white"
            onClick={async () => {
              await logout();
              navigate('/entrar');
            }}
          >
            Sair
          </button>
        </div>
      </aside>
      <main className="min-w-0 flex-1 px-4 py-5 md:px-8 md:py-6">
        <Outlet />
      </main>
    </div>
  );
}

export function Breadcrumbs({ items }: { items: { label: string; to?: string }[] }) {
  return (
    <nav aria-label="Trilha" className="mb-2 text-[13px] text-muted">
      <ol className="flex flex-wrap items-center gap-1.5">
        {items.map((it, i) => (
          <li key={i} className="flex items-center gap-1.5">
            {i > 0 && <span aria-hidden>/</span>}
            {it.to ? (
              <NavLink to={it.to} className="hover:text-cyan-ink hover:underline">
                {it.label}
              </NavLink>
            ) : (
              <span aria-current="page" className="text-ink">
                {it.label}
              </span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}

export function PageHeader({ title, actions, children }: { title: string; actions?: React.ReactNode; children?: React.ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3 border-b border-line pb-4">
      <div>
        <h1 className="font-display text-[28px] font-semibold leading-tight tracking-tight">{title}</h1>
        {children && <div className="mt-1 text-[14px] text-muted">{children}</div>}
      </div>
      {actions && <div className="flex gap-2">{actions}</div>}
    </div>
  );
}
