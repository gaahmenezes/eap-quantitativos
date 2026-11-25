import { forwardRef, useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';

const control =
  'w-full rounded-md border border-line-strong bg-sheet px-3 text-[14px] text-ink shadow-xs transition-[border-color,box-shadow] duration-150 placeholder:text-graphite-400 hover:border-graphite-400 focus:border-cyan-ink focus:outline-none focus:ring-[3px] focus:ring-cyan-ink/15 disabled:bg-paper disabled:text-muted aria-[invalid=true]:border-danger aria-[invalid=true]:focus:ring-danger/15';
/** Seta do select desenhada (o nativo varia entre navegadores). */
const chevron =
  "appearance-none bg-[length:16px_16px] bg-[right_10px_center] bg-no-repeat pr-9 bg-[url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%235b6579' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E\")]";

interface FieldShellProps {
  label: string;
  error?: string;
  hint?: ReactNode;
  children: (id: string, describedBy: string | undefined) => ReactNode;
}

export function FieldShell({ label, error, hint, children }: FieldShellProps) {
  const id = useId();
  const msgId = `${id}-msg`;
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-[13px] font-medium text-ink/80">
        {label}
      </label>
      {children(id, error || hint ? msgId : undefined)}
      {error ? (
        <p id={msgId} className="text-[12.5px] text-danger">
          {error}
        </p>
      ) : hint ? (
        <p id={msgId} className="text-[12.5px] text-muted">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

type Common = { label: string; error?: string; hint?: ReactNode };

export const TextField = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & Common>(
  function TextField({ label, error, hint, className = '', ...rest }, ref) {
    return (
      <FieldShell label={label} error={error} hint={hint}>
        {(id, d) => (
          <input ref={ref} id={id} aria-describedby={d} aria-invalid={!!error} className={`${control} h-9 ${className}`} {...rest} />
        )}
      </FieldShell>
    );
  },
);

export const TextArea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement> & Common>(
  function TextArea({ label, error, hint, className = '', ...rest }, ref) {
    return (
      <FieldShell label={label} error={error} hint={hint}>
        {(id, d) => (
          <textarea ref={ref} id={id} aria-describedby={d} aria-invalid={!!error} className={`${control} min-h-24 py-2 ${className}`} {...rest} />
        )}
      </FieldShell>
    );
  },
);

export const SelectField = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement> & Common>(
  function SelectField({ label, error, hint, className = '', children, ...rest }, ref) {
    return (
      <FieldShell label={label} error={error} hint={hint}>
        {(id, d) => (
          <select ref={ref} id={id} aria-describedby={d} aria-invalid={!!error} className={`${control} ${rest.multiple || rest.size ? 'py-1' : `h-9 ${chevron}`} ${className}`} {...rest}>
            {children}
          </select>
        )}
      </FieldShell>
    );
  },
);
