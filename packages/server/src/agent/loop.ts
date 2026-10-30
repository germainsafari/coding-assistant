// The agent loop: plan -> call tools -> observe -> iterate, streaming events.
// Long-run mode adds time/step budgets, a definition-of-done verification gate,
// plan-completeness checks, durable checkpoints (.agent/progress.md) and
// patience with a temporarily unavailable model server.
import type { AgentEventBody, ChatMessage, LongRunOptions, Project, RunOptions, RunStatus, Settings, Thread, ToolCall } from '@hearth/shared';
import { settingsForProfile } from '../config.ts';
import { messages as messagesDb, projects, runs as runsDb, spans, threads } from '../db.ts';
import { chatOnce, chatStream, invalidateCapabilities, LlmHttpError, probeCapabilities, type LlmResult } from '../llm/client.ts';
import { approvalNeeded, deniedReason, SandboxError } from '../safety.ts';
import { execCommand } from '../shell.ts';
import { allTools, toOpenAITools } from '../tools/index.ts';
import type { ToolContext, ToolDef, ToolResult } from '../tools/types.ts';
import { errMsg, newId, safeJson, truncateMiddle } from '../util.ts';
import { buildContext, calibrate, compact, type ContextOptions } from './context.ts';
import { appendProgress, resolveLongRun } from './longrun.ts';
import { buildSystemPrompt } from './prompt.ts';
import { finishRun, registerRun, RunHandle } from './runs.ts';
import { exportRunToOtel } from '../otel.ts';

const MAX_TOOL_RESULT_CHARS = 16_000;
/** Polling tools that are legitimately called repeatedly with identical arguments. */
const REPEAT_OK = new Set(['shell_output', 'update_plan', 'browser_screenshot', 'git_status']);

interface LoopOptions {
  runId: string;
  thread: Thread;
  project: Project;
  userMessage: string;
  /** stored with the user message (e.g. {synthetic:true} for harness-generated resumes) */
  userMeta?: Record<string, unknown>;
  settings: Settings;
  depth: number;
  readOnly: boolean;
  parentRunId?: string | null;
  source: string;
  runOptions: RunOptions;
  longRun: LongRunOptions | null;
  /** top-level handle: approvals, questions and cancellation always go through it */
  handle: RunHandle;
  emit: (e: AgentEventBody) => void;
}

export interface LoopResult {
  status: RunStatus;
  finalText: string;
  steps: number;
  promptTokens: number;
  completionTokens: number;
  toolCalls: number;
  error?: string;
}

/** Detects the agent going in circles: identical calls, or errors piling up. */
class StuckDetector {
  private recent: string[] = [];
  private consecutiveErrors = 0;
  private lastFailSig = '';
  private sameFail = 0;
  nudges = 0;

  record(call: ToolCall, ok: boolean) {
    const sig = `${call.name}:${JSON.stringify(call.arguments)}`;
    if (!REPEAT_OK.has(call.name)) this.recent = [...this.recent, sig].slice(-8);
    if (ok) {
      this.consecutiveErrors = 0;
      this.sameFail = 0;
    } else {
      this.consecutiveErrors++;
      this.sameFail = sig === this.lastFailSig ? this.sameFail + 1 : 1;
      this.lastFailSig = sig;
    }
  }

  /** A reflection prompt if the agent looks stuck, else null. */
  check(): string | null {
    let msg: string | null = null;
    const counts = new Map<string, number>();
    for (const s of this.recent) counts.set(s, (counts.get(s) ?? 0) + 1);
    const [topSig, top] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0] ?? ['', 0];
    if (this.sameFail >= 3) {
      msg = `The same tool call (${this.lastFailSig.split(':')[0]}) has failed ${this.sameFail} times in a row.`;
    } else if (top >= 3) {
      msg = `You have made the identical call ${topSig.split(':')[0]} ${top} times recently with the same arguments - you appear to be looping.`;
    } else if (this.consecutiveErrors >= 5) {
      msg = `${this.consecutiveErrors} tool calls in a row have failed.`;
    }
    if (!msg) return null;
    this.nudges++;
    this.recent = [];
    this.consecutiveErrors = 0;
    this.sameFail = 0;
    return `[harness] ${msg} Stop and reflect: (1) re-read the exact error output and the relevant files, (2) list 2-3 hypotheses for the root cause, (3) choose a genuinely different approach. If you are blocked by something only the user can fix, explain it and stop.`;
  }
}

const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    const t = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => (clearTimeout(t), resolve()), { once: true });
  });

const isContextError = (e: unknown) => e instanceof LlmHttpError && e.status === 400 && /context length|maximum.*(tokens|length)|too (long|many tokens)|exceeds/i.test(e.body);
const isTransient = (e: unknown) => !(e instanceof LlmHttpError) || e.status >= 500 || e.status === 429;

async function runLoop(o: LoopOptions): Promise<LoopResult> {
  const { settings, emit, handle } = o;
  const signal = handle.abort.signal;
  const lr = o.depth === 0 ? o.longRun : null;
  const result: LoopResult = { status: 'running', finalText: '', steps: 0, promptTokens: 0, completionTokens: 0, toolCalls: 0 };
  runsDb.create({
    id: o.runId,
    threadId: o.thread.id,
    projectId: o.project.id,
    parentRunId: o.parentRunId,
    model: settings.model.model,
    userMessage: o.userMessage,
    source: o.source,
    options: o.depth === 0 ? o.runOptions : null,
  });
  emit({ type: 'run_started', threadId: o.thread.id, userMessage: o.userMessage, model: settings.model.model, longRun: lr });
  messagesDb.add({ threadId: o.thread.id, role: 'user', content: o.userMessage, runId: o.runId, meta: o.userMeta ? { ok: true, ...o.userMeta } : null });

  const startedAt = Date.now();
  const maxSteps = lr ? lr.maxSteps : settings.maxSteps;
  const deadline = lr ? startedAt + lr.maxMinutes * 60_000 : Number.POSITIVE_INFINITY;

  try {
    let caps = await probeCapabilities(settings.model);
    if (!caps.reachable) caps = await probeCapabilities(settings.model, true);
    if (!caps.reachable) throw new Error(`Cannot reach the model server at ${settings.model.baseUrl}: ${caps.error}. Is vLLM running? (see docs/setup-guide.md)`);
    let mode = caps.effectiveToolMode;
    const contextLimit = settings.model.contextLimit || caps.maxModelLen || 32768;
    const tools = allTools({ readOnly: o.readOnly, subagent: o.depth > 0 });
    const oaiTools = toOpenAITools(tools);
    const known = new Set(tools.map((t) => t.name));
    const makePrompt = () =>
      buildSystemPrompt({ project: o.project, settings, tools, mode, userMessage: o.userMessage, subagent: o.depth > 0, readOnly: o.readOnly, longRun: lr });
    let systemPrompt = makePrompt();
    const stuck = new StuckDetector();
    let nudges = 0;
    let planNudges = 0;
    let verifyAttempts = 0;
    let llmRetryUntil = 0;

    for (let step = 1; step <= maxSteps; step++) {
      if (signal.aborted) break;
      if (Date.now() > deadline) {
        result.status = 'budget_exhausted';
        result.finalText = `Stopped: the long-run time budget of ${lr!.maxMinutes} minutes is used up. Progress is saved in .agent/progress.md; send "continue" (or press Resume) to keep going.`;
        break;
      }
      result.steps = step;
      emit({ type: 'step_started', step });

      const ctxOpts: ContextOptions = {
        threadId: o.thread.id,
        systemPrompt: () => systemPrompt,
        mode,
        model: settings.model,
        contextLimit,
        compactAt: settings.compactAt,
        tools: oaiTools,
        signal,
        onCompact: (info) => {
          const sid = spans.start({ runId: o.runId, kind: 'compaction', name: 'compact_context', input: `before≈${info.beforeTokens} tokens` });
          spans.end(sid, { status: 'ok', output: info.summary, promptTokens: info.promptTokens, completionTokens: info.completionTokens });
          if (lr) {
            try {
              appendProgress(o.project.path, `Checkpoint at step ${step} (context compacted)`, info.summary);
            } catch {}
          }
          // re-read AGENTS.md / plan / progress into the fresh prompt
          systemPrompt = makePrompt();
          emit({ type: 'context_compacted', beforeTokens: info.beforeTokens, afterTokens: info.afterTokens, summary: info.summary });
        },
      };
      const ctx = await buildContext(ctxOpts);

      const llmSpan = spans.start({
        runId: o.runId,
        kind: 'llm',
        name: `llm step ${step}`,
        input: safeJson({ estTokens: ctx.estTokens, messages: ctx.messages.length, mode, maxTokens: ctx.maxTokens, last: ctx.messages[ctx.messages.length - 1] }, 6000),
      });
      let res: LlmResult;
      try {
        res = await chatStream({
          settings: settings.model,
          messages: ctx.messages,
          tools: oaiTools,
          mode,
          maxTokens: ctx.maxTokens,
          signal,
          onReasoning: (t) => emit({ type: 'reasoning_delta', text: t }),
          onText: (t) => emit({ type: 'text_delta', text: t }),
          onToolGenerating: (name) => emit({ type: 'tool_call_generating', name }),
        });
      } catch (e) {
        spans.end(llmSpan, { status: 'error', error: errMsg(e) });
        if (signal.aborted) throw e;
        if (e instanceof LlmHttpError && e.status === 400 && mode === 'native' && !isContextError(e)) {
          // the server stopped accepting tool_choice=auto (restarted without tool parser?) -> re-probe
          invalidateCapabilities();
          caps = await probeCapabilities(settings.model, true);
          if (caps.effectiveToolMode !== 'native') {
            mode = caps.effectiveToolMode;
            systemPrompt = makePrompt();
            emit({ type: 'notice', level: 'warn', text: `Native tool calling was rejected by the server; switched to "${mode}" tool mode.` });
            step--;
            continue;
          }
        }
        if (isContextError(e)) {
          emit({ type: 'notice', level: 'warn', text: 'Prompt exceeded the context window; compacting the conversation.' });
          await compact(ctxOpts, ctx.estTokens);
          step--;
          continue;
        }
        if (lr && isTransient(e)) {
          // long runs wait (up to 15 min per outage) for the model server to come back
          if (!llmRetryUntil) llmRetryUntil = Date.now() + 15 * 60_000;
          if (Date.now() < llmRetryUntil && Date.now() < deadline) {
            emit({ type: 'notice', level: 'warn', text: `Model server error (${errMsg(e).slice(0, 160)}). Retrying in 30s…` });
            await sleep(30_000, signal);
            invalidateCapabilities();
            step--;
            continue;
          }
        }
        throw e;
      }
      llmRetryUntil = 0;
      calibrate(ctx.estTokens, res.promptTokens);
      result.promptTokens += res.promptTokens;
      result.completionTokens += res.completionTokens;
      spans.end(llmSpan, {
        status: 'ok',
        output: safeJson({ content: res.content, reasoning: res.reasoning.slice(0, 4000), toolCalls: res.toolCalls, finishReason: res.finishReason, parseErrors: res.parseErrors }, 12000),
        promptTokens: res.promptTokens,
        completionTokens: res.completionTokens,
        ttftMs: res.ttftMs ?? undefined,
        tokensPerSec: res.tokensPerSec ?? undefined,
      });
      runsDb.update(o.runId, { steps: step, promptTokens: result.promptTokens, completionTokens: result.completionTokens });
      emit({ type: 'usage', promptTokens: res.promptTokens, completionTokens: res.completionTokens, contextLimit, tokensPerSec: res.tokensPerSec ?? undefined });

      const calls: ToolCall[] = res.toolCalls;
      const assistant = messagesDb.add({
        threadId: o.thread.id,
        role: 'assistant',
        content: res.content,
        reasoning: res.reasoning || null,
        toolCalls: calls.length ? calls : null,
        runId: o.runId,
        meta: { ok: true, finishReason: res.finishReason, tokensPerSec: res.tokensPerSec },
      });
      emit({ type: 'assistant_message', message: assistant });

      if (!calls.length) {
        if (res.parseErrors.length && nudges < 3) {
          nudges++;
          addSynthetic(o, `[harness] Your tool call could not be parsed: ${res.parseErrors.join('; ')}. Please retry using the exact tool call format.`);
          continue;
        }
        if (!res.content && nudges < 2) {
          nudges++;
          const why = res.finishReason === 'length' ? 'Your output hit the token limit before you produced an answer or tool call.' : 'You produced no answer or tool call.';
          addSynthetic(o, `[harness] ${why} Continue the task: call the next tool, or give your final answer. Keep reasoning brief.`);
          continue;
        }
        if (lr) {
          const gate = await longRunGate(o, lr, { planNudges, verifyAttempts });
          planNudges = gate.planNudges;
          verifyAttempts = gate.verifyAttempts;
          if (gate.action === 'continue') continue;
          if (gate.action === 'fail') {
            result.status = 'error';
            result.error = gate.error;
            result.finalText = res.content;
            emit({ type: 'error', message: gate.error! });
            break;
          }
        }
        result.finalText = res.content;
        result.status = 'completed';
        break;
      }

      for (const call of calls) {
        if (signal.aborted) break;
        result.toolCalls++;
        const tool = tools.find((t) => t.name === call.name);
        const msg = await executeCall(o, call, tool, known);
        stuck.record(call, !!msg.meta?.ok);
      }
      const warn = stuck.check();
      if (warn) {
        emit({ type: 'notice', level: 'warn', text: 'Loop/stuck detection triggered: asking the agent to reflect and change strategy.' });
        addSynthetic(o, warn);
        if (!lr && stuck.nudges > 4) {
          result.status = 'error';
          result.error = 'The agent appears to be stuck (repeated failing or identical tool calls).';
          emit({ type: 'error', message: result.error });
          break;
        }
      }
    }
    if (signal.aborted) result.status = 'cancelled';
    else if (result.status === 'running') {
      result.status = 'max_steps';
      result.finalText = `Stopped after reaching the maximum of ${maxSteps} steps. Send "continue" to keep going.`;
    }
    if (result.status === 'max_steps' || result.status === 'budget_exhausted') {
      const m = messagesDb.add({ threadId: o.thread.id, role: 'assistant', content: result.finalText, runId: o.runId, meta: { ok: true, synthetic: true } });
      emit({ type: 'assistant_message', message: m });
    }
  } catch (e) {
    if (signal.aborted || (e as Error).name === 'AbortError') {
      result.status = 'cancelled';
    } else {
      result.status = 'error';
      result.error = e instanceof LlmHttpError ? e.message : errMsg(e);
      emit({ type: 'error', message: result.error });
      console.error('[agent] run error', e);
    }
  }
  if (lr && result.status !== 'completed') {
    try {
      appendProgress(o.project.path, `Run ended: ${result.status}`, `${result.error ?? result.finalText ?? ''}\nSteps: ${result.steps}, tool calls: ${result.toolCalls}.`);
    } catch {}
  }
  runsDb.update(o.runId, { status: result.status, endedAt: Date.now(), error: result.error ?? null, steps: result.steps, promptTokens: result.promptTokens, completionTokens: result.completionTokens });
  exportRunToOtel(o.runId).catch(() => {});
  return result;
}

/** Long-run completion gate: unfinished plan items and the definition-of-done command. */
async function longRunGate(
  o: LoopOptions,
  lr: LongRunOptions,
  st: { planNudges: number; verifyAttempts: number },
): Promise<{ action: 'continue' | 'finish' | 'fail'; planNudges: number; verifyAttempts: number; error?: string }> {
  const unfinished = threads.getTodos(o.thread.id).filter((t) => t.status === 'pending' || t.status === 'in_progress');
  if (unfinished.length && st.planNudges < 3) {
    o.emit({ type: 'notice', level: 'info', text: `Long-run: ${unfinished.length} plan item(s) unfinished; continuing.` });
    addSynthetic(
      o,
      `[harness] Long-run mode: your plan still has ${unfinished.length} unfinished item(s):\n${unfinished.map((t) => `- [${t.status}] ${t.content}`).join('\n')}\nContinue working on them. If an item is not needed, mark it cancelled via update_plan and say why.`,
    );
    return { action: 'continue', planNudges: st.planNudges + 1, verifyAttempts: st.verifyAttempts };
  }
  if (!lr.doneCommand) return { action: 'finish', ...st };

  const attempt = st.verifyAttempts + 1;
  const sid = spans.start({ runId: o.runId, kind: 'tool', name: 'verify:done_command', input: lr.doneCommand });
  const r = await execCommand(lr.doneCommand, { cwd: o.project.path, timeoutMs: 15 * 60_000, signal: o.handle.abort.signal });
  const passed = r.exitCode === 0 && !r.timedOut;
  const out = truncateMiddle(r.output.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '').trim(), 6000).text;
  spans.end(sid, { status: passed ? 'ok' : 'error', output: out, error: passed ? undefined : `exit ${r.exitCode}` });
  o.emit({ type: 'verification', command: lr.doneCommand, passed, output: out, attempt });
  try {
    appendProgress(o.project.path, `Verification attempt ${attempt}: ${passed ? 'PASSED' : 'FAILED'}`, `\`${lr.doneCommand}\` -> exit ${r.exitCode}${r.timedOut ? ' (timed out)' : ''}\n\n\`\`\`\n${out.slice(-1500)}\n\`\`\``);
  } catch {}
  if (passed) return { action: 'finish', planNudges: st.planNudges, verifyAttempts: attempt };
  if (attempt >= lr.maxVerifyAttempts) {
    return { action: 'fail', planNudges: st.planNudges, verifyAttempts: attempt, error: `Definition-of-done command \`${lr.doneCommand}\` still fails after ${attempt} attempts.` };
  }
  addSynthetic(
    o,
    `[harness] You tried to finish, but the definition-of-done check failed (attempt ${attempt}/${lr.maxVerifyAttempts}).\n$ ${lr.doneCommand}\n${out}\n[exit code ${r.exitCode}${r.timedOut ? ', timed out' : ''}]\nFix the problems, re-run the check yourself, and only then finish.`,
  );
  return { action: 'continue', planNudges: st.planNudges, verifyAttempts: attempt };
}

function addSynthetic(o: LoopOptions, text: string) {
  messagesDb.add({ threadId: o.thread.id, role: 'user', content: text, runId: o.runId, meta: { ok: true, synthetic: true } });
}

async function executeCall(o: LoopOptions, call: ToolCall, tool: ToolDef | undefined, known: Set<string>): Promise<ChatMessage> {
  const { emit, handle, settings } = o;
  const save = (r: ToolResult & { denied?: boolean }, durationMs: number) => {
    const { text, truncated } = truncateMiddle(r.content, MAX_TOOL_RESULT_CHARS);
    const m = messagesDb.add({
      threadId: o.thread.id,
      role: 'tool',
      content: text,
      toolCallId: call.id,
      name: call.name,
      runId: o.runId,
      meta: { ok: r.ok, durationMs, diff: r.diff, image: r.image, truncated, denied: r.denied, changedFiles: r.changedFiles },
    });
    emit({ type: 'tool_call_finished', callId: call.id, name: call.name, message: m });
    return m;
  };

  emit({ type: 'tool_call_started', call });
  if (!tool) {
    const names = [...known].filter((n) => n.includes(call.name.split('_')[0])).slice(0, 8);
    return save({ ok: false, content: `Unknown tool "${call.name}". Available tools include: ${names.join(', ') || [...known].slice(0, 20).join(', ')}` }, 0);
  }

  const risk = tool.riskFor?.(call.arguments) ?? tool.risk;
  const command = typeof call.arguments.command === 'string' ? call.arguments.command : undefined;
  const blocked = risk === 'shell' && command ? deniedReason(command) : null;
  const reason = blocked ? null : approvalNeeded(risk, settings.approvalMode, { command, autoApprove: tool.autoApprove });
  if (o.readOnly && risk !== 'read' && risk !== 'network') {
    return save({ ok: false, content: 'This subagent is read-only; that tool is not allowed.' }, 0);
  }
  if (reason && !handle.alwaysApprove.has(tool.name)) {
    let preview: string | undefined;
    try {
      preview = await tool.preview?.(call.arguments, toolContext(o, call.id));
    } catch {}
    const approvalSpan = spans.start({ runId: o.runId, kind: 'tool', name: `approval:${call.name}`, input: safeJson(call.arguments, 4000) });
    handle.emit({ type: 'approval_required', call, reason, preview });
    const d = await handle.requestApproval(call);
    spans.end(approvalSpan, { status: d.decision === 'approved' ? 'ok' : 'denied', output: d.feedback });
    if (d.decision === 'denied') {
      return save({ ok: false, denied: true, content: `The user DENIED this ${call.name} call.${d.feedback ? ` User feedback: ${d.feedback}` : ''} Do not retry the same action; adapt your plan or ask the user.` }, 0);
    }
  }

  const sid = spans.start({ runId: o.runId, kind: 'tool', name: call.name, input: safeJson(call.arguments, 8000) });
  const t0 = Date.now();
  let r: ToolResult;
  try {
    r = await tool.execute(call.arguments ?? {}, toolContext(o, call.id));
  } catch (e) {
    r = { ok: false, content: `Error: ${e instanceof SandboxError ? e.message : errMsg(e)}` };
  }
  const dur = Date.now() - t0;
  spans.end(sid, { status: r.ok ? 'ok' : 'error', output: safeJson(r.content, 8000), error: r.ok ? undefined : r.content.slice(0, 500) });
  return save(r, dur);
}

function toolContext(o: LoopOptions, callId: string): ToolContext {
  return {
    project: o.project,
    root: o.project.path,
    threadId: o.thread.id,
    runId: o.runId,
    settings: o.settings,
    signal: o.handle.abort.signal,
    depth: o.depth,
    callId,
    longRun: o.depth === 0 ? o.longRun : null,
    emit: o.emit,
    askUser: (q, options) => o.handle.ask(callId, q, options),
    runSubagent: async (task, { readOnly }) => {
      const sub = threads.create(o.project.id, `Subagent: ${task.slice(0, 60)}`, { parentThreadId: o.thread.id, hidden: true });
      const subRunId = newId('r_');
      const sid = spans.start({ runId: o.runId, kind: 'subagent', name: 'subagent', input: task.slice(0, 4000) });
      const r = await runLoop({
        ...o,
        runId: subRunId,
        thread: sub,
        userMessage: task,
        userMeta: undefined,
        depth: o.depth + 1,
        readOnly,
        parentRunId: o.runId,
        source: 'subagent',
        longRun: null,
        runOptions: {},
        settings: { ...o.settings, maxSteps: Math.min(o.settings.maxSteps, 25) },
        emit: (e) => o.emit({ type: 'subagent_event', parentCallId: callId, event: { ...e, seq: 0, runId: subRunId, ts: Date.now() } as any }),
      });
      spans.end(sid, { status: r.status === 'completed' ? 'ok' : 'error', output: r.finalText.slice(0, 8000), promptTokens: r.promptTokens, completionTokens: r.completionTokens });
      if (r.status !== 'completed') return `Subagent ended with status "${r.status}"${r.error ? `: ${r.error}` : ''}.\n${r.finalText}`;
      return r.finalText || '(subagent returned no text)';
    },
  };
}

// ---------- public API ----------
export interface StartRunOptions {
  source?: string;
  /** full settings override (evals); otherwise current settings + options.profileId */
  settings?: Settings;
  options?: Omit<RunOptions, 'longRun'> & { longRun?: Partial<LongRunOptions> };
  userMeta?: Record<string, unknown>;
}

export function startRun(threadId: string, userMessage: string, opts: StartRunOptions = {}): RunHandle {
  const thread = threads.get(threadId);
  if (!thread) throw new Error('Thread not found');
  const project = projects.get(thread.projectId);
  if (!project) throw new Error('Project not found');
  const settings = opts.settings ?? settingsForProfile(opts.options?.profileId);
  const longRun = resolveLongRun(opts.options?.longRun, settings);
  const runOptions: RunOptions = { profileId: opts.options?.profileId, resumeOf: opts.options?.resumeOf, ...(longRun ? { longRun } : {}) };
  const handle = new RunHandle(thread.id, project.id);
  registerRun(handle);
  const isFirst = messagesDb.count(thread.id) === 0;

  void (async () => {
    const r = await runLoop({
      runId: handle.id,
      thread,
      project,
      userMessage,
      userMeta: opts.userMeta,
      settings,
      depth: 0,
      readOnly: false,
      source: opts.source ?? 'ui',
      runOptions,
      longRun,
      handle,
      emit: (e) => handle.emit(e),
    });
    handle.status = r.status;
    handle.result = r;
    handle.emit({ type: 'run_finished', status: r.status, error: r.error });
    finishRun(handle);
  })();

  if (isFirst && thread.title === 'New thread') {
    void autoTitle(thread.id, userMessage, settings);
  }
  return handle;
}

/** Continue an interrupted / budget-stopped run in the same thread with the same options. */
export function resumeThread(threadId: string, source = 'resume'): RunHandle {
  const last = runsDb.lastForThread(threadId);
  const options = last?.options ?? {};
  const why = last ? `The previous run ended with status "${last.status}"${last.error ? ` (${last.error})` : ''}.` : '';
  const files = options.longRun?.enabled ? ' Re-read .agent/plan.md and .agent/progress.md,' : '';
  const msg = `[harness] Resume. ${why}${files} check the current state of the files (and any test/build output), then continue the task where you left off. Do not redo work that is already complete.`;
  return startRun(threadId, msg, { source, options: { ...options, resumeOf: last?.id }, userMeta: { synthetic: true, resume: true } });
}

export function waitForRun(h: RunHandle): Promise<LoopResult> {
  return new Promise((resolve) => {
    if (h.result) return resolve(h.result as LoopResult);
    const off = h.subscribe((e) => {
      if (e.type === 'run_finished') {
        off();
        resolve(h.result as LoopResult);
      }
    });
  });
}

async function autoTitle(threadId: string, userMessage: string, settings: Settings) {
  threads.rename(threadId, userMessage.replace(/\s+/g, ' ').slice(0, 60));
  try {
    const r = await chatOnce(
      settings.model,
      [
        { role: 'system', content: 'Write a short title (max 6 words) for a coding conversation that starts with the user message below. Reply with the title only, no quotes or punctuation at the end.' },
        { role: 'user', content: userMessage.slice(0, 2000) },
      ],
      { maxTokens: 24, thinking: false },
    );
    const title = r.content.split('\n')[0].replace(/^["'#\s]+|["'.\s]+$/g, '').slice(0, 80);
    if (title) threads.rename(threadId, title);
  } catch {}
}
