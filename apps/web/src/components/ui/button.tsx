import type { ButtonHTMLAttributes } from 'react';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
const styles: Record<Variant, string> = {
  primary: 'bg-cyan-ink text-white hover:bg-cyan-ink-dark disabled:bg-graphite-400',
  secondary: 'bg-sheet text-ink border border-line-strong hover:bg-cyan-wash disabled:text-graphite-400',
  ghost: 'text-cyan-ink hover:bg-cyan-wash disabled:text-graphite-400',
  danger: 'bg-danger text-white hover:brightness-90 disabled:bg-graphite-400',
};

export function Button({
  variant = 'secondary',
  busy = false,
  className = '',
  children,
  disabled,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; busy?: boolean }) {
  return (
    <button
      {...rest}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      className={`inline-flex h-9 items-center justify-center gap-2 rounded-[3px] px-3.5 text-[14px] font-medium transition-colors disabled:cursor-not-allowed ${styles[variant]} ${className}`}
    >
      {busy && <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-r-transparent" aria-hidden />}
      {children}
    </button>
  );
}
