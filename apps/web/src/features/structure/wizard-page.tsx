import { useMemo, useState, type ReactNode } from 'react';
import { useNavigate, useParams } from 'react-router';
import { wizardInputSchema, type ProjectDto, type WizardInput, type WizardModuleInput, type WizardPreviewDto } from '@eapq/contracts';
import { MODULE_KIND_LABELS, NODE_KIND_LABELS, type ModuleKind, type NodeKind } from '@eapq/domain';
import { Breadcrumbs } from '../../app/shell';
import { Button } from '../../components/ui/button';
import { ErrorState, Loading, Notice } from '../../components/ui/feedback';
import { ApiError, errorMessage } from '../../lib/api';
import { useProject } from '../projects/api';
import { previewWizard, useApplyWizard } from './api';

type Mod<K extends ModuleKind> = Extract<WizardModuleInput, { kind: K }>;

const COMMON_PRESETS = ['Portaria', 'Guarita', 'Salão de festas', 'Espaço gourmet', 'Piscina', 'Quadra poliesportiva', 'Academia', 'Playground', 'Paisagismo', 'Estacionamento', 'Circulações'];
const TECH_PRESETS = ['Reservatório', 'Casa de máquinas', 'Central de gás', 'Abrigo de resíduos', 'Subestação'];

function defaultModule(kind: ModuleKind): WizardModuleInput {
  switch (kind) {
    case 'VERTICAL_RESIDENTIAL':
      return { kind, name: 'Torres residenciais', towers: [{ name: 'Torre A', floors: 10, unitsPerFloor: 4, groundFloor: true, unitTypologies: [null, null, null, null] }] };
    case 'HORIZONTAL_RESIDENTIAL':
      return { kind, name: 'Casas', layout: 'LOTS', blocks: [{ name: 'Quadra 1', lotCount: 20 }], typologyDistribution: [] };
    case 'LAND_SUBDIVISION':
      return { kind, name: 'Loteamento', phases: [{ name: 'Fase 1', blocks: [{ name: 'Quadra A', lotCount: 20 }] }], streets: [{ name: 'Rua 1', sectionCount: 3 }], areas: [] };
    case 'COMMON_AREAS':
      return { kind, name: 'Áreas comuns', areas: [{ kind: 'COMMON_AREA', name: 'Portaria' }] };
    case 'INFRASTRUCTURE':
      return { kind, name: 'Infraestrutura', streets: [{ name: 'Via de acesso', sectionCount: 2 }] };
  }
}

function initialModules(p: ProjectDto): WizardModuleInput[] {
  const map: Record<ProjectDto['classification'], ModuleKind[]> = {
    VERTICAL: ['VERTICAL_RESIDENTIAL', 'COMMON_AREAS', 'INFRASTRUCTURE'],
    HORIZONTAL: ['HORIZONTAL_RESIDENTIAL', 'COMMON_AREAS', 'INFRASTRUCTURE'],
    LOTEAMENTO: ['LAND_SUBDIVISION'],
    MISTO: ['VERTICAL_RESIDENTIAL', 'HORIZONTAL_RESIDENTIAL', 'COMMON_AREAS', 'INFRASTRUCTURE'],
  };
  return map[p.classification].map(defaultModule);
}

const STEPS = ['Módulos', 'Tipologias', 'Parâmetros', 'Prévia'] as const;

export function WizardPage() {
  const { projectId = '' } = useParams();
  const project = useProject(projectId);
  if (project.isPending) return <Loading />;
  if (project.isError) return <ErrorState message={errorMessage(project.error)} onRetry={() => project.refetch()} />;
  return <Wizard project={project.data} />;
}

function Wizard({ project }: { project: ProjectDto }) {
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const [input, setInput] = useState<WizardInput>(() => ({ typologies: [], modules: initialModules(project) }));
  const [preview, setPreview] = useState<WizardPreviewDto | null>(null);
  const [issues, setIssues] = useState<{ path: string; message: string }[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const apply = useApplyWizard(project.id);

  const setModule = (i: number, m: WizardModuleInput) => setInput((s) => ({ ...s, modules: s.modules.map((x, j) => (j === i ? m : x)) }));
  const kinds = new Set(input.modules.map((m) => m.kind));
  const needsApt = kinds.has('VERTICAL_RESIDENTIAL');
  const needsHouse = kinds.has('HORIZONTAL_RESIDENTIAL');

  const runPreview = async () => {
    setError(null);
    setIssues([]);
    const parsed = wizardInputSchema.safeParse(input);
    if (!parsed.success) {
      setIssues(parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })));
      return;
    }
    setLoading(true);
    try {
      setPreview(await previewWizard(project.id, parsed.data));
      setStep(3);
    } catch (e) {
      if (e instanceof ApiError && e.problem.errors) setIssues(e.problem.errors);
      else setError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  };

  const go = (target: number) => {
    if (target === 3) return void runPreview();
    setPreview(null);
    setStep(target);
  };

  return (
    <>
      <Breadcrumbs items={[{ label: 'Empreendimentos', to: '/empreendimentos' }, { label: project.name, to: `/empreendimentos/${project.id}` }, { label: 'Cadastro físico', to: `/empreendimentos/${project.id}/cadastro` }, { label: 'Assistente' }]} />
      <h1 className="font-display text-[28px] font-semibold leading-tight tracking-tight">Assistente de estruturação</h1>
      <p className="mt-1 max-w-prose text-[14px] text-muted">Informe a composição do empreendimento. Nada é gravado até você confirmar a prévia; a estrutura gerada pode ser editada depois.</p>

      <ol aria-label="Etapas" className="my-5 flex flex-wrap border border-line bg-sheet text-[14px]">
        {STEPS.map((label, i) => (
          <li key={label} className="flex-1 border-r border-line last:border-r-0">
            <button type="button" onClick={() => go(i)} aria-current={step === i ? 'step' : undefined}
              className={`flex w-full items-center gap-2 px-3 py-2.5 text-left ${step === i ? 'bg-cyan-wash font-medium' : 'text-muted hover:text-ink'}`}>
              <span className={`grid h-5 w-5 place-items-center rounded-full border text-[12px] ${step === i ? 'border-cyan-ink bg-cyan-ink text-white' : i < step ? 'border-ok text-ok' : 'border-line-strong'}`}>{i + 1}</span>
              {label}
            </button>
          </li>
        ))}
      </ol>

      {error && <div className="mb-4"><Notice tone="danger">{error}</Notice></div>}
      {issues.length > 0 && (
        <div className="mb-4"><Notice tone="danger">
          <p className="font-medium">Revise os parâmetros:</p>
          <ul className="mt-1 list-disc pl-5">{issues.map((i, k) => <li key={k}>{describePath(i.path, input)}: {i.message}</li>)}</ul>
        </Notice></div>
      )}

      <div className="max-w-5xl">
        {step === 0 && <ModulesStep input={input} setInput={setInput} classification={project.classification} />}
        {step === 1 && <TypologiesStep input={input} setInput={setInput} needsApt={needsApt} needsHouse={needsHouse} />}
        {step === 2 && (
          <div className="flex flex-col gap-6">
            {input.modules.map((m, i) => (
              <section key={i} className="border border-line bg-sheet">
                <header className="flex flex-wrap items-baseline justify-between gap-2 border-b border-line px-4 py-2.5">
                  <h2 className="font-display text-[18px] font-semibold">{m.name}</h2>
                  <span className="text-[13px] text-muted">{MODULE_KIND_LABELS[m.kind]}</span>
                </header>
                <div className="px-4 py-4"><ModuleParams module={m} onChange={(x) => setModule(i, x)} typologies={input.typologies} /></div>
              </section>
            ))}
          </div>
        )}
        {step === 3 && preview && <PreviewStep preview={preview} input={input} />}

        <div className="mt-6 flex flex-wrap justify-between gap-2 border-t border-line pt-4">
          <Button variant="ghost" onClick={() => (step === 0 ? navigate(`/empreendimentos/${project.id}/cadastro`) : go(step - 1))}>{step === 0 ? 'Cancelar' : 'Voltar'}</Button>
          {step < 2 && <Button variant="primary" onClick={() => go(step + 1)} disabled={step === 0 && input.modules.length === 0}>Continuar</Button>}
          {step === 2 && <Button variant="primary" busy={loading} onClick={runPreview}>Gerar prévia</Button>}
          {step === 3 && (
            <Button variant="primary" busy={apply.isPending} onClick={async () => {
              setError(null);
              try {
                await apply.mutateAsync(input);
                navigate(`/empreendimentos/${project.id}/cadastro`);
              } catch (e) { setError(errorMessage(e)); }
            }}>Gravar estrutura</Button>
          )}
        </div>
      </div>
    </>
  );
}

/** Traduz o caminho técnico de um erro (modules.0.towers.1.floors) para algo legível. */
function describePath(path: string, input: WizardInput): string {
  const parts = path.split('.');
  if (parts[0] === 'typologies') return `Tipologia ${Number(parts[1]) + 1}`;
  if (parts[0] === 'modules' && parts[1] !== undefined) {
    const m = input.modules[Number(parts[1])];
    const label = m ? m.name : 'Módulo';
    const sub: Record<string, string> = { towers: 'torre', blocks: 'quadra', phases: 'fase', streets: 'rua', areas: 'área', typologyDistribution: 'distribuição de tipologias', houseCount: 'quantidade de casas' };
    const extra = parts[2] ? ` — ${sub[parts[2]] ?? parts[2]}${parts[3] !== undefined && /^\d+$/.test(parts[3]) ? ` ${Number(parts[3]) + 1}` : ''}` : '';
    return `${label}${extra}`;
  }
  return 'Parâmetros';
}

// ---------------- etapas ----------------

const input = 'h-9 rounded-md border border-line-strong bg-sheet px-2 text-[14px] min-w-0';
const num = `${input} w-24 text-right font-mono`;

function Field({ label, children, className = '' }: { label: string; children: ReactNode; className?: string }) {
  return <label className={`flex flex-col gap-1 text-[13px] font-medium text-graphite-800 ${className}`}>{label}{children}</label>;
}
const intVal = (v: string) => (v === '' ? 0 : Math.max(0, Math.floor(Number(v))));

function ModulesStep({ input: s, setInput, classification }: { input: WizardInput; setInput: (f: (s: WizardInput) => WizardInput) => void; classification: ProjectDto['classification'] }) {
  const [kind, setKind] = useState<ModuleKind>('COMMON_AREAS');
  return (
    <div className="flex flex-col gap-4">
      <p className="text-[14px]">Sugerimos os módulos abaixo para um empreendimento {({ VERTICAL: 'vertical', HORIZONTAL: 'horizontal', LOTEAMENTO: 'de loteamento', MISTO: 'misto' })[classification]}. Um empreendimento misto pode combinar quantos módulos forem necessários.</p>
      <ul className="border border-line bg-sheet">
        {s.modules.map((m, i) => (
          <li key={i} className="flex flex-wrap items-end gap-3 border-b border-line px-4 py-3 last:border-0">
            <span className="w-44 shrink-0 pb-2 text-[13px] text-muted">{MODULE_KIND_LABELS[m.kind]}</span>
            <Field label="Nome do módulo" className="min-w-0 flex-1">
              <input className={input} value={m.name} onChange={(e) => setInput((x) => ({ ...x, modules: x.modules.map((y, j) => (j === i ? { ...y, name: e.target.value } : y)) }))} />
            </Field>
            <button type="button" className="pb-2 text-[13px] text-danger hover:underline" onClick={() => setInput((x) => ({ ...x, modules: x.modules.filter((_, j) => j !== i) }))}>Remover</button>
          </li>
        ))}
        {s.modules.length === 0 && <li className="px-4 py-3 text-[14px] text-muted">Nenhum módulo. Adicione ao menos um.</li>}
      </ul>
      <div className="flex flex-wrap items-end gap-2">
        <Field label="Adicionar módulo">
          <select className={input} value={kind} onChange={(e) => setKind(e.target.value as ModuleKind)}>
            {(Object.keys(MODULE_KIND_LABELS) as ModuleKind[]).map((k) => <option key={k} value={k}>{MODULE_KIND_LABELS[k]}</option>)}
          </select>
        </Field>
        <Button onClick={() => setInput((x) => ({ ...x, modules: [...x.modules, defaultModule(kind)] }))}>Adicionar</Button>
      </div>
    </div>
  );
}

function TypologiesStep({ input: s, setInput, needsApt, needsHouse }: { input: WizardInput; setInput: (f: (s: WizardInput) => WizardInput) => void; needsApt: boolean; needsHouse: boolean }) {
  const set = (i: number, patch: Partial<WizardInput['typologies'][number]>) => setInput((x) => ({ ...x, typologies: x.typologies.map((t, j) => (j === i ? { ...t, ...patch } : t)) }));
  const add = (kind: 'APARTMENT' | 'HOUSE') => setInput((x) => {
    const n = x.typologies.filter((t) => t.kind === kind).length + 1;
    return { ...x, typologies: [...x.typologies, kind === 'APARTMENT' ? { code: `AP${n}`, name: `Apartamento tipo ${n}`, kind } : { code: `C${n}`, name: `Casa tipo ${n}`, kind }] };
  });
  if (!needsApt && !needsHouse) return <Notice tone="info">Os módulos escolhidos não têm unidades habitacionais. Siga para os parâmetros.</Notice>;
  return (
    <div className="flex flex-col gap-4">
      <p className="text-[14px]">Cadastre as tipologias para distribuí-las entre as unidades na próxima etapa. Tipologias com código já existente no empreendimento são reaproveitadas.</p>
      <table className="w-full border border-line bg-sheet text-[14px]">
        <thead className="border-b border-line-strong text-left text-[13px] text-muted"><tr><th className="px-3 py-2 font-medium">Código</th><th className="px-3 py-2 font-medium">Nome</th><th className="px-3 py-2 font-medium">Tipo</th><th className="px-3 py-2"><span className="sr-only">Ações</span></th></tr></thead>
        <tbody>
          {s.typologies.map((t, i) => (
            <tr key={i} className="border-b border-line last:border-0">
              <td className="px-3 py-1.5"><input aria-label={`Código da tipologia ${i + 1}`} className={`${input} w-28 font-mono uppercase`} value={t.code} onChange={(e) => set(i, { code: e.target.value.toUpperCase() })} /></td>
              <td className="px-3 py-1.5"><input aria-label={`Nome da tipologia ${i + 1}`} className={`${input} w-full`} value={t.name} onChange={(e) => set(i, { name: e.target.value })} /></td>
              <td className="px-3 py-1.5">{t.kind === 'APARTMENT' ? 'Apartamento' : 'Casa'}</td>
              <td className="px-3 py-1.5 text-right"><button type="button" className="text-[13px] text-danger hover:underline" onClick={() => setInput((x) => ({ ...x, typologies: x.typologies.filter((_, j) => j !== i) }))}>Remover</button></td>
            </tr>
          ))}
          {s.typologies.length === 0 && <tr><td colSpan={4} className="px-3 py-3 text-muted">Nenhuma tipologia. As unidades podem ficar sem tipologia e ser vinculadas depois.</td></tr>}
        </tbody>
      </table>
      <div className="flex gap-2">
        {needsApt && <Button onClick={() => add('APARTMENT')}>Adicionar tipologia de apartamento</Button>}
        {needsHouse && <Button onClick={() => add('HOUSE')}>Adicionar tipologia de casa</Button>}
      </div>
    </div>
  );
}

function ListEditor<T>({ items, onChange, make, render, addLabel, max = 500 }: { items: T[]; onChange: (v: T[]) => void; make: (i: number) => T; render: (item: T, set: (v: T) => void, i: number) => ReactNode; addLabel: string; max?: number }) {
  return (
    <div className="flex flex-col gap-2">
      {items.map((it, i) => (
        <div key={i} className="flex flex-wrap items-end gap-3 border-b border-line pb-2">
          {render(it, (v) => onChange(items.map((x, j) => (j === i ? v : x))), i)}
          <button type="button" className="pb-2 text-[13px] text-danger hover:underline" onClick={() => onChange(items.filter((_, j) => j !== i))}>Remover</button>
        </div>
      ))}
      <div><button type="button" disabled={items.length >= max} className="text-[14px] font-medium text-cyan-ink hover:underline disabled:text-graphite-400" onClick={() => onChange([...items, make(items.length)])}>{addLabel}</button></div>
    </div>
  );
}

const blockEditor = (blocks: { name: string; lotCount: number }[], onChange: (b: { name: string; lotCount: number }[]) => void, label = 'Adicionar quadra') => (
  <ListEditor items={blocks} onChange={onChange} addLabel={label} make={(i) => ({ name: `Quadra ${i + 1}`, lotCount: blocks.at(-1)?.lotCount ?? 20 })}
    render={(b, set, i) => (<>
      <Field label={`Quadra ${i + 1}`}><input className={input} value={b.name} onChange={(e) => set({ ...b, name: e.target.value })} /></Field>
      <Field label="Lotes"><input type="number" min={1} className={num} value={b.lotCount} onChange={(e) => set({ ...b, lotCount: intVal(e.target.value) })} /></Field>
    </>)} />
);

const streetEditor = (streets: { name: string; sectionCount: number }[], onChange: (s: { name: string; sectionCount: number }[]) => void) => (
  <ListEditor items={streets} onChange={onChange} addLabel="Adicionar rua" make={(i) => ({ name: `Rua ${i + 1}`, sectionCount: 2 })}
    render={(st, set, i) => (<>
      <Field label={`Rua ${i + 1}`}><input className={input} value={st.name} onChange={(e) => set({ ...st, name: e.target.value })} /></Field>
      <Field label="Trechos"><input type="number" min={0} className={num} value={st.sectionCount} onChange={(e) => set({ ...st, sectionCount: intVal(e.target.value) })} /></Field>
    </>)} />
);

function ModuleParams({ module: m, onChange, typologies }: { module: WizardModuleInput; onChange: (m: WizardModuleInput) => void; typologies: WizardInput['typologies'] }) {
  switch (m.kind) {
    case 'VERTICAL_RESIDENTIAL': return <VerticalParams m={m} onChange={onChange} typologies={typologies.filter((t) => t.kind === 'APARTMENT')} />;
    case 'HORIZONTAL_RESIDENTIAL': return <HorizontalParams m={m} onChange={onChange} typologies={typologies.filter((t) => t.kind === 'HOUSE')} />;
    case 'LAND_SUBDIVISION': return <LandParams m={m} onChange={onChange} />;
    case 'COMMON_AREAS': return <AreasParams m={m} onChange={onChange} />;
    case 'INFRASTRUCTURE': return (
      <div><p className="mb-2 text-[14px] text-muted">Ruas e trechos de acesso externos. Redes e sistemas de infraestrutura são cadastrados na fase 3.</p>{streetEditor(m.streets, (streets) => onChange({ ...m, streets }))}</div>
    );
  }
}

function VerticalParams({ m, onChange, typologies }: { m: Mod<'VERTICAL_RESIDENTIAL'>; onChange: (m: WizardModuleInput) => void; typologies: WizardInput['typologies'] }) {
  const total = m.towers.reduce((a, t) => a + t.floors * t.unitsPerFloor, 0);
  return (
    <div className="flex flex-col gap-3">
      <ListEditor items={m.towers} onChange={(towers) => onChange({ ...m, towers })} addLabel="Adicionar torre" max={50}
        make={(i) => ({ ...(m.towers.at(-1) ?? { floors: 10, unitsPerFloor: 4, groundFloor: true, unitTypologies: [null, null, null, null] }), name: `Torre ${String.fromCharCode(65 + (i % 26))}` })}
        render={(t, set, i) => (
          <div className="flex w-full flex-col gap-2">
            <div className="flex flex-wrap items-end gap-3">
              <Field label={`Torre ${i + 1}`}><input className={input} value={t.name} onChange={(e) => set({ ...t, name: e.target.value })} /></Field>
              <Field label="Pavimentos-tipo"><input type="number" min={1} className={num} value={t.floors} onChange={(e) => set({ ...t, floors: intVal(e.target.value) })} /></Field>
              <Field label="Unidades por pavimento"><input type="number" min={0} className={num} value={t.unitsPerFloor} onChange={(e) => {
                const n = Math.min(intVal(e.target.value), 60);
                const cur = t.unitTypologies ?? [];
                set({ ...t, unitsPerFloor: n, unitTypologies: Array.from({ length: n }, (_, k) => cur[k] ?? null) });
              }} /></Field>
              <label className="flex items-center gap-2 pb-2 text-[14px]"><input type="checkbox" checked={!!t.groundFloor} onChange={(e) => set({ ...t, groundFloor: e.target.checked })} /> Incluir térreo</label>
            </div>
            {t.unitsPerFloor > 0 && typologies.length > 0 && (
              <div className="flex flex-wrap items-end gap-2">
                <span className="w-full text-[13px] text-muted">Tipologia por final de unidade</span>
                {(t.unitTypologies ?? []).map((code, k) => (
                  <Field key={k} label={`Final ${String(k + 1).padStart(2, '0')}`}>
                    <select className={`${input} w-28 font-mono`} value={code ?? ''} onChange={(e) => set({ ...t, unitTypologies: (t.unitTypologies ?? []).map((c, j) => (j === k ? e.target.value || null : c)) })}>
                      <option value="">Nenhuma</option>
                      {typologies.map((ty) => <option key={ty.code} value={ty.code}>{ty.code}</option>)}
                    </select>
                  </Field>
                ))}
              </div>
            )}
          </div>
        )} />
      <p className="text-[13px] text-muted">Total previsto: <span className="font-mono text-ink">{total}</span> unidades. Numeração: pavimento + final (Apto 101, 102…).</p>
    </div>
  );
}

function HorizontalParams({ m, onChange, typologies }: { m: Mod<'HORIZONTAL_RESIDENTIAL'>; onChange: (m: WizardModuleInput) => void; typologies: WizardInput['typologies'] }) {
  const total = m.layout === 'UNITS' ? (m.houseCount ?? 0) : (m.blocks ?? []).reduce((a, b) => a + b.lotCount, 0);
  const dist = m.typologyDistribution ?? [];
  const sum = dist.reduce((a, d) => a + d.quantity, 0);
  return (
    <div className="flex flex-col gap-4">
      <fieldset className="flex flex-wrap gap-4 text-[14px]">
        <legend className="mb-1 text-[13px] font-medium text-graphite-800">Organização das casas</legend>
        <label className="flex items-center gap-2"><input type="radio" checked={m.layout === 'LOTS'} onChange={() => onChange({ ...m, layout: 'LOTS', blocks: m.blocks?.length ? m.blocks : [{ name: 'Quadra 1', lotCount: 20 }] })} /> Em quadras e lotes (uma casa por lote)</label>
        <label className="flex items-center gap-2"><input type="radio" checked={m.layout === 'UNITS'} onChange={() => onChange({ ...m, layout: 'UNITS', houseCount: m.houseCount ?? total })} /> Sem lotes (casas numeradas)</label>
      </fieldset>
      {m.layout === 'LOTS' ? blockEditor(m.blocks ?? [], (blocks) => onChange({ ...m, blocks })) : (
        <Field label="Quantidade de casas"><input type="number" min={1} className={num} value={m.houseCount ?? 0} onChange={(e) => onChange({ ...m, houseCount: intVal(e.target.value) })} /></Field>
      )}
      <div>
        <h3 className="mb-1 text-[14px] font-medium">Distribuição por tipologia</h3>
        {typologies.length === 0 ? <p className="text-[13px] text-muted">Sem tipologias de casa: as casas ficarão sem tipologia.</p> : (
          <>
            <ListEditor items={dist} onChange={(typologyDistribution) => onChange({ ...m, typologyDistribution })} addLabel="Adicionar tipologia à distribuição"
              make={() => ({ typologyCode: typologies[0]!.code, quantity: Math.max(total - sum, 0) })}
              render={(d, set) => (<>
                <Field label="Tipologia"><select className={`${input} w-40`} value={d.typologyCode} onChange={(e) => set({ ...d, typologyCode: e.target.value })}>{typologies.map((t) => <option key={t.code} value={t.code}>{t.code} · {t.name}</option>)}</select></Field>
                <Field label="Casas"><input type="number" min={1} className={num} value={d.quantity} onChange={(e) => set({ ...d, quantity: intVal(e.target.value) })} /></Field>
              </>)} />
            <p className={`mt-2 text-[13px] ${dist.length && sum !== total ? 'text-danger' : 'text-muted'}`}>Distribuídas: <span className="font-mono">{sum}</span> de <span className="font-mono">{total}</span> casas, na ordem das quadras e lotes.</p>
          </>
        )}
      </div>
    </div>
  );
}

function LandParams({ m, onChange }: { m: Mod<'LAND_SUBDIVISION'>; onChange: (m: WizardModuleInput) => void }) {
  const lots = m.phases.reduce((a, p) => a + p.blocks.reduce((b, q) => b + q.lotCount, 0), 0);
  return (
    <div className="flex flex-col gap-5">
      <div>
        <h3 className="mb-2 text-[14px] font-medium">Fases, quadras e lotes</h3>
        <ListEditor items={m.phases} onChange={(phases) => onChange({ ...m, phases })} addLabel="Adicionar fase" max={50} make={(i) => ({ name: `Fase ${i + 1}`, blocks: [{ name: `Quadra ${String.fromCharCode(65 + i)}`, lotCount: 20 }] })}
          render={(p, set, i) => (
            <div className="flex w-full flex-col gap-2">
              <Field label={`Fase ${i + 1}`}><input className={input} value={p.name} onChange={(e) => set({ ...p, name: e.target.value })} /></Field>
              <div className="border-l-2 border-line pl-4">{blockEditor(p.blocks, (blocks) => set({ ...p, blocks }))}</div>
            </div>
          )} />
        <p className="mt-2 text-[13px] text-muted">Total previsto: <span className="font-mono text-ink">{lots}</span> lotes.</p>
      </div>
      <div><h3 className="mb-2 text-[14px] font-medium">Ruas e trechos</h3>{streetEditor(m.streets ?? [], (streets) => onChange({ ...m, streets }))}</div>
      <div>
        <h3 className="mb-2 text-[14px] font-medium">Áreas institucionais e verdes</h3>
        <ListEditor items={m.areas ?? []} onChange={(areas) => onChange({ ...m, areas })} addLabel="Adicionar área" make={(i) => ({ kind: 'GREEN_AREA' as const, name: `Área verde ${i + 1}` })}
          render={(a, set) => (<>
            <Field label="Tipo"><select className={input} value={a.kind} onChange={(e) => set({ ...a, kind: e.target.value as 'GREEN_AREA' | 'INSTITUTIONAL_AREA' })}><option value="GREEN_AREA">Área verde</option><option value="INSTITUTIONAL_AREA">Área institucional</option></select></Field>
            <Field label="Nome"><input className={input} value={a.name} onChange={(e) => set({ ...a, name: e.target.value })} /></Field>
          </>)} />
      </div>
    </div>
  );
}

function AreasParams({ m, onChange }: { m: Mod<'COMMON_AREAS'>; onChange: (m: WizardModuleInput) => void }) {
  const has = (name: string) => m.areas.some((a) => a.name === name);
  const toggle = (name: string, kind: 'COMMON_AREA' | 'TECHNICAL_AREA') =>
    onChange({ ...m, areas: has(name) ? m.areas.filter((a) => a.name !== name) : [...m.areas, { kind, name }] });
  const custom = m.areas.filter((a) => !COMMON_PRESETS.includes(a.name) && !TECH_PRESETS.includes(a.name));
  return (
    <div className="flex flex-col gap-4">
      {([['Áreas comuns', COMMON_PRESETS, 'COMMON_AREA'], ['Áreas técnicas', TECH_PRESETS, 'TECHNICAL_AREA']] as const).map(([title, list, kind]) => (
        <fieldset key={title}>
          <legend className="mb-1.5 text-[14px] font-medium">{title}</legend>
          <div className="flex flex-wrap gap-x-5 gap-y-1.5 text-[14px]">
            {list.map((name) => <label key={name} className="flex items-center gap-2"><input type="checkbox" checked={has(name)} onChange={() => toggle(name, kind)} /> {name}</label>)}
          </div>
        </fieldset>
      ))}
      <div>
        <h3 className="mb-2 text-[14px] font-medium">Outras áreas</h3>
        <ListEditor items={custom} addLabel="Adicionar outra área" make={() => ({ kind: 'COMMON_AREA' as const, name: '' })}
          onChange={(next) => onChange({ ...m, areas: [...m.areas.filter((a) => COMMON_PRESETS.includes(a.name) || TECH_PRESETS.includes(a.name)), ...next] })}
          render={(a, set) => (<>
            <Field label="Tipo"><select className={input} value={a.kind} onChange={(e) => set({ ...a, kind: e.target.value as 'COMMON_AREA' | 'TECHNICAL_AREA' })}><option value="COMMON_AREA">Área comum</option><option value="TECHNICAL_AREA">Área técnica</option></select></Field>
            <Field label="Nome"><input className={input} value={a.name} onChange={(e) => set({ ...a, name: e.target.value })} /></Field>
          </>)} />
      </div>
    </div>
  );
}

function PreviewStep({ preview, input: s }: { preview: WizardPreviewDto; input: WizardInput }) {
  const counts = useMemo(() => Object.entries(preview.counts) as [NodeKind, number][], [preview]);
  return (
    <div className="flex flex-col gap-5">
      <Notice tone="info">Prévia de <span className="font-mono">{preview.totalNodes}</span> itens em {preview.modules.length} módulo(s). Confira antes de gravar.</Notice>
      {preview.existingTypologies.length > 0 && <Notice tone="warn">Já existem no empreendimento e serão reaproveitadas: {preview.existingTypologies.join(', ')}.</Notice>}
      <div className="grid gap-5 md:grid-cols-2">
        <section>
          <h2 className="mb-2 font-display text-[18px] font-semibold">Itens por tipo</h2>
          <table className="w-full border border-line bg-sheet text-[14px]"><tbody>
            {counts.map(([k, v]) => <tr key={k} className="border-b border-line last:border-0"><th scope="row" className="px-3 py-1.5 text-left font-normal">{NODE_KIND_LABELS[k]}</th><td className="px-3 py-1.5 text-right font-mono">{v}</td></tr>)}
          </tbody></table>
        </section>
        <section>
          <h2 className="mb-2 font-display text-[18px] font-semibold">Unidades por tipologia</h2>
          <table className="w-full border border-line bg-sheet text-[14px]"><tbody>
            {Object.entries(preview.unitsByTypology).map(([code, v]) => (
              <tr key={code} className="border-b border-line"><th scope="row" className="px-3 py-1.5 text-left font-normal"><span className="font-mono">{code}</span> {s.typologies.find((t) => t.code === code)?.name}</th><td className="px-3 py-1.5 text-right font-mono">{v}</td></tr>
            ))}
            <tr><th scope="row" className="px-3 py-1.5 text-left font-normal text-muted">Sem tipologia</th><td className="px-3 py-1.5 text-right font-mono">{preview.unitsWithoutTypology}</td></tr>
          </tbody></table>
        </section>
      </div>
      {preview.modules.map((m, i) => (
        <section key={i} className="border border-line bg-sheet">
          <header className="flex justify-between border-b border-line px-4 py-2"><h3 className="font-medium">{m.name}</h3><span className="font-mono text-[13px] text-muted">{m.nodeCount} itens</span></header>
          <ul className="px-4 py-2 font-mono text-[12.5px] leading-6">
            {m.sample.map((n, k) => <li key={k} style={{ paddingLeft: n.depth * 16 }}><span className="text-muted">{NODE_KIND_LABELS[n.kind as NodeKind]}</span> {n.name}</li>)}
            {m.nodeCount > m.sample.length && <li className="text-muted">… e mais {m.nodeCount - m.sample.length} itens</li>}
          </ul>
        </section>
      ))}
    </div>
  );
}
