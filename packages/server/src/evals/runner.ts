// Eval harness: copies each fixture repo to a scratch workspace, runs the agent
// headless (full-auto approvals), restores the hidden checks, runs the check
// commands and writes a JSON + Markdown report to evals/results/.
import fs from 'node:fs';
import path from 'node:path';
import type { EvalReport, EvalTaskInfo, EvalTaskResult, ModelSettings, Settings } from '@hearth/shared';
import { DATA_DIR, EVALS_DIR, settingsForProfile } from '../config.ts';
import { projects, threads } from '../db.ts';
import { probeCapabilities } from '../llm/client.ts';
import { startRun, waitForRun } from '../agent/loop.ts';
import { execCommand } from '../shell.ts';
import { truncateMiddle } from '../util.ts';

const TASKS_DIR = path.join(EVALS_DIR, 'tasks');
export const RESULTS_DIR = path.join(EVALS_DIR, 'results');
const WORK_DIR = path.join(DATA_DIR, 'eval-workspaces');

interface TaskSpec extends EvalTaskInfo {
  checks: string[];
  timeoutSec?: number;
  maxSteps?: number;
}

export function listTasks(): TaskSpec[] {
  if (!fs.existsSync(TASKS_DIR)) return [];
  return fs
    .readdirSync(TASKS_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory() && fs.existsSync(path.join(TASKS_DIR, d.name, 'task.json')))
    .map((d) => {
      const j = JSON.parse(fs.readFileSync(path.join(TASKS_DIR, d.name, 'task.json'), 'utf8'));
      const checks: string[] = Array.isArray(j.check) ? j.check : [j.check];
      return { id: d.name, title: j.title, prompt: j.prompt, check: checks.join(' ; '), checks, tags: j.tags ?? [], timeoutSec: j.timeoutSec, maxSteps: j.maxSteps };
    })
    .sort((a, b) => a.id.localeCompare(b.id));
}

export interface EvalProgress {
  running: boolean;
  reportId?: string;
  current?: string;
  done: number;
  total: number;
  results: EvalTaskResult[];
}
export const evalProgress: EvalProgress = { running: false, done: 0, total: 0, results: [] };

export async function runEvals(
  opts: { taskIds?: string[]; log?: (s: string) => void; profileId?: string; model?: Partial<ModelSettings>; label?: string } = {},
): Promise<EvalReport> {
  if (evalProgress.running) throw new Error('An eval run is already in progress');
  const log = opts.log ?? (() => {});
  const base = settingsForProfile(opts.profileId);
  const settings: Settings = { ...base, approvalMode: 'full-auto', model: { ...base.model, ...(opts.model ?? {}) } };
  const profileName = base.profiles.find((p) => p.id === (opts.profileId ?? base.activeProfileId) || p.name === opts.profileId)?.name ?? settings.model.model;
  const caps = await probeCapabilities(settings.model, true);
  if (!caps.reachable) throw new Error(`Model server not reachable: ${caps.error}`);
  const tasks = listTasks().filter((t) => !opts.taskIds?.length || opts.taskIds.includes(t.id));
  const reportId = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19) + (opts.label ? `-${opts.label.replace(/[^\w.-]+/g, '_')}` : '');
  log(`Model ${settings.model.model} @ ${settings.model.baseUrl} (profile "${profileName}", tool mode ${caps.effectiveToolMode}, thinking ${settings.model.thinking}). ${tasks.length} task(s).`);
  Object.assign(evalProgress, { running: true, reportId, done: 0, total: tasks.length, results: [], current: undefined });
  const startedAt = Date.now();
  const results: EvalTaskResult[] = [];
  try {
    for (const t of tasks) {
      evalProgress.current = t.id;
      log(`\n▶ ${t.id}: ${t.title}`);
      const r = await runTask(t, settings, reportId, log);
      results.push(r);
      evalProgress.results = [...results];
      evalProgress.done++;
      log(`${r.passed ? '✅ PASS' : '❌ FAIL'} ${t.id} in ${(r.durationMs / 1000).toFixed(1)}s, ${r.steps} steps, ${r.toolCalls} tool calls, ${r.promptTokens + r.completionTokens} tokens`);
    }
  } finally {
    evalProgress.running = false;
    evalProgress.current = undefined;
  }
  const report: EvalReport = {
    id: reportId,
    startedAt,
    finishedAt: Date.now(),
    model: settings.model.model,
    profile: profileName,
    thinking: settings.model.thinking,
    toolMode: caps.effectiveToolMode,
    passed: results.filter((r) => r.passed).length,
    total: results.length,
    results,
  };
  fs.mkdirSync(RESULTS_DIR, { recursive: true });
  fs.writeFileSync(path.join(RESULTS_DIR, `${reportId}.json`), JSON.stringify(report, null, 2));
  fs.writeFileSync(path.join(RESULTS_DIR, `${reportId}.md`), reportMarkdown(report));
  log(`\nScore: ${report.passed}/${report.total}. Report: ${path.join(RESULTS_DIR, reportId + '.md')}`);
  return report;
}

async function runTask(t: TaskSpec, settings: Settings, reportId: string, log: (s: string) => void): Promise<EvalTaskResult> {
  const t0 = Date.now();
  const src = path.join(TASKS_DIR, t.id);
  const ws = path.join(WORK_DIR, reportId, t.id);
  fs.rmSync(ws, { recursive: true, force: true });
  fs.mkdirSync(ws, { recursive: true });
  if (fs.existsSync(path.join(src, 'repo'))) fs.cpSync(path.join(src, 'repo'), ws, { recursive: true });
  await execCommand('git init -q -b main; git add -A; git -c user.name=eval -c user.email=eval@localhost commit -q -m "fixture"', { cwd: ws, timeoutMs: 30_000 });

  const project = projects.create(`eval:${t.id}`, ws, true);
  const thread = threads.create(project.id, `eval ${t.id}`);
  const base: EvalTaskResult = { id: t.id, title: t.title, passed: false, durationMs: 0, steps: 0, promptTokens: 0, completionTokens: 0, toolCalls: 0, runStatus: 'error', checkOutput: '' };
  try {
    const handle = startRun(thread.id, t.prompt, { source: 'eval', settings: { ...settings, maxSteps: t.maxSteps ?? 30 } });
    const timeout = setTimeout(() => handle.abort.abort(), (t.timeoutSec ?? 600) * 1000);
    handle.subscribe((e) => {
      if (e.type === 'tool_call_started') log(`   · ${e.call.name} ${truncateMiddle(JSON.stringify(e.call.arguments), 120).text.replace(/\n/g, ' ')}`);
      if (e.type === 'error') log(`   ! ${e.message}`);
    });
    const r = await waitForRun(handle);
    clearTimeout(timeout);
    Object.assign(base, { steps: r.steps, promptTokens: r.promptTokens, completionTokens: r.completionTokens, toolCalls: r.toolCalls, runStatus: r.status, error: r.error });

    // restore pristine hidden checks (so the agent can't "pass" by editing tests)
    if (fs.existsSync(path.join(src, 'checks'))) fs.cpSync(path.join(src, 'checks'), ws, { recursive: true, force: true });
    let out = '';
    let passed = true;
    for (const c of t.checks) {
      const cr = await execCommand(c, { cwd: ws, timeoutMs: 120_000 });
      out += `$ ${c}\n${cr.output.trim()}\n[exit ${cr.exitCode}]\n`;
      if (cr.exitCode !== 0) {
        passed = false;
        break;
      }
    }
    base.passed = passed;
    base.checkOutput = truncateMiddle(out, 4000).text;
  } catch (e) {
    base.error = (e as Error).message;
  }
  base.durationMs = Date.now() - t0;
  return base;
}

export function reportMarkdown(r: EvalReport): string {
  const rows = r.results
    .map(
      (x) =>
        `| ${x.id} | ${x.passed ? '✅ pass' : '❌ fail'} | ${(x.durationMs / 1000).toFixed(1)}s | ${x.steps} | ${x.toolCalls} | ${x.promptTokens.toLocaleString('en-US')} / ${x.completionTokens.toLocaleString('en-US')} | ${x.runStatus} |`,
    )
    .join('\n');
  const totalTime = r.results.reduce((a, x) => a + x.durationMs, 0) / 1000;
  return `# Eval report ${r.id}

- Model: \`${r.model}\` (profile: ${r.profile ?? '-'}, tool mode: ${r.toolMode}, thinking: ${r.thinking ?? '-'})
- Date: ${new Date(r.startedAt).toISOString().replace('T', ' ').slice(0, 16)} UTC
- Score: **${r.passed}/${r.total}** (${r.total ? Math.round((r.passed / r.total) * 100) : 0}%)
- Total agent time: ${totalTime.toFixed(0)}s

| Task | Result | Time | Steps | Tool calls | Prompt / completion tokens | Run status |
|---|---|---|---|---|---|---|
${rows}

${r.results
  .filter((x) => !x.passed)
  .map((x) => `## ${x.id} (failed)\n\n\`\`\`\n${x.error ? 'Error: ' + x.error + '\n' : ''}${x.checkOutput}\n\`\`\``)
  .join('\n\n')}
`;
}

export function listReports(): EvalReport[] {
  if (!fs.existsSync(RESULTS_DIR)) return [];
  return fs
    .readdirSync(RESULTS_DIR)
    .filter((f) => f.endsWith('.json'))
    .map((f) => JSON.parse(fs.readFileSync(path.join(RESULTS_DIR, f), 'utf8')) as EvalReport)
    .sort((a, b) => b.startedAt - a.startedAt);
}
