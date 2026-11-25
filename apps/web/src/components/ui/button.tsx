import type { ButtonHTMLAttributes, ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
type Size = 'sm' | 'md';
const styles: Record<Variant, string> = {
  primary:
    'bg-cyan-ink text-white shadow-[inset_0_1px_0_rgb(255_255_255/0.14),0_1px_2px_rgb(16_24_40/0.12)] hover:bg-cyan-ink-dark disabled:bg-graphite-400 disabled:shadow-none',
  secondary: 'bg-sheet text-ink border border-line-strong shadow-xs hover:bg-paper hover:border-graphite-400 disabled:text-graphite-400 disabled:hover:bg-sheet',
  ghost: 'text-cyan-ink hover:bg-cyan-wash disabled:text-graphite-400 disabled:hover:bg-transparent',
  danger: 'bg-danger text-white shadow-[inset_0_1px_0_rgb(255_255_255/0.12)] hover:brightness-95 disabled:bg-graphite-400',
};
const sizes: Record<Size, string> = { sm: 'h-8 px-2.5 text-[13px] gap-1.5', md: 'h-9 px-3.5 text-[14px] gap-2' };

export function Button({
  variant = 'secondary',
  size = 'md',
  busy = false,
  icon: Icon,
  className = '',
  children,
  disabled,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: Size; busy?: boolean; icon?: LucideIcon; children?: ReactNode }) {
  return (
    <button
      {...rest}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      className={`inline-flex shrink-0 items-center justify-center rounded-md font-medium whitespace-nowrap transition-[background-color,border-color,box-shadow,color] duration-150 disabled:cursor-not-allowed ${sizes[size]} ${styles[variant]} ${className}`}
    >
      {busy ? (
        <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-r-transparent" aria-hidden />
      ) : Icon ? (
        <Icon className="h-4 w-4 shrink-0" strokeWidth={2} aria-hidden />
      ) : null}
      {children}
    </button>
  );
}
