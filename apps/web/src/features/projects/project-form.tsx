import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import {
  createProjectSchema,
  PROJECT_CLASSIFICATIONS,
  PROJECT_CLASSIFICATION_LABELS,
  type ProjectDto,
} from '@eapq/contracts';
import { Button } from '../../components/ui/button';
import { SelectField, TextArea, TextField } from '../../components/ui/field';
import { Notice } from '../../components/ui/feedback';
import { applyServerErrors } from '../auth/auth-pages';

const formSchema = createProjectSchema.extend({ reason: z.string().trim().max(500).optional() });
type FormValues = z.input<typeof formSchema>;
export type ProjectFormOutput = z.output<typeof formSchema>;

const CLASSIFICATION_HINT: Record<string, string> = {
  VERTICAL: 'Torres, blocos, pavimentos e apartamentos.',
  HORIZONTAL: 'Setores, quadras, lotes e casas.',
  LOTEAMENTO: 'Fases, quadras, lotes, ruas e redes de infraestrutura.',
  MISTO: 'Combina torres, casas, loteamento e áreas comuns no mesmo empreendimento.',
};

export function ProjectForm({
  initial,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  initial?: ProjectDto;
  submitLabel: string;
  onSubmit: (values: ProjectFormOutput) => Promise<unknown>;
  onCancel: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const form = useForm<FormValues, unknown, ProjectFormOutput>({
    resolver: zodResolver(formSchema),
    defaultValues: initial
      ? {
          code: initial.code,
          name: initial.name,
          description: initial.description ?? '',
          classification: initial.classification,
          location: initial.location ?? '',
        }
      : { classification: 'VERTICAL' },
  });
  const e = form.formState.errors;
  const classification = form.watch('classification');
  const submit = form.handleSubmit(async (values) => {
    setError(null);
    try {
      await onSubmit(values);
    } catch (err) {
      setError(applyServerErrors(err, form.setError));
    }
  });
  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-4">
      {error && <Notice tone="danger">{error}</Notice>}
      <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,2fr)] gap-3">
        <TextField label="Código" className="font-mono uppercase" {...form.register('code')} error={e.code?.message} />
        <TextField label="Nome" {...form.register('name')} error={e.name?.message} />
      </div>
      <SelectField label="Classificação" {...form.register('classification')} error={e.classification?.message} hint={CLASSIFICATION_HINT[classification ?? '']}>
        {PROJECT_CLASSIFICATIONS.map((c) => (
          <option key={c} value={c}>
            {PROJECT_CLASSIFICATION_LABELS[c]}
          </option>
        ))}
      </SelectField>
      <TextField label="Localização" {...form.register('location')} error={e.location?.message} hint="Município, UF ou endereço da obra" />
      <TextArea label="Descrição" {...form.register('description')} error={e.description?.message} />
      {initial && (
        <TextField label="Motivo da alteração" {...form.register('reason')} error={e.reason?.message} hint="Fica registrado no histórico do empreendimento" />
      )}
      <div className="flex justify-end gap-2 border-t border-line pt-4">
        <Button type="button" variant="ghost" onClick={onCancel}>Cancelar</Button>
        <Button type="submit" variant="primary" busy={form.formState.isSubmitting}>{submitLabel}</Button>
      </div>
    </form>
  );
}
