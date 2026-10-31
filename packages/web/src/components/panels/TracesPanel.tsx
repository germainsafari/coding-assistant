import { useCallback, useEffect, useMemo, useState } from 'react';
import { Activity, ArrowLeft, CircleCheck, CircleX, FlaskConical, Gauge, ListTree, Play, RefreshCw, RotateCcw } from 'lucide-react';
import type { EvalReport, Metrics, RunRecord, SpanRecord } from '@hearth/shared';
import { api, type Trace } from '../../api';
import { errText, useStore } from '../../store';
import { Markdown } from '../Markdown';
import { Badge, Button, cx, Empty, fmtMs, fmtNum, fmtTime, IconButton, Skeleton, Spinner, Tabs, type Tone } from '../ui';

const statusTone = (s: string): Tone =>
  s === 'completed' || s === 'ok' ? 'ok' : s === 'running' ? 'accent' : s === 'cancelled' || s === 'denied' ? 'neutral' : s === 'max_steps' || s === 'budget_exhausted' || s === 'interrupted' ? 'warn' : 'danger';
const statusLabel = (s: string) => s.replace(/_/g, ' ');

export function TracesPanel() {
  const [tab, setTab] = useState<'runs' | 'metrics' | 'evals'>('runs');
  return (
    <div className="flex h-full flex-col">
      <div className="flex h-9 shrink-0 items-center border-b border-line px-2">
        <Tabs
          value={tab}
          onChange={setTab}
          label="Observability views"
          tabs={[
            { id: 'runs', label: <><ListTree className="h-3.5 w-3.5" /> Runs</> },
            { id: 'metrics', label: <><Gauge className="h-3.5 w-3.5" /> Metrics</> },
            { id: 'evals', label: <><FlaskConical className="h-3.5 w-3.5" /> Evals</> },
          ]}
        />
      </div>
      <div className="min-h-0 flex-1">{tab === 'runs' ? <Runs /> : tab === 'metrics' ? <MetricsView /> : <Evals />}</div>
    </div>
  );
}

function ListSkeleton() {
  return (
    <div className="space-y-3 p-3">
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="space-y-1.5">
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-3 w-1/2" />
        </div>
      ))}
    </div>
  );
}

function Runs() {
  const projectId = useStore((s) => s.projectId);
  const [all, setAll] = useState(false);
  const [runs, setRuns] = useState<RunRecord[] | null>(null);
  const [sel, setSel] = useState<string | null>(null);
  const load = useCallback(() => api.runs(all ? undefined : (projectId ?? undefined)).then(setRuns, () => setRuns([])), [all, projectId]);
  useEffect(() => {
    void load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, [load]);
  if (sel) return <TraceView runId={sel} onBack={() => setSel(null)} />;
  return (
    <div className="flex h-full flex-col">
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-line px-3 text-xs text-fg-subtle">
        <label className="flex cursor-pointer items-center gap-1.5 select-none">
          <input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} /> All projects (incl. evals)
        </label>
        <div className="flex-1" />
        <IconButton label="Refresh" size="sm" onClick={load}>
          <RefreshCw className="h-3.5 w-3.5" />
        </IconButton>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {runs === null && <ListSkeleton />}
        {runs?.length === 0 && (
          <Empty icon={<Activity />} title="No runs yet">
            Every agent run is recorded here with each model call and tool call, their timings and tokens.
          </Empty>
        )}
        {runs?.map((r) => (
          <button key={r.id} type="button" data-run-row onClick={() => setSel(r.id)} className="block w-full border-b border-line px-3.5 py-2.5 text-left transition-colors hover:bg-raised/60">
            <div className="flex items-center gap-2">
              <Badge tone={statusTone(r.status)} dot>
                {statusLabel(r.status)}
              </Badge>
              {r.options?.longRun?.enabled && <Badge tone="accent">long-run</Badge>}
              {r.source !== 'ui' && <Badge>{r.source}</Badge>}
              <span className="min-w-0 flex-1 truncate text-[13px] text-fg">{r.userMessage.replace(/^\[harness\]\s*/, '↻ ')}</span>
            </div>
            <div className="mt-1 flex flex-wrap gap-x-2.5 text-[11px] text-fg-subtle tabular-nums">
              <span>{fmtTime(r.startedAt)}</span>
              <span>{fmtMs((r.endedAt ?? Date.now()) - r.startedAt)}</span>
              <span>{r.steps} steps</span>
              <span>
                {fmtNum(r.promptTokens)} in · {fmtNum(r.completionTokens)} out
              </span>
              <span className="truncate font-mono">{r.model}</span>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

const kindColor: Record<string, string> = { llm: 'bg-info', tool: 'bg-ok', compaction: 'bg-violet', subagent: 'bg-accent' };
const kindLabel: Record<string, string> = { llm: 'Model call', tool: 'Tool call', compaction: 'Compaction', subagent: 'Subagent' };

function TraceView({ runId, onBack }: { runId: string; onBack: () => void }) {
  const [t, setT] = useState<Trace | null>(null);
  const [span, setSpan] = useState<SpanRecord | null>(null);
  useEffect(() => {
    let stop = false;
    const load = () =>
      api.trace(runId).then(
        (x) => !stop && setT(x),
        () => {},
      );
    void load();
    const i = setInterval(() => t?.run.status === 'running' && load(), 3000);
    return () => {
      stop = true;
      clearInterval(i);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runId, t?.run.status]);
  if (!t) return <ListSkeleton />;
  const start = t.run.startedAt;
  const end = Math.max(t.run.endedAt ?? Date.now(), ...t.spans.map((s) => s.endedAt ?? s.startedAt));
  const total = Math.max(1, end - start);
  const llm = t.spans.filter((s) => s.kind === 'llm');
  const tools = t.spans.filter((s) => s.kind === 'tool');
  const failed = tools.filter((s) => s.status === 'error').length;
  const rows = [...t.spans, ...t.children.flatMap((c) => c.spans.map((s) => ({ ...s, name: `↳ ${s.name}` })))].sort((a, b) => a.startedAt - b.startedAt);
  const kinds = [...new Set(rows.map((r) => r.kind))];
  return (
    <div className="flex h-full flex-col">
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-line px-2">
        <IconButton label="Back to runs" onClick={onBack}>
          <ArrowLeft className="h-4 w-4" />
        </IconButton>
        <Badge tone={statusTone(t.run.status)} dot>
          {statusLabel(t.run.status)}
        </Badge>
        <span className="min-w-0 flex-1 truncate text-[13px] text-fg" title={t.run.userMessage}>
          {t.run.userMessage.replace(/^\[harness\]\s*/, '↻ ')}
        </span>
      </div>
      <div className="grid shrink-0 grid-cols-4 gap-2 border-b border-line p-3">
        <Stat label="Duration" value={fmtMs(total)} sub={`${t.run.steps} steps`} />
        <Stat label="Model calls" value={`${llm.length}`} sub={`avg ${fmtMs(avg(llm.map((s) => s.durationMs ?? 0)))}`} />
        <Stat label="Tool calls" value={`${tools.length}`} sub={failed ? `${failed} failed` : 'all ok'} subTone={failed ? 'danger' : undefined} />
        <Stat label="Tokens" value={fmtNum(t.run.promptTokens + t.run.completionTokens)} sub={`${fmtNum(Math.round(avg(llm.map((s) => s.tokensPerSec ?? 0))))} tok/s`} />
      </div>
      {t.run.error && <div className="shrink-0 border-b border-line bg-danger/[0.07] px-3 py-2 text-xs text-danger-ink">{t.run.error}</div>}
      <div className="flex shrink-0 items-center gap-3 px-3 pt-2 pb-1 text-[11px] text-fg-subtle">
        <span className="font-medium tracking-wide uppercase">Timeline</span>
        {kinds.map((k) => (
          <span key={k} className="flex items-center gap-1">
            <span className={cx('h-2 w-2 rounded-sm', kindColor[k] ?? 'bg-fg-faint')} /> {kindLabel[k] ?? k}
          </span>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-auto px-1.5 pb-2">
        {rows.map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => setSpan(span?.id === s.id ? null : s)}
            aria-pressed={span?.id === s.id}
            className={cx('flex h-6 w-full items-center gap-2 rounded-md px-1.5 text-left text-[11.5px] transition-colors hover:bg-raised/70', span?.id === s.id && 'bg-raised')}
          >
            <span className={cx('w-36 shrink-0 truncate font-mono', s.status === 'error' ? 'text-danger-ink' : 'text-fg-muted')} title={s.name}>
              {s.name}
            </span>
            <span className="relative h-2.5 flex-1 rounded-full bg-raised">
              <span
                className={cx('absolute top-0 h-2.5 rounded-full', s.status === 'error' ? 'bg-danger' : (kindColor[s.kind] ?? 'bg-fg-faint'))}
                style={{ left: `${((s.startedAt - start) / total) * 100}%`, width: `max(3px, ${(((s.endedAt ?? Date.now()) - s.startedAt) / total) * 100}%)` }}
              />
            </span>
            <span className="w-14 shrink-0 text-right text-fg-subtle tabular-nums">{fmtMs(s.durationMs)}</span>
          </button>
        ))}
      </div>
      {span && (
        <div className="max-h-[45%] shrink-0 animate-slide-up overflow-auto border-t border-line bg-surface p-3 text-[11.5px]">
          <div className="mb-2 flex flex-wrap items-center gap-2 text-fg-subtle">
            <Badge tone={statusTone(span.status)} dot>
              {span.status}
            </Badge>
            <span className="font-mono text-fg">{span.name}</span>
            <span>{kindLabel[span.kind] ?? span.kind}</span>
            <span>{fmtMs(span.durationMs)}</span>
            {span.promptTokens != null && (
              <span>
                {fmtNum(span.promptTokens)} prompt · {fmtNum(span.completionTokens)} completion tokens
              </span>
            )}
            {span.ttftMs != null && <span>TTFT {fmtMs(span.ttftMs)}</span>}
            {span.tokensPerSec != null && <span>{span.tokensPerSec} tok/s</span>}
          </div>
          {span.error && <pre className="mb-2 whitespace-pre-wrap text-danger-ink">{span.error}</pre>}
          <div className="grid gap-2 xl:grid-cols-2">
            <div>
              <div className="mb-1 font-medium tracking-wide text-fg-subtle uppercase">Input</div>
              <pre className="max-h-48 overflow-auto rounded-lg border border-line bg-code p-2.5 whitespace-pre-wrap text-fg-muted">{pretty(span.input)}</pre>
            </div>
            <div>
              <div className="mb-1 font-medium tracking-wide text-fg-subtle uppercase">Output</div>
              <pre className="max-h-48 overflow-auto rounded-lg border border-line bg-code p-2.5 whitespace-pre-wrap text-fg-muted">{pretty(span.output)}</pre>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
function pretty(s?: string | null) {
  if (!s) return '';
  try {
    return JSON.stringify(JSON.parse(s), null, 2);
  } catch {
    return s;
  }
}

function Stat({ label, value, sub, subTone }: { label: string; value: string; sub?: string; subTone?: 'danger' }) {
  return (
    <div className="min-w-0 rounded-xl border border-line bg-surface px-3 py-2 shadow-card">
      <div className="truncate text-[10.5px] font-medium tracking-wide text-fg-subtle uppercase">{label}</div>
      <div className="mt-0.5 truncate text-[17px] font-semibold tracking-tight text-fg tabular-nums">{value}</div>
      {sub && <div className={cx('truncate text-[11px]', subTone === 'danger' ? 'text-danger-ink' : 'text-fg-subtle')}>{sub}</div>}
    </div>
  );
}

function MetricsView() {
  const [hours, setHours] = useState(168);
  const [m, setM] = useState<Metrics | null>(null);
  useEffect(() => {
    void api.metrics(hours).then(setM, () => {});
  }, [hours]);
  if (!m) return <ListSkeleton />;
  const maxTps = Math.max(1, ...m.recentLlm.map((r) => r.tokensPerSec));
  const maxCalls = Math.max(1, ...m.tools.map((t) => t.calls));
  return (
    <div className="h-full space-y-4 overflow-auto p-3">
      <div className="flex items-center justify-between text-xs text-fg-subtle">
        <span className="font-medium tracking-wide uppercase">Overview</span>
        <select className="h-7 py-0 text-xs" aria-label="Time window" value={hours} onChange={(e) => setHours(Number(e.target.value))}>
          <option value={24}>Last 24 hours</option>
          <option value={168}>Last 7 days</option>
          <option value={720}>Last 30 days</option>
          <option value={24 * 3650}>All time</option>
        </select>
      </div>
      <div className="grid grid-cols-3 gap-2">
        <Stat label="Runs" value={`${m.runs}`} sub={Object.entries(m.runsByStatus).map(([k, v]) => `${v} ${statusLabel(k)}`).join(' · ')} />
        <Stat label="Avg speed" value={`${m.avgTokensPerSec}`} sub={`tok/s · ${m.llmCalls} model calls`} />
        <Stat label="Avg TTFT" value={fmtMs(m.avgTtftMs)} sub={`latency ${fmtMs(m.avgLlmLatencyMs)}`} />
        <Stat label="Tool success" value={`${m.toolSuccessRate}%`} sub={`${m.toolCalls} tool calls`} />
        <Stat label="Prompt tokens" value={fmtNum(m.totalPromptTokens)} />
        <Stat label="Output tokens" value={fmtNum(m.totalCompletionTokens)} />
      </div>
      <div className="rounded-xl border border-line bg-surface p-3 shadow-card">
        <div className="mb-2 flex items-baseline justify-between">
          <span className="text-xs font-medium text-fg">Generation speed</span>
          <span className="text-[11px] text-fg-subtle">recent model calls · peak {Math.round(maxTps)} tok/s</span>
        </div>
        <div className="flex h-28 items-end gap-[2px]">
          {m.recentLlm.map((r, i) => (
            <div
              key={i}
              title={`${r.tokensPerSec} tok/s · ${fmtMs(r.durationMs)} · ${r.promptTokens} prompt tokens`}
              className="min-w-[2px] flex-1 rounded-t-[3px] bg-accent/70 transition-colors hover:bg-accent"
              style={{ height: `${Math.max(2, (r.tokensPerSec / maxTps) * 100)}%` }}
            />
          ))}
          {!m.recentLlm.length && <div className="m-auto text-xs text-fg-subtle">No data yet</div>}
        </div>
      </div>
      <div className="overflow-hidden rounded-xl border border-line bg-surface shadow-card">
        <table className="w-full text-xs">
          <thead className="bg-raised/60 text-fg-subtle">
            <tr className="text-left">
              <th className="px-3 py-2 font-medium">Tool</th>
              <th className="w-[38%] px-3 py-2 font-medium">Calls</th>
              <th className="px-3 py-2 text-right font-medium">Errors</th>
              <th className="px-3 py-2 text-right font-medium">Avg time</th>
            </tr>
          </thead>
          <tbody>
            {m.tools.map((t) => (
              <tr key={t.name} className="border-t border-line text-fg-muted">
                <td className="px-3 py-1.5 font-mono text-fg">{t.name}</td>
                <td className="px-3 py-1.5">
                  <span className="flex items-center gap-2 tabular-nums">
                    <span className="h-1.5 rounded-full bg-ok/70" style={{ width: `${Math.max(4, (t.calls / maxCalls) * 70)}%` }} />
                    {t.calls}
                  </span>
                </td>
                <td className={cx('px-3 py-1.5 text-right tabular-nums', t.errors ? 'text-danger-ink' : 'text-fg-faint')}>{t.errors}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{fmtMs(t.avgMs)}</td>
              </tr>
            ))}
            {!m.tools.length && (
              <tr>
                <td colSpan={4} className="px-3 py-4 text-center text-fg-subtle">
                  No tool calls in this window.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Evals() {
  const settings = useStore((s) => s.settings);
  const notify = useStore((s) => s.notify);
  const [tasks, setTasks] = useState<Awaited<ReturnType<typeof api.evalTasks>>>([]);
  const [reports, setReports] = useState<EvalReport[]>([]);
  const [status, setStatus] = useState<Awaited<ReturnType<typeof api.evalStatus>> | null>(null);
  const [profileId, setProfileId] = useState('');
  const [md, setMd] = useState<string | null>(null);
  const load = useCallback(async () => {
    const [r, s] = await Promise.all([api.evalReports().catch(() => []), api.evalStatus().catch(() => null)]);
    setReports(r);
    setStatus(s);
  }, []);
  useEffect(() => {
    void api.evalTasks().then(setTasks, () => {});
    void load();
  }, [load]);
  useEffect(() => {
    if (!status?.running) return;
    const t = setInterval(load, 3000);
    return () => clearInterval(t);
  }, [status?.running, load]);
  const latest = useMemo(() => reports[0], [reports]);

  if (md !== null)
    return (
      <div className="flex h-full flex-col">
        <div className="flex h-10 shrink-0 items-center border-b border-line px-2">
          <IconButton label="Back to evals" onClick={() => setMd(null)}>
            <ArrowLeft className="h-4 w-4" />
          </IconButton>
          <span className="ml-1 text-[13px] font-medium text-fg">Eval report</span>
        </div>
        <div className="min-h-0 flex-1 overflow-auto p-4">
          <Markdown text={md} className="text-[13px]" />
        </div>
      </div>
    );

  return (
    <div className="h-full space-y-4 overflow-auto p-3 text-xs">
      <div className="rounded-xl border border-line bg-surface p-3 shadow-card">
        <p className="leading-relaxed text-fg-muted">
          {tasks.length} small coding tasks in fixture repos, graded by hidden tests. Runs headless in full-auto against a model profile. CLI: <code className="rounded border border-line bg-raised px-1 font-mono text-fg">npm run eval -- --profile &lt;id&gt;</code>
        </p>
        <div className="mt-3 flex items-center gap-2">
          <select className="h-7 py-0 text-xs" aria-label="Model profile" value={profileId} onChange={(e) => setProfileId(e.target.value)}>
            <option value="">Active profile</option>
            {settings?.profiles.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <Button
            size="sm"
            variant="primary"
            disabled={status?.running}
            onClick={async () => {
              try {
                await api.runEvals({ profileId: profileId || undefined });
                await load();
              } catch (e) {
                notify(errText(e), 'error');
              }
            }}
          >
            <Play className="h-3.5 w-3.5" /> Run all evals
          </Button>
          {status?.running && (
            <span className="flex items-center gap-1.5 text-fg-subtle">
              <Spinner className="h-3.5 w-3.5" /> {status.done}/{status.total} · {status.current}
            </span>
          )}
        </div>
        {status?.running && status.results.length > 0 && (
          <div className="mt-2 space-y-1">
            {status.results.map((r) => (
              <div key={r.id} className="flex items-center gap-1.5 font-mono">
                {r.passed ? <CircleCheck className="h-3.5 w-3.5 text-ok" /> : <CircleX className="h-3.5 w-3.5 text-danger" />} {r.id} · {fmtMs(r.durationMs)}
              </div>
            ))}
          </div>
        )}
      </div>
      <div>
        <div className="mb-1.5 font-medium tracking-wide text-fg-subtle uppercase">Reports</div>
        {!reports.length && <div className="text-fg-subtle">No reports yet.</div>}
        <div className="space-y-1.5">
          {reports.map((r) => (
            <button key={r.id} type="button" onClick={async () => setMd(await api.evalMarkdown(r.id))} className="flex w-full items-center gap-2.5 rounded-xl border border-line bg-surface px-3 py-2 text-left shadow-card transition-colors hover:border-line-strong">
              <Badge tone={r.passed === r.total ? 'ok' : r.passed >= r.total / 2 ? 'warn' : 'danger'}>
                {r.passed}/{r.total} passed
              </Badge>
              <span className="min-w-0 flex-1 truncate text-fg">
                {r.profile ?? r.model} <span className="text-fg-subtle">· {r.toolMode} tools</span>
              </span>
              <span className="text-fg-subtle">{fmtTime(r.startedAt)}</span>
            </button>
          ))}
        </div>
      </div>
      <div>
        <div className="mb-1.5 flex items-center justify-between font-medium tracking-wide text-fg-subtle uppercase">
          Tasks {latest && <span className="normal-case tracking-normal">latest report</span>}
        </div>
        <div className="overflow-hidden rounded-xl border border-line bg-surface shadow-card">
          {tasks.map((t, i) => {
            const res = latest?.results.find((x) => x.id === t.id);
            return (
              <div key={t.id} className={cx('flex items-center gap-2.5 px-3 py-2', i > 0 && 'border-t border-line')} title={t.prompt}>
                {res ? res.passed ? <CircleCheck className="h-3.5 w-3.5 shrink-0 text-ok" /> : <CircleX className="h-3.5 w-3.5 shrink-0 text-danger" /> : <RotateCcw className="h-3.5 w-3.5 shrink-0 text-fg-faint" />}
                <span className="shrink-0 font-mono text-fg">{t.id}</span>
                <span className="min-w-0 flex-1 truncate text-fg-subtle">{t.title}</span>
                {res && <span className="shrink-0 text-fg-subtle tabular-nums">{fmtMs(res.durationMs)}</span>}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
