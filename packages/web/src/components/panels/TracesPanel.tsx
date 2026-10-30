import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowLeft, FlaskConical, Gauge, ListTree, Play, RefreshCw } from 'lucide-react';
import type { EvalReport, Metrics, RunRecord, SpanRecord } from '@hearth/shared';
import { api, type Trace } from '../../api';
import { errText, useStore } from '../../store';
import { Markdown } from '../Markdown';
import { Badge, Button, fmtMs, fmtNum, fmtTime, IconButton, Spinner, Tabs } from '../ui';

const statusTone = (s: string) => (s === 'completed' || s === 'ok' ? 'green' : s === 'running' ? 'orange' : s === 'cancelled' || s === 'denied' ? 'zinc' : s === 'max_steps' || s === 'budget_exhausted' || s === 'interrupted' ? 'amber' : 'red') as 'green' | 'orange' | 'zinc' | 'amber' | 'red';

export function TracesPanel() {
  const [tab, setTab] = useState<'runs' | 'metrics' | 'evals'>('runs');
  return (
    <div className="flex h-full flex-col">
      <div className="shrink-0 border-b border-zinc-800 px-2 py-1.5">
        <Tabs
          value={tab}
          onChange={setTab}
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

function Runs() {
  const { projectId } = useStore();
  const [all, setAll] = useState(false);
  const [runs, setRuns] = useState<RunRecord[] | null>(null);
  const [sel, setSel] = useState<string | null>(null);
  const load = useCallback(() => api.runs(all ? undefined : projectId ?? undefined).then(setRuns, () => setRuns([])), [all, projectId]);
  useEffect(() => {
    void load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, [load]);
  if (sel) return <TraceView runId={sel} onBack={() => setSel(null)} />;
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 px-3 py-1.5 text-xs text-zinc-400">
        <label className="flex items-center gap-1.5">
          <input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} /> all projects (incl. evals)
        </label>
        <div className="flex-1" />
        <IconButton title="Refresh" onClick={load}>
          <RefreshCw className="h-3.5 w-3.5" />
        </IconButton>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {runs === null && <div className="p-4"><Spinner /></div>}
        {runs?.length === 0 && <div className="p-4 text-xs text-zinc-500">No runs yet. Every agent run is recorded here with its LLM and tool calls.</div>}
        {runs?.map((r) => (
          <button key={r.id} onClick={() => setSel(r.id)} className="block w-full border-b border-zinc-900 px-3 py-2 text-left hover:bg-zinc-900">
            <div className="flex items-center gap-2">
              <Badge tone={statusTone(r.status)}>{r.status}</Badge>
              {r.options?.longRun?.enabled && <Badge tone="orange">long-run</Badge>}
              {r.source !== 'ui' && <Badge>{r.source}</Badge>}
              <span className="min-w-0 flex-1 truncate text-[13px] text-zinc-200">{r.userMessage.replace(/^\[harness\]\s*/, '↻ ')}</span>
            </div>
            <div className="mt-0.5 text-[11px] text-zinc-500">
              {fmtTime(r.startedAt)} · {fmtMs((r.endedAt ?? Date.now()) - r.startedAt)} · {r.steps} steps · {fmtNum(r.promptTokens)} in / {fmtNum(r.completionTokens)} out · {r.model}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

const kindColor: Record<string, string> = { llm: 'bg-sky-600', tool: 'bg-emerald-600', compaction: 'bg-violet-600', subagent: 'bg-orange-600' };

function TraceView({ runId, onBack }: { runId: string; onBack: () => void }) {
  const [t, setT] = useState<Trace | null>(null);
  const [span, setSpan] = useState<SpanRecord | null>(null);
  useEffect(() => {
    let stop = false;
    const load = () => api.trace(runId).then((x) => !stop && setT(x), () => {});
    void load();
    const i = setInterval(() => t?.run.status === 'running' && load(), 3000);
    return () => {
      stop = true;
      clearInterval(i);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runId, t?.run.status]);
  if (!t) return <div className="p-4"><Spinner /></div>;
  const start = t.run.startedAt;
  const end = Math.max(t.run.endedAt ?? Date.now(), ...t.spans.map((s) => s.endedAt ?? s.startedAt));
  const total = Math.max(1, end - start);
  const llm = t.spans.filter((s) => s.kind === 'llm');
  const tools = t.spans.filter((s) => s.kind === 'tool');
  const rows = [...t.spans, ...t.children.flatMap((c) => c.spans.map((s) => ({ ...s, name: `↳ ${s.name}` })))].sort((a, b) => a.startedAt - b.startedAt);
  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b border-zinc-800 px-2 py-1.5">
        <IconButton title="Back" onClick={onBack}>
          <ArrowLeft className="h-4 w-4" />
        </IconButton>
        <Badge tone={statusTone(t.run.status)}>{t.run.status}</Badge>
        <span className="min-w-0 flex-1 truncate text-xs text-zinc-300">{t.run.userMessage}</span>
      </div>
      <div className="grid shrink-0 grid-cols-4 gap-2 border-b border-zinc-800 p-2 text-center">
        <Stat label="Duration" value={fmtMs(total)} />
        <Stat label="LLM calls" value={`${llm.length}`} sub={`avg ${fmtMs(avg(llm.map((s) => s.durationMs ?? 0)))}`} />
        <Stat label="Tool calls" value={`${tools.length}`} sub={`${tools.filter((s) => s.status === 'error').length} failed`} />
        <Stat label="Tokens" value={`${fmtNum(t.run.promptTokens + t.run.completionTokens)}`} sub={`${fmtNum(avg(llm.map((s) => s.tokensPerSec ?? 0)))} tok/s`} />
      </div>
      {t.run.error && <div className="shrink-0 border-b border-zinc-800 bg-rose-950/30 px-3 py-1.5 text-xs text-rose-300">{t.run.error}</div>}
      <div className="min-h-0 flex-1 overflow-auto">
        {rows.map((s) => (
          <button key={s.id} onClick={() => setSpan(span?.id === s.id ? null : s)} className={`flex w-full items-center gap-2 px-2 py-[3px] text-left text-[11px] hover:bg-zinc-900 ${span?.id === s.id ? 'bg-zinc-900' : ''}`}>
            <span className={`w-40 shrink-0 truncate ${s.status === 'error' ? 'text-rose-400' : 'text-zinc-300'}`} title={s.name}>
              {s.name}
            </span>
            <span className="relative h-3 flex-1 rounded-sm bg-zinc-900">
              <span
                className={`absolute top-0 h-3 rounded-sm ${s.status === 'error' ? 'bg-rose-600' : kindColor[s.kind] ?? 'bg-zinc-500'}`}
                style={{ left: `${((s.startedAt - start) / total) * 100}%`, width: `${Math.max(0.4, (((s.endedAt ?? Date.now()) - s.startedAt) / total) * 100)}%` }}
              />
            </span>
            <span className="w-14 shrink-0 text-right text-zinc-500">{fmtMs(s.durationMs)}</span>
          </button>
        ))}
      </div>
      {span && (
        <div className="max-h-[45%] shrink-0 overflow-auto border-t border-zinc-800 p-2 text-[11px]">
          <div className="mb-1 flex flex-wrap gap-2 text-zinc-400">
            <Badge tone={statusTone(span.status)}>{span.status}</Badge>
            <span>{span.kind}</span>
            <span>{fmtMs(span.durationMs)}</span>
            {span.promptTokens != null && <span>{fmtNum(span.promptTokens)} prompt / {fmtNum(span.completionTokens)} completion tokens</span>}
            {span.ttftMs != null && <span>TTFT {fmtMs(span.ttftMs)}</span>}
            {span.tokensPerSec != null && <span>{span.tokensPerSec} tok/s</span>}
          </div>
          {span.error && <pre className="mb-1 whitespace-pre-wrap text-rose-300">{span.error}</pre>}
          <div className="text-zinc-500">Input</div>
          <pre className="mb-1 max-h-48 overflow-auto rounded bg-zinc-950 p-2 whitespace-pre-wrap text-zinc-300">{pretty(span.input)}</pre>
          <div className="text-zinc-500">Output</div>
          <pre className="max-h-64 overflow-auto rounded bg-zinc-950 p-2 whitespace-pre-wrap text-zinc-300">{pretty(span.output)}</pre>
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

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-md border border-zinc-800 bg-zinc-900/50 px-2 py-1.5">
      <div className="text-[10px] tracking-wide text-zinc-500 uppercase">{label}</div>
      <div className="text-base font-semibold text-zinc-100">{value}</div>
      {sub && <div className="text-[10px] text-zinc-500">{sub}</div>}
    </div>
  );
}

function MetricsView() {
  const [hours, setHours] = useState(168);
  const [m, setM] = useState<Metrics | null>(null);
  useEffect(() => {
    void api.metrics(hours).then(setM, () => {});
  }, [hours]);
  if (!m) return <div className="p-4"><Spinner /></div>;
  const maxTps = Math.max(1, ...m.recentLlm.map((r) => r.tokensPerSec));
  return (
    <div className="h-full space-y-3 overflow-auto p-3">
      <div className="flex items-center gap-2 text-xs text-zinc-400">
        Window
        <select className="text-xs" value={hours} onChange={(e) => setHours(Number(e.target.value))}>
          <option value={24}>last 24 hours</option>
          <option value={168}>last 7 days</option>
          <option value={720}>last 30 days</option>
          <option value={24 * 3650}>all time</option>
        </select>
      </div>
      <div className="grid grid-cols-3 gap-2 text-center">
        <Stat label="Runs" value={`${m.runs}`} sub={Object.entries(m.runsByStatus).map(([k, v]) => `${v} ${k}`).join(' · ')} />
        <Stat label="Avg speed" value={`${m.avgTokensPerSec} tok/s`} sub={`${m.llmCalls} LLM calls`} />
        <Stat label="Avg TTFT" value={fmtMs(m.avgTtftMs)} sub={`latency ${fmtMs(m.avgLlmLatencyMs)}`} />
        <Stat label="Tool success" value={`${m.toolSuccessRate}%`} sub={`${m.toolCalls} tool calls`} />
        <Stat label="Prompt tokens" value={fmtNum(m.totalPromptTokens)} />
        <Stat label="Output tokens" value={fmtNum(m.totalCompletionTokens)} />
      </div>
      <div>
        <div className="mb-1 text-xs text-zinc-400">Generation speed of recent LLM calls (tokens/sec)</div>
        <div className="flex h-24 items-end gap-px rounded-md border border-zinc-800 bg-zinc-950 p-1">
          {m.recentLlm.map((r, i) => (
            <div key={i} title={`${r.tokensPerSec} tok/s · ${fmtMs(r.durationMs)} · ${r.promptTokens} prompt tokens`} className="flex-1 rounded-t-sm bg-orange-500/80" style={{ height: `${(r.tokensPerSec / maxTps) * 100}%` }} />
          ))}
          {!m.recentLlm.length && <div className="m-auto text-xs text-zinc-600">no data</div>}
        </div>
      </div>
      <table className="w-full text-xs">
        <thead className="text-zinc-500">
          <tr className="text-left">
            <th className="py-1 font-medium">Tool</th>
            <th className="font-medium">Calls</th>
            <th className="font-medium">Errors</th>
            <th className="font-medium">Avg time</th>
          </tr>
        </thead>
        <tbody>
          {m.tools.map((t) => (
            <tr key={t.name} className="border-t border-zinc-900 text-zinc-300">
              <td className="py-1 font-mono">{t.name}</td>
              <td>{t.calls}</td>
              <td className={t.errors ? 'text-rose-400' : ''}>{t.errors}</td>
              <td>{fmtMs(t.avgMs)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Evals() {
  const { settings, notify } = useStore();
  const [tasks, setTasks] = useState<Awaited<ReturnType<typeof api.evalTasks>>>([]);
  const [reports, setReports] = useState<EvalReport[]>([]);
  const [status, setStatus] = useState<Awaited<ReturnType<typeof api.evalStatus>> | null>(null);
  const [profileId, setProfileId] = useState('');
  const [md, setMd] = useState<string | null>(null);
  const load = useCallback(async () => {
    setReports(await api.evalReports().catch(() => []));
    setStatus(await api.evalStatus().catch(() => null));
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
  const best = useMemo(() => reports[0], [reports]);

  if (md !== null)
    return (
      <div className="flex h-full flex-col">
        <div className="shrink-0 border-b border-zinc-800 px-2 py-1.5">
          <IconButton title="Back" onClick={() => setMd(null)}>
            <ArrowLeft className="h-4 w-4" />
          </IconButton>
        </div>
        <div className="min-h-0 flex-1 overflow-auto p-3">
          <Markdown text={md} className="text-xs" />
        </div>
      </div>
    );

  return (
    <div className="h-full space-y-3 overflow-auto p-3 text-xs">
      <p className="text-zinc-400">
        {tasks.length} small coding tasks in fixture repos, checked by hidden tests. Runs headless in full-auto against a model profile. CLI: <code className="text-zinc-300">npm run eval -- --profile &lt;id&gt;</code>
      </p>
      <div className="flex items-center gap-2">
        <select className="text-xs" value={profileId} onChange={(e) => setProfileId(e.target.value)}>
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
          <span className="flex items-center gap-1.5 text-zinc-400">
            <Spinner className="h-3.5 w-3.5" /> {status.done}/{status.total} · {status.current}
          </span>
        )}
      </div>
      {status?.running && status.results.length > 0 && (
        <div className="space-y-1">
          {status.results.map((r) => (
            <div key={r.id}>
              {r.passed ? '✅' : '❌'} {r.id} · {fmtMs(r.durationMs)}
            </div>
          ))}
        </div>
      )}
      <div>
        <div className="mb-1 font-medium text-zinc-300">Reports</div>
        {!reports.length && <div className="text-zinc-500">No reports yet.</div>}
        {reports.map((r) => (
          <button key={r.id} onClick={async () => setMd(await api.evalMarkdown(r.id))} className="mb-1 flex w-full items-center gap-2 rounded-md border border-zinc-800 px-2 py-1.5 text-left hover:border-zinc-600">
            <Badge tone={r.passed === r.total ? 'green' : r.passed >= r.total / 2 ? 'amber' : 'red'}>
              {r.passed}/{r.total}
            </Badge>
            <span className="min-w-0 flex-1 truncate text-zinc-300">
              {r.profile ?? r.model} · {r.toolMode} tools
            </span>
            <span className="text-zinc-500">{fmtTime(r.startedAt)}</span>
          </button>
        ))}
      </div>
      <div>
        <div className="mb-1 font-medium text-zinc-300">Tasks</div>
        {tasks.map((t) => {
          const res = best?.results.find((x) => x.id === t.id);
          return (
            <div key={t.id} className="flex items-center gap-2 border-t border-zinc-900 py-1" title={t.prompt}>
              <span>{res ? (res.passed ? '✅' : '❌') : '·'}</span>
              <span className="font-mono text-zinc-300">{t.id}</span>
              <span className="truncate text-zinc-500">{t.title}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
