import { useEffect, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { LoaderCircle, X } from 'lucide-react';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
const variants: Record<Variant, string> = {
  primary: 'bg-orange-600 text-white hover:bg-orange-500 disabled:bg-orange-900 disabled:text-orange-300/60',
  secondary: 'bg-zinc-800 text-zinc-100 hover:bg-zinc-700 border border-zinc-700 disabled:opacity-50',
  ghost: 'text-zinc-300 hover:bg-zinc-800 hover:text-zinc-100 disabled:opacity-40',
  danger: 'bg-rose-700 text-white hover:bg-rose-600 disabled:opacity-50',
};

export function Button({ variant = 'secondary', size = 'md', className = '', children, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: 'sm' | 'md' }) {
  const sz = size === 'sm' ? 'h-7 px-2 text-xs gap-1' : 'h-8 px-3 text-sm gap-1.5';
  return (
    <button className={`inline-flex shrink-0 items-center justify-center rounded-md font-medium transition-colors ${sz} ${variants[variant]} ${className}`} {...rest}>
      {children}
    </button>
  );
}

export function IconButton({ title, className = '', children, active, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { title: string; active?: boolean }) {
  return (
    <button
      title={title}
      aria-label={title}
      className={`inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md transition-colors disabled:opacity-40 ${active ? 'bg-zinc-800 text-orange-400' : 'text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100'} ${className}`}
      {...rest}
    >
      {children}
    </button>
  );
}

export const Spinner = ({ className = 'h-4 w-4' }: { className?: string }) => <LoaderCircle className={`animate-spin text-orange-400 ${className}`} />;

export function Modal({ title, onClose, children, wide, footer }: { title: ReactNode; onClose: () => void; children: ReactNode; wide?: boolean; footer?: ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" className={`flex max-h-[90vh] w-full flex-col overflow-hidden rounded-xl border border-zinc-700 bg-zinc-900 shadow-2xl ${wide ? 'max-w-5xl' : 'max-w-xl'}`}>
        <div className="flex items-center justify-between border-b border-zinc-800 px-4 py-3">
          <h2 className="text-base font-semibold text-zinc-100">{title}</h2>
          <IconButton title="Close" onClick={onClose}>
            <X className="h-4 w-4" />
          </IconButton>
        </div>
        <div className="min-h-0 flex-1 overflow-auto">{children}</div>
        {footer && <div className="flex justify-end gap-2 border-t border-zinc-800 px-4 py-3">{footer}</div>}
      </div>
    </div>
  );
}

export function Tabs<T extends string>({ tabs, value, onChange, className = '' }: { tabs: { id: T; label: ReactNode }[]; value: T; onChange: (t: T) => void; className?: string }) {
  return (
    <div className={`flex gap-1 overflow-x-auto [scrollbar-width:none] ${className}`}>
      {tabs.map((t) => (
        <button
          key={t.id}
          onClick={() => onChange(t.id)}
          className={`inline-flex shrink-0 items-center gap-1.5 rounded-md whitespace-nowrap px-2.5 py-1 text-xs font-medium transition-colors ${value === t.id ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-400 hover:bg-zinc-800/60 hover:text-zinc-200'}`}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

export function Badge({ children, tone = 'zinc', title }: { children: ReactNode; tone?: 'zinc' | 'green' | 'red' | 'amber' | 'blue' | 'orange'; title?: string }) {
  const tones = {
    zinc: 'bg-zinc-800 text-zinc-300 border-zinc-700',
    green: 'bg-emerald-950 text-emerald-300 border-emerald-800',
    red: 'bg-rose-950 text-rose-300 border-rose-800',
    amber: 'bg-amber-950 text-amber-300 border-amber-800',
    blue: 'bg-sky-950 text-sky-300 border-sky-800',
    orange: 'bg-orange-950 text-orange-300 border-orange-800',
  };
  return (
    <span title={title} className={`inline-flex items-center gap-1 whitespace-nowrap rounded border px-1.5 py-px text-[11px] font-medium ${tones[tone]}`}>
      {children}
    </span>
  );
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label?: ReactNode }) {
  return (
    <label className="inline-flex cursor-pointer items-center gap-2 text-sm text-zinc-300 select-none">
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`relative h-5 w-9 rounded-full transition-colors ${checked ? 'bg-orange-600' : 'bg-zinc-700'}`}
      >
        <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all ${checked ? 'left-[18px]' : 'left-0.5'}`} />
      </button>
      {label}
    </label>
  );
}

export function Empty({ icon, title, children }: { icon?: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center text-zinc-500">
      {icon}
      <div className="text-sm font-medium text-zinc-300">{title}</div>
      {children && <div className="max-w-sm text-xs">{children}</div>}
    </div>
  );
}

export const fmtMs = (ms?: number | null) => (ms == null ? '-' : ms < 1000 ? `${Math.round(ms)}ms` : ms < 60_000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.floor(ms / 60_000)}m${Math.round((ms % 60_000) / 1000)}s`);
export const fmtNum = (n?: number | null) => (n == null ? '-' : n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 10_000 ? `${(n / 1000).toFixed(1)}k` : n.toLocaleString('en-US'));
export const fmtTime = (t: number) => new Date(t).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
