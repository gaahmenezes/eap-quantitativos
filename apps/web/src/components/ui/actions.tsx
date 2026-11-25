import { useState } from 'react';
import { useQueryClient, type QueryKey } from '@tanstack/react-query';
import { Archive } from 'lucide-react';
import { ApiError, errorMessage } from '../../lib/api';
import { Button } from './button';
import { TextField } from './field';
import { ConfirmDialog } from './panel';

/** Executa uma ação na API, invalida as consultas afetadas e guarda o erro para exibição. */
export function useAction(invalidate: QueryKey[]) {
  const qc = useQueryClient();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  /** Retorna o resultado (ou `true` quando a resposta não tem corpo); `false` indica erro já exibido. */
  const run = async <T,>(fn: () => Promise<T>): Promise<T | true | false> => {
    setPending(true);
    setError(null);
    setFieldErrors({});
    try {
      const r = await fn();
      await Promise.all(invalidate.map((k) => qc.invalidateQueries({ queryKey: k })));
      return r === undefined ? true : r;
    } catch (e) {
      setError(errorMessage(e));
      if (e instanceof ApiError) setFieldErrors(e.fieldErrors());
      return false;
    } finally {
      setPending(false);
    }
  };
  return { run, pending, error, fieldErrors, clear: () => { setError(null); setFieldErrors({}); } };
}

/** Botão de arquivamento com motivo obrigatório (nada é apagado). */
export function ArchiveButton({ label = 'Arquivar', what, onConfirm, variant = 'ghost' }: {
  label?: string;
  what: string;
  onConfirm: (reason: string) => Promise<unknown>;
  variant?: 'ghost' | 'secondary';
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <>
      <Button variant={variant} icon={Archive} onClick={() => { setReason(''); setOpen(true); }}>{label}</Button>
      <ConfirmDialog open={open} onClose={() => setOpen(false)} title={`${label} ${what}`}
        footer={<>
          <Button variant="ghost" onClick={() => setOpen(false)}>Cancelar</Button>
          <Button variant="danger" disabled={!reason.trim()} busy={busy} onClick={async () => {
            setBusy(true);
            try { await onConfirm(reason.trim()); } finally { setBusy(false); setOpen(false); }
          }}>{label}</Button>
        </>}>
        <p className="mb-3">O registro deixa de aparecer como ativo e permanece no histórico. Nada é apagado.</p>
        <TextField label="Motivo" value={reason} onChange={(e) => setReason(e.target.value)} />
      </ConfirmDialog>
    </>
  );
}
