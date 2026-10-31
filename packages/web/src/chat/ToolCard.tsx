import { memo, useEffect, useRef, useState, type ReactNode } from 'react';
import {
  Bot,
  BookOpen,
  Brain,
  Check,
  ChevronRight,
  FilePen,
  FilePlus2,
  FileSearch,
  FileText,
  FileX2,
  FolderTree,
  GitBranch,
  Globe,
  ListTodo,
  MessageCircleQuestion,
  Plug,
  Search,
  ShieldAlert,
  SpellCheck,
  SquareTerminal,
  Wrench,
  type LucideIcon,
} from 'lucide-react';
import type { ChatMessage, ToolCall } from '@hearth/shared';
import { api } from '../api';
import { errText, useStore } from '../store';
import { DiffStat, DiffView, diffStats } from '../components/Markdown';
import { Badge, Button, CopyButton, cx, fmtMs, Spinner } from '../components/ui';

const str = (v: unknown) => (typeof v === 'string' ? v : v === undefined ? '' : JSON.stringify(v));

/** Read-only lookups that the chat folds into an "Explored" group. */
const EXPLORE = new Set(['read_file', 'list_dir', 'glob', 'grep', 'memory_search', 'load_skill']);
export const isExploreCall = (c: ToolCall) => EXPLORE.has(c.name);

type Desc = { Icon: LucideIcon; tint: string; verb: string; target?: string };

function describe(call: ToolCall): Desc {
  const a = call.arguments ?? {};
  const t = (s: unknown, n = 140) => str(s).split('\n')[0].slice(0, n);
  switch (call.name) {
    case 'read_file':
      return { Icon: FileText, tint: 'text-info-ink', verb: 'Read', target: t(a.path) };
    case 'write_file':
      return { Icon: FilePlus2, tint: 'text-ok-ink', verb: 'Write', target: t(a.path) };
    case 'edit_file':
      return { Icon: FilePen, tint: 'text-warn-ink', verb: 'Edit', target: t(a.path) };
    case 'delete_file':
      return { Icon: FileX2, tint: 'text-danger-ink', verb: 'Delete', target: t(a.path) };
    case 'list_dir':
      return { Icon: FolderTree, tint: 'text-info-ink', verb: 'List', target: !t(a.path) || t(a.path) === '.' || t(a.path) === './' ? 'project root' : t(a.path) };
    case 'glob':
      return { Icon: FileSearch, tint: 'text-info-ink', verb: 'Find files', target: t(a.pattern) };
    case 'grep':
      return { Icon: Search, tint: 'text-info-ink', verb: 'Search', target: `${t(a.pattern, 80)}${a.glob ? `  in ${t(a.glob, 40)}` : ''}` };
    case 'run_shell':
      return { Icon: SquareTerminal, tint: 'text-fg', verb: a.background ? 'Start' : 'Run', target: t(a.command) };
    case 'shell_output':
      return { Icon: SquareTerminal, tint: 'text-fg', verb: 'Read output', target: a.id ? t(a.id) : undefined };
    case 'shell_kill':
      return { Icon: SquareTerminal, tint: 'text-danger-ink', verb: 'Stop process', target: t(a.id) };
    case 'update_plan':
      return { Icon: ListTodo, tint: 'text-accent-ink', verb: 'Updated the plan' };
    case 'ask_user':
      return { Icon: MessageCircleQuestion, tint: 'text-accent-ink', verb: 'Question for you' };
    case 'load_skill':
      return { Icon: BookOpen, tint: 'text-violet', verb: 'Load skill', target: t(a.name) };
    case 'spawn_subagent':
      return { Icon: Bot, tint: 'text-violet', verb: 'Subagent', target: t(a.task, 100) };
    case 'memory_save':
    case 'memory_search':
    case 'memory_delete':
    case 'update_project_notes':
      return { Icon: Brain, tint: 'text-violet', verb: call.name.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase()), target: a.query || a.content ? t(a.query ?? a.content, 80) : undefined };
    case 'web_fetch':
      return { Icon: Globe, tint: 'text-info-ink', verb: 'Fetch', target: t(a.url) };
    case 'web_search':
      return { Icon: Globe, tint: 'text-info-ink', verb: 'Web search', target: t(a.query) };
    case 'languagetool_check':
      return { Icon: SpellCheck, tint: 'text-ok-ink', verb: 'Grammar check' };
  }
  if (call.name.startsWith('browser_')) return { Icon: Globe, tint: 'text-info-ink', verb: `Browser ${call.name.slice(8)}`, target: a.url || a.text || a.selector ? t(a.url ?? a.text ?? a.selector, 80) : undefined };
  if (call.name.startsWith('git_') || call.name.startsWith('github_'))
    return { Icon: GitBranch, tint: 'text-violet', verb: call.name.replace(/_/g, ' ').replace(/^git /, 'Git ').replace(/^github /, 'GitHub '), target: a.message ? t(a.message, 80) : a.title ? t(a.title) : undefined };
  if (call.name.startsWith('mcp__')) {
    const [, server, tool] = call.name.split('__');
    return { Icon: Plug, tint: 'text-info-ink', verb: 'MCP', target: `${server}.${tool}` };
  }
  return { Icon: Wrench, tint: 'text-fg-muted', verb: call.name };
}

export function ToolIcon({ call, className = '' }: { call: ToolCall; className?: string }) {
  const { Icon, tint } = describe(call);
  return (
    <span className={cx('flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-line bg-raised', className)}>
      <Icon className={cx('h-3.5 w-3.5', tint)} />
    </span>
  );
}

export const toolLabel = (call: ToolCall) => {
  const d = describe(call);
  return d.target ? `${d.verb} ${d.target}` : d.verb;
};

function Label({ k, children, action }: { k: string; children: ReactNode; action?: ReactNode }) {
  return (
    <div className="space-y-1">
      <div className="flex h-5 items-center justify-between text-[11px] font-medium tracking-wide text-fg-subtle uppercase">
        {k}
        {action}
      </div>
      {children}
    </div>
  );
}

const pre = 'overflow-auto rounded-lg border border-line bg-code px-3 py-2 font-mono text-[12px] leading-[1.55] whitespace-pre-wrap';

function ArgsView({ call }: { call: ToolCall }) {
  const a = call.arguments ?? {};
  if (call.name === 'run_shell')
    return (
      <Label k="Command" action={<CopyButton text={str(a.command)} label="Copy command" />}>
        <pre className={cx(pre, 'text-fg')}>
          <span className="text-accent-ink select-none">$ </span>
          {str(a.command)}
        </pre>
      </Label>
    );
  if (call.name === 'write_file' || call.name === 'edit_file' || call.name === 'update_plan' || call.name === 'ask_user') return null;
  const entries = Object.entries(a);
  if (!entries.length) return null;
  return (
    <Label k="Arguments">
      <div className={cx(pre, 'space-y-0.5')}>
        {entries.map(([k, v]) => (
          <div key={k} className="flex gap-2">
            <span className="shrink-0 text-fg-subtle">{k}</span>
            <span className="min-w-0 break-words text-fg">{str(v).slice(0, 4000)}</span>
          </div>
        ))}
      </div>
    </Label>
  );
}

function LiveOutput({ text }: { text: string }) {
  const ref = useRef<HTMLPreElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.scrollTop = ref.current.scrollHeight;
  }, [text]);
  return (
    <Label k="Output">
      <pre ref={ref} className={cx(pre, 'max-h-72 text-fg-muted')}>
        {text.slice(-20000)}
      </pre>
    </Label>
  );
}

type Status = 'approval' | 'question' | 'running' | 'denied' | 'ok' | 'error';

function StatusPill({ status, ms }: { status: Status; ms?: number }) {
  const dur = ms != null && ms >= 100 ? <span className="text-[11px] text-fg-subtle tabular-nums">{fmtMs(ms)}</span> : null;
  switch (status) {
    case 'running':
      return (
        <Badge tone="accent">
          <Spinner className="h-3 w-3" /> Running
        </Badge>
      );
    case 'approval':
      return (
        <Badge tone="accent" dot>
          Needs approval
        </Badge>
      );
    case 'question':
      return (
        <Badge tone="accent" dot>
          Waiting for you
        </Badge>
      );
    case 'denied':
      return <Badge tone="neutral">Denied</Badge>;
    case 'error':
      return (
        <>
          {dur}
          <Badge tone="danger">Failed</Badge>
        </>
      );
    case 'ok':
      return (
        <>
          {dur}
          <Check className="h-3.5 w-3.5 text-ok" aria-label="Done" />
        </>
      );
  }
}

type Meta = { ok?: boolean; durationMs?: number; diff?: string; image?: string; denied?: boolean; truncated?: boolean; changedFiles?: string[] };

export const ToolCard = memo(function ToolCard(props: {
  call: ToolCall;
  result?: ChatMessage;
  running?: { output: string };
  approval?: { reason: string; preview?: string };
  question?: { question: string; options?: string[] };
  subagent?: { tools: string[]; text: string; status?: string };
  runId: string | null;
  compact?: boolean;
}) {
  const { call, result, running, approval, question, subagent, runId, compact } = props;
  const meta = (result?.meta ?? {}) as Meta;
  const setOpenFile = useStore((s) => s.setOpenFile);
  const d = describe(call);
  const stats = diffStats(meta.diff);
  const isEdit = call.name === 'edit_file' || call.name === 'write_file';
  const [open, setOpen] = useState<boolean | null>(null);
  const status: Status = approval ? 'approval' : question ? 'question' : running || !result ? 'running' : meta.denied ? 'denied' : meta.ok ? 'ok' : 'error';
  const attention = status === 'approval' || status === 'question';
  const expanded = open ?? (attention || (!!running && call.name === 'run_shell') || call.name === 'spawn_subagent');
  const bodyId = `tool-${call.id}`;

  return (
    <div
      className={cx(
        'overflow-hidden rounded-xl border transition-[border-color,box-shadow] duration-200',
        attention ? 'border-accent/55 bg-surface shadow-[0_0_0_4px_color-mix(in_oklab,var(--hx-accent)_12%,transparent)]' : status === 'error' ? 'border-danger/30 bg-surface' : 'border-line bg-surface',
        compact && 'rounded-lg',
      )}
    >
      <button type="button" aria-expanded={expanded} aria-controls={bodyId} onClick={() => setOpen(!expanded)} className="group flex w-full items-center gap-2.5 px-2.5 py-2 text-left hover:bg-raised/60">
        <ToolIcon call={call} />
        <span className="flex min-w-0 flex-1 items-baseline gap-1.5 text-[13px]">
          <span className="shrink-0 font-medium text-fg">{d.verb}</span>
          {d.target && (
            <span className="min-w-0 truncate font-mono text-[12px] text-fg-muted" title={d.target}>
              {d.target}
            </span>
          )}
        </span>
        {stats && (stats.add > 0 || stats.del > 0) && <DiffStat {...stats} />}
        <span className="flex shrink-0 items-center gap-2">
          <StatusPill status={status} ms={meta.durationMs} />
        </span>
        <ChevronRight className={cx('h-3.5 w-3.5 shrink-0 text-fg-faint transition-transform duration-150 group-hover:text-fg-subtle', expanded && 'rotate-90')} />
      </button>
      {expanded && (
        <div id={bodyId} className="animate-slide-up space-y-2.5 border-t border-line px-3 py-2.5">
          <ArgsView call={call} />
          {approval && runId && <ApprovalBox runId={runId} call={call} approval={approval} />}
          {question && runId && <QuestionBox runId={runId} callId={call.id} q={question} />}
          {call.name === 'ask_user' && !question && <div className="text-[13px] text-fg">{str(call.arguments.question)}</div>}
          {subagent && (
            <Label k={`Subagent activity${subagent.status ? ` · ${subagent.status}` : ''}`}>
              <div className="flex flex-wrap gap-1">
                {subagent.tools.map((t, i) => (
                  <Badge key={i}>{t}</Badge>
                ))}
                {!subagent.tools.length && <span className="text-xs text-fg-subtle">Starting…</span>}
              </div>
            </Label>
          )}
          {running?.output && <LiveOutput text={running.output} />}
          {meta.diff && <DiffView diff={meta.diff} />}
          {meta.image && <img src={meta.image} alt="Browser screenshot" className="max-h-80 rounded-lg border border-line" />}
          {result && !(isEdit && meta.diff && meta.ok) && call.name !== 'update_plan' && (
            <Label k={meta.ok ? 'Result' : 'Error'} action={<CopyButton text={result.content} label="Copy result" />}>
              <pre className={cx(pre, 'max-h-80', meta.ok ? 'text-fg-muted' : 'border-danger/30 text-danger-ink')}>{result.content}</pre>
            </Label>
          )}
          {meta.changedFiles?.length && !(isEdit && meta.diff) ? (
            <div className="flex flex-wrap gap-1.5">
              {meta.changedFiles.map((f) => (
                <button key={f} type="button" onClick={() => setOpenFile(f)} className="inline-flex items-center gap-1 rounded-md border border-line bg-raised px-2 py-0.5 font-mono text-[11px] text-fg-muted hover:border-line-strong hover:text-fg">
                  <FileText className="h-3 w-3" /> {f}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
});

function ApprovalBox({ runId, call, approval }: { runId: string; call: ToolCall; approval: { reason: string; preview?: string } }) {
  const [feedback, setFeedback] = useState('');
  const [busy, setBusy] = useState(false);
  const notify = useStore((s) => s.notify);
  const decide = async (decision: 'approved' | 'denied', always = false) => {
    setBusy(true);
    try {
      await api.approve(runId, call.id, { decision, feedback: feedback || undefined, always });
    } catch (e) {
      notify(errText(e), 'error');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="space-y-2.5 rounded-lg border border-accent/30 bg-accent/[0.06] p-3" role="group" aria-label="Approval required">
      <div className="flex items-start gap-2">
        <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-accent-ink" />
        <div>
          <div className="text-[13px] font-semibold text-fg">Approval required</div>
          <div className="text-xs text-fg-muted">{approval.reason}</div>
        </div>
      </div>
      {approval.preview && <DiffView diff={approval.preview} maxHeight="max-h-64" />}
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="primary" disabled={busy} onClick={() => decide('approved')}>
          <Check className="h-3.5 w-3.5" /> Approve
        </Button>
        <Button size="sm" disabled={busy} onClick={() => decide('approved', true)} title={`Don't ask again for ${call.name} during this run`}>
          Always allow <span className="font-mono text-[11px] text-fg-subtle">{call.name}</span>
        </Button>
        <Button size="sm" variant="danger-ghost" disabled={busy} onClick={() => decide('denied')}>
          Deny
        </Button>
        <input
          className="h-7 min-w-40 flex-1 py-0 text-xs"
          placeholder="Optional feedback for the agent…"
          aria-label="Feedback for the agent"
          value={feedback}
          onChange={(e) => setFeedback(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && feedback.trim() && decide('denied')}
        />
      </div>
    </div>
  );
}

function QuestionBox({ runId, callId, q }: { runId: string; callId: string; q: { question: string; options?: string[] } }) {
  const [text, setText] = useState('');
  const notify = useStore((s) => s.notify);
  const send = (answer: string) => api.answer(runId, callId, answer).catch((e) => notify(errText(e), 'error'));
  return (
    <div className="space-y-2.5 rounded-lg border border-accent/30 bg-accent/[0.06] p-3">
      <div className="flex items-start gap-2">
        <MessageCircleQuestion className="mt-0.5 h-4 w-4 shrink-0 text-accent-ink" />
        <div className="text-[13.5px] text-fg">{q.question}</div>
      </div>
      {q.options?.length ? (
        <div className="flex flex-wrap gap-1.5">
          {q.options.map((o) => (
            <Button key={o} size="sm" onClick={() => send(o)}>
              {o}
            </Button>
          ))}
        </div>
      ) : null}
      <div className="flex gap-2">
        <input className="h-8 flex-1 text-[13px]" autoFocus aria-label="Your answer" placeholder="Type your answer…" value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && text.trim() && send(text.trim())} />
        <Button size="md" variant="primary" disabled={!text.trim()} onClick={() => send(text.trim())}>
          Answer
        </Button>
      </div>
    </div>
  );
}
