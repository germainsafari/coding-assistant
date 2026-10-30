// Minimal OpenAI-compatible streaming client (raw fetch + SSE parsing) so we can
// read vLLM-specific fields such as `delta.reasoning` / `reasoning_content`
// and pass `chat_template_kwargs`.
import type { Capabilities, ModelSettings, ToolCall } from '@hearth/shared';
import { newId } from '../util.ts';
import { parseToolCalls, StreamSplitter, type SchemaLookup } from './toolparse.ts';

export type OAIContentPart = { type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } };
export interface OAIMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | OAIContentPart[] | null;
  tool_calls?: { id: string; type: 'function'; function: { name: string; arguments: string } }[];
  tool_call_id?: string;
  name?: string;
}
export interface OAITool {
  type: 'function';
  function: { name: string; description: string; parameters: Record<string, any> };
}

export interface LlmRequest {
  settings: ModelSettings;
  messages: OAIMessage[];
  tools?: OAITool[];
  mode: 'native' | 'template' | 'prompt';
  maxTokens?: number;
  thinking?: boolean;
  temperature?: number;
  signal?: AbortSignal;
  onReasoning?: (t: string) => void;
  onText?: (t: string) => void;
  onToolGenerating?: (name: string) => void;
}

export interface LlmResult {
  content: string;
  reasoning: string;
  toolCalls: ToolCall[];
  rawContent: string;
  finishReason: string | null;
  promptTokens: number;
  completionTokens: number;
  ttftMs: number | null;
  durationMs: number;
  tokensPerSec: number | null;
  parseErrors: string[];
}

export class LlmHttpError extends Error {
  constructor(
    public status: number,
    public body: string,
  ) {
    super(`LLM server returned HTTP ${status}: ${body.slice(0, 500)}`);
  }
}

function headers(s: ModelSettings) {
  return { 'content-type': 'application/json', authorization: `Bearer ${s.apiKey || 'local'}` };
}
const url = (s: ModelSettings, p: string) => s.baseUrl.replace(/\/+$/, '') + p;

async function* sseLines(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let nl: number;
    while ((nl = buf.indexOf('\n')) !== -1) {
      const line = buf.slice(0, nl).replace(/\r$/, '');
      buf = buf.slice(nl + 1);
      if (line.startsWith('data:')) yield line.slice(5).trim();
    }
  }
  if (buf.startsWith('data:')) yield buf.slice(5).trim();
}

export async function chatStream(req: LlmRequest): Promise<LlmResult> {
  const s = req.settings;
  const body: any = {
    model: s.model,
    messages: req.messages,
    stream: true,
    stream_options: { include_usage: true },
    temperature: req.temperature ?? s.temperature,
    top_p: s.topP,
    max_tokens: req.maxTokens ?? s.maxOutputTokens,
    chat_template_kwargs: { enable_thinking: req.thinking ?? s.thinking },
  };
  if (s.topK > 0) body.top_k = s.topK;
  if (s.reasoningEffort && (req.thinking ?? s.thinking)) body.reasoning_effort = s.reasoningEffort;
  if (req.tools?.length && req.mode !== 'prompt') {
    body.tools = req.tools;
    body.tool_choice = req.mode === 'native' ? 'auto' : 'none';
  }

  const t0 = performance.now();
  let res: Response | undefined;
  let lastErr: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      res = await fetch(url(s, '/chat/completions'), { method: 'POST', headers: headers(s), body: JSON.stringify(body), signal: req.signal });
      if (res.status >= 500 && attempt < 2) {
        lastErr = new LlmHttpError(res.status, await res.text());
        await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
        continue;
      }
      break;
    } catch (e) {
      if (req.signal?.aborted) throw e;
      lastErr = e;
      await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
    }
  }
  if (!res) throw lastErr instanceof Error ? lastErr : new Error(`Could not reach LLM server at ${s.baseUrl}: ${String(lastErr)}`);
  if (!res.ok || !res.body) throw new LlmHttpError(res.status, await res.text());

  const splitter = new StreamSplitter(req.mode !== 'native');
  let reasoning = '';
  let finishReason: string | null = null;
  let promptTokens = 0;
  let completionTokens = 0;
  let ttft: number | null = null;
  let firstTokenAt: number | null = null;
  const native: Record<number, { id?: string; name: string; args: string }> = {};
  let nativeAnnounced = false;

  for await (const data of sseLines(res.body)) {
    if (data === '[DONE]') break;
    let chunk: any;
    try {
      chunk = JSON.parse(data);
    } catch {
      continue;
    }
    if (chunk.error) throw new Error(`LLM stream error: ${JSON.stringify(chunk.error)}`);
    if (chunk.usage) {
      promptTokens = chunk.usage.prompt_tokens ?? promptTokens;
      completionTokens = chunk.usage.completion_tokens ?? completionTokens;
    }
    const choice = chunk.choices?.[0];
    if (!choice) continue;
    const d = choice.delta ?? {};
    const r = d.reasoning ?? d.reasoning_content;
    if (r || d.content || d.tool_calls) {
      if (ttft === null) {
        ttft = performance.now() - t0;
        firstTokenAt = performance.now();
      }
    }
    if (r) {
      reasoning += r;
      req.onReasoning?.(r);
    }
    if (d.content) {
      const out = splitter.push(d.content);
      if (out.reasoning) {
        reasoning += out.reasoning;
        req.onReasoning?.(out.reasoning);
      }
      if (out.text) req.onText?.(out.text);
      if (out.toolName) req.onToolGenerating?.(out.toolName);
    }
    if (Array.isArray(d.tool_calls)) {
      for (const tc of d.tool_calls) {
        const i = tc.index ?? 0;
        native[i] ??= { name: '', args: '' };
        if (tc.id) native[i].id = tc.id;
        if (tc.function?.name) native[i].name += tc.function.name;
        if (tc.function?.arguments) native[i].args += tc.function.arguments;
        if (!nativeAnnounced && native[i].name) {
          nativeAnnounced = true;
          req.onToolGenerating?.(native[i].name);
        }
      }
    }
    if (choice.finish_reason) finishReason = choice.finish_reason;
  }
  const tail = splitter.flush();
  if (tail) req.onText?.(tail);

  const durationMs = performance.now() - t0;
  const genMs = firstTokenAt ? performance.now() - firstTokenAt : durationMs;
  const lookup: SchemaLookup = (name) => req.tools?.find((t) => t.function.name === name)?.function.parameters;

  const toolCalls: ToolCall[] = [];
  const parseErrors: string[] = [];
  let content = splitter.body();
  for (const n of Object.values(native)) {
    let args: Record<string, unknown> = {};
    try {
      args = n.args ? JSON.parse(n.args) : {};
    } catch {
      parseErrors.push(`Invalid JSON arguments for ${n.name}: ${n.args.slice(0, 200)}`);
      continue;
    }
    toolCalls.push({ id: n.id || newId('call_'), name: n.name, arguments: args });
  }
  if (req.mode !== 'native' || toolCalls.length === 0) {
    const parsed = parseToolCalls(content, lookup);
    if (parsed.calls.length || parsed.errors.length) {
      content = parsed.text;
      parseErrors.push(...parsed.errors);
      for (const c of parsed.calls) toolCalls.push({ id: newId('call_'), name: c.name, arguments: c.arguments });
    }
  }
  if (!reasoning && splitter.inlineReasoning()) reasoning = splitter.inlineReasoning();

  return {
    content: content.trim(),
    reasoning: reasoning.trim(),
    toolCalls,
    rawContent: splitter.full,
    finishReason,
    promptTokens,
    completionTokens,
    ttftMs: ttft === null ? null : Math.round(ttft),
    durationMs: Math.round(durationMs),
    tokensPerSec: completionTokens && genMs > 0 ? Math.round((completionTokens / (genMs / 1000)) * 10) / 10 : null,
    parseErrors,
  };
}

/** Non-streaming helper for small utility calls (titles, summaries, commit messages). */
export async function chatOnce(
  settings: ModelSettings,
  messages: OAIMessage[],
  opts: { maxTokens?: number; thinking?: boolean; temperature?: number; signal?: AbortSignal } = {},
): Promise<{ content: string; promptTokens: number; completionTokens: number }> {
  const r = await chatStream({
    settings,
    messages,
    mode: 'prompt',
    maxTokens: opts.maxTokens ?? 1024,
    thinking: opts.thinking ?? false,
    temperature: opts.temperature ?? 0.3,
    signal: opts.signal,
  });
  return { content: r.content || r.rawContent, promptTokens: r.promptTokens, completionTokens: r.completionTokens };
}

// ---------- capability probing ----------
const capCache = new Map<string, Capabilities>();
const inflight = new Map<string, Promise<Capabilities>>();

/** Forget cached probe results (e.g. after the model server was restarted with new flags). */
export function invalidateCapabilities() {
  capCache.clear();
}

/**
 * Detect what the server supports: reachability + context length (/v1/models),
 * native tool calling (tool_choice=auto needs vLLM --enable-auto-tool-choice),
 * template-rendered tools (tool_choice=none) and reasoning output. Cached for 5 min.
 */
export async function probeCapabilities(s: ModelSettings, force = false): Promise<Capabilities> {
  const key = `${s.baseUrl}|${s.model}|${s.toolMode}`;
  const hit = capCache.get(key);
  if (!force && hit && Date.now() - hit.checkedAt < (hit.reachable ? 5 * 60_000 : 10_000)) return hit;
  if (!force && inflight.has(key)) return inflight.get(key)!;
  const p = doProbe(s, key).finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

async function doProbe(s: ModelSettings, key: string): Promise<Capabilities> {
  const caps: Capabilities = {
    reachable: false,
    models: [],
    nativeTools: false,
    templateTools: false,
    reasoning: false,
    effectiveToolMode: 'prompt',
    checkedAt: Date.now(),
  };
  try {
    const r = await fetch(url(s, '/models'), { headers: headers(s), signal: AbortSignal.timeout(8000) });
    if (!r.ok) throw new Error(`GET /models -> HTTP ${r.status}`);
    const j: any = await r.json();
    caps.reachable = true;
    caps.models = (j.data ?? []).map((m: any) => m.id);
    const m = (j.data ?? []).find((x: any) => x.id === s.model) ?? j.data?.[0];
    if (m?.max_model_len) caps.maxModelLen = m.max_model_len;
  } catch (e) {
    caps.error = (e as Error).message;
    capCache.set(key, caps);
    return caps;
  }
  const tool: OAITool = {
    type: 'function',
    function: { name: 'ping', description: 'Ping', parameters: { type: 'object', properties: {}, required: [] } },
  };
  const tiny = async (extra: any) => {
    const r = await fetch(url(s, '/chat/completions'), {
      method: 'POST',
      headers: headers(s),
      signal: AbortSignal.timeout(60000),
      body: JSON.stringify({
        model: s.model,
        messages: [{ role: 'user', content: 'Reply with OK.' }],
        max_tokens: 8,
        ...extra,
      }),
    });
    return { ok: r.ok, json: r.ok ? await r.json() : null, text: r.ok ? '' : await r.text() };
  };
  try {
    caps.nativeTools = (await tiny({ tools: [tool], tool_choice: 'auto', chat_template_kwargs: { enable_thinking: false } })).ok;
  } catch {}
  try {
    caps.templateTools = (await tiny({ tools: [tool], tool_choice: 'none', chat_template_kwargs: { enable_thinking: false } })).ok;
  } catch {}
  try {
    const r = await tiny({ chat_template_kwargs: { enable_thinking: true } });
    const msg = r.json?.choices?.[0]?.message;
    caps.reasoning = !!(msg?.reasoning || msg?.reasoning_content || /<think>/.test(msg?.content ?? ''));
  } catch {}
  caps.effectiveToolMode =
    s.toolMode !== 'auto' ? s.toolMode : caps.nativeTools ? 'native' : caps.templateTools ? 'template' : 'prompt';
  capCache.set(key, caps);
  return caps;
}
