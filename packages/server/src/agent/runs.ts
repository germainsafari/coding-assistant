// Run manager: one RunHandle per agent run. Buffers events so the browser can
// (re)connect to the SSE stream at any time, and brokers approvals / questions.
import type { AgentEvent, AgentEventBody, RunStatus, ToolCall } from '@hearth/shared';
import { newId } from '../util.ts';

export type ApprovalDecision = { decision: 'approved' | 'denied'; feedback?: string; always?: boolean };

export class RunHandle {
  readonly id: string;
  readonly events: AgentEvent[] = [];
  private seq = 0;
  private listeners = new Set<(e: AgentEvent) => void>();
  readonly abort = new AbortController();
  status: RunStatus = 'running';
  /** LoopResult once the run has finished */
  result?: unknown;
  readonly pendingApprovals = new Map<string, { call: ToolCall; resolve: (d: ApprovalDecision) => void }>();
  readonly pendingQuestions = new Map<string, (answer: string) => void>();
  readonly alwaysApprove = new Set<string>();

  constructor(
    readonly threadId: string,
    readonly projectId: string,
    id?: string,
  ) {
    this.id = id ?? newId('r_');
  }

  emit(body: AgentEventBody) {
    const e = { ...body, seq: ++this.seq, runId: this.id, ts: Date.now() } as AgentEvent;
    // Collapse streaming deltas in the replay buffer to keep it small.
    const last = this.events[this.events.length - 1];
    if (last && (e.type === 'text_delta' || e.type === 'reasoning_delta') && last.type === e.type) {
      (last as any).text += (e as any).text;
      last.seq = e.seq;
    } else {
      this.events.push(e.type === 'text_delta' || e.type === 'reasoning_delta' ? { ...e } : e);
    }
    for (const l of this.listeners) l(e);
  }

  subscribe(fn: (e: AgentEvent) => void) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  requestApproval(call: ToolCall): Promise<ApprovalDecision> {
    return new Promise((resolve) => {
      if (this.abort.signal.aborted) return resolve({ decision: 'denied', feedback: 'Run cancelled' });
      this.pendingApprovals.set(call.id, { call, resolve });
      this.abort.signal.addEventListener('abort', () => resolve({ decision: 'denied', feedback: 'Run cancelled' }), { once: true });
    });
  }

  resolveApproval(callId: string, d: ApprovalDecision): boolean {
    const p = this.pendingApprovals.get(callId);
    if (!p) return false;
    this.pendingApprovals.delete(callId);
    if (d.always && d.decision === 'approved') this.alwaysApprove.add(p.call.name);
    this.emit({ type: 'approval_resolved', callId, decision: d.decision, feedback: d.feedback });
    p.resolve(d);
    return true;
  }

  ask(callId: string, question: string, options?: string[]): Promise<string> {
    this.emit({ type: 'ask_user', callId, question, options });
    return new Promise((resolve, reject) => {
      this.pendingQuestions.set(callId, resolve);
      this.abort.signal.addEventListener('abort', () => reject(new Error('Run cancelled')), { once: true });
    });
  }

  answer(callId: string, answer: string): boolean {
    const r = this.pendingQuestions.get(callId);
    if (!r) return false;
    this.pendingQuestions.delete(callId);
    this.emit({ type: 'ask_user_answered', callId, answer });
    r(answer);
    return true;
  }
}

export const activeRuns = new Map<string, RunHandle>();
export const activeByThread = new Map<string, string>();

export function registerRun(h: RunHandle) {
  activeRuns.set(h.id, h);
  activeByThread.set(h.threadId, h.id);
}

export function finishRun(h: RunHandle) {
  if (activeByThread.get(h.threadId) === h.id) activeByThread.delete(h.threadId);
  // keep finished runs around briefly so late SSE subscribers can replay them
  setTimeout(() => activeRuns.delete(h.id), 5 * 60_000).unref?.();
}
