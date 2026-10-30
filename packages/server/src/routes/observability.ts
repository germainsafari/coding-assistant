import fs from 'node:fs';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import type { Metrics } from '@hearth/shared';
import { db, runs, spans } from '../db.ts';
import { evalProgress, listReports, listTasks, RESULTS_DIR, runEvals } from '../evals/runner.ts';

export function computeMetrics(sinceMs: number): Metrics {
  const runRows: any[] = db.prepare('SELECT status, count(*) c FROM runs WHERE started_at>=? AND parent_run_id IS NULL GROUP BY status').all(sinceMs);
  const llm: any = db
    .prepare(
      `SELECT count(*) c, avg(tokens_per_sec) tps, avg(ttft_ms) ttft, avg(duration_ms) lat, sum(prompt_tokens) pt, sum(completion_tokens) ct
       FROM spans WHERE kind='llm' AND started_at>=? AND status='ok'`,
    )
    .get(sinceMs);
  const tools: any[] = db
    .prepare(
      `SELECT name, count(*) calls, sum(CASE WHEN status='error' THEN 1 ELSE 0 END) errors, avg(duration_ms) avgMs
       FROM spans WHERE kind='tool' AND name NOT LIKE 'approval:%' AND started_at>=? GROUP BY name ORDER BY calls DESC`,
    )
    .all(sinceMs);
  const recent: any[] = db
    .prepare(
      `SELECT started_at, tokens_per_sec, duration_ms, prompt_tokens, completion_tokens FROM spans
       WHERE kind='llm' AND status='ok' AND started_at>=? ORDER BY started_at DESC LIMIT 60`,
    )
    .all(sinceMs);
  const toolCalls = tools.reduce((a, t) => a + t.calls, 0);
  const toolErrors = tools.reduce((a, t) => a + t.errors, 0);
  const byStatus: Record<string, number> = {};
  for (const r of runRows) byStatus[r.status] = r.c;
  return {
    runs: runRows.reduce((a, r) => a + r.c, 0),
    runsByStatus: byStatus,
    llmCalls: llm?.c ?? 0,
    avgTokensPerSec: Math.round((llm?.tps ?? 0) * 10) / 10,
    avgTtftMs: Math.round(llm?.ttft ?? 0),
    avgLlmLatencyMs: Math.round(llm?.lat ?? 0),
    totalPromptTokens: llm?.pt ?? 0,
    totalCompletionTokens: llm?.ct ?? 0,
    toolCalls,
    toolSuccessRate: toolCalls ? Math.round(((toolCalls - toolErrors) / toolCalls) * 1000) / 10 : 0,
    tools: tools.map((t) => ({ name: t.name, calls: t.calls, errors: t.errors, avgMs: Math.round(t.avgMs ?? 0) })),
    recentLlm: recent.reverse().map((r) => ({
      startedAt: r.started_at,
      tokensPerSec: r.tokens_per_sec ?? 0,
      durationMs: r.duration_ms ?? 0,
      promptTokens: r.prompt_tokens ?? 0,
      completionTokens: r.completion_tokens ?? 0,
    })),
  };
}

export function observabilityRoutes(app: FastifyInstance) {
  app.get('/api/runs', async (req) => {
    const q = req.query as any;
    return runs.list({ limit: Number(q.limit) || 100, projectId: q.projectId || undefined });
  });
  app.get('/api/runs/:id/trace', async (req, reply) => {
    const run = runs.get((req.params as any).id);
    if (!run) return reply.code(404).send({ error: 'not found' });
    const children = runs.children(run.id).map((c) => ({ run: c, spans: spans.forRun(c.id) }));
    return { run, spans: spans.forRun(run.id), children };
  });
  app.get('/api/metrics', async (req) => {
    const hours = Number((req.query as any).hours) || 24 * 7;
    return computeMetrics(Date.now() - hours * 3600_000);
  });

  // ---------- evals ----------
  app.get('/api/evals/tasks', async () => listTasks());
  app.get('/api/evals/reports', async () => listReports());
  app.get('/api/evals/reports/:id/markdown', async (req, reply) => {
    const f = path.join(RESULTS_DIR, `${path.basename((req.params as any).id)}.md`);
    if (!fs.existsSync(f)) return reply.code(404).send({ error: 'not found' });
    return reply.type('text/markdown').send(fs.readFileSync(f, 'utf8'));
  });
  app.get('/api/evals/status', async () => evalProgress);
  app.post('/api/evals/run', async (req, reply) => {
    if (evalProgress.running) return reply.code(409).send({ error: 'Eval already running' });
    const b = (req.body ?? {}) as { taskIds?: string[]; profileId?: string };
    runEvals({ taskIds: b.taskIds, profileId: b.profileId, log: (s) => console.log('[eval]', s) }).catch((e) => console.error('[eval] failed', e));
    await new Promise((r) => setTimeout(r, 300));
    return evalProgress;
  });
}
