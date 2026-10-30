// Context management: converts stored thread messages into the LLM prompt and
// keeps it inside the model's context window by (1) pruning old tool outputs
// and (2) summarizing ("compacting") older turns with the model itself.
import type { ModelSettings } from '@hearth/shared';
import { messages as messagesDb, threads, type StoredMessage } from '../db.ts';
import { chatOnce, type OAIMessage, type OAITool } from '../llm/client.ts';
import { truncateMiddle } from '../util.ts';

const IMAGE_TOKENS = 1400;
let charsPerToken = 3.2; // calibrated at runtime from real usage numbers

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / charsPerToken);
}

export function calibrate(estimatedTokens: number, actualPromptTokens: number) {
  if (!estimatedTokens || !actualPromptTokens) return;
  const ratio = (estimatedTokens * charsPerToken) / actualPromptTokens; // = chars per real token
  if (ratio > 1.5 && ratio < 8) charsPerToken = charsPerToken * 0.7 + ratio * 0.3;
}

export function estimateMessages(msgs: OAIMessage[], tools?: OAITool[]): number {
  let t = 0;
  for (const m of msgs) {
    t += 6;
    if (typeof m.content === 'string') t += estimateTokens(m.content);
    else if (Array.isArray(m.content)) for (const p of m.content) t += p.type === 'text' ? estimateTokens(p.text) : IMAGE_TOKENS;
    if (m.tool_calls) t += estimateTokens(JSON.stringify(m.tool_calls));
  }
  if (tools?.length) t += estimateTokens(JSON.stringify(tools)) + 200;
  return t;
}

function xmlToolCall(name: string, args: Record<string, unknown>): string {
  const params = Object.entries(args)
    .map(([k, v]) => `<parameter=${k}>\n${typeof v === 'string' ? v : JSON.stringify(v)}\n</parameter>`)
    .join('\n');
  return `<tool_call>\n<function=${name}>\n${params}\n</function>\n</tool_call>`;
}

const PRUNED_NOTE = '\n…[older tool output pruned to save context; re-run the tool if you need it again]';

export function toOpenAIMessages(stored: StoredMessage[], mode: 'native' | 'template' | 'prompt', opts: { vision: boolean; pruneBefore?: number }): OAIMessage[] {
  const out: OAIMessage[] = [];
  // only the most recent image is sent to the model
  let lastImageIdx = -1;
  if (opts.vision) for (let i = stored.length - 1; i >= 0; i--) if (stored[i].meta?.image) { lastImageIdx = i; break; }
  let pendingImage: StoredMessage | null = null;

  // Tool calls whose results were never stored (run crashed / cancelled mid-tool)
  // get a synthetic result so that every call is answered, as chat templates expect.
  const answered = new Set(stored.filter((m) => m.role === 'tool').map((m) => m.toolCallId));
  const orphanResults = (calls: { id: string; name: string }[]) => {
    for (const c of calls) {
      if (answered.has(c.id)) continue;
      const content = '[no result: the run was interrupted before this tool finished]';
      if (mode === 'prompt') out.push({ role: 'user', content: `<tool_response>\n${content}\n</tool_response>` });
      else out.push({ role: 'tool', tool_call_id: c.id, content });
    }
  };

  for (let i = 0; i < stored.length; i++) {
    const m = stored[i];
    const prune = opts.pruneBefore !== undefined && i < opts.pruneBefore;
    if (m.role === 'user') {
      out.push({ role: 'user', content: m.content });
    } else if (m.role === 'assistant') {
      const calls = m.toolCalls ?? [];
      const nextIsTool = stored[i + 1]?.role === 'tool';
      if (mode === 'prompt') {
        const text = [m.content, ...calls.map((c) => xmlToolCall(c.name, c.arguments))].filter(Boolean).join('\n\n');
        out.push({ role: 'assistant', content: text || '(no output)' });
      } else {
        out.push({
          role: 'assistant',
          content: m.content || (calls.length ? '' : '(no output)'),
          ...(calls.length
            ? { tool_calls: calls.map((c) => ({ id: c.id, type: 'function' as const, function: { name: c.name, arguments: JSON.stringify(c.arguments ?? {}) } })) }
            : {}),
        });
      }
      if (calls.length && !nextIsTool) orphanResults(calls);
    } else if (m.role === 'tool') {
      let content = m.content;
      if (prune && content.length > 1500) content = content.slice(0, 700) + PRUNED_NOTE;
      if (m.meta?.image && i !== lastImageIdx) content += '\n[screenshot omitted from context]';
      if (mode === 'prompt') {
        const prev = out[out.length - 1];
        const block = `<tool_response>\n${content}\n</tool_response>`;
        if (prev && prev.role === 'user' && typeof prev.content === 'string' && prev.content.startsWith('<tool_response>')) prev.content += '\n' + block;
        else out.push({ role: 'user', content: block });
      } else {
        out.push({ role: 'tool', tool_call_id: m.toolCallId ?? '', content });
      }
      // Tool messages can't carry images, so the latest screenshot is attached as a
      // user message after the batch of tool results it belongs to.
      if (i === lastImageIdx) pendingImage = m;
      const batchEnds = !stored[i + 1] || stored[i + 1].role !== 'tool';
      if (batchEnds) {
        let a = i;
        while (a >= 0 && stored[a].role === 'tool') a--;
        if (a >= 0 && stored[a].role === 'assistant') orphanResults(stored[a].toolCalls ?? []);
      }
      if (pendingImage && batchEnds) {
        out.push({
          role: 'user',
          content: [
            { type: 'text', text: `Screenshot from ${pendingImage.name}:` },
            { type: 'image_url', image_url: { url: String(pendingImage.meta!.image) } },
          ],
        });
        pendingImage = null;
      }
    }
  }
  return out;
}

export interface BuiltContext {
  messages: OAIMessage[];
  estTokens: number;
  maxTokens: number;
}

export interface ContextOptions {
  threadId: string;
  /** Called on every build so the prompt can be refreshed after a compaction. */
  systemPrompt: string | (() => string);
  mode: 'native' | 'template' | 'prompt';
  model: ModelSettings;
  contextLimit: number;
  /** Compact when the prompt exceeds this fraction of the context window (default 0.65). */
  compactAt?: number;
  tools?: OAITool[];
  signal?: AbortSignal;
  onCompact?: (info: { beforeTokens: number; afterTokens: number; summary: string; durationMs: number; promptTokens: number; completionTokens: number }) => void;
}

const KEEP_RECENT = 10;

function build(opts: ContextOptions, pruneOld: boolean): BuiltContext {
  const { summary, upto } = threads.getSummary(opts.threadId);
  const stored = messagesDb.list(opts.threadId, upto);
  const sys = typeof opts.systemPrompt === 'function' ? opts.systemPrompt() : opts.systemPrompt;
  const msgs: OAIMessage[] = [{ role: 'system', content: sys }];
  if (summary) {
    msgs.push({ role: 'user', content: `[Summary of the earlier part of this conversation, written by you before older messages were removed to save context]\n${summary}` });
    msgs.push({ role: 'assistant', content: 'Understood. I will continue from this summary.' });
  }
  msgs.push(...toOpenAIMessages(stored, opts.mode, { vision: opts.model.vision, pruneBefore: pruneOld ? Math.max(0, stored.length - KEEP_RECENT) : undefined }));
  const estTokens = estimateMessages(msgs, opts.mode === 'prompt' ? undefined : opts.tools);
  const room = opts.contextLimit - estTokens - 256;
  return { messages: msgs, estTokens, maxTokens: Math.max(256, Math.min(opts.model.maxOutputTokens, room)) };
}

/** Build the prompt, pruning/compacting as needed to fit the context window. */
export async function buildContext(opts: ContextOptions): Promise<BuiltContext> {
  // hard budget: always leave room for the reply
  const budget = opts.contextLimit - Math.min(opts.model.maxOutputTokens, Math.floor(opts.contextLimit * 0.25));
  const trigger = Math.min(budget, opts.contextLimit * (opts.compactAt ?? 0.65));
  let ctx = build(opts, false);
  if (ctx.estTokens <= trigger) return ctx;
  // first, cheaply drop the bodies of old tool outputs
  ctx = build(opts, true);
  if (ctx.estTokens <= trigger * 0.9) return ctx;
  await compact(opts, ctx.estTokens);
  ctx = build(opts, true);
  if (ctx.estTokens > budget) {
    // last resort: hard-truncate the largest remaining messages
    for (const m of ctx.messages.slice(1)) {
      if (typeof m.content === 'string' && m.content.length > 6000) m.content = truncateMiddle(m.content, 6000).text;
    }
    ctx.estTokens = estimateMessages(ctx.messages, opts.mode === 'prompt' ? undefined : opts.tools);
    ctx.maxTokens = Math.max(256, Math.min(opts.model.maxOutputTokens, opts.contextLimit - ctx.estTokens - 256));
  }
  return ctx;
}

/** Summarize everything except the most recent turns into threads.summary. */
export async function compact(opts: ContextOptions, beforeTokens: number) {
  const t0 = Date.now();
  const { summary: prevSummary, upto } = threads.getSummary(opts.threadId);
  const stored = messagesDb.list(opts.threadId, upto);
  if (stored.length <= 4) return;
  // cut point: keep the last KEEP_RECENT messages, moving the cut back so it starts at a user/assistant message
  let cut = Math.max(1, stored.length - KEEP_RECENT);
  while (cut > 0 && stored[cut].role === 'tool') cut--;
  if (cut <= 0) cut = Math.max(1, stored.length - 4);
  while (cut < stored.length && stored[cut].role === 'tool') cut++;
  const old = stored.slice(0, cut);
  if (!old.length) return;

  const transcript = old
    .map((m) => {
      if (m.role === 'assistant') {
        const calls = (m.toolCalls ?? []).map((c) => `  -> ${c.name}(${truncateMiddle(JSON.stringify(c.arguments), 300).text})`).join('\n');
        return `ASSISTANT: ${truncateMiddle(m.content, 2000).text}${calls ? '\n' + calls : ''}`;
      }
      if (m.role === 'tool') return `TOOL RESULT (${m.name}): ${truncateMiddle(m.content, 600).text}`;
      return `USER: ${truncateMiddle(m.content, 3000).text}`;
    })
    .join('\n');
  const prompt = `${prevSummary ? `Existing summary of even earlier conversation:\n${prevSummary}\n\n` : ''}Conversation segment to summarize:\n${truncateMiddle(transcript, 90_000).text}`;
  const r = await chatOnce(
    opts.model,
    [
      {
        role: 'system',
        content: `You compress a coding-agent conversation into a dense checkpoint summary that lets the agent continue seamlessly after the older messages are deleted. Use exactly these Markdown sections:
## Goal
(the user's request and requirements; quote short instructions verbatim)
## Constraints & preferences
## Done so far
(bullets: what was completed, with file paths)
## Files touched
(path - purpose / current state)
## Key findings & errors
(commands run and important results, error messages, what did NOT work)
## Current state
## Next steps
(ordered, concrete)
Be specific and factual. Max ~700 words.`,
      },
      { role: 'user', content: prompt },
    ],
    { maxTokens: 2000, thinking: false, signal: opts.signal },
  );
  const summary = r.content.trim();
  threads.setSummary(opts.threadId, summary, old[old.length - 1].seq);
  const after = build(opts, true).estTokens;
  opts.onCompact?.({ beforeTokens, afterTokens: after, summary, durationMs: Date.now() - t0, promptTokens: r.promptTokens, completionTokens: r.completionTokens });
}
