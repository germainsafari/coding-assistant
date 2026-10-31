// The transcript: user bubbles, agent answers, tool cards (with read-only lookups
// folded into "Explored" groups), notices, and the live block of the running step.
import { memo, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ArrowDown, Square } from 'lucide-react';
import type { ChatMessage, ToolCall } from '@hearth/shared';
import type { LiveState, Notice, ThreadState } from './useThread';
import { isExploreCall, ToolCard, ToolIcon } from './ToolCard';
import { ExploreGroup, HarnessNote, NoticeView, PlanCard, Reasoning } from './Blocks';
import { Markdown } from '../components/Markdown';
import { CopyButton, Skeleton } from '../components/ui';

type Item =
  | { kind: 'user'; key: string; m: ChatMessage }
  | { kind: 'harness'; key: string; m: ChatMessage }
  | { kind: 'reasoning'; key: string; text: string }
  | { kind: 'text'; key: string; m: ChatMessage }
  | { kind: 'tool'; key: string; call: ToolCall }
  | { kind: 'orphan'; key: string; m: ChatMessage }
  | { kind: 'notice'; key: string; n: Notice }
  | { kind: 'explore'; key: string; items: Item[]; calls: ToolCall[] };

const synthetic = (m: ChatMessage) => !!(m.meta as { synthetic?: boolean } | null)?.synthetic;

function buildItems(messages: ChatMessage[], notices: Notice[], results: Map<string | null | undefined, ChatMessage>, live: LiveState): Item[] {
  const after = new Map<string | null, Notice[]>();
  for (const n of notices) after.set(n.afterMessageId, [...(after.get(n.afterMessageId) ?? []), n]);
  const callIds = new Set(messages.flatMap((m) => m.toolCalls?.map((c) => c.id) ?? []));
  const flat: Item[] = (after.get(null) ?? []).map((n) => ({ kind: 'notice', key: n.id, n }));
  for (const m of messages) {
    if (m.role === 'user') flat.push(synthetic(m) ? { kind: 'harness', key: m.id, m } : { kind: 'user', key: m.id, m });
    if (m.role === 'assistant') {
      if (m.reasoning?.trim()) flat.push({ kind: 'reasoning', key: `${m.id}:r`, text: m.reasoning });
      if (m.content.trim()) flat.push({ kind: 'text', key: m.id, m });
      for (const c of m.toolCalls ?? []) flat.push({ kind: 'tool', key: c.id, call: c });
    }
    if (m.role === 'tool' && !callIds.has(m.toolCallId ?? '')) flat.push({ kind: 'orphan', key: m.id, m });
    for (const n of after.get(m.id) ?? []) flat.push({ kind: 'notice', key: n.id, n });
  }

  // Fold runs of finished read-only lookups (and the thinking between them).
  const settled = (c: ToolCall) => {
    const r = results.get(c.id);
    return isExploreCall(c) && !!r && (r.meta as { ok?: boolean } | null)?.ok && !live.pending[c.id] && !live.approvals[c.id];
  };
  const out: Item[] = [];
  let run: Item[] = [];
  const flush = () => {
    const tail: Item[] = [];
    while (run.length && run[run.length - 1].kind === 'reasoning') tail.unshift(run.pop()!);
    const calls = run.flatMap((i) => (i.kind === 'tool' ? [i.call] : []));
    if (calls.length >= 2) out.push({ kind: 'explore', key: `x:${run[0].key}`, items: run, calls });
    else out.push(...run);
    out.push(...tail);
    run = [];
  };
  for (const it of flat) {
    if (it.kind === 'reasoning' || (it.kind === 'tool' && settled(it.call))) run.push(it);
    else {
      flush();
      out.push(it);
    }
  }
  flush();
  return out;
}

function UserBubble({ m }: { m: ChatMessage }) {
  return (
    <div className="group/msg flex justify-end gap-1 pt-4 first:pt-0">
      <CopyButton text={m.content} label="Copy message" className="mt-1.5 opacity-0 group-hover/msg:opacity-100 focus-visible:opacity-100" />
      <div className="max-w-[82%] rounded-2xl rounded-tr-md border border-line bg-raised px-4 py-2.5 text-[14px] leading-relaxed whitespace-pre-wrap text-fg">{m.content}</div>
    </div>
  );
}

function AnswerText({ m }: { m: ChatMessage }) {
  if (synthetic(m)) return <div className="text-[13px] text-warn-ink">{m.content}</div>;
  return (
    <div className="group/msg relative">
      <Markdown text={m.content} />
      <div className="mt-1 flex h-6 opacity-0 transition-opacity group-hover/msg:opacity-100 focus-within:opacity-100">
        <CopyButton text={m.content} label="Copy answer" />
      </div>
    </div>
  );
}

interface Props {
  state: ThreadState;
  empty: ReactNode;
}

export const MessageList = memo(function MessageList({ state, empty }: Props) {
  const { messages, live, notices, todos, loading } = state;
  const scroller = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const running = live.status === 'running';
  const runningRef = useRef(running);
  runningRef.current = running;
  const [atBottom, setAtBottom] = useState(true);

  const results = useMemo(() => new Map(messages.filter((m) => m.role === 'tool').map((m) => [m.toolCallId, m])), [messages]);
  const items = useMemo(() => buildItems(messages, notices, results, live), [messages, notices, results, live.pending, live.approvals]);

  // Follow the stream while the agent is running, unless the user scrolled up.
  useEffect(() => {
    const el = scroller.current;
    const c = content.current;
    if (!el || !c) return;
    const ro = new ResizeObserver(() => {
      if (stick.current && runningRef.current) el.scrollTop = el.scrollHeight;
    });
    ro.observe(c);
    return () => ro.disconnect();
  }, []);

  // Jump to the end once the thread has loaded.
  useEffect(() => {
    const el = scroller.current;
    if (!loading && el) {
      el.scrollTop = el.scrollHeight;
      stick.current = true;
    }
  }, [loading]);

  const renderItem = (it: Item, nested = false): ReactNode => {
    switch (it.kind) {
      case 'user':
        return <UserBubble key={it.key} m={it.m} />;
      case 'harness':
        return <HarnessNote key={it.key} m={it.m} />;
      case 'reasoning':
        return <Reasoning key={it.key} text={it.text} />;
      case 'text':
        return <AnswerText key={it.key} m={it.m} />;
      case 'orphan':
        return (
          <pre key={it.key} className="rounded-lg border border-line bg-code p-2.5 font-mono text-[11.5px] text-fg-muted">
            {it.m.content.slice(0, 2000)}
          </pre>
        );
      case 'notice':
        return <NoticeView key={it.key} n={it.n} />;
      case 'explore':
        return (
          <ExploreGroup key={it.key} calls={it.calls}>
            {it.items.map((x) => renderItem(x, true))}
          </ExploreGroup>
        );
      case 'tool':
        return (
          <div key={it.key} id={`call-${it.call.id}`} className="scroll-mt-20">
            <ToolCard
              call={it.call}
              result={results.get(it.call.id)}
              running={live.pending[it.call.id]}
              approval={live.approvals[it.call.id]}
              question={live.questions[it.call.id]}
              subagent={live.subagents[it.call.id]}
              runId={live.runId}
              compact={nested}
            />
          </div>
        );
    }
  };

  const isEmpty = !messages.length && !running && !loading;

  return (
    <div className="relative min-h-0 flex-1">
      <div
        ref={scroller}
        className="h-full overflow-y-auto [overflow-anchor:none]"
        onScroll={(e) => {
          const el = e.currentTarget;
          const near = el.scrollHeight - el.scrollTop - el.clientHeight < 72;
          stick.current = near;
          setAtBottom(near);
        }}
      >
        <div ref={content} className="mx-auto w-full max-w-[46rem] px-6 pt-6 pb-10">
          <PlanCard todos={todos} running={running} />
          {loading && !messages.length && <TranscriptSkeleton />}
          {state.error && (
            <div role="alert" className="mb-4 rounded-lg border border-danger/30 bg-danger/[0.07] px-3 py-2.5 text-[13px] text-danger-ink">
              {state.error}
            </div>
          )}
          {isEmpty ? empty : null}
          <div className="space-y-3.5">
            {items.map((it) => renderItem(it))}
            {running && <LiveBlock live={live} />}
            {!running && state.lastRun?.status === 'cancelled' && messages.length > 0 && (
              <div className="flex items-center gap-2 pt-1 text-xs text-fg-subtle">
                <span className="h-px flex-1 bg-line" />
                <Square className="h-2.5 w-2.5 fill-current" /> Stopped by you
                <span className="h-px flex-1 bg-line" />
              </div>
            )}
          </div>
        </div>
      </div>
      {!atBottom && (messages.length > 0 || running) && (
        <button
          type="button"
          onClick={() => {
            const el = scroller.current;
            if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
            stick.current = true;
          }}
          className="absolute bottom-3 left-1/2 inline-flex -translate-x-1/2 animate-pop-in items-center gap-1.5 rounded-full border border-line-strong bg-overlay px-3 py-1.5 text-xs font-medium text-fg-muted shadow-pop hover:text-fg"
        >
          <ArrowDown className="h-3.5 w-3.5" /> {running ? 'Follow the agent' : 'Jump to latest'}
        </button>
      )}
    </div>
  );
});

function LiveBlock({ live }: { live: LiveState }) {
  const waitingTools = Object.keys(live.pending).length > 0 || Object.keys(live.approvals).length > 0 || Object.keys(live.questions).length > 0;
  return (
    <div className="space-y-3">
      {live.reasoning && <Reasoning text={live.reasoning} live />}
      {live.text.trim() && <Markdown text={live.text} className="caret" />}
      {live.generatingTool && (
        <div className="flex items-center gap-2.5 text-[13px]">
          <ToolIcon call={{ id: 'gen', name: live.generatingTool, arguments: {} }} />
          <span className="shimmer font-medium">Preparing {live.generatingTool.replace(/_/g, ' ')}</span>
        </div>
      )}
      {!live.text.trim() && !live.reasoning && !live.generatingTool && !waitingTools && (
        <div className="flex items-center gap-2 text-[13px]">
          <span className="relative flex h-2 w-2">
            <span className="absolute inset-0 animate-ping rounded-full bg-accent opacity-60" />
            <span className="relative h-2 w-2 rounded-full bg-accent" />
          </span>
          <span className="shimmer font-medium">{live.step ? `Working · step ${live.step}` : 'Starting'}</span>
        </div>
      )}
    </div>
  );
}

function TranscriptSkeleton() {
  return (
    <div className="space-y-6" aria-label="Loading conversation">
      <div className="flex justify-end">
        <Skeleton className="h-10 w-2/3 rounded-2xl" />
      </div>
      <div className="space-y-2">
        <Skeleton className="h-3.5 w-1/3" />
        <Skeleton className="h-9 w-full rounded-xl" />
        <Skeleton className="h-9 w-full rounded-xl" />
        <Skeleton className="h-3.5 w-5/6" />
        <Skeleton className="h-3.5 w-2/3" />
      </div>
    </div>
  );
}