import { forwardRef, useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';

const control =
  'w-full rounded-[3px] border border-line-strong bg-sheet px-2.5 text-[14px] text-ink placeholder:text-graphite-400 focus:border-cyan-ink focus:outline-none focus-visible:outline-2 focus-visible:outline-signal aria-[invalid=true]:border-danger';

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
      <label htmlFor={id} className="text-[13px] font-medium text-graphite-800">
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
          <select ref={ref} id={id} aria-describedby={d} aria-invalid={!!error} className={`${control} h-9 ${className}`} {...rest}>
            {children}
          </select>
        )}
      </FieldShell>
    );
  },
);
