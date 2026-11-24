import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { createTypologySchema, type TypologyDto } from '@eapq/contracts';
import { Button } from '../../components/ui/button';
import { EmptyState, ErrorState, Loading, Notice } from '../../components/ui/feedback';
import { SelectField, TextArea, TextField } from '../../components/ui/field';
import { SidePanel } from '../../components/ui/panel';
import { errorMessage } from '../../lib/api';
import { applyServerErrors } from '../auth/auth-pages';
import { useStructureMutations, useTypologies } from './api';

const KIND_LABEL = { APARTMENT: 'Apartamento', HOUSE: 'Casa' } as const;
type FormIn = z.input<typeof createTypologySchema>;
type FormOut = z.output<typeof createTypologySchema>;

const fmtArea = (v: string | null) => (v ? `${Number(v).toLocaleString('pt-BR', { maximumFractionDigits: 4 })} m²` : '—');

export function TypologiesTab({ projectId, canEdit }: { projectId: string; canEdit: boolean }) {
  const list = useTypologies(projectId);
  const mut = useStructureMutations(projectId);
  const [editing, setEditing] = useState<TypologyDto | 'new' | null>(null);
  const [msg, setMsg] = useState<{ tone: 'ok' | 'danger'; text: string } | null>(null);

  if (list.isPending) return <Loading />;
  if (list.isError) return <ErrorState message={errorMessage(list.error)} onRetry={() => list.refetch()} />;

  return (
    <div className="max-w-5xl">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-prose text-[14px] text-muted">Tipologias agrupam unidades com a mesma solução construtiva. Elementos, serviços e particularidades por unidade chegam nas próximas fases.</p>
        {canEdit && <Button variant="primary" onClick={() => setEditing('new')}>Nova tipologia</Button>}
      </div>
      {msg && <div className="mb-3"><Notice tone={msg.tone}>{msg.text}</Notice></div>}
      {list.data.length === 0 ? (
        <EmptyState title="Nenhuma tipologia cadastrada">Cadastre tipologias para vincular apartamentos e casas.</EmptyState>
      ) : (
        <div className="overflow-x-auto border border-line bg-sheet">
          <table className="w-full text-left text-[14px]">
            <thead className="border-b border-line-strong text-[13px] text-muted">
              <tr>
                <th className="px-3 py-2 font-medium">Código</th><th className="px-3 py-2 font-medium">Nome</th><th className="px-3 py-2 font-medium">Tipo</th>
                <th className="px-3 py-2 text-right font-medium">Área privativa</th><th className="px-3 py-2 text-right font-medium">Unidades</th>
                {canEdit && <th className="px-3 py-2"><span className="sr-only">Ações</span></th>}
              </tr>
            </thead>
            <tbody>
              {list.data.map((t) => (
                <tr key={t.id} className={`border-b border-line last:border-0 ${t.archivedAt ? 'text-graphite-400' : ''}`}>
                  <td className="px-3 py-2 font-mono text-[13px]">{t.code}</td>
                  <td className="px-3 py-2">{t.name}{t.archivedAt && <span className="ml-2 text-[12px]">arquivada</span>}</td>
                  <td className="px-3 py-2">{KIND_LABEL[t.kind]}</td>
                  <td className="px-3 py-2 text-right font-mono">{fmtArea(t.privateArea)}</td>
                  <td className="px-3 py-2 text-right font-mono">{t.unitCount}</td>
                  {canEdit && (
                    <td className="whitespace-nowrap px-3 py-2 text-right">
                      {!t.archivedAt && <button type="button" className="mr-3 text-[13px] text-cyan-ink hover:underline" onClick={() => setEditing(t)}>Editar</button>}
                      <button type="button" className="text-[13px] text-cyan-ink hover:underline" onClick={async () => {
                        setMsg(null);
                        try { await mut.archiveTypology.mutateAsync({ id: t.id, version: t.version, archived: !t.archivedAt }); setMsg({ tone: 'ok', text: t.archivedAt ? 'Tipologia reativada.' : 'Tipologia arquivada.' }); } catch (e) { setMsg({ tone: 'danger', text: errorMessage(e) }); }
                      }}>{t.archivedAt ? 'Reativar' : 'Arquivar'}</button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <SidePanel open={!!editing} title={editing === 'new' ? 'Nova tipologia' : 'Editar tipologia'} onClose={() => setEditing(null)}>
        {editing && (
          <TypologyForm
            initial={editing === 'new' ? undefined : editing}
            onCancel={() => setEditing(null)}
            onSubmit={async (v) => {
              if (editing === 'new') await mut.createTypology.mutateAsync(v);
              else {
                const { kind: _k, ...body } = v;
                await mut.updateTypology.mutateAsync({ id: editing.id, version: editing.version, body });
              }
              setEditing(null);
              setMsg({ tone: 'ok', text: 'Tipologia salva.' });
            }}
          />
        )}
      </SidePanel>
    </div>
  );
}

function TypologyForm({ initial, onSubmit, onCancel }: { initial?: TypologyDto; onSubmit: (v: FormOut) => Promise<void>; onCancel: () => void }) {
  const [error, setError] = useState<string | null>(null);
  const form = useForm<FormIn, unknown, FormOut>({
    resolver: zodResolver(createTypologySchema),
    defaultValues: initial
      ? { code: initial.code, name: initial.name, kind: initial.kind, description: initial.description ?? '', privateArea: initial.privateArea ?? undefined }
      : { kind: 'APARTMENT' },
  });
  const e = form.formState.errors;
  return (
    <form noValidate className="flex flex-col gap-4" onSubmit={form.handleSubmit(async (v) => {
      setError(null);
      try { await onSubmit({ ...v, privateArea: v.privateArea || null }); } catch (err) { setError(applyServerErrors(err, form.setError)); }
    })}>
      {error && <Notice tone="danger">{error}</Notice>}
      <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,2fr)] gap-3">
        <TextField label="Código" className="font-mono uppercase" {...form.register('code')} error={e.code?.message} />
        <TextField label="Nome" {...form.register('name')} error={e.name?.message} />
      </div>
      <SelectField label="Tipo" {...form.register('kind')} disabled={!!initial} hint={initial ? 'O tipo não muda depois de criado.' : undefined}>
        <option value="APARTMENT">Apartamento</option>
        <option value="HOUSE">Casa</option>
      </SelectField>
      <TextField label="Área privativa (m²)" inputMode="decimal" {...form.register('privateArea', { setValueAs: (v: string) => (v === '' ? undefined : v) })} error={e.privateArea?.message} />
      <TextArea label="Descrição" {...form.register('description')} error={e.description?.message} />
      <div className="flex justify-end gap-2 border-t border-line pt-4">
        <Button type="button" variant="ghost" onClick={onCancel}>Cancelar</Button>
        <Button type="submit" variant="primary" busy={form.formState.isSubmitting}>Salvar tipologia</Button>
      </div>
    </form>
  );
}
