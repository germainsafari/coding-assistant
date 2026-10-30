import { useState, type ReactNode } from 'react';
import {
  Bot,
  BookOpen,
  Brain,
  Check,
  ChevronRight,
  CircleX,
  FileText,
  GitBranch,
  Globe,
  ListTodo,
  MessageSquare,
  Pencil,
  Plug,
  Search,
  Shield,
  SquareTerminal,
  Wrench,
} from 'lucide-react';
import type { ChatMessage, ToolCall } from '@hearth/shared';
import { api } from '../api';
import { errText, useStore } from '../store';
import { DiffView, diffStats } from '../components/Markdown';
import { Badge, Button, fmtMs, Spinner } from '../components/ui';

const str = (v: unknown) => (typeof v === 'string' ? v : v === undefined ? '' : JSON.stringify(v));

function describe(call: ToolCall): { icon: ReactNode; title: ReactNode } {
  const a = call.arguments ?? {};
  const code = (s: string) => <code className="rounded bg-zinc-800 px-1 font-mono text-[12px] text-zinc-200">{s}</code>;
  const ic = (C: typeof FileText) => <C className="h-3.5 w-3.5" />;
  switch (call.name) {
    case 'read_file':
      return { icon: ic(FileText), title: <>Read {code(str(a.path))}</> };
    case 'write_file':
      return { icon: ic(Pencil), title: <>Write {code(str(a.path))}</> };
    case 'edit_file':
      return { icon: ic(Pencil), title: <>Edit {code(str(a.path))}</> };
    case 'delete_file':
      return { icon: ic(Pencil), title: <>Delete {code(str(a.path))}</> };
    case 'list_dir':
      return { icon: ic(FileText), title: <>List {code(str(a.path) || '.')}</> };
    case 'glob':
      return { icon: ic(Search), title: <>Find files {code(str(a.pattern))}</> };
    case 'grep':
      return { icon: ic(Search), title: <>Search {code(str(a.pattern))}{a.glob ? <> in {code(str(a.glob))}</> : null}</> };
    case 'run_shell':
      return { icon: ic(SquareTerminal), title: <>{a.background ? 'Start' : 'Run'} {code(str(a.command).slice(0, 140))}</> };
    case 'shell_output':
      return { icon: ic(SquareTerminal), title: <>Read process output {a.id ? code(str(a.id)) : null}</> };
    case 'shell_kill':
      return { icon: ic(SquareTerminal), title: <>Stop process {code(str(a.id))}</> };
    case 'update_plan':
      return { icon: ic(ListTodo), title: 'Updated plan' };
    case 'ask_user':
      return { icon: ic(MessageSquare), title: 'Question for you' };
    case 'load_skill':
      return { icon: ic(BookOpen), title: <>Load skill {code(str(a.name))}</> };
    case 'spawn_subagent':
      return { icon: ic(Bot), title: <>Subagent: {str(a.task).slice(0, 90)}</> };
    case 'memory_save':
    case 'memory_search':
    case 'memory_delete':
    case 'update_project_notes':
      return { icon: ic(Brain), title: <>{call.name.replace(/_/g, ' ')} {a.query || a.content ? code(str(a.query ?? a.content).slice(0, 80)) : null}</> };
    case 'web_fetch':
      return { icon: ic(Globe), title: <>Fetch {code(str(a.url))}</> };
    case 'web_search':
      return { icon: ic(Globe), title: <>Web search {code(str(a.query))}</> };
    case 'languagetool_check':
      return { icon: ic(Check), title: 'Grammar check (LanguageTool)' };
  }
  if (call.name.startsWith('browser_')) return { icon: ic(Globe), title: <>Browser {call.name.slice(8)} {a.url || a.text || a.selector ? code(str(a.url ?? a.text ?? a.selector).slice(0, 80)) : null}</> };
  if (call.name.startsWith('git_') || call.name.startsWith('github_')) return { icon: ic(GitBranch), title: <>{call.name.replace(/_/g, ' ')} {a.message ? code(str(a.message).split('\n')[0].slice(0, 80)) : a.title ? code(str(a.title)) : null}</> };
  if (call.name.startsWith('mcp__')) {
    const [, server, tool] = call.name.split('__');
    return { icon: ic(Plug), title: <>MCP {code(`${server}.${tool}`)}</> };
  }
  return { icon: ic(Wrench), title: call.name };
}

function ArgsView({ call }: { call: ToolCall }) {
  const a = call.arguments ?? {};
  if (call.name === 'run_shell') return <pre className="rounded-md bg-zinc-950 px-3 py-2 font-mono text-[12px] whitespace-pre-wrap text-zinc-200">$ {str(a.command)}</pre>;
  if (call.name === 'write_file' || call.name === 'edit_file') return null; // diff shown instead
  if (call.name === 'update_plan' || call.name === 'ask_user') return null;
  const entries = Object.entries(a);
  if (!entries.length) return null;
  return (
    <div className="space-y-1 rounded-md bg-zinc-950 px-3 py-2 font-mono text-[12px]">
      {entries.map(([k, v]) => (
        <div key={k} className="flex gap-2">
          <span className="shrink-0 text-zinc-500">{k}:</span>
          <span className="min-w-0 break-words whitespace-pre-wrap text-zinc-300">{str(v).slice(0, 4000)}</span>
        </div>
      ))}
    </div>
  );
}

export function ToolCard(props: {
  call: ToolCall;
  result?: ChatMessage;
  running?: { output: string };
  approval?: { reason: string; preview?: string };
  question?: { question: string; options?: string[] };
  subagent?: { tools: string[]; text: string; status?: string };
  runId: string | null;
}) {
  const { call, result, running, approval, question, subagent, runId } = props;
  const meta = (result?.meta ?? {}) as { ok?: boolean; durationMs?: number; diff?: string; image?: string; denied?: boolean; truncated?: boolean; changedFiles?: string[] };
  const { setOpenFile } = useStore();
  const d = describe(call);
  const stats = diffStats(meta.diff);
  const isEdit = call.name === 'edit_file' || call.name === 'write_file';
  const [open, setOpen] = useState<boolean | null>(null);
  const expanded = open ?? (!!approval || !!question || (!!running && call.name === 'run_shell') || (isEdit && !!meta.diff) || call.name === 'spawn_subagent');
  const status = approval ? 'approval' : question ? 'question' : running || !result ? 'running' : meta.denied ? 'denied' : meta.ok ? 'ok' : 'error';

  return (
    <div className={`overflow-hidden rounded-lg border ${status === 'approval' || status === 'question' ? 'border-orange-600/60 bg-orange-950/10' : status === 'error' ? 'border-rose-900/60 bg-zinc-900/40' : 'border-zinc-800 bg-zinc-900/40'}`}>
      <button onClick={() => setOpen(!expanded)} className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[13px] text-zinc-300 hover:bg-zinc-800/40">
        <ChevronRight className={`h-3.5 w-3.5 shrink-0 text-zinc-500 transition-transform ${expanded ? 'rotate-90' : ''}`} />
        <span className="text-zinc-400">{d.icon}</span>
        <span className="min-w-0 flex-1 truncate">{d.title}</span>
        {stats && (
          <span className="font-mono text-[11px]">
            <span className="text-emerald-400">+{stats.add}</span> <span className="text-rose-400">-{stats.del}</span>
          </span>
        )}
        {meta.durationMs != null && meta.durationMs > 300 && <span className="text-[11px] text-zinc-500">{fmtMs(meta.durationMs)}</span>}
        {status === 'running' && <Spinner className="h-3.5 w-3.5" />}
        {status === 'ok' && <Check className="h-3.5 w-3.5 text-emerald-500" />}
        {status === 'error' && <CircleX className="h-3.5 w-3.5 text-rose-500" />}
        {status === 'denied' && <Badge tone="red">denied</Badge>}
        {status === 'approval' && <Badge tone="orange">needs approval</Badge>}
        {status === 'question' && <Badge tone="orange">waiting for you</Badge>}
      </button>
      {expanded && (
        <div className="space-y-2 border-t border-zinc-800/80 px-3 py-2">
          <ArgsView call={call} />
          {approval && runId && <ApprovalBox runId={runId} call={call} approval={approval} />}
          {question && runId && <QuestionBox runId={runId} callId={call.id} q={question} />}
          {call.name === 'ask_user' && !question && <div className="text-sm text-zinc-300">{str(call.arguments.question)}</div>}
          {subagent && (
            <div className="rounded-md bg-zinc-950 px-3 py-2 text-xs text-zinc-400">
              <div className="mb-1 font-medium text-zinc-300">Subagent activity {subagent.status ? `(${subagent.status})` : ''}</div>
              <div className="flex flex-wrap gap-1">
                {subagent.tools.map((t, i) => (
                  <Badge key={i}>{t}</Badge>
                ))}
              </div>
            </div>
          )}
          {running && running.output && <pre className="max-h-72 overflow-auto rounded-md bg-zinc-950 px-3 py-2 font-mono text-[12px] whitespace-pre-wrap text-zinc-300">{running.output.slice(-20000)}</pre>}
          {meta.diff && <DiffView diff={meta.diff} />}
          {meta.image && <img src={meta.image} alt="screenshot" className="max-h-80 rounded-md border border-zinc-800" />}
          {result && !(isEdit && meta.diff && meta.ok) && call.name !== 'update_plan' && (
            <pre className={`max-h-80 overflow-auto rounded-md bg-zinc-950 px-3 py-2 font-mono text-[12px] whitespace-pre-wrap ${meta.ok ? 'text-zinc-400' : 'text-rose-300'}`}>{result.content}</pre>
          )}
          {meta.changedFiles?.length ? (
            <div className="flex flex-wrap gap-1">
              {meta.changedFiles.map((f) => (
                <button key={f} onClick={() => setOpenFile(f)} className="font-mono text-[11px] text-orange-300 hover:underline">
                  open {f}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}

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
    <div className="space-y-2 rounded-md border border-orange-800/60 bg-orange-950/20 p-2.5">
      <div className="flex items-center gap-1.5 text-xs text-orange-200">
        <Shield className="h-3.5 w-3.5" /> {approval.reason}
      </div>
      {approval.preview && <DiffView diff={approval.preview} maxHeight="max-h-64" />}
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="primary" disabled={busy} onClick={() => decide('approved')}>
          Approve
        </Button>
        <Button size="sm" disabled={busy} onClick={() => decide('approved', true)} title={`Don't ask again for ${call.name} during this run`}>
          Always allow {call.name}
        </Button>
        <Button size="sm" variant="danger" disabled={busy} onClick={() => decide('denied')}>
          Deny
        </Button>
        <input className="min-w-40 flex-1 text-xs" placeholder="Optional feedback for the agent…" value={feedback} onChange={(e) => setFeedback(e.target.value)} />
      </div>
    </div>
  );
}

function QuestionBox({ runId, callId, q }: { runId: string; callId: string; q: { question: string; options?: string[] } }) {
  const [text, setText] = useState('');
  const notify = useStore((s) => s.notify);
  const send = (answer: string) => api.answer(runId, callId, answer).catch((e) => notify(errText(e), 'error'));
  return (
    <div className="space-y-2 rounded-md border border-orange-800/60 bg-orange-950/20 p-2.5">
      <div className="text-sm text-zinc-100">{q.question}</div>
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
        <input className="flex-1 text-sm" autoFocus placeholder="Type your answer…" value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && text.trim() && send(text.trim())} />
        <Button size="sm" variant="primary" disabled={!text.trim()} onClick={() => send(text.trim())}>
          Answer
        </Button>
      </div>
    </div>
  );
}
