// Optional OpenTelemetry export (OTLP/HTTP JSON) of finished runs, e.g. to a local
// Jaeger (`docker compose --profile observability up`). Disabled by default.
import crypto from 'node:crypto';
import { getSettings } from './config.ts';
import { runs, spans } from './db.ts';

const hex = (s: string, len: number) => crypto.createHash('sha256').update(s).digest('hex').slice(0, len);
const nanos = (ms: number) => (BigInt(Math.round(ms)) * 1_000_000n).toString();
const attr = (key: string, v: string | number | undefined | null) =>
  v === undefined || v === null ? null : typeof v === 'number' ? { key, value: Number.isInteger(v) ? { intValue: v } : { doubleValue: v } } : { key, value: { stringValue: String(v).slice(0, 4000) } };

export async function exportRunToOtel(runId: string): Promise<void> {
  const cfg = getSettings().otel;
  if (!cfg?.enabled) return;
  const run = runs.get(runId);
  if (!run) return;
  const traceId = hex(run.parentRunId ?? run.id, 32);
  const rootId = hex(run.id, 16);
  const end = run.endedAt ?? Date.now();
  const otelSpans: any[] = [
    {
      traceId,
      spanId: rootId,
      parentSpanId: run.parentRunId ? hex(run.parentRunId, 16) : undefined,
      name: run.parentRunId ? 'subagent run' : 'agent run',
      kind: 1,
      startTimeUnixNano: nanos(run.startedAt),
      endTimeUnixNano: nanos(end),
      status: { code: run.status === 'error' ? 2 : 1, message: run.error ?? undefined },
      attributes: [
        attr('hearth.run_id', run.id),
        attr('hearth.status', run.status),
        attr('gen_ai.request.model', run.model),
        attr('gen_ai.usage.input_tokens', run.promptTokens),
        attr('gen_ai.usage.output_tokens', run.completionTokens),
        attr('hearth.user_message', run.userMessage),
      ].filter(Boolean),
    },
  ];
  for (const s of spans.forRun(runId)) {
    otelSpans.push({
      traceId,
      spanId: hex(s.id, 16),
      parentSpanId: rootId,
      name: s.kind === 'llm' ? `chat ${run.model}` : s.kind === 'tool' ? `execute_tool ${s.name}` : s.name,
      kind: s.kind === 'llm' ? 3 : 1,
      startTimeUnixNano: nanos(s.startedAt),
      endTimeUnixNano: nanos(s.endedAt ?? s.startedAt),
      status: { code: s.status === 'error' ? 2 : 1, message: s.error ?? undefined },
      attributes: [
        attr('hearth.span_kind', s.kind),
        attr('gen_ai.usage.input_tokens', s.promptTokens),
        attr('gen_ai.usage.output_tokens', s.completionTokens),
        attr('hearth.ttft_ms', s.ttftMs),
        attr('hearth.tokens_per_sec', s.tokensPerSec),
        attr('hearth.input', s.input),
        attr('hearth.output', s.output),
      ].filter(Boolean),
    });
  }
  const body = {
    resourceSpans: [
      {
        resource: { attributes: [attr('service.name', 'hearth-agent')] },
        scopeSpans: [{ scope: { name: 'hearth', version: '0.1.0' }, spans: otelSpans }],
      },
    ],
  };
  const res = await fetch(cfg.endpoint, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(10_000) });
  if (!res.ok) console.warn(`[otel] export failed: HTTP ${res.status}`);
}
