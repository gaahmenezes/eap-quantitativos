import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { Building2, CornerDownLeft, FileSpreadsheet, Grid3x3, Search, type LucideIcon } from 'lucide-react';
import type { ProjectDto, ScheduleListItemDto, SheetListItemDto } from '@eapq/contracts';
import { api } from '../lib/api';
import { GLOBAL_GROUPS, PROJECT_GROUPS } from './nav';

interface Cmd { id: string; label: string; hint?: string; group: string; icon: LucideIcon; to: string; keywords?: string }
const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** Busca e comandos (Ctrl+K): páginas, empreendimentos e, dentro de um, fichas e quadros. */
export function CommandPalette({ open, onClose, projectId, project }: { open: boolean; onClose: () => void; projectId?: string; project?: ProjectDto }) {
  const ref = useRef<HTMLDialogElement>(null);
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const projects = useQuery({ queryKey: ['palette', 'projects'], queryFn: () => api<ProjectDto[]>('GET', '/projects?status=ACTIVE'), enabled: open, staleTime: 30_000 });
  const sheets = useQuery({ queryKey: ['project', projectId, 'sheets', 'list', false], queryFn: () => api<SheetListItemDto[]>('GET', `/projects/${projectId}/sheets`), enabled: open && !!projectId });
  const schedules = useQuery({ queryKey: ['project', projectId, 'schedules', 'list', false], queryFn: () => api<ScheduleListItemDto[]>('GET', `/projects/${projectId}/schedules`), enabled: open && !!projectId });

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) { d.showModal(); setQ(''); setActive(0); }
    if (!open && d.open) d.close();
  }, [open]);

  const all = useMemo<Cmd[]>(() => {
    const out: Cmd[] = [];
    if (projectId) for (const g of PROJECT_GROUPS) for (const i of g.items) out.push({ id: `p:${i.projectPath}`, label: i.label, hint: project ? project.code : undefined, group: 'Neste empreendimento', icon: i.icon, to: `/empreendimentos/${projectId}/${i.projectPath}`, keywords: i.keywords });
    for (const s of sheets.data ?? []) out.push({ id: `s:${s.id}`, label: s.title, hint: `Ficha ${s.templateCode}`, group: 'Fichas e quadros', icon: FileSpreadsheet, to: `/empreendimentos/${projectId}/fichas/${s.id}` });
    for (const s of schedules.data ?? []) out.push({ id: `q:${s.id}`, label: s.title, hint: 'Quadro', group: 'Fichas e quadros', icon: Grid3x3, to: `/empreendimentos/${projectId}/quadros/${s.id}` });
    for (const g of GLOBAL_GROUPS) for (const i of g.items) out.push({ id: `g:${i.to}`, label: i.label, group: 'Páginas', icon: i.icon, to: i.to!, keywords: i.keywords });
    for (const p of projects.data ?? []) out.push({ id: `e:${p.id}`, label: p.name, hint: p.code, group: 'Empreendimentos', icon: Building2, to: `/empreendimentos/${p.id}/painel`, keywords: p.code });
    return out;
  }, [projectId, project, sheets.data, schedules.data, projects.data]);
  const terms = norm(q).split(/\s+/).filter(Boolean);
  const shown = all.filter((c) => terms.every((t) => norm(`${c.label} ${c.hint ?? ''} ${c.keywords ?? ''}`).includes(t))).slice(0, 40);
  const groups = [...new Set(shown.map((c) => c.group))];
  const go = (c: Cmd | undefined) => { if (!c) return; onClose(); navigate(c.to); };

  return (
    <dialog ref={ref} onClose={onClose} aria-label="Buscar e ir para" className="mx-auto mt-[12vh] mb-auto w-[min(640px,calc(100vw-32px))] border border-line bg-sheet p-0 text-ink backdrop:bg-graphite-950/35"
      onClick={(e) => { if (e.target === ref.current) onClose(); }}>
      {open && (
        <div>
          <div className="flex items-center gap-2.5 border-b border-line px-4">
            <Search className="h-[18px] w-[18px] shrink-0 text-muted" aria-hidden />
            <input autoFocus aria-label="Buscar" placeholder="Buscar páginas, empreendimentos, fichas e quadros…" value={q}
              onChange={(e) => { setQ(e.target.value); setActive(0); }}
              onKeyDown={(e) => {
                if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(a + 1, shown.length - 1)); }
                else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
                else if (e.key === 'Enter') { e.preventDefault(); go(shown[active]); }
              }}
              className="h-12 flex-1 bg-transparent text-[15px] outline-none placeholder:text-graphite-400 focus-visible:outline-none" />
            <kbd className="rounded border border-line px-1.5 py-0.5 text-[11px] text-muted">Esc</kbd>
          </div>
          <div role="listbox" aria-label="Resultados" className="max-h-[min(420px,60vh)] overflow-y-auto p-2">
            {shown.length === 0 && <p className="px-3 py-6 text-center text-[13.5px] text-muted">Nada encontrado para "{q}".</p>}
            {groups.map((g) => (
              <div key={g} className="mb-1">
                <p className="px-2.5 pt-2 pb-1 text-[11.5px] font-medium tracking-wide text-muted uppercase">{g}</p>
                {shown.filter((c) => c.group === g).map((c) => {
                  const i = shown.indexOf(c);
                  const Icon = c.icon;
                  return (
                    <button key={c.id} type="button" role="option" aria-selected={i === active} onMouseMove={() => setActive(i)} onClick={() => go(c)}
                      className={`flex w-full items-center gap-3 rounded-md px-2.5 py-2 text-left text-[14px] ${i === active ? 'bg-cyan-wash text-ink' : 'text-ink/90'}`}>
                      <Icon className={`h-4 w-4 shrink-0 ${i === active ? 'text-cyan-ink' : 'text-muted'}`} aria-hidden />
                      <span className="min-w-0 flex-1 truncate">{c.label}</span>
                      {c.hint && <span className="shrink-0 font-mono text-[12px] text-muted">{c.hint}</span>}
                      {i === active && <CornerDownLeft className="h-3.5 w-3.5 shrink-0 text-muted" aria-hidden />}
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
          <div className="flex items-center gap-4 rounded-b-xl border-t border-line bg-paper/60 px-4 py-2 text-[12px] text-muted">
            <span><kbd className="font-sans">↑↓</kbd> navegar</span><span><kbd className="font-sans">Enter</kbd> abrir</span><span className="ml-auto"><kbd className="font-sans">Ctrl K</kbd> abre de qualquer lugar</span>
          </div>
        </div>
      )}
    </dialog>
  );
}
