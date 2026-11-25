import { useEffect, useRef, useState } from 'react';
import { NavLink, Outlet, useLocation, useMatch, useNavigate } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { Check, ChevronRight, ChevronsUpDown, LogOut, Menu, PanelLeftClose, PanelLeftOpen, Search, X } from 'lucide-react';
import type { ProjectDto } from '@eapq/contracts';
import { api } from '../lib/api';
import { useSession } from '../features/auth/session';
import { CommandPalette } from './command-palette';
import { GLOBAL_GROUPS, PROJECT_GROUPS, type NavItem } from './nav';

const COLLAPSE_KEY = 'eapq.nav.collapsed';
const readCollapsed = () => { try { return localStorage.getItem(COLLAPSE_KEY) === '1'; } catch { return false; } };
function useDesktop() {
  const q = '(min-width: 768px)';
  const [m, setM] = useState(() => typeof window === 'undefined' || window.matchMedia(q).matches);
  useEffect(() => { const mq = window.matchMedia(q); const on = () => setM(mq.matches); mq.addEventListener('change', on); return () => mq.removeEventListener('change', on); }, []);
  return m;
}
const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

/** Marca: barras de prancha (níveis da EAP) sobre o acento. */
function Logomark({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden>
      <defs>
        <linearGradient id="lm" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#5b82ff" />
          <stop offset="1" stopColor="#2346c9" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="8" fill="url(#lm)" />
      <path d="M8 10h7M8 16h12M8 22h16" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" />
      <circle cx="22.5" cy="10" r="2.2" fill="#f2a93b" />
    </svg>
  );
}

function Item({ item, projectId, collapsed }: { item: NavItem; projectId?: string; collapsed: boolean }) {
  const to = item.projectPath ? (projectId ? `/empreendimentos/${projectId}/${item.projectPath}` : undefined) : item.to;
  if (!to) return null;
  const Icon = item.icon;
  return (
    <li>
      <NavLink
        to={to}
        end={to === '/' || to === '/empreendimentos'}
        title={collapsed ? item.label : undefined}
        className={({ isActive }) =>
          `group relative flex items-center gap-2.5 rounded-md py-[7px] text-[13.5px] transition-colors ${collapsed ? 'justify-center px-0' : 'px-2.5'} ${
            isActive ? 'bg-white/[0.08] text-white' : 'text-graphite-400 hover:bg-white/[0.04] hover:text-white'
          }`
        }
      >
        {({ isActive }) => (
          <>
            {isActive && <span className="absolute top-1.5 bottom-1.5 left-0 w-[3px] rounded-r bg-accent-on-dark" aria-hidden />}
            <Icon className={`h-[17px] w-[17px] shrink-0 ${isActive ? 'text-accent-on-dark' : 'text-graphite-400 group-hover:text-graphite-200'}`} strokeWidth={1.9} aria-hidden />
            <span className={collapsed ? 'sr-only' : 'truncate'}>{item.label}</span>
          </>
        )}
      </NavLink>
    </li>
  );
}

function Group({ label, children, collapsed }: { label: string; children: React.ReactNode; collapsed: boolean }) {
  return (
    <div className="mt-4 first:mt-0">
      {collapsed ? <div className="mx-auto mb-1.5 h-px w-6 bg-graphite-700" aria-hidden /> : (
        <p className="mb-1 px-2.5 text-[11px] font-medium tracking-[0.06em] text-graphite-600 uppercase">{label}</p>
      )}
      <ul className="flex flex-col gap-0.5">{children}</ul>
    </div>
  );
}

/** Seletor do empreendimento ativo, no topo do menu do empreendimento. */
function ProjectSwitcher({ project, collapsed }: { project?: ProjectDto; collapsed: boolean }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const navigate = useNavigate();
  const list = useQuery({ queryKey: ['switcher', 'projects'], queryFn: () => api<ProjectDto[]>('GET', '/projects?status=ACTIVE'), enabled: open, staleTime: 30_000 });
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);
  const shown = (list.data ?? []).filter((p) => !q || `${p.code} ${p.name}`.toLowerCase().includes(q.toLowerCase())).slice(0, 30);
  const initials = (project?.name ?? '?').split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase();
  return (
    <div ref={ref} className="relative">
      <button ref={btn} type="button" aria-haspopup="listbox" aria-expanded={open} aria-label={project ? `Empreendimento atual: ${project.code} ${project.name}. Trocar empreendimento` : 'Escolher empreendimento'}
        onClick={() => { const r = btn.current!.getBoundingClientRect(); setPos({ top: r.bottom + 6, left: r.left }); setOpen((o) => !o); setQ(''); }}
        className={`flex w-full items-center gap-2.5 rounded-lg border border-graphite-700 bg-graphite-800/70 text-left transition-colors hover:border-graphite-600 hover:bg-graphite-800 ${collapsed ? 'justify-center p-1.5' : 'px-2.5 py-2'}`}>
        <span className="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-graphite-700 text-[11px] font-semibold text-white">{project ? initials : '—'}</span>
        {!collapsed && (
          <>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px] font-medium text-white">{project?.name ?? 'Escolher empreendimento'}</span>
              <span className="block truncate font-mono text-[11.5px] text-graphite-400">{project?.code ?? 'nenhum selecionado'}</span>
            </span>
            <ChevronsUpDown className="h-4 w-4 shrink-0 text-graphite-400" aria-hidden />
          </>
        )}
      </button>
      {open && pos && (
        <div style={{ top: pos.top, left: pos.left }} onKeyDown={(e) => { if (e.key === 'Escape') setOpen(false); }}
          className="fixed z-50 w-[272px] rounded-lg border border-line bg-sheet p-1.5 text-ink shadow-[var(--shadow-pop)]">
          <input autoFocus aria-label="Buscar empreendimento" placeholder="Buscar empreendimento…" value={q} onChange={(e) => setQ(e.target.value)}
            className="mb-1 h-8 w-full rounded-md border border-line px-2.5 text-[13px] outline-none focus:border-cyan-ink focus:ring-[3px] focus:ring-cyan-ink/15 focus-visible:outline-none" />
          <ul role="listbox" aria-label="Empreendimentos ativos" className="max-h-72 overflow-y-auto">
            {list.isPending && <li className="px-2.5 py-2 text-[13px] text-muted">Carregando…</li>}
            {shown.map((p) => (
              <li key={p.id}>
                <button type="button" role="option" aria-selected={p.id === project?.id} onClick={() => { setOpen(false); navigate(`/empreendimentos/${p.id}/painel`); }}
                  className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[13px] hover:bg-cyan-wash">
                  <span className="min-w-0 flex-1"><span className="block truncate">{p.name}</span><span className="block font-mono text-[11.5px] text-muted">{p.code}</span></span>
                  {p.id === project?.id && <Check className="h-4 w-4 text-cyan-ink" aria-hidden />}
                </button>
              </li>
            ))}
            {!list.isPending && shown.length === 0 && <li className="px-2.5 py-2 text-[13px] text-muted">Nenhum empreendimento ativo.</li>}
          </ul>
          <button type="button" onClick={() => { setOpen(false); navigate('/empreendimentos'); }} className="mt-1 w-full rounded-md border-t border-line px-2.5 pt-2 pb-1 text-left text-[12.5px] text-cyan-ink hover:underline">
            Ver todos os empreendimentos
          </button>
        </div>
      )}
    </div>
  );
}

export function Shell() {
  const { me, logout } = useSession();
  const navigate = useNavigate();
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const [palette, setPalette] = useState(false);
  const desktop = useDesktop();
  useEffect(() => setMenuOpen(false), [location.pathname]);
  useEffect(() => { try { localStorage.setItem(COLLAPSE_KEY, collapsed ? '1' : '0'); } catch { /* armazenamento indisponível */ } }, [collapsed]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setPalette((p) => !p); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  const match = useMatch('/empreendimentos/:projectId/*');
  const projectId = match?.params.projectId;
  const project = useQuery({ queryKey: ['project', projectId], queryFn: () => api<ProjectDto>('GET', `/projects/${projectId}`), enabled: !!projectId });
  const narrow = collapsed && !menuOpen;
  const name = me?.user.name ?? '';
  const initials = name.split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase();

  return (
    <div className="flex min-h-dvh">
      {menuOpen && <div className="fixed inset-0 z-30 bg-graphite-950/40 md:hidden" onClick={() => setMenuOpen(false)} aria-hidden />}
      <aside inert={!desktop && !menuOpen} className={`fixed inset-y-0 left-0 z-40 flex flex-col bg-graphite-900 text-white transition-[width,transform] duration-200 md:sticky md:top-0 md:h-dvh md:translate-x-0 ${menuOpen ? 'translate-x-0' : '-translate-x-full'} ${narrow ? 'md:w-[68px]' : 'w-[264px]'}`}>
        <div className={`flex items-center gap-2.5 px-4 pt-4 pb-3 ${narrow ? 'md:justify-center md:px-0' : ''}`}>
          <Logomark className="h-8 w-8 shrink-0" />
          {!narrow && (
            <div className="min-w-0 flex-1">
              <p className="text-[15px] leading-tight font-semibold tracking-tight">EAP Quantitativos</p>
              <p className="truncate text-[12px] text-graphite-400">{me?.organization.name}</p>
            </div>
          )}
          <button type="button" className="ml-auto grid h-8 w-8 place-items-center rounded-md text-graphite-400 hover:bg-white/5 hover:text-white md:hidden" aria-label="Fechar menu" onClick={() => setMenuOpen(false)}>
            <X className="h-[18px] w-[18px]" aria-hidden />
          </button>
        </div>
        <nav id="nav-principal" aria-label="Navegação principal" className={`flex-1 overflow-y-auto pb-4 ${narrow ? 'px-2.5' : 'px-3'}`}>
          {GLOBAL_GROUPS.map((g) => (
            <Group key={g.label} label={g.label} collapsed={narrow}>{g.items.map((i) => <Item key={i.label} item={i} collapsed={narrow} />)}</Group>
          ))}
          <div className="mt-5 border-t border-graphite-800 pt-4">
            <p className={`mb-2 px-2.5 text-[11px] font-medium tracking-[0.06em] text-graphite-600 uppercase ${narrow ? 'sr-only' : ''}`}>Empreendimento</p>
            <ProjectSwitcher project={project.data} collapsed={narrow} />
            {projectId && PROJECT_GROUPS.map((g) => (
              <Group key={g.label} label={g.label} collapsed={narrow}>{g.items.map((i) => <Item key={i.label} item={i} projectId={projectId} collapsed={narrow} />)}</Group>
            ))}
          </div>
        </nav>
        <div className={`flex items-center gap-2.5 border-t border-graphite-800 px-3 py-3 ${narrow ? 'flex-col' : ''}`}>
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-gradient-to-br from-graphite-600 to-graphite-700 text-[12px] font-semibold" title={me?.user.email} aria-hidden>{initials}</span>
          {!narrow && (
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13px] font-medium" title={me?.user.email}>{name}</p>
              <p className="truncate text-[11.5px] text-graphite-400">{me?.orgRole === 'OWNER' ? 'Proprietário' : me?.orgRole === 'ADMIN' ? 'Administrador' : 'Membro'}</p>
            </div>
          )}
          <button type="button" title="Sair" className="grid h-8 shrink-0 place-items-center gap-1.5 rounded-md px-2 text-[12.5px] text-graphite-400 hover:bg-white/5 hover:text-white"
            onClick={async () => { await logout(); navigate('/entrar'); }}>
            <span className="flex items-center gap-1.5"><LogOut className="h-4 w-4" aria-hidden /><span className={narrow ? 'sr-only' : ''}>Sair</span></span>
          </button>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-line/80 bg-paper/80 px-4 backdrop-blur-md md:px-8">
          <button type="button" className="grid h-9 w-9 place-items-center rounded-md text-muted hover:bg-sheet md:hidden" aria-label="Menu" aria-expanded={menuOpen} aria-controls="nav-principal" onClick={() => setMenuOpen(true)}>
            <Menu className="h-5 w-5" aria-hidden />
          </button>
          <button type="button" className="hidden h-8 w-8 place-items-center rounded-md text-muted transition-colors hover:bg-sheet hover:text-ink md:grid"
            aria-label={collapsed ? 'Expandir menu' : 'Recolher menu'} title={collapsed ? 'Expandir menu' : 'Recolher menu'} onClick={() => setCollapsed((c) => !c)}>
            {collapsed ? <PanelLeftOpen className="h-[18px] w-[18px]" aria-hidden /> : <PanelLeftClose className="h-[18px] w-[18px]" aria-hidden />}
          </button>
          {project.data && (
            <p className="hidden min-w-0 truncate text-[13px] text-muted sm:block">
              <span className="font-mono text-ink/70">{project.data.code}</span> <span className="text-ink">{project.data.name}</span>
            </p>
          )}
          <button type="button" onClick={() => setPalette(true)} aria-label="Buscar e ir para (Ctrl+K)"
            className="ml-auto flex h-9 w-full max-w-[340px] items-center gap-2 rounded-lg border border-line bg-sheet px-3 text-[13.5px] text-muted shadow-xs transition-colors hover:border-line-strong">
            <Search className="h-4 w-4 shrink-0" aria-hidden />
            <span className="flex-1 truncate text-left">Buscar ou ir para…</span>
            <kbd className="hidden rounded border border-line bg-paper px-1.5 py-0.5 font-sans text-[11px] sm:inline">{isMac ? '⌘' : 'Ctrl'} K</kbd>
          </button>
        </header>
        <main className="min-w-0 flex-1 px-4 py-6 md:px-8 md:py-7">
          <div className="mx-auto w-full max-w-[1600px]">
            <Outlet />
          </div>
        </main>
      </div>
      <CommandPalette open={palette} onClose={() => setPalette(false)} projectId={projectId} project={project.data} />
    </div>
  );
}

export function Breadcrumbs({ items }: { items: { label: string; to?: string }[] }) {
  return (
    <nav aria-label="Trilha" className="mb-3 text-[13px] text-muted">
      <ol className="flex flex-wrap items-center gap-1">
        {items.map((it, i) => (
          <li key={i} className="flex min-w-0 items-center gap-1">
            {i > 0 && <ChevronRight className="h-3.5 w-3.5 shrink-0 text-graphite-400" aria-hidden />}
            {it.to ? (
              <NavLink to={it.to} className="truncate rounded px-1 py-0.5 transition-colors hover:bg-sheet hover:text-ink">
                {it.label}
              </NavLink>
            ) : (
              <span aria-current="page" className="truncate px-1 font-medium text-ink">
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
    <div className="mb-6 flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
      <div className="min-w-0">
        <h1 className="text-[26px] leading-tight font-semibold tracking-[-0.022em] text-ink">{title}</h1>
        {children && <div className="mt-1.5 max-w-[80ch] text-[14px] text-muted">{children}</div>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}
