// The agent loop: plan -> call tools -> observe -> iterate, streaming events.
import type { AgentEventBody, ChatMessage, Project, RunStatus, Settings, Thread, ToolCall } from '@hearth/shared';
import { getSettings } from '../config.ts';
import { messages as messagesDb, projects, runs as runsDb, spans, threads } from '../db.ts';
import { chatOnce, chatStream, LlmHttpError, probeCapabilities } from '../llm/client.ts';
import { approvalNeeded, deniedReason, SandboxError } from '../safety.ts';
import { allTools, toOpenAITools } from '../tools/index.ts';
import type { ToolContext, ToolDef, ToolResult } from '../tools/types.ts';
import { errMsg, newId, safeJson, truncateMiddle } from '../util.ts';
import { buildContext, calibrate } from './context.ts';
import { buildSystemPrompt } from './prompt.ts';
import { finishRun, registerRun, RunHandle } from './runs.ts';
import { exportRunToOtel } from '../otel.ts';

const MAX_TOOL_RESULT_CHARS = 16_000;

interface LoopOptions {
  runId: string;
  thread: Thread;
  project: Project;
  userMessage: string;
  settings: Settings;
  depth: number;
  readOnly: boolean;
  parentRunId?: string | null;
  source: string;
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

async function runLoop(o: LoopOptions): Promise<LoopResult> {
  const { settings, emit, handle } = o;
  const signal = handle.abort.signal;
  const result: LoopResult = { status: 'running', finalText: '', steps: 0, promptTokens: 0, completionTokens: 0, toolCalls: 0 };
  runsDb.create({ id: o.runId, threadId: o.thread.id, projectId: o.project.id, parentRunId: o.parentRunId, model: settings.model.model, userMessage: o.userMessage, source: o.source });
  emit({ type: 'run_started', threadId: o.thread.id, userMessage: o.userMessage });
  messagesDb.add({ threadId: o.thread.id, role: 'user', content: o.userMessage, runId: o.runId });

  try {
    const caps = await probeCapabilities(settings.model);
    if (!caps.reachable) throw new Error(`Cannot reach the model server at ${settings.model.baseUrl}: ${caps.error}. Is vLLM running? (see docs/setup-guide.md)`);
    const mode = caps.effectiveToolMode;
    const contextLimit = settings.model.contextLimit || caps.maxModelLen || 32768;
    const tools = allTools({ readOnly: o.readOnly, subagent: o.depth > 0 });
    const oaiTools = toOpenAITools(tools);
    const systemPrompt = buildSystemPrompt({ project: o.project, settings, tools, mode, userMessage: o.userMessage, subagent: o.depth > 0, readOnly: o.readOnly });
    let nudges = 0;
    let lastFailSig = '';
    let sameFailCount = 0;

    for (let step = 1; step <= settings.maxSteps; step++) {
      if (signal.aborted) break;
      result.steps = step;
      emit({ type: 'step_started', step });

      const ctx = await buildContext({
        threadId: o.thread.id,
        systemPrompt,
        mode,
        model: settings.model,
        contextLimit,
        tools: oaiTools,
        signal,
        onCompact: (info) => {
          const sid = spans.start({ runId: o.runId, kind: 'compaction', name: 'compact_context', input: `before≈${info.beforeTokens} tokens` });
          spans.end(sid, { status: 'ok', output: info.summary, promptTokens: info.promptTokens, completionTokens: info.completionTokens });
          emit({ type: 'context_compacted', beforeTokens: info.beforeTokens, afterTokens: info.afterTokens, summary: info.summary });
        },
      });

      const llmSpan = spans.start({
        runId: o.runId,
        kind: 'llm',
        name: `llm step ${step}`,
        input: safeJson({ estTokens: ctx.estTokens, messages: ctx.messages.length, mode, maxTokens: ctx.maxTokens, last: ctx.messages[ctx.messages.length - 1] }, 6000),
      });
      let res;
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
        throw e;
      }
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

      const known = new Set(tools.map((t) => t.name));
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
        result.finalText = res.content;
        result.status = 'completed';
        break;
      }

      for (const call of calls) {
        if (signal.aborted) break;
        result.toolCalls++;
        const tool = tools.find((t) => t.name === call.name);
        const msg = await executeCall(o, call, tool, known);
        const sig = `${call.name}:${JSON.stringify(call.arguments)}`;
        if (!msg.meta?.ok) {
          sameFailCount = sig === lastFailSig ? sameFailCount + 1 : 1;
          lastFailSig = sig;
        } else sameFailCount = 0;
      }
      if (sameFailCount >= 3) {
        addSynthetic(o, '[harness] The same tool call has failed 3 times in a row. Stop repeating it: re-read the relevant files/errors and try a different approach, or explain the blocker to the user.');
        sameFailCount = 0;
      }
    }
    if (signal.aborted) result.status = 'cancelled';
    else if (result.status === 'running') {
      result.status = 'max_steps';
      result.finalText = `Stopped after reaching the maximum of ${settings.maxSteps} steps. Send "continue" to keep going.`;
      const m = messagesDb.add({ threadId: o.thread.id, role: 'assistant', content: result.finalText, runId: o.runId });
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
  runsDb.update(o.runId, { status: result.status, endedAt: Date.now(), error: result.error ?? null, steps: result.steps, promptTokens: result.promptTokens, completionTokens: result.completionTokens });
  exportRunToOtel(o.runId).catch(() => {});
  return result;
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
  let reason = blocked ? null : approvalNeeded(risk, settings.approvalMode, { command, autoApprove: tool.autoApprove });
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
        depth: o.depth + 1,
        readOnly,
        parentRunId: o.runId,
        source: 'subagent',
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
export function startRun(threadId: string, userMessage: string, opts: { source?: string; settings?: Settings } = {}): RunHandle {
  const thread = threads.get(threadId);
  if (!thread) throw new Error('Thread not found');
  const project = projects.get(thread.projectId);
  if (!project) throw new Error('Project not found');
  const settings = opts.settings ?? getSettings();
  const handle = new RunHandle(thread.id, project.id);
  registerRun(handle);
  const isFirst = messagesDb.count(thread.id) === 0;

  void (async () => {
    const r = await runLoop({
      runId: handle.id,
      thread,
      project,
      userMessage,
      settings,
      depth: 0,
      readOnly: false,
      source: opts.source ?? 'ui',
      handle,
      emit: (e) => handle.emit(e),
    });
    handle.status = r.status;
    handle.emit({ type: 'run_finished', status: r.status, error: r.error });
    finishRun(handle);
    (handle as any).result = r;
  })();

  if (isFirst && thread.title === 'New thread') {
    void autoTitle(thread.id, userMessage, settings);
  }
  return handle;
}

export function waitForRun(h: RunHandle): Promise<LoopResult> {
  return new Promise((resolve) => {
    const check = () => {
      if ((h as any).result) {
        resolve((h as any).result);
        return true;
      }
      return false;
    };
    if (check()) return;
    const off = h.subscribe((e) => {
      if (e.type === 'run_finished') setTimeout(() => (check() ? off() : undefined), 0);
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
