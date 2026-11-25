import type { MemoryDto } from '@eapq/contracts';
import { fmtQty } from '../../lib/format';

/** Memória de cálculo legível: entradas, conversões, expressão substituída e resultado. */
export function MemoryView({ memory: m }: { memory: MemoryDto }) {
  if (m.method === 'SHEET' && m.sheet) return <SheetMemory memory={m} />;
  return (
    <div className="flex flex-col gap-2 text-[13px]">
      {m.method === 'FORMULA' ? (
        <p>
          <span className="text-muted">Fórmula </span>
          {m.formula && <span className="font-mono">{m.formula.code} R{m.formula.versionNumber}</span>}
          {m.formula && <span className="text-muted"> — {m.formula.name}</span>}
          <span className="block font-mono text-[12.5px]">{m.expression}</span>
        </p>
      ) : (
        <p className="text-muted">Quantidade informada manualmente.</p>
      )}
      <table className="w-full border border-line text-left">
        <thead className="bg-paper text-[12px] text-muted">
          <tr><th className="px-2 py-1 font-normal">Variável</th><th className="px-2 py-1 text-right font-normal">Informado</th><th className="px-2 py-1 text-right font-normal">Na base</th></tr>
        </thead>
        <tbody>
          {m.inputs.map((i) => (
            <tr key={i.symbol} className="border-t border-line">
              <td className="px-2 py-1"><span className="font-mono">{i.symbol}</span> <span className="text-muted">{i.label}</span></td>
              <td className="px-2 py-1 text-right font-mono">{fmtQty(i.value)} {i.unit}</td>
              <td className="px-2 py-1 text-right font-mono">{fmtQty(i.baseValue)}{i.baseUnit !== '1' && ` ${i.baseUnit}`}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {m.substituted && <p className="font-mono text-[12.5px]"><span className="text-muted">= </span>{m.substituted.replace(/(\d)\.(\d)/g, '$1,$2')}</p>}
      <p className="font-mono">
        <span className="text-muted">= </span>
        {m.resultBaseUnit === m.unit ? <strong>{fmtQty(m.result)} {m.unit}</strong> : (
          <>{fmtQty(m.resultBase)}{m.resultBaseUnit !== '1' && ` ${m.resultBaseUnit}`} <span className="text-muted">→</span> <strong>{fmtQty(m.result)} {m.unit}</strong></>
        )}
      </p>
    </div>
  );
}

/** Memória de medição lançada por ficha: modelo, coluna somada, parâmetros e contribuição de cada linha. */
function SheetMemory({ memory: m }: { memory: MemoryDto }) {
  const s = m.sheet!;
  return (
    <div className="flex flex-col gap-2 text-[13px]">
      <p>
        <span className="text-muted">Ficha </span><span className="font-medium">{s.title}</span>
        <span className="text-muted"> · modelo </span><span className="font-mono">{s.template.code} R{s.template.versionNumber}</span>
        <span className="block"><span className="text-muted">Soma da coluna </span>{s.column.label}{s.column.expression && <span className="font-mono text-[12.5px] text-muted"> = {s.column.expression}</span>}</span>
      </p>
      {s.params.length > 0 && (
        <p className="text-[12.5px]"><span className="text-muted">Parâmetros: </span>{s.params.map((x) => `${x.label} ${fmtQty(x.value)} ${x.unit}`).join(' · ')}</p>
      )}
      <div className="max-h-72 overflow-auto border border-line">
        <table className="w-full text-left">
          <thead className="sticky top-0 bg-paper text-[12px] text-muted"><tr><th className="px-2 py-1 font-normal">Linha</th><th className="px-2 py-1 font-normal">Identificação</th><th className="px-2 py-1 text-right font-normal">{s.column.label}</th></tr></thead>
          <tbody>
            {s.rows.map((r) => (
              <tr key={r.index} className="border-t border-line">
                <td className="px-2 py-1 font-mono text-muted">{r.index}</td>
                <td className="px-2 py-1">{r.label}</td>
                <td className="px-2 py-1 text-right font-mono">{fmtQty(r.value)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {s.skippedRows > 0 && <p className="text-[12px] text-muted">{s.skippedRows} linha(s) em branco ignorada(s).</p>}
      <p className="font-mono">
        <span className="text-muted">Σ = </span>{fmtQty(s.total)} {s.totalUnit}
        {s.totalUnit !== m.unit && <><span className="text-muted"> → </span><strong>{fmtQty(m.result)} {m.unit}</strong></>}
        {s.totalUnit === m.unit && <strong className="sr-only"> {fmtQty(m.result)} {m.unit}</strong>}
      </p>
    </div>
  );
}
