import type { MemoryDto } from '@eapq/contracts';
import { fmtQty } from '../../lib/format';

/** Memória de cálculo legível: entradas, conversões, expressão substituída e resultado. */
export function MemoryView({ memory: m }: { memory: MemoryDto }) {
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
