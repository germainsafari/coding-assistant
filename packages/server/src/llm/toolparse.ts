// Text-mode tool-call parsing. Used when the server does not return native
// OpenAI `tool_calls` (e.g. vLLM started without --enable-auto-tool-choice).
// Supports:
//   1. Qwen3-Coder / Qwen3.5+ XML style:
//        <tool_call><function=NAME><parameter=KEY>VALUE</parameter></function></tool_call>
//   2. Hermes / Qwen2.5 JSON style:
//        <tool_call>{"name": "NAME", "arguments": {...}}</tool_call>
//   3. Either of the above with a missing closing tag (generation stopped early).

export interface ParsedCall {
  name: string;
  arguments: Record<string, unknown>;
}

export interface ParseResult {
  text: string;
  calls: ParsedCall[];
  errors: string[];
}

export type SchemaLookup = (toolName: string) => Record<string, any> | undefined;

const START_MARKERS = ['<tool_call>', '<function='];

/** Index where the first tool call starts in `s`, or -1. */
export function toolCallStart(s: string, from = 0): number {
  let best = -1;
  for (const m of START_MARKERS) {
    const i = s.indexOf(m, from);
    if (i !== -1 && (best === -1 || i < best)) best = i;
  }
  return best;
}

/** Length of a suffix of `s` that could be the beginning of one of `markers`. */
export function partialMarkerSuffix(s: string, markers: string[]): number {
  let hold = 0;
  for (const m of markers) {
    for (let k = Math.min(m.length - 1, s.length); k > 0; k--) {
      if (s.endsWith(m.slice(0, k))) {
        hold = Math.max(hold, k);
        break;
      }
    }
  }
  return hold;
}

function coerce(value: string, schema: any): unknown {
  const type = schema?.type;
  const t = Array.isArray(type) ? type.find((x: string) => x !== 'null') : type;
  const trimmed = value.trim();
  if (t === 'string' || (!t && !/^[[{]/.test(trimmed))) return value;
  if (t === 'integer' || t === 'number') {
    const n = Number(trimmed);
    return Number.isFinite(n) ? n : value;
  }
  if (t === 'boolean') {
    if (/^(true|yes|1)$/i.test(trimmed)) return true;
    if (/^(false|no|0)$/i.test(trimmed)) return false;
    return value;
  }
  try {
    return JSON.parse(trimmed);
  } catch {
    return value;
  }
}

function stripOneNewline(v: string): string {
  let s = v;
  if (s.startsWith('\r\n')) s = s.slice(2);
  else if (s.startsWith('\n')) s = s.slice(1);
  if (s.endsWith('\r\n')) s = s.slice(0, -2);
  else if (s.endsWith('\n')) s = s.slice(0, -1);
  return s;
}

function parseXmlFunction(block: string, lookup?: SchemaLookup): ParsedCall | null {
  const fm = block.match(/<function=\s*([^>\s]+)\s*>/);
  if (!fm) return null;
  const name = fm[1].trim();
  const props = lookup?.(name)?.properties ?? {};
  let body = block.slice((fm.index ?? 0) + fm[0].length);
  const endFn = body.lastIndexOf('</function>');
  if (endFn !== -1) body = body.slice(0, endFn);
  const args: Record<string, unknown> = {};
  const re = /<parameter=\s*([^>]+?)\s*>/g;
  const starts: { key: string; idx: number; end: number }[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(body))) starts.push({ key: m[1], idx: m.index, end: m.index + m[0].length });
  for (let i = 0; i < starts.length; i++) {
    const s = starts[i];
    const limit = i + 1 < starts.length ? starts[i + 1].idx : body.length;
    let raw = body.slice(s.end, limit);
    const close = raw.lastIndexOf('</parameter>');
    if (close !== -1) raw = raw.slice(0, close);
    args[s.key] = coerce(stripOneNewline(raw), props[s.key]);
  }
  return { name, arguments: args };
}

function looseJsonParse(s: string): any {
  const t = s.trim();
  try {
    return JSON.parse(t);
  } catch {
    // try trimming to the last closing brace
    const last = t.lastIndexOf('}');
    if (last > 0) return JSON.parse(t.slice(0, last + 1));
    throw new Error('invalid JSON');
  }
}

function parseJsonCall(block: string): ParsedCall | null {
  const obj = looseJsonParse(block);
  if (!obj || typeof obj !== 'object') return null;
  const name = obj.name ?? obj.function?.name ?? obj.tool;
  let args = obj.arguments ?? obj.parameters ?? obj.function?.arguments ?? obj.args ?? {};
  if (typeof args === 'string') {
    try {
      args = JSON.parse(args);
    } catch {
      args = { input: args };
    }
  }
  if (typeof name !== 'string') return null;
  return { name, arguments: args };
}

/** Parse all tool calls in a complete assistant message. */
export function parseToolCalls(content: string, lookup?: SchemaLookup): ParseResult {
  const errors: string[] = [];
  const calls: ParsedCall[] = [];
  const first = toolCallStart(content);
  if (first === -1) return { text: content, calls, errors };
  const text = content.slice(0, first).trimEnd();
  const rest = content.slice(first);

  // Split into blocks on <tool_call> or bare <function= (when not wrapped).
  const blocks: string[] = [];
  if (rest.includes('<tool_call>')) {
    const parts = rest.split('<tool_call>').slice(1);
    for (const p of parts) {
      const end = p.indexOf('</tool_call>');
      blocks.push(end === -1 ? p : p.slice(0, end));
    }
  } else {
    const parts = rest.split(/(?=<function=)/);
    for (const p of parts) if (p.startsWith('<function=')) blocks.push(p);
  }

  for (const raw of blocks) {
    const b = raw.trim();
    if (!b) continue;
    try {
      let call: ParsedCall | null = null;
      if (b.includes('<function=')) call = parseXmlFunction(b, lookup);
      else if (b.startsWith('{')) call = parseJsonCall(b);
      if (call) calls.push(call);
      else errors.push(`Could not parse tool call: ${b.slice(0, 200)}`);
    } catch (e) {
      errors.push(`Could not parse tool call (${(e as Error).message}): ${b.slice(0, 200)}`);
    }
  }
  return { text, calls, errors };
}

/**
 * Incrementally separates streamed assistant content into visible text,
 * inline <think> reasoning (for servers without a reasoning parser) and
 * tool-call markup (hidden from the user, parsed at the end).
 */
export class StreamSplitter {
  full = '';
  private textEmitted = 0;
  private reasoningEmitted = 0;
  private thinkState: 'unknown' | 'in' | 'done' | 'none' = 'unknown';
  private thinkStart = 0;
  private bodyStart = 0;
  toolStarted = false;
  private toolNameAnnounced = false;

  constructor(private parseText: boolean) {}

  push(chunk: string): { text: string; reasoning: string; toolName?: string } {
    this.full += chunk;
    let text = '';
    let reasoning = '';
    let toolName: string | undefined;

    if (this.thinkState === 'unknown') {
      const lead = this.full.trimStart();
      if (lead.startsWith('<think>')) {
        this.thinkState = 'in';
        this.thinkStart = this.full.indexOf('<think>') + '<think>'.length;
        this.reasoningEmitted = this.thinkStart;
      } else if (lead.length >= 7 || (lead.length > 0 && !'<think>'.startsWith(lead))) {
        this.thinkState = 'none';
      } else {
        return { text, reasoning };
      }
    }
    if (this.thinkState === 'in') {
      const end = this.full.indexOf('</think>', this.thinkStart);
      if (end === -1) {
        const hold = partialMarkerSuffix(this.full, ['</think>']);
        const upto = this.full.length - hold;
        if (upto > this.reasoningEmitted) {
          reasoning = this.full.slice(this.reasoningEmitted, upto);
          this.reasoningEmitted = upto;
        }
        return { text, reasoning };
      }
      if (end > this.reasoningEmitted) reasoning = this.full.slice(this.reasoningEmitted, end);
      this.reasoningEmitted = end;
      this.thinkState = 'done';
      this.bodyStart = end + '</think>'.length;
      this.textEmitted = this.bodyStart;
    }

    if (this.toolStarted) {
      if (!this.toolNameAnnounced) {
        const m = this.full.slice(this.bodyStart).match(/<function=\s*([^>\s]+)\s*>|"name"\s*:\s*"([^"]+)"/);
        if (m) {
          toolName = m[1] ?? m[2];
          this.toolNameAnnounced = true;
        }
      }
      return { text, reasoning, toolName };
    }
    const visibleEnd = (() => {
      if (!this.parseText) return this.full.length;
      const idx = toolCallStart(this.full, this.bodyStart);
      if (idx !== -1) {
        this.toolStarted = true;
        return idx;
      }
      return this.full.length - partialMarkerSuffix(this.full, START_MARKERS);
    })();
    if (visibleEnd > this.textEmitted) {
      text = this.full.slice(this.textEmitted, visibleEnd);
      this.textEmitted = visibleEnd;
    }
    if (this.toolStarted) {
      const r = this.push('');
      toolName = r.toolName;
    }
    return { text, reasoning, toolName };
  }

  /** Content after the (optional) think block. */
  body(): string {
    return this.thinkState === 'done' ? this.full.slice(this.bodyStart) : this.thinkState === 'in' ? '' : this.full;
  }
  inlineReasoning(): string {
    if (this.thinkState === 'done') return this.full.slice(this.thinkStart, this.bodyStart - '</think>'.length);
    if (this.thinkState === 'in') return this.full.slice(this.thinkStart);
    return '';
  }
  /** Flush any held-back text at end of stream. */
  flush(): string {
    if (this.toolStarted || this.thinkState === 'in') return '';
    const out = this.full.slice(this.textEmitted);
    this.textEmitted = this.full.length;
    return out;
  }
}
