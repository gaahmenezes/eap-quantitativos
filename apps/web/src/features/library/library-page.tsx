import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import type { CategoryDto, ProjectDto, ServiceDto, ServiceSaveResult, SimilarServiceDto, UnitDto } from '@eapq/contracts';
import { baseUnitSymbol, compareUnitsForDisplay, describeDimension, projectPermissions } from '@eapq/domain';
import { Breadcrumbs, PageHeader } from '../../app/shell';
import { useAction } from '../../components/ui/actions';
import { Button } from '../../components/ui/button';
import { EmptyState, ErrorState, Loading, Notice } from '../../components/ui/feedback';
import { SelectField, TextArea, TextField } from '../../components/ui/field';
import { SidePanel } from '../../components/ui/panel';
import { api, errorMessage } from '../../lib/api';
import { useSession } from '../auth/session';
import { useProjects } from '../projects/api';
import { ExportButton } from '../../components/export-button';
import { categoryTree, libKeys, useCategories, useServices, useUnits } from './api';

const ORIGIN = { CATALOG: 'Catálogo', PROJECT: 'Empreendimento', DUPLICATE: 'Duplicado', IMPORT: 'Importado' } as const;
const PAGE = 50;

export function LibraryPage() {
  const [params, setParams] = useSearchParams();
  const tab = params.get('aba') ?? 'servicos';
  const tabs = [['servicos', 'Serviços'], ['categorias', 'Categorias'], ['unidades', 'Unidades de medida']] as const;
  return (
    <>
      <Breadcrumbs items={[{ label: 'Biblioteca de serviços' }]} />
      <PageHeader title="Biblioteca de serviços">Serviços técnicos quantificáveis, com unidade e critério de medição. Sem preços ou custos.</PageHeader>
      <div role="tablist" aria-label="Seções da biblioteca" className="mb-4 flex gap-1 border-b border-line">
        {tabs.map(([id, label]) => (
          <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => setParams(id === 'servicos' ? {} : { aba: id }, { replace: true })}
            className={`-mb-px border-b-2 px-3 py-2 text-[14px] ${tab === id ? 'border-cyan-ink font-medium' : 'border-transparent text-muted hover:text-ink'}`}>{label}</button>
        ))}
      </div>
      {tab === 'categorias' ? <CategoriesTab /> : tab === 'unidades' ? <UnitsTab /> : <ServicesTab />}
    </>
  );
}

// ------------------------------------------------------------------ serviços

function ServicesTab() {
  const { me, can } = useSession();
  const units = useUnits();
  const cats = useCategories();
  const projects = useProjects({ status: 'ACTIVE' });
  const [scope, setScope] = useState<string>('catalog');
  const [category, setCategory] = useState('');
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  const [unit, setUnit] = useState('');
  const [status, setStatus] = useState<'ACTIVE' | 'ARCHIVED' | 'ALL'>('ACTIVE');
  const [offset, setOffset] = useState(0);
  const [panel, setPanel] = useState<ServiceDto | 'new' | null>(null);
  useEffect(() => { const t = setTimeout(() => { setDebounced(q); setOffset(0); }, 250); return () => clearTimeout(t); }, [q]);
  const projectId = scope === 'catalog' ? null : scope;
  const list = useServices(projectId, { q: debounced, categoryId: category || undefined, unitId: unit || undefined, status, offset, limit: PAGE, scope: projectId ? 'ALL' : undefined });
  if (units.isPending || cats.isPending || projects.isPending) return <Loading />;
  const failed = [units, cats, projects].find((x) => x.isError);
  if (failed) return <ErrorState message={errorMessage(failed.error)} onRetry={() => failed.refetch()} />;
  const project = projects.data!.find((p) => p.id === projectId) ?? null;
  const canEditCatalog = can('org.manage');
  const canEditProject = !!project && projectPermissions(me!.orgRole, project.myProjectRole).has('project.content.edit');
  const canEdit = projectId ? canEditProject : canEditCatalog;
  const tree = categoryTree(cats.data!.filter((c) => !c.archivedAt));
  const catName = new Map(cats.data!.map((c) => [c.id, c.name]));
  const canEditRow = (s: ServiceDto) => (s.projectId ? canEditProject : canEditCatalog);

  return (
    <div className="grid gap-4 lg:grid-cols-[250px_minmax(0,1fr)]">
      <aside className="flex flex-col gap-3 self-start">
        <SelectField label="Escopo" value={scope} onChange={(e) => { setScope(e.target.value); setOffset(0); }}
          hint={projectId ? 'Mostra o catálogo da organização e os serviços específicos deste empreendimento.' : undefined}>
          <option value="catalog">Catálogo da organização</option>
          {projects.data!.map((p: ProjectDto) => <option key={p.id} value={p.id}>{p.code} · {p.name}</option>)}
        </SelectField>
        <nav aria-label="Categorias" className="border border-line bg-sheet">
          <ul>
            <li><CatButton active={category === ''} depth={0} label="Todas as categorias" onClick={() => { setCategory(''); setOffset(0); }} /></li>
            {tree.map((c) => <li key={c.id}><CatButton active={category === c.id} depth={c.depth} label={c.name} count={projectId ? undefined : c.serviceCount} onClick={() => { setCategory(c.id); setOffset(0); }} /></li>)}
          </ul>
        </nav>
      </aside>
      <section className="min-w-0">
        <div role="search" className="mb-3 flex flex-wrap items-end gap-2">
          <label className="flex min-w-0 flex-1 flex-col gap-1 text-[13px] font-medium text-graphite-800">Buscar
            <input type="search" aria-label="Buscar serviços" placeholder="Código ou descrição" value={q} onChange={(e) => setQ(e.target.value)} className="h-9 rounded-[3px] border border-line-strong bg-sheet px-2.5 text-[14px] font-normal" />
          </label>
          <label className="flex flex-col gap-1 text-[13px] font-medium text-graphite-800">Unidade
            <select aria-label="Filtrar por unidade" value={unit} onChange={(e) => { setUnit(e.target.value); setOffset(0); }} className="h-9 rounded-[3px] border border-line-strong bg-sheet px-2 font-mono text-[14px] font-normal">
              <option value="">Todas</option>{units.data!.filter((u) => !u.archivedAt).map((u) => <option key={u.id} value={u.id}>{u.symbol}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-[13px] font-medium text-graphite-800">Situação
            <select aria-label="Filtrar por situação" value={status} onChange={(e) => { setStatus(e.target.value as typeof status); setOffset(0); }} className="h-9 rounded-[3px] border border-line-strong bg-sheet px-2 text-[14px] font-normal">
              <option value="ACTIVE">Ativos</option><option value="ARCHIVED">Arquivados</option><option value="ALL">Todos</option>
            </select>
          </label>
          <ExportButton path={projectId ? `/projects/${projectId}/exports` : '/exports'} body={{ report: 'services' }} />
          {canEdit && <Link to={projectId ? `/empreendimentos/${projectId}/importacoes` : '/importacoes'} className="inline-flex h-9 items-center rounded-[3px] border border-line-strong bg-sheet px-3.5 text-[14px] hover:bg-paper">Importar</Link>}
          {canEdit && <Button variant="primary" onClick={() => setPanel('new')}>{projectId ? 'Novo serviço do empreendimento' : 'Novo serviço'}</Button>}
        </div>
        {list.isPending ? <Loading /> : list.isError ? <ErrorState message={errorMessage(list.error)} onRetry={() => list.refetch()} /> : list.data.total === 0 ? (
          <EmptyState title="Nenhum serviço encontrado">{debounced || category || unit ? 'Ajuste a busca ou os filtros.' : 'Cadastre o primeiro serviço desta biblioteca.'}</EmptyState>
        ) : (
          <>
            <div className="overflow-x-auto border border-line bg-sheet">
              <table className="w-full text-left text-[14px]">
                <thead className="border-b border-line-strong text-[13px] text-muted"><tr>
                  <th className="px-3 py-2 font-medium">Código</th><th className="px-3 py-2 font-medium">Descrição</th><th className="px-3 py-2 font-medium">Un.</th>
                  <th className="px-3 py-2 font-medium">Categoria</th><th className="px-3 py-2 font-medium">Origem</th>
                </tr></thead>
                <tbody>
                  {list.data.items.map((s) => (
                    <tr key={s.id} className={`cursor-pointer border-b border-line last:border-0 hover:bg-cyan-wash ${s.archivedAt ? 'text-graphite-400' : ''}`} onClick={() => setPanel(s)}>
                      <td className="whitespace-nowrap px-3 py-1.5 font-mono text-[13px]">{s.code}</td>
                      <td className="px-3 py-1.5">{s.description}{s.archivedAt && <span className="ml-2 text-[12px]">arquivado</span>}</td>
                      <td className="px-3 py-1.5 font-mono">{s.unitSymbol}</td>
                      <td className="px-3 py-1.5 text-[13px]">{catName.get(s.categoryId)}</td>
                      <td className="whitespace-nowrap px-3 py-1.5 text-[13px]">{s.projectId ? 'Empreendimento' : ORIGIN[s.origin]}{s.derivedFrom && <span className="text-muted"> de {s.derivedFrom.code}</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mt-2 flex items-center justify-between text-[13px] text-muted">
              <span><span className="font-mono text-ink">{offset + 1}–{Math.min(offset + PAGE, list.data.total)}</span> de <span className="font-mono text-ink">{list.data.total}</span></span>
              <span className="flex gap-2">
                <Button disabled={offset === 0} onClick={() => setOffset((o) => Math.max(0, o - PAGE))}>Anterior</Button>
                <Button disabled={offset + PAGE >= list.data.total} onClick={() => setOffset((o) => o + PAGE)}>Próxima</Button>
              </span>
            </div>
          </>
        )}
      </section>
      <SidePanel open={!!panel} title={panel === 'new' ? (projectId ? `Novo serviço — ${project?.code}` : 'Novo serviço do catálogo') : panel ? `Serviço ${panel.code}` : ''} onClose={() => setPanel(null)}>
        {panel && (
          <ServicePanel key={panel === 'new' ? 'new' : panel.id + panel.version} service={panel === 'new' ? null : panel} projectId={panel === 'new' ? projectId : panel.projectId}
            contextProjectId={projectId} units={units.data!} cats={cats.data!} canEdit={panel === 'new' ? canEdit : canEditRow(panel)} canDuplicateToProject={canEditProject} canDuplicateToCatalog={canEditCatalog}
            onClose={() => setPanel(null)} />
        )}
      </SidePanel>
    </div>
  );
}

function CatButton({ active, depth, label, count, onClick }: { active: boolean; depth: number; label: string; count?: number; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} aria-current={active ? 'true' : undefined}
      className={`flex w-full items-baseline justify-between gap-2 border-l-[3px] py-1.5 pr-3 text-left text-[14px] ${active ? 'border-signal bg-cyan-wash' : 'border-transparent hover:bg-paper'}`}
      style={{ paddingLeft: 10 + depth * 14 }}>
      <span className={depth === 0 ? 'font-medium' : ''}>{label}</span>
      {count !== undefined && <span className="font-mono text-[12px] text-muted">{count}</span>}
    </button>
  );
}

function unitOptions(units: UnitDto[], current?: string) {
  const groups = new Map<string, UnitDto[]>();
  for (const u of units.filter((x) => !x.archivedAt || x.id === current)) groups.set(u.quantity, [...(groups.get(u.quantity) ?? []), u]);
  return [...groups.entries()].map(([g, us]) => (
    <optgroup key={g} label={g}>{us.map((u) => <option key={u.id} value={u.id}>{u.symbol} — {u.name}</option>)}</optgroup>
  ));
}

function ServicePanel({ service, projectId, contextProjectId, units, cats, canEdit, canDuplicateToProject, canDuplicateToCatalog, onClose }: {
  service: ServiceDto | null; projectId: string | null; contextProjectId: string | null; units: UnitDto[]; cats: CategoryDto[];
  canEdit: boolean; canDuplicateToProject: boolean; canDuplicateToCatalog: boolean; onClose: () => void;
}) {
  const editable = canEdit && !service?.archivedAt;
  const [v, setV] = useState({
    code: service?.code ?? '',
    description: service?.description ?? '',
    categoryId: service?.categoryId ?? '',
    unitId: service?.unitId ?? '',
    measurementCriterion: service?.measurementCriterion ?? '',
    technicalDescription: service?.technicalDescription ?? '',
    reason: '',
  });
  const [similar, setSimilar] = useState<SimilarServiceDto[]>([]);
  const [saved, setSaved] = useState<string | null>(null);
  const [dupCode, setDupCode] = useState('');
  const act = useAction([['services']]);
  const base = projectId ? `/projects/${projectId}/services` : '/catalog/services';
  const set = (k: keyof typeof v) => (e: { target: { value: string } }) => setV((x) => ({ ...x, [k]: e.target.value }));
  const tree = useMemo(() => categoryTree(cats.filter((c) => !c.archivedAt || c.id === service?.categoryId)), [cats, service?.categoryId]);

  // Aviso de possível duplicidade enquanto digita (não bloqueia o cadastro).
  useEffect(() => {
    if (!editable || v.description.trim().length < 6 || v.description === service?.description) { setSimilar([]); return; }
    const t = setTimeout(async () => {
      const qs = new URLSearchParams({ description: v.description, ...(service ? { excludeId: service.id } : {}) });
      try { setSimilar(await api<SimilarServiceDto[]>('GET', `${contextProjectId ? `/projects/${contextProjectId}/services` : '/catalog/services'}/similar?${qs}`)); } catch { setSimilar([]); }
    }, 400);
    return () => clearTimeout(t);
  }, [v.description, editable, service, contextProjectId]);

  const fe = act.fieldErrors;
  const body = {
    code: v.code.trim(), description: v.description.trim(), categoryId: v.categoryId, unitId: v.unitId,
    measurementCriterion: v.measurementCriterion.trim() || null, technicalDescription: v.technicalDescription.trim() || null,
  };
  return (
    <div className="flex flex-col gap-4">
      {service && (
        <p className="text-[13px] text-muted">
          {service.projectId ? 'Específico do empreendimento' : 'Catálogo da organização'} · origem: {ORIGIN[service.origin]}{service.derivedFrom ? ` de ${service.derivedFrom.code}` : ''}
          {service.archivedAt ? ' · arquivado' : ''}
        </p>
      )}
      {saved && <Notice tone="ok">{saved}</Notice>}
      {act.error && <Notice tone="danger">{act.error}</Notice>}
      <form className="flex flex-col gap-4" onSubmit={async (e) => {
        e.preventDefault();
        setSaved(null);
        const r = await act.run(() => service
          ? api<ServiceSaveResult>('PATCH', `${base}/${service.id}`, { body: { ...body, reason: v.reason.trim() || null }, version: service.version })
          : api<ServiceSaveResult>('POST', base, { body }));
        if (r && r !== true) {
          if (!service) onClose();
          else setSaved('Serviço salvo.');
        }
      }}>
        <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-3">
          <TextField label="Código" className="font-mono uppercase" value={v.code} onChange={set('code')} disabled={!editable} error={fe.code} />
          <SelectField label="Unidade" className="font-mono" value={v.unitId} onChange={set('unitId')} disabled={!editable} error={fe.unitId}>
            <option value="">Selecione</option>{unitOptions(units, service?.unitId)}
          </SelectField>
        </div>
        <TextField label="Descrição" value={v.description} onChange={set('description')} disabled={!editable} error={fe.description} />
        {similar.length > 0 && (
          <Notice tone="warn">
            <p className="font-medium">Serviços com descrição parecida já cadastrados:</p>
            <ul className="mt-1">{similar.map((s) => <li key={s.id}><span className="font-mono">{s.code}</span> {s.description} <span className="font-mono">({s.unitSymbol})</span>{s.projectId ? ' — do empreendimento' : ''}</li>)}</ul>
            <p className="mt-1">Se for um serviço tecnicamente diferente, você pode salvar normalmente.</p>
          </Notice>
        )}
        <SelectField label="Categoria" value={v.categoryId} onChange={set('categoryId')} disabled={!editable} error={fe.categoryId}>
          <option value="">Selecione</option>
          {tree.map((c) => <option key={c.id} value={c.id}>{'  '.repeat(c.depth)}{c.name}</option>)}
        </SelectField>
        <TextArea label="Critério de medição" value={v.measurementCriterion} onChange={set('measurementCriterion')} disabled={!editable} hint="Como a quantidade é medida (ex.: área líquida descontando vãos maiores que 2 m²)." />
        <TextArea label="Descrição técnica" value={v.technicalDescription} onChange={set('technicalDescription')} disabled={!editable} />
        {service && editable && <TextField label="Motivo da alteração (opcional)" value={v.reason} onChange={set('reason')} />}
        {editable && <div><Button type="submit" variant="primary" busy={act.pending} disabled={!body.code || !body.description || !body.categoryId || !body.unitId}>{service ? 'Salvar alterações' : 'Cadastrar serviço'}</Button></div>}
      </form>

      {service && (canDuplicateToCatalog || (contextProjectId && canDuplicateToProject)) && (
        <section className="flex flex-col gap-2 border-t border-line pt-4">
          <h3 className="font-display text-[16px] font-semibold">Duplicar</h3>
          <div className="flex flex-wrap items-end gap-2">
            <div className="w-40"><TextField label="Novo código" className="font-mono uppercase" value={dupCode} onChange={(e) => setDupCode(e.target.value)} /></div>
            {contextProjectId && canDuplicateToProject && (
              <Button disabled={!dupCode.trim()} busy={act.pending} onClick={async () => {
                const r = await act.run(() => api<ServiceSaveResult>('POST', `/projects/${contextProjectId}/services/duplicate`, { body: { sourceId: service.id, code: dupCode.trim() } }));
                if (r && r !== true) { setSaved(`Criado ${r.service.code} no empreendimento.`); setDupCode(''); }
              }}>Para este empreendimento</Button>
            )}
            {canDuplicateToCatalog && (
              <Button disabled={!dupCode.trim()} busy={act.pending} onClick={async () => {
                const r = await act.run(() => api<ServiceSaveResult>('POST', `/catalog/services/${service.id}/duplicate`, { body: { code: dupCode.trim() } }));
                if (r && r !== true) { setSaved(`Criado ${r.service.code} no catálogo.`); setDupCode(''); }
              }}>Para o catálogo</Button>
            )}
          </div>
        </section>
      )}
      {service && canEdit && (
        <section className="border-t border-line pt-4">
          <Button variant={service.archivedAt ? 'secondary' : 'ghost'} busy={act.pending} onClick={async () => {
            if (await act.run(() => api('POST', `${base}/${service.id}/${service.archivedAt ? 'unarchive' : 'archive'}`, { body: {}, version: service.version }))) onClose();
          }}>{service.archivedAt ? 'Reativar serviço' : 'Arquivar serviço'}</Button>
        </section>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ categorias

function CategoriesTab() {
  const { can } = useSession();
  const cats = useCategories();
  const act = useAction([libKeys.categories]);
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [parent, setParent] = useState('');
  if (cats.isPending) return <Loading />;
  if (cats.isError) return <ErrorState message={errorMessage(cats.error)} onRetry={() => cats.refetch()} />;
  const tree = categoryTree(cats.data);
  return (
    <div className="grid max-w-5xl gap-6 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
      <section>
        {act.error && <div className="mb-3"><Notice tone="danger">{act.error}</Notice></div>}
        <ul className="border border-line bg-sheet">
          {tree.map((c) => (
            <li key={c.id} className={`flex items-baseline justify-between gap-3 border-b border-line py-1.5 pr-3 last:border-0 ${c.archivedAt ? 'text-graphite-400' : ''}`} style={{ paddingLeft: 12 + c.depth * 18 }}>
              <span className="min-w-0"><span className="font-mono text-[12.5px] text-muted">{c.code}</span> <span className={c.depth === 0 ? 'font-medium' : ''}>{c.name}</span>{c.archivedAt && ' (arquivada)'}</span>
              <span className="flex shrink-0 items-baseline gap-3">
                <span className="font-mono text-[12px] text-muted">{c.serviceCount}</span>
                {can('org.manage') && !c.archivedAt && <button type="button" className="text-[13px] text-cyan-ink hover:underline" onClick={() => act.run(() => api('POST', `/catalog/service-categories/${c.id}/archive`, { body: {}, version: c.version }))}>Arquivar</button>}
              </span>
            </li>
          ))}
        </ul>
        <p className="mt-2 text-[13px] text-muted">Só é possível arquivar categorias sem subcategorias e sem serviços ativos.</p>
      </section>
      {can('org.manage') && (
        <form className="flex flex-col gap-3 self-start border border-line bg-sheet p-4" onSubmit={async (e) => {
          e.preventDefault();
          if (await act.run(() => api('POST', '/catalog/service-categories', { body: { code: code.trim(), name: name.trim(), parentId: parent || null } }))) { setCode(''); setName(''); }
        }}>
          <h2 className="font-display text-[17px] font-semibold">Nova categoria</h2>
          <TextField label="Código" className="font-mono uppercase" value={code} onChange={(e) => setCode(e.target.value)} error={act.fieldErrors.code} />
          <TextField label="Nome" value={name} onChange={(e) => setName(e.target.value)} />
          <SelectField label="Dentro de" value={parent} onChange={(e) => setParent(e.target.value)}>
            <option value="">Nível principal</option>
            {tree.filter((c) => !c.archivedAt).map((c) => <option key={c.id} value={c.id}>{'  '.repeat(c.depth)}{c.name}</option>)}
          </SelectField>
          <div><Button type="submit" variant="primary" busy={act.pending} disabled={!code.trim() || !name.trim()}>Criar categoria</Button></div>
        </form>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ unidades

const PRESETS: { label: string; dim: UnitDto['dimension'] }[] = [
  { label: 'Comprimento', dim: { L: 1, M: 0, T: 0, N: 0 } }, { label: 'Área', dim: { L: 2, M: 0, T: 0, N: 0 } },
  { label: 'Volume', dim: { L: 3, M: 0, T: 0, N: 0 } }, { label: 'Massa', dim: { L: 0, M: 1, T: 0, N: 0 } },
  { label: 'Tempo', dim: { L: 0, M: 0, T: 1, N: 0 } }, { label: 'Contagem', dim: { L: 0, M: 0, T: 0, N: 1 } },
];

function UnitsTab() {
  const { can } = useSession();
  const units = useUnits();
  const act = useAction([libKeys.units]);
  const [form, setForm] = useState({ symbol: '', name: '', preset: '0', factor: '', decimals: '2' });
  const [conv, setConv] = useState({ value: '1', from: '', to: '', result: '' as string, error: '' });
  if (units.isPending) return <Loading />;
  if (units.isError) return <ErrorState message={errorMessage(units.error)} onRetry={() => units.refetch()} />;
  const list = [...units.data].sort((a, b) => (a.archivedAt ? 1 : 0) - (b.archivedAt ? 1 : 0) || compareUnitsForDisplay(a, b));
  const fromUnit = list.find((u) => u.id === conv.from);
  const compatible = list.filter((u) => !u.archivedAt && fromUnit && describeDimension(u.dimension) === describeDimension(fromUnit.dimension));
  const base = (d: UnitDto['dimension']) => baseUnitSymbol(d);
  return (
    <div className="grid gap-6 2xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
      <section className="min-w-0">
        {act.error && <div className="mb-3"><Notice tone="danger">{act.error}</Notice></div>}
        <div className="overflow-x-auto border border-line bg-sheet">
          <table className="w-full text-left text-[14px]">
            <thead className="border-b border-line-strong text-[13px] text-muted"><tr>
              <th className="px-3 py-2 font-medium">Símbolo</th><th className="px-3 py-2 font-medium">Nome</th><th className="px-3 py-2 font-medium">Grandeza</th>
              <th className="px-3 py-2 text-right font-medium">Equivale a</th><th className="px-3 py-2 text-right font-medium">Casas</th><th className="px-3 py-2 text-right font-medium">Serviços</th>
              {can('org.manage') && <th className="px-3 py-2"><span className="sr-only">Ações</span></th>}
            </tr></thead>
            <tbody>
              {list.map((u) => (
                <tr key={u.id} className={`border-b border-line last:border-0 ${u.archivedAt ? 'text-graphite-400' : ''}`}>
                  <td className="px-3 py-1.5 font-mono">{u.symbol}</td>
                  <td className="px-3 py-1.5">{u.name}{!u.system && <span className="ml-2 text-[12px] text-muted">própria</span>}</td>
                  <td className="px-3 py-1.5">{u.quantity}</td>
                  <td className="whitespace-nowrap px-3 py-1.5 text-right font-mono text-[13px]">{u.factor === '1' ? '—' : `${Number(u.factor).toLocaleString('pt-BR', { maximumSignificantDigits: 12 })}${base(u.dimension) === '1' ? '' : ` ${base(u.dimension)}`}`}</td>
                  <td className="px-3 py-1.5 text-right font-mono">{u.decimals}</td>
                  <td className="px-3 py-1.5 text-right font-mono">{u.serviceCount}</td>
                  {can('org.manage') && <td className="px-3 py-1.5 text-right">
                    <button type="button" className="text-[13px] text-cyan-ink hover:underline" onClick={() => act.run(() => api('POST', `/catalog/units/${u.id}/${u.archivedAt ? 'unarchive' : 'archive'}`, { body: {}, version: u.version }))}>{u.archivedAt ? 'Reativar' : 'Arquivar'}</button>
                  </td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <div className="grid content-start gap-4 lg:grid-cols-2 2xl:grid-cols-1">
        <section className="border border-line bg-sheet p-4">
          <h2 className="mb-3 font-display text-[17px] font-semibold">Converter</h2>
          <form className="flex flex-col gap-3" onSubmit={async (e) => {
            e.preventDefault();
            try {
              const r = await api<{ result: string }>('GET', `/catalog/units/convert?${new URLSearchParams({ value: conv.value, from: conv.from, to: conv.to })}`);
              setConv((c) => ({ ...c, result: r.result, error: '' }));
            } catch (err) { setConv((c) => ({ ...c, result: '', error: errorMessage(err) })); }
          }}>
            <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)] gap-2">
              <TextField label="Valor" inputMode="decimal" className="text-right font-mono" value={conv.value} onChange={(e) => setConv((c) => ({ ...c, value: e.target.value, result: '' }))} />
              <SelectField label="De" className="font-mono" value={conv.from} onChange={(e) => setConv((c) => ({ ...c, from: e.target.value, to: '', result: '' }))}>
                <option value="">—</option>{list.filter((u) => !u.archivedAt).map((u) => <option key={u.id} value={u.id}>{u.symbol}</option>)}
              </SelectField>
              <SelectField label="Para" className="font-mono" value={conv.to} onChange={(e) => setConv((c) => ({ ...c, to: e.target.value, result: '' }))} disabled={!fromUnit}>
                <option value="">—</option>{compatible.map((u) => <option key={u.id} value={u.id}>{u.symbol}</option>)}
              </SelectField>
            </div>
            <div className="flex items-center gap-3">
              <Button type="submit" disabled={!conv.from || !conv.to || !conv.value.trim()}>Converter</Button>
              {conv.result && <output className="font-mono text-[15px]">{Number(conv.result).toLocaleString('pt-BR', { maximumFractionDigits: 12 })} {list.find((u) => u.id === conv.to)?.symbol}</output>}
            </div>
            {conv.error && <Notice tone="danger">{conv.error}</Notice>}
          </form>
        </section>
        {can('org.manage') && (
          <section className="border border-line bg-sheet p-4">
            <h2 className="mb-3 font-display text-[17px] font-semibold">Nova unidade</h2>
            <form className="flex flex-col gap-3" onSubmit={async (e) => {
              e.preventDefault();
              const preset = PRESETS[Number(form.preset)]!;
              const r = await act.run(() => api('POST', '/catalog/units', { body: { symbol: form.symbol.trim(), name: form.name.trim(), dimension: preset.dim, factor: form.factor.trim(), decimals: Number(form.decimals) } }));
              if (r) setForm({ symbol: '', name: '', preset: form.preset, factor: '', decimals: '2' });
            }}>
              <div className="grid grid-cols-2 gap-2">
                <TextField label="Símbolo" className="font-mono" value={form.symbol} onChange={(e) => setForm((f) => ({ ...f, symbol: e.target.value }))} placeholder="pol" />
                <TextField label="Nome" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="polegada" />
                <SelectField label="Grandeza" value={form.preset} onChange={(e) => setForm((f) => ({ ...f, preset: e.target.value }))}>
                  {PRESETS.map((p, i) => <option key={p.label} value={i}>{p.label}</option>)}
                </SelectField>
                <TextField label={`Equivale a (${base(PRESETS[Number(form.preset)]!.dim)})`.replace(' (1)', '')} inputMode="decimal" className="text-right font-mono" value={form.factor} onChange={(e) => setForm((f) => ({ ...f, factor: e.target.value }))} placeholder="0,0254" error={act.fieldErrors.factor} />
                <TextField label="Casas decimais" inputMode="numeric" className="text-right font-mono" value={form.decimals} onChange={(e) => setForm((f) => ({ ...f, decimals: e.target.value }))} />
              </div>
              <p className="text-[12.5px] text-muted">Grandeza e equivalência não mudam depois que a unidade passa a ser usada.</p>
              <div><Button type="submit" variant="primary" busy={act.pending} disabled={!form.symbol.trim() || !form.name.trim() || !form.factor.trim()}>Cadastrar unidade</Button></div>
            </form>
          </section>
        )}
      </div>
    </div>
  );
}
