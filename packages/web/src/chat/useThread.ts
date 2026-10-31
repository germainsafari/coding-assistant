// Loads a thread and merges the live event stream of its active run.
// Event replay is idempotent: persisted messages are de-duplicated by id and the
// streaming buffers are reset by every assistant_message / run_started.
import { useCallback, useEffect, useReducer, useRef } from 'react';
import type { AgentEvent, ChatMessage, LongRunOptions, RunRecord, RunStatus, TodoItem, ToolCall } from '@hearth/shared';
import { api, subscribeRun } from '../api';
import { useStore } from '../store';

export interface Notice {
  id: string;
  afterMessageId: string | null;
  kind: 'info' | 'warn' | 'error' | 'compacted' | 'verification';
  text: string;
  detail?: string;
  passed?: boolean;
}

export interface LiveState {
  runId: string | null;
  status: RunStatus | null;
  model: string | null;
  longRun: LongRunOptions | null;
  step: number;
  text: string;
  reasoning: string;
  generatingTool: string | null;
  pending: Record<string, { call: ToolCall; output: string }>;
  approvals: Record<string, { call: ToolCall; reason: string; preview?: string }>;
  questions: Record<string, { question: string; options?: string[] }>;
  subagents: Record<string, { tools: string[]; text: string; status?: string }>;
  usage: { promptTokens: number; completionTokens: number; contextLimit: number; tokensPerSec?: number } | null;
}

export interface ThreadState {
  loading: boolean;
  error: string | null;
  messages: ChatMessage[];
  todos: TodoItem[];
  lastRun: RunRecord | null;
  notices: Notice[];
  live: LiveState;
}

const emptyLive = (): LiveState => ({
  runId: null,
  status: null,
  model: null,
  longRun: null,
  step: 0,
  text: '',
  reasoning: '',
  generatingTool: null,
  pending: {},
  approvals: {},
  questions: {},
  subagents: {},
  usage: null,
});

const initial = (): ThreadState => ({ loading: false, error: null, messages: [], todos: [], lastRun: null, notices: [], live: emptyLive() });

type Action =
  | { type: 'reset' }
  | { type: 'loading' }
  | { type: 'loaded'; messages: ChatMessage[]; todos: TodoItem[]; lastRun: RunRecord | null }
  | { type: 'error'; error: string }
  | { type: 'attach'; runId: string }
  | { type: 'event'; e: AgentEvent };

function upsert(list: ChatMessage[], m: ChatMessage) {
  return list.some((x) => x.id === m.id) ? list : [...list, m];
}
const without = <T,>(o: Record<string, T>, k: string) => {
  const { [k]: _drop, ...rest } = o;
  return rest;
};

function reducer(s: ThreadState, a: Action): ThreadState {
  switch (a.type) {
    case 'reset':
      return initial();
    case 'loading':
      return { ...s, loading: true, error: null };
    case 'loaded': {
      // keep messages that arrived live but aren't in the snapshot yet
      const ids = new Set(a.messages.map((m) => m.id));
      const extra = s.messages.filter((m) => !ids.has(m.id) && s.live.runId && m.runId === s.live.runId);
      return { ...s, loading: false, messages: [...a.messages, ...extra], todos: a.todos, lastRun: a.lastRun };
    }
    case 'error':
      return { ...s, loading: false, error: a.error };
    case 'attach':
      return { ...s, live: { ...emptyLive(), runId: a.runId, status: 'running' } };
    case 'event':
      return applyEvent(s, a.e);
  }
}

function applyEvent(s: ThreadState, e: AgentEvent): ThreadState {
  const L = s.live;
  if (L.runId && e.runId !== L.runId) return s;
  const lastId = () => s.messages[s.messages.length - 1]?.id ?? null;
  const notice = (n: Omit<Notice, 'id' | 'afterMessageId'>): Notice[] =>
    s.notices.some((x) => x.id === `${e.runId}:${e.seq}`) ? s.notices : [...s.notices, { id: `${e.runId}:${e.seq}`, afterMessageId: lastId(), ...n }];
  switch (e.type) {
    case 'run_started':
      return { ...s, live: { ...emptyLive(), runId: e.runId, status: 'running', model: e.model, longRun: e.longRun ?? null } };
    case 'step_started':
      return { ...s, live: { ...L, step: e.step } };
    case 'reasoning_delta':
      return { ...s, live: { ...L, reasoning: L.reasoning + e.text } };
    case 'text_delta':
      return { ...s, live: { ...L, text: L.text + e.text } };
    case 'tool_call_generating':
      return { ...s, live: { ...L, generatingTool: e.name } };
    case 'assistant_message':
      return { ...s, messages: upsert(s.messages, e.message), live: { ...L, text: '', reasoning: '', generatingTool: null } };
    case 'tool_call_started':
      return { ...s, live: { ...L, pending: { ...L.pending, [e.call.id]: { call: e.call, output: '' } } } };
    case 'tool_output_delta': {
      const p = L.pending[e.callId];
      if (!p) return s;
      return { ...s, live: { ...L, pending: { ...L.pending, [e.callId]: { ...p, output: (p.output + e.text).slice(-60_000) } } } };
    }
    case 'approval_required':
      return { ...s, live: { ...L, approvals: { ...L.approvals, [e.call.id]: { call: e.call, reason: e.reason, preview: e.preview } } } };
    case 'approval_resolved':
      return { ...s, live: { ...L, approvals: without(L.approvals, e.callId) } };
    case 'ask_user':
      return { ...s, live: { ...L, questions: { ...L.questions, [e.callId]: { question: e.question, options: e.options } } } };
    case 'ask_user_answered':
      return { ...s, live: { ...L, questions: without(L.questions, e.callId) } };
    case 'tool_call_finished':
      return { ...s, messages: upsert(s.messages, e.message), live: { ...L, pending: without(L.pending, e.callId) } };
    case 'plan_updated':
      return { ...s, todos: e.todos };
    case 'usage':
      return { ...s, live: { ...L, usage: { promptTokens: e.promptTokens, completionTokens: e.completionTokens, contextLimit: e.contextLimit, tokensPerSec: e.tokensPerSec } } };
    case 'context_compacted':
      return { ...s, notices: notice({ kind: 'compacted', text: `Context compacted: ~${Math.round(e.beforeTokens / 1000)}k → ~${Math.round(e.afterTokens / 1000)}k tokens`, detail: e.summary }) };
    case 'notice':
      return { ...s, notices: notice({ kind: e.level, text: e.text }) };
    case 'verification':
      return {
        ...s,
        notices: notice({ kind: 'verification', passed: e.passed, text: `Definition of done \`${e.command}\` ${e.passed ? 'passed' : 'failed'} (attempt ${e.attempt})`, detail: e.output }),
      };
    case 'error':
      return { ...s, notices: notice({ kind: 'error', text: e.message }) };
    case 'subagent_event': {
      const sub = L.subagents[e.parentCallId] ?? { tools: [], text: '' };
      const ev = e.event;
      const next =
        ev.type === 'tool_call_started'
          ? { ...sub, tools: [...sub.tools, ev.call.name] }
          : ev.type === 'text_delta'
            ? { ...sub, text: (sub.text + ev.text).slice(-2000) }
            : ev.type === 'run_finished'
              ? { ...sub, status: ev.status }
              : sub;
      return next === sub ? s : { ...s, live: { ...L, subagents: { ...L.subagents, [e.parentCallId]: next } } };
    }
    case 'run_finished':
      return { ...s, live: { ...L, status: e.status, text: '', reasoning: '', generatingTool: null, pending: {}, approvals: {}, questions: {} } };
    default:
      return s;
  }
}

export function useThread(threadId: string | null) {
  const [state, dispatch] = useReducer(reducer, undefined, initial);
  const unsub = useRef<(() => void) | null>(null);
  const { bumpFs, loadThreads, projectId } = useStore();
  const tidRef = useRef(threadId);
  tidRef.current = threadId;

  const reload = useCallback(async () => {
    if (!threadId) return null;
    try {
      const d = await api.thread(threadId);
      if (tidRef.current !== threadId) return null;
      dispatch({ type: 'loaded', messages: d.messages, todos: d.todos, lastRun: d.lastRun });
      return d;
    } catch (e) {
      dispatch({ type: 'error', error: (e as Error).message });
      return null;
    }
  }, [threadId]);

  const attach = useCallback(
    (runId: string) => {
      unsub.current?.();
      dispatch({ type: 'attach', runId });
      unsub.current = subscribeRun(
        runId,
        (e) => {
          dispatch({ type: 'event', e });
          if (e.type === 'tool_call_finished' && (e.message.meta as any)?.changedFiles?.length) bumpFs();
        },
        (why) => {
          unsub.current = null;
          void reload();
          if (projectId) void loadThreads(projectId);
          bumpFs();
          // Auto-continue starts a new run in the same thread; pick it up without a Resume click.
          const retry = why === 'error' ? 2000 : 350;
          setTimeout(async () => {
            const d = await api.thread(threadId!).catch(() => null);
            if (d?.thread.activeRunId && tidRef.current === threadId) attach(d.thread.activeRunId);
          }, retry);
        },
      );
    },
    [reload, bumpFs, loadThreads, projectId, threadId],
  );

  useEffect(() => {
    unsub.current?.();
    unsub.current = null;
    dispatch({ type: 'reset' });
    if (!threadId) return;
    dispatch({ type: 'loading' });
    void reload().then((d) => {
      if (d?.thread.activeRunId) attach(d.thread.activeRunId);
    });
    return () => {
      unsub.current?.();
      unsub.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [threadId]);

  return { state, attach, reload };
}
