import { useMemo, useState } from 'react';
import type { AnchorInput, CalcInput, CalcPreviewDto, DocumentDto, FormulaVariableInput, MeasurementDto, ServiceDto, UnitDto } from '@eapq/contracts';
import { compatibleDimensions } from '@eapq/domain';
import { useAction } from '../../components/ui/actions';
import { Button } from '../../components/ui/button';
import { Loading, Notice } from '../../components/ui/feedback';
import { SelectField, TextArea, TextField } from '../../components/ui/field';
import { api, uploadFile } from '../../lib/api';
import { useUnits } from '../library/api';
import { useFormulas } from './formulas-page';
import { mKeys, useAnchors } from './api';
import { MemoryView } from './memory-view';

const ANCHOR_KINDS: { kind: AnchorInput['kind']; label: string }[] = [
  { kind: 'STRUCTURE_NODE', label: 'Item do cadastro físico' },
  { kind: 'TYPOLOGY_ELEMENT', label: 'Elemento de tipologia' },
  { kind: 'NETWORK_SEGMENT', label: 'Trecho de rede' },
  { kind: 'NETWORK_NODE', label: 'Dispositivo de rede' },
  { kind: 'PHYSICAL_ELEMENT', label: 'Elemento físico' },
];

interface Props {
  projectId: string;
  wbsNodeId: string;
  service: ServiceDto;
  /** Revisão de uma medição existente (âncora fixa). */
  existing?: MeasurementDto;
  /** Pré-seleciona a versão mais nova da fórmula (recálculo). */
  recalcVersionId?: string;
  onDone: () => void;
}

export function MeasurementForm({ projectId, wbsNodeId, service, existing, recalcVersionId, onDone }: Props) {
  const units = useUnits();
  const formulas = useFormulas();
  const all = useMemo(() => (units.data ?? []).filter((u) => !u.archivedAt), [units.data]);
  const target = all.find((u) => u.symbol === service.unitSymbol);
  const cur = existing?.current;
  const initialFormula = recalcVersionId ?? (cur?.method === 'FORMULA' ? cur.formulaVersionId ?? '' : '');
  const [method, setMethod] = useState<'MANUAL' | 'FORMULA'>(recalcVersionId || cur?.method === 'FORMULA' ? 'FORMULA' : 'MANUAL');
  const [manual, setManual] = useState(() => {
    const i = cur?.method === 'MANUAL' ? (cur.inputs as { value: string; unit: string }) : null;
    return { value: i?.value ?? '', unit: i?.unit ?? service.unitSymbol };
  });
  const [versionId, setVersionId] = useState(initialFormula);
  const [inputs, setInputs] = useState<Record<string, { value: string; unit: string }>>(() =>
    Object.fromEntries(cur?.method === 'FORMULA' ? (cur.inputs as { symbol: string; value: string; unit: string }[]).map((i) => [i.symbol, { value: i.value, unit: i.unit }]) : []));
  const [anchor, setAnchor] = useState<AnchorInput | null>(null);
  const [sourceReference, setSource] = useState(cur?.sourceReference ?? '');
  const [notes, setNotes] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [reason, setReason] = useState(recalcVersionId ? 'Recálculo com a versão mais nova da fórmula' : '');
  const [preview, setPreview] = useState<CalcPreviewDto | null>(null);
  const act = useAction([mKeys.all(projectId), ['formulas']]);

  // versões publicadas cujo resultado tem a grandeza da unidade do serviço
  const versions = useMemo(() => (formulas.data ?? []).flatMap((f) => f.versions.filter((v) => v.status === 'PUBLISHED' && (!f.archivedAt || v.id === initialFormula) && v.resultDimension && target && compatibleDimensions(v.resultDimension, target.dimension))
    .map((v) => ({ id: v.id, label: `${f.code} R${v.number} — ${f.name}`, expression: v.expression, variables: v.variables, latest: f.versions.find((x) => x.status === 'PUBLISHED')!.id === v.id }))), [formulas.data, target, initialFormula]);
  const version = versions.find((v) => v.id === versionId);
  if (units.isPending || formulas.isPending) return <Loading />;
  if (!target) return <Notice tone="danger">A unidade {service.unitSymbol} do serviço não está cadastrada.</Notice>;

  const calc = (): CalcInput => method === 'MANUAL'
    ? { method, value: manual.value, unit: manual.unit }
    : { method, formulaVersionId: versionId, inputs: (version?.variables ?? []).map((x) => ({ symbol: x.symbol, value: inputs[x.symbol]?.value ?? '', unit: inputs[x.symbol]?.unit ?? x.unit })) };
  const reset = () => setPreview(null);

  return (
    <form className="flex flex-col gap-4" onSubmit={async (e) => {
      e.preventDefault();
      // o arquivo de origem é enviado antes; a medição só referencia o documento já verificado
      const doc = file ? await act.run(() => uploadFile<DocumentDto>(`/projects/${projectId}/documents`, file)) : null;
      if (doc === false) return;
      const body = { calc: calc(), sourceReference: sourceReference.trim() || null, notes: notes.trim() || null, documentId: doc && doc !== true ? doc.id : null };
      const r = existing
        ? await act.run(() => api('POST', `/projects/${projectId}/measurements/${existing.id}/revisions`, { body: { ...body, reason }, version: existing.version }))
        : await act.run(() => api('POST', `/projects/${projectId}/measurements`, { body: { ...body, wbsNodeId, serviceId: service.id, anchor } }));
      if (r) onDone();
    }}>
      <p className="text-[13.5px]"><span className="font-mono">{service.code}</span> {service.description} <span className="font-mono text-muted">({service.unitSymbol})</span></p>
      {existing ? (
        <p className="text-[13.5px] text-muted">Âncora: <span className="text-ink">{existing.anchor.label}</span> · nova revisão R{existing.current.number + 1} (a R{existing.current.number} continua na memória de cálculo)</p>
      ) : (
        <AnchorPicker projectId={projectId} value={anchor} onChange={setAnchor} />
      )}
      <fieldset className="flex gap-4 text-[14px]">
        <legend className="mb-1 text-[13px] font-medium text-graphite-800">Método</legend>
        <label className="flex items-center gap-1.5"><input type="radio" name="method" checked={method === 'MANUAL'} onChange={() => { setMethod('MANUAL'); reset(); }} /> Quantidade informada</label>
        <label className="flex items-center gap-1.5"><input type="radio" name="method" checked={method === 'FORMULA'} onChange={() => { setMethod('FORMULA'); reset(); }} /> Por fórmula</label>
      </fieldset>
      {method === 'MANUAL' ? (
        <ValueWithUnit label="Quantidade" value={manual} units={all.filter((u) => compatibleDimensions(u.dimension, target.dimension))} onChange={(x) => { setManual(x); reset(); }} />
      ) : (
        <>
          <SelectField label="Fórmula" value={versionId} onChange={(e) => { setVersionId(e.target.value); reset(); }}
            hint={versions.length === 0 ? `Nenhuma fórmula publicada resulta em ${service.unitSymbol}.` : undefined}>
            <option value="">Selecione</option>
            {versions.map((v) => <option key={v.id} value={v.id}>{v.label}{!v.latest ? ' (há versão mais nova)' : ''}</option>)}
          </SelectField>
          {version && <p className="font-mono text-[13px] text-muted">{version.expression}</p>}
          {version?.variables.map((x: FormulaVariableInput) => {
            const d = all.find((u) => u.symbol === x.unit)?.dimension;
            return <ValueWithUnit key={x.symbol} label={`${x.label} (${x.symbol})`} value={inputs[x.symbol] ?? { value: '', unit: x.unit }} units={all.filter((u) => d && compatibleDimensions(u.dimension, d))} onChange={(v) => { setInputs((s) => ({ ...s, [x.symbol]: v })); reset(); }} />;
          })}
        </>
      )}
      <TextField label="Documento de origem (opcional)" value={sourceReference} onChange={(e) => setSource(e.target.value)} hint="Prancha, memorial ou levantamento, por exemplo: ARQ-03 rev. B" />
      <div>
        <label htmlFor="measurement-file" className="mb-1 block text-[13px] font-medium text-graphite-800">Arquivo de origem (opcional)</label>
        <input id="measurement-file" type="file" accept=".pdf,.png,.jpg,.jpeg,.xlsx,.csv" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="text-[13px]" />
        <p className="mt-0.5 text-[12px] text-muted">PDF, imagem ou planilha, até 20 MB. Fica anexado a esta revisão da medição.</p>
      </div>
      <TextArea label="Observações (opcional)" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
      {existing && <TextField label="Motivo da revisão" value={reason} onChange={(e) => setReason(e.target.value)} error={act.fieldErrors.reason} />}
      {act.error && <Notice tone="danger">{act.error}</Notice>}
      {preview && <section aria-label="Prévia do cálculo" className="border border-line bg-paper p-3"><MemoryView memory={preview.memory} /></section>}
      <div className="flex flex-wrap gap-2 border-t border-line pt-4">
        <Button busy={act.pending} onClick={async () => { const r = await act.run(() => api<CalcPreviewDto>('POST', `/projects/${projectId}/measurements/preview`, { body: { serviceId: service.id, calc: calc() } })); if (r && r !== true) setPreview(r); }}>Calcular prévia</Button>
        <Button type="submit" variant="primary" busy={act.pending} disabled={(!existing && !anchor) || (method === 'FORMULA' && !versionId) || (!!existing && !reason.trim())}>{existing ? 'Gravar revisão' : 'Gravar medição'}</Button>
      </div>
    </form>
  );
}

function ValueWithUnit({ label, value, units, onChange }: { label: string; value: { value: string; unit: string }; units: UnitDto[]; onChange: (v: { value: string; unit: string }) => void }) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_110px] items-end gap-2">
      <TextField label={label} inputMode="decimal" className="font-mono" value={value.value} onChange={(e) => onChange({ ...value, value: e.target.value })} />
      <SelectField label={`Unidade de ${label.split(' (')[0]!.toLowerCase()}`} value={value.unit} onChange={(e) => onChange({ ...value, unit: e.target.value })}>
        {units.map((u) => <option key={u.id} value={u.symbol}>{u.symbol}</option>)}
      </SelectField>
    </div>
  );
}

export function AnchorPicker({ projectId, value, onChange }: { projectId: string; value: AnchorInput | null; onChange: (a: AnchorInput | null) => void }) {
  const q = useAnchors(projectId);
  const [kind, setKind] = useState<AnchorInput['kind']>('STRUCTURE_NODE');
  const [filter, setFilter] = useState('');
  const [typologyId, setTypologyId] = useState('');
  const [unitId, setUnitId] = useState('');
  if (q.isPending) return <Loading />;
  if (q.isError) return <Notice tone="danger">Não foi possível carregar as âncoras.</Notice>;
  const a = q.data;
  const simple = kind === 'STRUCTURE_NODE' ? a.structure.filter((n) => !n.archived) : kind === 'NETWORK_SEGMENT' ? a.segments : kind === 'NETWORK_NODE' ? a.networkNodes : kind === 'PHYSICAL_ELEMENT' ? a.physicalElements : [];
  const shown = simple.filter((o) => !filter || o.label.toLowerCase().includes(filter.toLowerCase())).slice(0, 300);
  const typ = a.typologies.find((t) => t.id === typologyId);
  const unit = typ?.units.find((u) => u.id === unitId);
  const currentId = value && value.kind !== 'TYPOLOGY_ELEMENT' ? value.id : '';
  const currentKey = value?.kind === 'TYPOLOGY_ELEMENT' ? value.elementKey : '';
  return (
    <fieldset className="flex flex-col gap-3 border border-line p-3">
      <legend className="px-1 text-[13px] font-medium text-graphite-800">Onde (âncora física)</legend>
      <SelectField label="Tipo de âncora" value={kind} onChange={(e) => { setKind(e.target.value as AnchorInput['kind']); onChange(null); setFilter(''); }}>
        {ANCHOR_KINDS.map((k) => <option key={k.kind} value={k.kind}>{k.label}</option>)}
      </SelectField>
      {kind !== 'TYPOLOGY_ELEMENT' ? (
        <>
          <TextField label="Filtrar" type="search" value={filter} onChange={(e) => setFilter(e.target.value)} />
          <SelectField label="Âncora" size={6} value={currentId} onChange={(e) => onChange(e.target.value ? { kind, id: e.target.value } as AnchorInput : null)}>
            {shown.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
          </SelectField>
          {shown.length === 0 && <p className="text-[13px] text-muted">Nada cadastrado deste tipo.</p>}
        </>
      ) : (
        <>
          <SelectField label="Tipologia" value={typologyId} onChange={(e) => { setTypologyId(e.target.value); setUnitId(''); onChange(null); }}>
            <option value="">Selecione</option>
            {a.typologies.map((t) => <option key={t.id} value={t.id}>{t.code} — {t.name} ({t.units.length} un.)</option>)}
          </SelectField>
          {typ && (
            <>
              <SelectField label="Aplicar a" value={unitId} onChange={(e) => { setUnitId(e.target.value); onChange(null); }}
                hint={unitId ? 'Medição própria desta unidade: substitui a da tipologia para ela, sem somar.' : 'Vale para todas as unidades da tipologia em que o elemento existe.'}>
                <option value="">Todas as unidades da tipologia</option>
                {typ.units.map((u) => <option key={u.id} value={u.id}>Somente {u.label}</option>)}
              </SelectField>
              <SelectField label="Elemento" value={currentKey} onChange={(e) => onChange(e.target.value ? { kind: 'TYPOLOGY_ELEMENT', typologyId: typ.id, elementKey: e.target.value, unitId: unitId || null } : null)}>
                <option value="">Selecione</option>
                {typ.elements.map((el) => <option key={el.key} value={el.key}>{' '.repeat(el.depth * 2)}{el.label}</option>)}
                {unit?.extraElements.map((el) => <option key={el.key} value={el.key}>{el.label} (incluído na unidade)</option>)}
              </SelectField>
              {typ.elements.length === 0 && <p className="text-[13px] text-muted">A tipologia ainda não tem elementos. Monte e publique uma revisão em Construtivo.</p>}
            </>
          )}
        </>
      )}
    </fieldset>
  );
}
