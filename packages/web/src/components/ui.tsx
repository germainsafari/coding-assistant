import { useEffect, useId, useRef, useState, type ButtonHTMLAttributes, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react';
import { Check, Copy, LoaderCircle, X } from 'lucide-react';

export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ');

type Variant = 'primary' | 'accent' | 'secondary' | 'ghost' | 'danger' | 'danger-ghost';
const variants: Record<Variant, string> = {
  primary: 'bg-primary text-primary-fg hover:bg-primary-hover shadow-card disabled:opacity-40',
  accent: 'bg-accent text-white hover:bg-accent-hover shadow-card disabled:opacity-40',
  secondary: 'border border-line-strong bg-surface text-fg hover:bg-raised shadow-card disabled:opacity-50',
  ghost: 'text-fg-muted hover:bg-raised hover:text-fg disabled:opacity-40',
  danger: 'bg-danger text-white hover:brightness-110 shadow-card disabled:opacity-50',
  'danger-ghost': 'text-danger-ink hover:bg-danger/10 disabled:opacity-40',
};
const sizes = { xs: 'h-6 px-2 text-xs gap-1 rounded-md', sm: 'h-7 px-2.5 text-xs gap-1.5 rounded-md', md: 'h-8 px-3 text-[13px] gap-1.5 rounded-lg', lg: 'h-9 px-4 text-sm gap-2 rounded-lg' };

export function Button({ variant = 'secondary', size = 'md', className = '', children, type = 'button', ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: keyof typeof sizes }) {
  return (
    <button type={type} className={cx('inline-flex shrink-0 items-center justify-center font-medium whitespace-nowrap transition-[background-color,color,box-shadow,opacity] duration-150 select-none', sizes[size], variants[variant], className)} {...rest}>
      {children}
    </button>
  );
}

const iconSizes = { sm: 'h-6 w-6 rounded-md', md: 'h-7 w-7 rounded-md', lg: 'h-8 w-8 rounded-lg' };

/** Icon-only button. `label` is the accessible name and tooltip; `shortcut` is appended to the tooltip. */
export function IconButton({ label, shortcut, className = '', children, active, size = 'md', type = 'button', ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string; shortcut?: string; active?: boolean; size?: keyof typeof iconSizes }) {
  return (
    <button
      type={type}
      title={shortcut ? `${label} (${shortcut})` : label}
      aria-label={label}
      aria-pressed={active}
      className={cx(
        'inline-flex shrink-0 items-center justify-center transition-colors duration-150 disabled:pointer-events-none disabled:opacity-40',
        iconSizes[size],
        active ? 'bg-raised text-fg' : 'text-fg-subtle hover:bg-raised hover:text-fg',
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}

export const Spinner = ({ className = 'h-4 w-4' }: { className?: string }) => <LoaderCircle aria-hidden className={cx('animate-spin text-accent', className)} />;

export function Kbd({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <kbd className={cx('inline-flex h-[18px] min-w-[18px] items-center justify-center rounded border border-line-strong bg-surface px-1 font-sans text-[10.5px] font-medium text-fg-subtle shadow-[0_1px_0_var(--hx-line-strong)]', className)}>{children}</kbd>;
}

export function Keys({ keys, className = '' }: { keys: string[]; className?: string }) {
  return (
    <span className={cx('inline-flex items-center gap-0.5', className)}>
      {keys.map((k) => (
        <Kbd key={k}>{k}</Kbd>
      ))}
    </span>
  );
}

export type Tone = 'neutral' | 'accent' | 'ok' | 'danger' | 'warn' | 'info' | 'violet';
const toneCls: Record<Tone, string> = {
  neutral: 'bg-raised text-fg-muted border-line',
  accent: 'bg-accent/10 text-accent-ink border-accent/25',
  ok: 'bg-ok/10 text-ok-ink border-ok/25',
  danger: 'bg-danger/10 text-danger-ink border-danger/25',
  warn: 'bg-warn/10 text-warn-ink border-warn/25',
  info: 'bg-info/10 text-info-ink border-info/25',
  violet: 'bg-violet/10 text-violet border-violet/25',
};
export const dotCls: Record<Tone, string> = { neutral: 'bg-fg-faint', accent: 'bg-accent', ok: 'bg-ok', danger: 'bg-danger', warn: 'bg-warn', info: 'bg-info', violet: 'bg-violet' };

export function Badge({ children, tone = 'neutral', title, dot, className = '' }: { children: ReactNode; tone?: Tone; title?: string; dot?: boolean; className?: string }) {
  return (
    <span title={title} className={cx('inline-flex h-5 shrink-0 items-center gap-1 rounded-full border px-2 text-[11px] leading-none font-medium whitespace-nowrap', toneCls[tone], className)}>
      {dot && <span className={cx('h-1.5 w-1.5 rounded-full', dotCls[tone])} />}
      {children}
    </span>
  );
}

export function StatusDot({ tone, pulse, className = '' }: { tone: Tone; pulse?: boolean; className?: string }) {
  return (
    <span className={cx('relative inline-flex h-2 w-2 shrink-0', className)} aria-hidden>
      {pulse && <span className={cx('absolute inset-0 animate-ping rounded-full opacity-60', dotCls[tone])} />}
      <span className={cx('relative h-2 w-2 rounded-full', dotCls[tone])} />
    </span>
  );
}

const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';
const modalSizes = { sm: 'max-w-md', md: 'max-w-xl', lg: 'max-w-3xl', xl: 'max-w-5xl' };

export function Modal({
  title,
  description,
  onClose,
  children,
  size = 'md',
  footer,
  bare,
  position = 'center',
  className = '',
}: {
  title: ReactNode;
  description?: ReactNode;
  onClose: () => void;
  children: ReactNode;
  size?: keyof typeof modalSizes;
  footer?: ReactNode;
  /** no header (the title is still used as the accessible name) */
  bare?: boolean;
  position?: 'center' | 'top';
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    const el = ref.current;
    if (el && !el.contains(document.activeElement)) (el.querySelector<HTMLElement>('[data-autofocus]') ?? el).focus();
    return () => prev?.focus?.();
  }, []);

  const onKeyDown = (e: ReactKeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      onCloseRef.current();
      return;
    }
    if (e.key !== 'Tab' || !ref.current) return;
    const items = [...ref.current.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((x) => x.offsetParent !== null);
    if (!items.length) return;
    const [first, last] = [items[0], items[items.length - 1]];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };

  return (
    <div
      className={cx('fixed inset-0 z-50 flex animate-fade-in justify-center bg-[var(--hx-backdrop)] p-4 backdrop-blur-[2px]', position === 'top' ? 'items-start pt-[12vh]' : 'items-center')}
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onKeyDown={onKeyDown}
        className={cx('flex max-h-[88vh] w-full animate-pop-in flex-col overflow-hidden rounded-2xl border border-line bg-overlay shadow-pop outline-none', modalSizes[size], className)}
      >
        {bare ? (
          <h2 id={titleId} className="sr-only">
            {title}
          </h2>
        ) : (
          <div className="flex shrink-0 items-start justify-between gap-4 px-5 pt-4 pb-3">
            <div className="min-w-0">
              <h2 id={titleId} className="text-[15px] font-semibold tracking-tight text-fg">
                {title}
              </h2>
              {description && <p className="mt-0.5 text-[13px] text-fg-subtle">{description}</p>}
            </div>
            <IconButton label="Close" shortcut="Esc" onClick={onClose} className="-mr-1.5">
              <X className="h-4 w-4" />
            </IconButton>
          </div>
        )}
        <div className="min-h-0 flex-1 overflow-auto">{children}</div>
        {footer && <div className="flex shrink-0 justify-end gap-2 border-t border-line bg-panel/60 px-5 py-3">{footer}</div>}
      </div>
    </div>
  );
}

export function Tabs<T extends string>({
  tabs,
  value,
  onChange,
  className = '',
  variant = 'pill',
  label,
}: {
  tabs: { id: T; label: ReactNode; title?: string }[];
  value: T;
  onChange: (t: T) => void;
  className?: string;
  variant?: 'pill' | 'underline';
  label?: string;
}) {
  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    const i = tabs.findIndex((t) => t.id === value);
    const next = tabs[(i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length];
    onChange(next.id);
    requestAnimationFrame(() => e.currentTarget.querySelector<HTMLElement>('[aria-selected="true"]')?.focus());
  };
  return (
    <div role="tablist" aria-label={label} onKeyDown={onKeyDown} className={cx('flex items-center overflow-x-auto [scrollbar-width:none]', variant === 'pill' ? 'gap-0.5' : 'gap-4', className)}>
      {tabs.map((t) => {
        const on = value === t.id;
        return (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={on}
            tabIndex={on ? 0 : -1}
            title={t.title}
            onClick={() => onChange(t.id)}
            className={cx(
              'inline-flex shrink-0 items-center gap-1.5 text-[12.5px] font-medium whitespace-nowrap transition-colors duration-150',
              variant === 'pill'
                ? cx('h-7 rounded-md px-2.5', on ? 'bg-raised text-fg shadow-card' : 'text-fg-subtle hover:bg-raised/60 hover:text-fg')
                : cx('-mb-px h-9 border-b-2 px-0.5', on ? 'border-accent text-fg' : 'border-transparent text-fg-subtle hover:text-fg'),
            )}
          >
            {t.label}
          </button>
        );
      })}
    </div>
  );
}

export function Toggle({ checked, onChange, label, description }: { checked: boolean; onChange: (v: boolean) => void; label?: ReactNode; description?: ReactNode }) {
  const id = useId();
  return (
    <div className="flex items-start gap-3">
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={typeof label === 'string' ? label : undefined}
        onClick={() => onChange(!checked)}
        className={cx('relative mt-px h-5 w-9 shrink-0 rounded-full transition-colors duration-150', checked ? 'bg-accent' : 'bg-line-strong')}
      >
        <span className={cx('absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-[left] duration-150', checked ? 'left-[18px]' : 'left-0.5')} />
      </button>
      {(label || description) && (
        <label htmlFor={id} className="cursor-pointer text-[13px] select-none">
          {label && <span className="text-fg">{label}</span>}
          {description && <span className="block text-xs text-fg-subtle">{description}</span>}
        </label>
      )}
    </div>
  );
}

export function Empty({ icon, title, children, action, className = '' }: { icon?: ReactNode; title: string; children?: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={cx('flex h-full flex-col items-center justify-center gap-1.5 p-8 text-center', className)}>
      {icon && <div className="mb-2 flex h-11 w-11 items-center justify-center rounded-xl border border-line bg-surface text-fg-subtle shadow-card [&>svg]:h-5 [&>svg]:w-5">{icon}</div>}
      <div className="text-[13.5px] font-medium text-fg">{title}</div>
      {children && <div className="max-w-xs text-[12.5px] leading-relaxed text-fg-subtle">{children}</div>}
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}

export const Skeleton = ({ className = '' }: { className?: string }) => <div aria-hidden className={cx('skeleton', className)} />;

export function Section({ title, description, children, actions, className = '' }: { title: ReactNode; description?: ReactNode; children: ReactNode; actions?: ReactNode; className?: string }) {
  return (
    <section className={cx('rounded-xl border border-line bg-surface shadow-card', className)}>
      <div className="flex items-start justify-between gap-4 border-b border-line px-4 py-3">
        <div>
          <h3 className="text-[13.5px] font-semibold text-fg">{title}</h3>
          {description && <p className="mt-0.5 text-xs leading-relaxed text-fg-subtle">{description}</p>}
        </div>
        {actions}
      </div>
      <div className="p-4">{children}</div>
    </section>
  );
}

export function CopyButton({ text, className = '', label = 'Copy' }: { text: string | (() => string); className?: string; label?: string }) {
  const [done, setDone] = useState(false);
  useEffect(() => {
    if (!done) return;
    const t = setTimeout(() => setDone(false), 1400);
    return () => clearTimeout(t);
  }, [done]);
  return (
    <IconButton
      size="sm"
      label={done ? 'Copied' : label}
      className={className}
      onClick={(e) => {
        e.stopPropagation();
        void navigator.clipboard?.writeText(typeof text === 'function' ? text() : text).then(() => setDone(true));
      }}
    >
      {done ? <Check className="h-3.5 w-3.5 text-ok" /> : <Copy className="h-3.5 w-3.5" />}
    </IconButton>
  );
}

export const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
export const MOD = isMac ? '⌘' : 'Ctrl';

export const fmtMs = (ms?: number | null) => (ms == null ? '-' : ms < 1000 ? `${Math.round(ms)}ms` : ms < 60_000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`);
export const fmtNum = (n?: number | null) => (n == null ? '-' : n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 10_000 ? `${(n / 1000).toFixed(1)}k` : n.toLocaleString('en-US'));
export const fmtTime = (t: number) => new Date(t).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

/** "now", "5m", "3h", "2d", then a short date. */
export function relTime(t: number, now = Date.now()) {
  const s = Math.max(0, (now - t) / 1000);
  if (s < 45) return 'now';
  if (s < 3600) return `${Math.round(s / 60)}m`;
  if (s < 86_400) return `${Math.round(s / 3600)}h`;
  if (s < 7 * 86_400) return `${Math.round(s / 86_400)}d`;
  return new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
