import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Brain,
  ChevronRight,
  Circle,
  CircleCheck,
  CircleDot,
  CircleX,
  FolderPlus,
  Infinity as InfinityIcon,
  Info,
  Layers,
  ListTodo,
  PanelRight,
  RotateCcw,
  Send,
  Sparkles,
  Square,
  TriangleAlert,
} from 'lucide-react';
import type { ApprovalMode, ChatMessage, TodoItem } from '@hearth/shared';
import { api } from '../api';
import { errText, useStore } from '../store';
import { useThread, type LiveState, type Notice } from '../chat/useThread';
import { ToolCard } from '../chat/ToolCard';
import { Markdown } from './Markdown';
import { Badge, Button, Empty, IconButton, Spinner } from './ui';

export function Chat() {
  const { projectId, threadId, projects, projectsLoaded, threads, toggleRight, rightOpen, openModal } = useStore();
  const project = projects.find((p) => p.id === projectId);
  const thread = projectId ? threads[projectId]?.find((t) => t.id === threadId) : undefined;
  const { state, attach, reload } = useThread(threadId);
  const running = state.live.status === 'running';

  if (!projectsLoaded) return <div className="h-full" />;
  if (!project) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 p-8 text-center">
        <img src="/favicon.svg" className="h-14 w-14" alt="" />
        <h1 className="text-2xl font-semibold text-zinc-100">Welcome to Hearth</h1>
        <p className="max-w-md text-sm text-zinc-400">A free, fully local AI coding agent running on your own GPU. Add a project folder to start: the agent reads and edits code, runs commands, uses git and a browser, and can work autonomously for hours.</p>
        <Button variant="primary" onClick={() => openModal('project')}>
          <FolderPlus className="h-4 w-4" /> Add your first project
        </Button>
      </div>
    );
  }

  return (
    <div className="flex h-full min-w-0 flex-col">
      <header className="flex h-11 shrink-0 items-center gap-2 border-b border-zinc-800 px-4">
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium text-zinc-100">{thread?.title ?? 'New thread'}</div>
          <div className="truncate font-mono text-[11px] text-zinc-500">{project.path}</div>
        </div>
        {running && (
          <Badge tone="orange">
            <Spinner className="h-3 w-3" /> {state.live.longRun ? 'long-run · ' : ''}step {state.live.step}
          </Badge>
        )}
        <IconButton title={rightOpen ? 'Hide side panel' : 'Show side panel'} onClick={toggleRight} active={rightOpen}>
          <PanelRight className="h-4 w-4" />
        </IconButton>
      </header>
      <MessageList state={state} projectName={project.name} />
      {!running && state.lastRun && ['interrupted', 'max_steps', 'budget_exhausted', 'error'].includes(state.lastRun.status) && threadId && (
        <ResumeBanner status={state.lastRun.status} error={state.lastRun.error} threadId={threadId} onStarted={attach} />
      )}
      <Composer projectId={project.id} running={running} live={state.live} onStarted={attach} reload={reload} />
    </div>
  );
}

function ResumeBanner({ status, error, threadId, onStarted }: { status: string; error?: string | null; threadId: string; onStarted: (runId: string) => void }) {
  const notify = useStore((s) => s.notify);
  const label: Record<string, string> = { interrupted: 'was interrupted (server stopped)', max_steps: 'hit the step limit', budget_exhausted: 'used up its time budget', error: 'ended with an error' };
  return (
    <div className="mx-4 mb-2 flex items-center gap-2 rounded-lg border border-amber-800/60 bg-amber-950/30 px-3 py-2 text-xs text-amber-200">
      <TriangleAlert className="h-4 w-4 shrink-0" />
      <span className="min-w-0 flex-1 truncate" title={error ?? ''}>
        The last run {label[status] ?? status}
        {error ? `: ${error}` : ''}.
      </span>
      <Button
        size="sm"
        onClick={async () => {
          try {
            onStarted((await api.resume(threadId)).runId);
          } catch (e) {
            notify(errText(e), 'error');
          }
        }}
      >
        <RotateCcw className="h-3.5 w-3.5" /> Resume
      </Button>
    </div>
  );
}

function PlanPanel({ todos }: { todos: TodoItem[] }) {
  const [userOpen, setOpen] = useState<boolean | null>(null);
  if (!todos.length) return null;
  const done = todos.filter((t) => t.status === 'completed').length;
  const open = userOpen ?? done < todos.length;
  return (
    <div className="sticky top-0 z-10 mb-3 rounded-lg border border-zinc-800 bg-zinc-900/95 backdrop-blur">
      <button className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-zinc-300" onClick={() => setOpen(!open)}>
        <ListTodo className="h-3.5 w-3.5 text-orange-400" />
        <span className="font-medium">Plan</span>
        <span className="text-zinc-500">
          {done}/{todos.length} done
        </span>
        <div className="mx-2 h-1 flex-1 overflow-hidden rounded bg-zinc-800">
          <div className="h-full bg-orange-500 transition-all" style={{ width: `${(done / todos.length) * 100}%` }} />
        </div>
        <ChevronRight className={`h-3.5 w-3.5 transition-transform ${open ? 'rotate-90' : ''}`} />
      </button>
      {open && (
        <ul className="max-h-[30vh] space-y-1 overflow-y-auto px-3 pb-2">
          {todos.map((t) => (
            <li key={t.id} className={`flex items-start gap-2 text-[13px] ${t.status === 'completed' ? 'text-zinc-500 line-through' : t.status === 'in_progress' ? 'text-zinc-100' : t.status === 'cancelled' ? 'text-zinc-600 line-through' : 'text-zinc-300'}`}>
              {t.status === 'completed' ? (
                <CircleCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-500" />
              ) : t.status === 'in_progress' ? (
                <CircleDot className="mt-0.5 h-3.5 w-3.5 shrink-0 animate-pulse text-orange-400" />
              ) : t.status === 'cancelled' ? (
                <CircleX className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              ) : (
                <Circle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-zinc-600" />
              )}
              {t.content}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Reasoning({ text, live }: { text: string; live?: boolean }) {
  const [open, setOpen] = useState<boolean | null>(null);
  const isOpen = open ?? !!live;
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (live && ref.current) ref.current.scrollTop = ref.current.scrollHeight;
  }, [text, live]);
  if (!text.trim()) return null;
  return (
    <div className="text-xs">
      <button onClick={() => setOpen(!isOpen)} className="flex items-center gap-1.5 text-zinc-500 hover:text-zinc-300">
        <Brain className={`h-3.5 w-3.5 ${live ? 'animate-pulse text-orange-400' : ''}`} />
        {live ? 'Thinking…' : `Thought (${Math.max(1, Math.round(text.length / 4))} tokens)`}
        <ChevronRight className={`h-3 w-3 transition-transform ${isOpen ? 'rotate-90' : ''}`} />
      </button>
      {isOpen && (
        <div ref={ref} className="mt-1 max-h-60 overflow-y-auto border-l-2 border-zinc-800 pl-3 leading-relaxed whitespace-pre-wrap text-zinc-500">
          {text}
        </div>
      )}
    </div>
  );
}

function NoticeView({ n }: { n: Notice }) {
  const [open, setOpen] = useState(false);
  const tone = n.kind === 'error' ? 'border-rose-900 bg-rose-950/40 text-rose-200' : n.kind === 'warn' ? 'border-amber-900 bg-amber-950/30 text-amber-200' : n.kind === 'verification' ? (n.passed ? 'border-emerald-900 bg-emerald-950/30 text-emerald-200' : 'border-rose-900 bg-rose-950/30 text-rose-200') : 'border-zinc-800 bg-zinc-900/60 text-zinc-400';
  const Icon = n.kind === 'compacted' ? Layers : n.kind === 'error' || n.kind === 'warn' ? TriangleAlert : n.kind === 'verification' ? (n.passed ? CircleCheck : CircleX) : Info;
  return (
    <div className={`rounded-md border px-3 py-1.5 text-xs ${tone}`}>
      <button className="flex w-full items-center gap-2 text-left" onClick={() => n.detail && setOpen(!open)}>
        <Icon className="h-3.5 w-3.5 shrink-0" />
        <span className="flex-1">{n.text}</span>
        {n.detail && <ChevronRight className={`h-3 w-3 transition-transform ${open ? 'rotate-90' : ''}`} />}
      </button>
      {open && n.detail && (n.kind === 'compacted' ? <Markdown text={n.detail} className="mt-2 text-xs" /> : <pre className="mt-2 max-h-60 overflow-auto font-mono text-[11px] whitespace-pre-wrap">{n.detail}</pre>)}
    </div>
  );
}

function HarnessNote({ m }: { m: ChatMessage }) {
  const [open, setOpen] = useState(false);
  const first = m.content.replace(/^\[harness\]\s*/, '').split('\n')[0];
  return (
    <div className="text-xs text-zinc-500">
      <button onClick={() => setOpen(!open)} className="flex max-w-full items-center gap-1.5 hover:text-zinc-300">
        <Sparkles className="h-3 w-3 shrink-0" /> <span className="max-w-[60ch] min-w-0 truncate">harness: {first}</span>
      </button>
      {open && <pre className="mt-1 ml-5 max-h-60 overflow-auto rounded bg-zinc-900 p-2 font-mono text-[11px] whitespace-pre-wrap">{m.content}</pre>}
    </div>
  );
}

function MessageList({ state, projectName }: { state: ReturnType<typeof useThread>['state']; projectName: string }) {
  const { messages, live, notices, todos } = state;
  const scroller = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const results = useMemo(() => new Map(messages.filter((m) => m.role === 'tool').map((m) => [m.toolCallId, m])), [messages]);
  const callIds = useMemo(() => new Set(messages.flatMap((m) => m.toolCalls?.map((c) => c.id) ?? [])), [messages]);
  const noticesAfter = useMemo(() => {
    const map = new Map<string | null, Notice[]>();
    for (const n of notices) map.set(n.afterMessageId, [...(map.get(n.afterMessageId) ?? []), n]);
    return map;
  }, [notices]);

  useEffect(() => {
    const el = scroller.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  });

  const running = live.status === 'running';
  const empty = !messages.length && !running && !state.loading;

  return (
    <div
      ref={scroller}
      className="min-h-0 flex-1 overflow-y-auto"
      onScroll={(e) => {
        const el = e.currentTarget;
        stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
      }}
    >
      <div className="mx-auto w-full max-w-3xl px-4 py-4">
        <PlanPanel todos={todos} />
        {state.loading && !messages.length && (
          <div className="flex justify-center p-8">
            <Spinner />
          </div>
        )}
        {state.error && <div className="rounded-md border border-rose-900 bg-rose-950/40 p-3 text-sm text-rose-300">{state.error}</div>}
        {empty && <Suggestions projectName={projectName} />}
        <div className="space-y-4">
          {(noticesAfter.get(null) ?? []).map((n) => (
            <NoticeView key={n.id} n={n} />
          ))}
          {messages.map((m) => (
            <div key={m.id} className="space-y-2">
              {m.role === 'user' &&
                ((m.meta as any)?.synthetic ? (
                  <HarnessNote m={m} />
                ) : (
                  <div className="flex justify-end">
                    <div className="max-w-[85%] rounded-2xl rounded-br-md bg-zinc-800 px-4 py-2.5 text-[14px] whitespace-pre-wrap text-zinc-100">{m.content}</div>
                  </div>
                ))}
              {m.role === 'assistant' && (
                <div className="space-y-2">
                  {m.reasoning && <Reasoning text={m.reasoning} />}
                  {m.content && ((m.meta as any)?.synthetic ? <div className="text-sm text-amber-300/90">{m.content}</div> : <Markdown text={m.content} />)}
                  {m.toolCalls?.map((c) => (
                    <ToolCard
                      key={c.id}
                      call={c}
                      result={results.get(c.id)}
                      running={live.pending[c.id]}
                      approval={live.approvals[c.id]}
                      question={live.questions[c.id]}
                      subagent={live.subagents[c.id]}
                      runId={live.runId}
                    />
                  ))}
                </div>
              )}
              {m.role === 'tool' && !callIds.has(m.toolCallId ?? '') && <pre className="rounded-md bg-zinc-900 p-2 font-mono text-[11px] text-zinc-400">{m.content.slice(0, 2000)}</pre>}
              {(noticesAfter.get(m.id) ?? []).map((n) => (
                <NoticeView key={n.id} n={n} />
              ))}
            </div>
          ))}
          {running && <LiveBlock live={live} />}
        </div>
      </div>
    </div>
  );
}

function LiveBlock({ live }: { live: LiveState }) {
  const waitingTools = Object.keys(live.pending).length > 0 || Object.keys(live.approvals).length > 0;
  return (
    <div className="space-y-2">
      <Reasoning text={live.reasoning} live />
      {live.text.trim() && <Markdown text={live.text} className="caret" />}
      {live.generatingTool && (
        <div className="flex items-center gap-2 text-xs text-zinc-400">
          <Spinner className="h-3.5 w-3.5" /> Preparing <code className="font-mono text-zinc-300">{live.generatingTool}</code>…
        </div>
      )}
      {!live.text.trim() && !live.reasoning && !live.generatingTool && !waitingTools && (
        <div className="flex items-center gap-2 text-xs text-zinc-500">
          <Spinner className="h-3.5 w-3.5" /> Working{live.step ? ` (step ${live.step})` : ''}…
        </div>
      )}
    </div>
  );
}

const EXAMPLES = [
  'Explain the structure of this project and how to run it.',
  'Find and fix the failing tests.',
  'Add a README with setup instructions, then grammar-check it.',
  'Create a small Express API with a /health endpoint and tests.',
];

function Suggestions({ projectName }: { projectName: string }) {
  return (
    <div className="mt-12 mb-8 text-center">
      <div className="mb-1 text-lg font-semibold text-zinc-100">What should we build in {projectName}?</div>
      <div className="mb-5 text-sm text-zinc-500">The agent works inside this folder. Turn on Long-run (∞) for big tasks it should finish on its own.</div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {EXAMPLES.map((e) => (
          <button
            key={e}
            onClick={() => window.dispatchEvent(new CustomEvent('hearth:prefill', { detail: e }))}
            className="rounded-lg border border-zinc-800 bg-zinc-900/50 px-3 py-2.5 text-left text-[13px] text-zinc-300 hover:border-orange-600/50 hover:text-zinc-100"
          >
            {e}
          </button>
        ))}
      </div>
    </div>
  );
}

function Composer({ projectId, running, live, onStarted, reload }: { projectId: string; running: boolean; live: LiveState; onStarted: (runId: string) => void; reload: () => Promise<unknown> }) {
  const { settings, saveSettings, threadId, selectThread, loadThreads, notify, caps } = useStore();
  const [text, setText] = useState('');
  const [longRun, setLongRun] = useState(false);
  const [doneCommand, setDoneCommand] = useState('');
  const [maxMinutes, setMaxMinutes] = useState<number | ''>('');
  const [busy, setBusy] = useState(false);
  const ta = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const onPrefill = (e: Event) => {
      setText((e as CustomEvent<string>).detail);
      ta.current?.focus();
    };
    window.addEventListener('hearth:prefill', onPrefill);
    return () => window.removeEventListener('hearth:prefill', onPrefill);
  }, []);
  useEffect(() => {
    const el = ta.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(260, el.scrollHeight) + 'px';
  }, [text]);

  const send = async () => {
    const message = text.trim();
    if (!message || busy || running) return;
    setBusy(true);
    try {
      const body = { message, longRun: longRun ? { enabled: true, doneCommand: doneCommand.trim(), maxMinutes: maxMinutes || undefined } : undefined };
      if (!threadId) {
        const t = await api.createThread(projectId);
        await api.startRun(t.id, body);
        await loadThreads(projectId);
        selectThread(t.id); // the thread view attaches to the active run on load
      } else {
        const { runId } = await api.startRun(threadId, body);
        onStarted(runId);
        void reload();
      }
      setText('');
    } catch (e) {
      notify(errText(e), 'error');
    } finally {
      setBusy(false);
    }
  };
  const stop = () => live.runId && api.cancelRun(live.runId);

  const usagePct = live.usage ? Math.min(100, Math.round((live.usage.promptTokens / live.usage.contextLimit) * 100)) : null;

  return (
    <div className="shrink-0 px-4 pb-4">
      <div className="mx-auto max-w-3xl rounded-xl border border-zinc-700 bg-zinc-900 shadow-lg focus-within:border-orange-600/60">
        <textarea
          ref={ta}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              void send();
            }
          }}
          rows={2}
          placeholder={running ? 'The agent is working… (you can send the next message when it finishes)' : 'Ask Hearth to build, fix or explain something…  (Enter to send, Shift+Enter for a new line)'}
          className="block w-full resize-none border-0 bg-transparent px-4 pt-3 pb-1 text-[14px] focus:border-0"
        />
        {longRun && (
          <div className="flex flex-wrap items-center gap-2 px-3 pb-1 text-xs text-zinc-400">
            <InfinityIcon className="h-3.5 w-3.5 text-orange-400" /> Long-run: done when
            <input className="w-56 py-0.5 font-mono text-xs" placeholder={settings?.longRun.doneCommand || 'e.g. npm test (optional)'} value={doneCommand} onChange={(e) => setDoneCommand(e.target.value)} />
            exits 0 · budget
            <input className="w-16 py-0.5 text-xs" type="number" min={1} placeholder={String(settings?.longRun.maxMinutes ?? 240)} value={maxMinutes} onChange={(e) => setMaxMinutes(e.target.value ? Number(e.target.value) : '')} />
            min
          </div>
        )}
        <div className="flex flex-wrap items-center gap-1.5 px-2 pb-2">
          <select
            className="max-w-44 min-w-0 border-zinc-800 bg-zinc-900 text-xs"
            value={settings?.activeProfileId ?? ''}
            onChange={(e) => saveSettings({ activeProfileId: e.target.value })}
            title={caps?.reachable ? `Tool mode: ${caps.effectiveToolMode} · context ${caps.maxModelLen ?? '?'}` : caps?.error ?? ''}
          >
            {settings?.profiles.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <select
            className="max-w-48 min-w-0 border-zinc-800 bg-zinc-900 text-xs"
            value={settings?.approvalMode ?? 'auto-edit'}
            onChange={(e) => saveSettings({ approvalMode: e.target.value as ApprovalMode })}
            title="Approval mode: what the agent may do without asking"
          >
            <option value="ask">Ask before edits & commands</option>
            <option value="auto-edit">Auto-edit (ask for commands)</option>
            <option value="full-auto">Full auto</option>
          </select>
          <button
            onClick={() => setLongRun(!longRun)}
            title="Long-run mode: autonomous for hours, with plan/progress files, auto-compaction, checkpoints and a definition-of-done check"
            className={`inline-flex h-7 items-center gap-1 rounded-md border px-2 text-xs ${longRun ? 'border-orange-600 bg-orange-950/40 text-orange-300' : 'border-zinc-800 text-zinc-400 hover:text-zinc-200'}`}
          >
            <InfinityIcon className="h-3.5 w-3.5" /> Long-run
          </button>
          <div className="flex-1" />
          {usagePct !== null && (
            <span className="text-[11px] text-zinc-500" title={`Context: ${live.usage!.promptTokens} / ${live.usage!.contextLimit} tokens`}>
              ctx {usagePct}%{live.usage!.tokensPerSec ? ` · ${Math.round(live.usage!.tokensPerSec)} tok/s` : ''}
            </span>
          )}
          {running ? (
            <Button size="sm" variant="danger" onClick={stop} title="Stop the agent">
              <Square className="h-3.5 w-3.5" /> Stop
            </Button>
          ) : (
            <Button size="sm" variant="primary" onClick={send} disabled={!text.trim() || busy} title="Send (Enter)">
              {busy ? <Spinner className="h-3.5 w-3.5 text-white" /> : <Send className="h-3.5 w-3.5" />} Send
            </Button>
          )}
        </div>
      </div>
      {settings?.approvalMode === 'full-auto' && <div className="mx-auto mt-1 max-w-3xl text-[11px] text-amber-500/80">Full auto: the agent runs commands without asking (dangerous commands are still blocked).</div>}
    </div>
  );
}
