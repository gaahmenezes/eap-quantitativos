import { useEffect, useRef, useState } from 'react';
import { downloadFile, errorMessage } from '../lib/api';
import { Button } from './ui/button';

/** Botão "Exportar" com escolha de formato. `path` = rota POST de exportação; `body` = relatório e parâmetros. */
export function ExportButton({ path, body, formats = ['xlsx', 'csv', 'pdf'], label = 'Exportar' }: { path: string; body: Record<string, unknown>; formats?: ('xlsx' | 'csv' | 'pdf')[]; label?: string }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);
  const go = async (format: string) => {
    setBusy(true); setError(null); setOpen(false);
    try { await downloadFile('POST', path, { ...body, format }); } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  };
  const NAMES = { xlsx: 'Planilha (XLSX)', csv: 'Texto separado (CSV)', pdf: 'Relatório (PDF)' } as const;
  return (
    <div ref={ref} className="relative inline-block">
      <Button busy={busy} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((x) => !x)}>{label}</Button>
      {open && (
        <ul role="menu" className="absolute right-0 z-20 mt-1 min-w-[200px] border border-line bg-sheet py-1 shadow-sm">
          {formats.map((f) => <li key={f}><button type="button" role="menuitem" className="block w-full px-3 py-1.5 text-left text-[13.5px] hover:bg-cyan-wash" onClick={() => go(f)}>{NAMES[f]}</button></li>)}
        </ul>
      )}
      {error && <p role="alert" className="absolute right-0 mt-1 w-64 text-[12.5px] text-danger">{error}</p>}
    </div>
  );
}
