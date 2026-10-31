// Small presentational pieces of the chat transcript.
import { memo, useEffect, useRef, useState, type ReactNode } from 'react';
import { ChevronRight, Circle, CircleCheck, CircleX, Info, Layers, Lightbulb, ListChecks, Sparkles, Telescope, TriangleAlert } from 'lucide-react';
import type { ChatMessage, TodoItem, ToolCall } from '@hearth/shared';
import type { Notice } from './useThread';
import { Markdown } from '../components/Markdown';
import { cx, Spinner } from '../components/ui';

export const Reasoning = memo(function Reasoning({ text, live }: { text: string; live?: boolean }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (live && ref.current) ref.current.scrollTop = ref.current.scrollHeight;
  }, [text, live]);
  if (!text.trim() && !live) return null;
  const tokens = Math.max(1, Math.round(text.length / 4));
  return (
    <div className="text-[13px]">
      <button type="button" aria-expanded={open} onClick={() => setOpen(!open)} className="group inline-flex items-center gap-1.5 rounded-md py-0.5 text-fg-subtle hover:text-fg-muted">
        <Lightbulb className={cx('h-3.5 w-3.5', live && 'text-accent')} />
        {live ? <span className="shimmer font-medium">Thinking</span> : <span>Thought</span>}
        {!live && <span className="text-fg-faint">· ~{tokens.toLocaleString('en-US')} tokens</span>}
        <ChevronRight className={cx('h-3 w-3 text-fg-faint transition-transform duration-150', open && 'rotate-90')} />
      </button>
      {(open || (live && text.trim())) && (
        <div
          ref={ref}
          className={cx(
            'mt-1 ml-[7px] overflow-y-auto border-l-2 border-line pl-4 text-[12.5px] leading-relaxed whitespace-pre-wrap text-fg-subtle',
            open ? 'max-h-80' : 'max-h-24 [mask-image:linear-gradient(to_bottom,transparent,black_40%)] [scrollbar-width:none]',
          )}
        >
          {text}
        </div>
      )}
    </div>
  );
});

export function PlanCard({ todos, running }: { todos: TodoItem[]; running: boolean }) {
  const [userOpen, setOpen] = useState<boolean | null>(null);
  if (!todos.length) return null;
  const done = todos.filter((t) => t.status === 'completed').length;
  const total = todos.filter((t) => t.status !== 'cancelled').length || todos.length;
  const current = running ? todos.find((t) => t.status === 'in_progress') : undefined;
  const finished = done >= total;
  const open = userOpen ?? false;
  return (
    <div className="sticky top-0 z-10 -mt-3 mb-2 bg-[linear-gradient(to_bottom,var(--hx-canvas)_70%,transparent)] pt-3 pb-3">
    <div className="overflow-hidden rounded-xl border border-line bg-overlay shadow-card">
      <button type="button" aria-expanded={open} className="flex w-full items-center gap-3 px-3.5 py-2.5 text-left" onClick={() => setOpen(!open)}>
        <span className={cx('flex h-6 w-6 shrink-0 items-center justify-center rounded-md', finished ? 'bg-ok/12 text-ok-ink' : 'bg-accent/12 text-accent-ink')}>
          <ListChecks className="h-3.5 w-3.5" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2 text-[13px]">
            <span className="font-semibold text-fg">Plan</span>
            <span className="text-fg-subtle tabular-nums">
              {done} of {total} done
            </span>
          </span>
          {!open && current && <span className="block truncate text-xs text-fg-muted">Now: {current.content}</span>}
        </span>
        <span className="hidden w-28 gap-0.5 sm:flex" aria-hidden>
          {todos
            .filter((t) => t.status !== 'cancelled')
            .map((t) => (
              <span key={t.id} className={cx('h-1.5 flex-1 rounded-full', t.status === 'completed' ? 'bg-ok' : t.status === 'in_progress' ? (running ? 'animate-pulse bg-accent' : 'bg-accent/50') : 'bg-line-strong')} />
            ))}
        </span>
        <ChevronRight className={cx('h-3.5 w-3.5 shrink-0 text-fg-faint transition-transform duration-150', open && 'rotate-90')} />
      </button>
      {open && (
        <ul className="max-h-[32vh] animate-slide-up space-y-1.5 overflow-y-auto border-t border-line px-3.5 py-2.5">
          {todos.map((t) => (
            <li key={t.id} className={cx('flex items-start gap-2.5 text-[13px]', t.status === 'completed' ? 'text-fg-subtle line-through decoration-fg-faint' : t.status === 'in_progress' ? 'font-medium text-fg' : t.status === 'cancelled' ? 'text-fg-faint line-through' : 'text-fg-muted')}>
              {t.status === 'completed' ? (
                <CircleCheck className="mt-0.5 h-4 w-4 shrink-0 text-ok" />
              ) : t.status === 'in_progress' && running ? (
                <Spinner className="mt-0.5 h-4 w-4 shrink-0" />
              ) : t.status === 'cancelled' ? (
                <CircleX className="mt-0.5 h-4 w-4 shrink-0" />
              ) : (
                <Circle className="mt-0.5 h-4 w-4 shrink-0 text-fg-faint" />
              )}
              {t.content}
            </li>
          ))}
        </ul>
      )}
    </div>
    </div>
  );
}

const noticeTone: Record<Notice['kind'], string> = {
  error: 'border-danger/30 bg-danger/[0.07] text-danger-ink',
  warn: 'border-warn/30 bg-warn/[0.07] text-warn-ink',
  info: 'border-line bg-surface text-fg-muted',
  compacted: 'border-line bg-surface text-fg-muted',
  verification: '',
};

export function NoticeView({ n }: { n: Notice }) {
  const [open, setOpen] = useState(false);
  const tone = n.kind === 'verification' ? (n.passed ? 'border-ok/30 bg-ok/[0.07] text-ok-ink' : 'border-danger/30 bg-danger/[0.07] text-danger-ink') : noticeTone[n.kind];
  const Icon = n.kind === 'compacted' ? Layers : n.kind === 'error' || n.kind === 'warn' ? TriangleAlert : n.kind === 'verification' ? (n.passed ? CircleCheck : CircleX) : Info;
  return (
    <div className={cx('rounded-lg border px-3 py-2 text-[12.5px]', tone)} role={n.kind === 'error' ? 'alert' : undefined}>
      <button type="button" className="flex w-full items-center gap-2 text-left" onClick={() => n.detail && setOpen(!open)} aria-expanded={n.detail ? open : undefined}>
        <Icon className="h-3.5 w-3.5 shrink-0" />
        <span className="flex-1">{n.text}</span>
        {n.detail && <ChevronRight className={cx('h-3 w-3 transition-transform', open && 'rotate-90')} />}
      </button>
      {open && n.detail && (n.kind === 'compacted' ? <Markdown text={n.detail} className="mt-2 text-xs text-fg-muted" /> : <pre className="mt-2 max-h-60 overflow-auto font-mono text-[11.5px] whitespace-pre-wrap text-fg-muted">{n.detail}</pre>)}
    </div>
  );
}

export function HarnessNote({ m }: { m: ChatMessage }) {
  const [open, setOpen] = useState(false);
  const first = m.content.replace(/^\[harness\]\s*/, '').split('\n')[0];
  return (
    <div className="text-xs text-fg-subtle">
      <button type="button" aria-expanded={open} onClick={() => setOpen(!open)} className="flex max-w-full items-center gap-1.5 rounded-md py-0.5 hover:text-fg-muted">
        <Sparkles className="h-3.5 w-3.5 shrink-0 text-accent" />
        <span className="font-medium">Harness</span>
        <span className="max-w-[60ch] min-w-0 truncate">{first}</span>
        <ChevronRight className={cx('h-3 w-3 shrink-0 transition-transform', open && 'rotate-90')} />
      </button>
      {open && <pre className="mt-1.5 ml-5 max-h-60 overflow-auto rounded-lg border border-line bg-code p-2.5 font-mono text-[11.5px] whitespace-pre-wrap text-fg-muted">{m.content}</pre>}
    </div>
  );
}

const exploreNoun: Record<string, [string, string]> = {
  read_file: ['file', 'files'],
  list_dir: ['folder', 'folders'],
  glob: ['search', 'searches'],
  grep: ['search', 'searches'],
  memory_search: ['memory lookup', 'memory lookups'],
  load_skill: ['skill', 'skills'],
};

export function exploreSummary(calls: ToolCall[]) {
  const counts = new Map<string, number>();
  for (const c of calls) {
    const [one] = exploreNoun[c.name] ?? [c.name];
    counts.set(one, (counts.get(one) ?? 0) + 1);
  }
  return [...counts]
    .map(([one, n]) => {
      const many = Object.values(exploreNoun).find(([o]) => o === one)?.[1] ?? one;
      return `${n} ${n === 1 ? one : many}`;
    })
    .join(', ');
}

/** Folded run of read-only lookups ("Explored 4 files, 2 searches"). */
export function ExploreGroup({ calls, children }: { calls: ToolCall[]; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button type="button" aria-expanded={open} onClick={() => setOpen(!open)} className="group inline-flex max-w-full items-center gap-2 rounded-md py-0.5 text-[13px] text-fg-subtle hover:text-fg-muted">
        <Telescope className="h-3.5 w-3.5 shrink-0" />
        <span className="font-medium text-fg-muted">Explored</span>
        <span className="truncate">{exploreSummary(calls)}</span>
        <ChevronRight className={cx('h-3 w-3 shrink-0 text-fg-faint transition-transform duration-150', open && 'rotate-90')} />
      </button>
      {open && <div className="mt-2 ml-[7px] animate-slide-up space-y-1.5 border-l-2 border-line pl-4">{children}</div>}
    </div>
  );
}
