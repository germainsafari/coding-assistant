// Long-run ("autonomous") mode helpers. The durable state of a long task lives in
// the project itself so it survives context compaction, crashes and restarts:
//   .agent/plan.md      checklist of the task (mirrors update_plan)
//   .agent/progress.md  append-only log: checkpoints (compaction summaries),
//                       verification results and the agent's own notes
import fs from 'node:fs';
import path from 'node:path';
import type { LongRunOptions, RunStatus, Settings, TodoItem } from '@hearth/shared';
import { truncateMiddle } from '../util.ts';

export const AGENT_DIR = '.agent';
export const planPath = (root: string) => path.join(root, AGENT_DIR, 'plan.md');
export const progressPath = (root: string) => path.join(root, AGENT_DIR, 'progress.md');

function ensureDir(root: string) {
  fs.mkdirSync(path.join(root, AGENT_DIR), { recursive: true });
}

export function readIfExists(file: string, max: number): string | null {
  if (!fs.existsSync(file)) return null;
  return truncateMiddle(fs.readFileSync(file, 'utf8'), max).text;
}

const mark: Record<TodoItem['status'], string> = { completed: '[x]', in_progress: '[~]', pending: '[ ]', cancelled: '[-]' };

export function writePlanFile(root: string, todos: TodoItem[]) {
  ensureDir(root);
  const lines = todos.map((t) => `- ${mark[t.status]} ${t.content}`);
  fs.writeFileSync(planPath(root), `# Plan\n\n_Legend: [x] done, [~] in progress, [ ] pending, [-] cancelled. Maintained by the agent (update_plan)._\n\n${lines.join('\n')}\n`, 'utf8');
}

export function appendProgress(root: string, heading: string, body: string) {
  ensureDir(root);
  const file = progressPath(root);
  const head = fs.existsSync(file) ? '' : '# Progress log\n\nDurable notes for long-running work. Re-read this after a context reset.\n';
  fs.appendFileSync(file, `${head}\n## ${heading} (${new Date().toISOString().replace('T', ' ').slice(0, 19)})\n\n${body.trim()}\n`, 'utf8');
}

export function resolveLongRun(o: Partial<LongRunOptions> | undefined, s: Settings): LongRunOptions | null {
  if (!o?.enabled) return null;
  return {
    enabled: true,
    doneCommand: (o.doneCommand ?? s.longRun.doneCommand ?? '').trim(),
    maxMinutes: Math.max(1, Number(o.maxMinutes) || s.longRun.maxMinutes),
    maxSteps: Math.max(5, Number(o.maxSteps) || s.longRun.maxSteps),
    maxVerifyAttempts: Math.max(1, Number(o.maxVerifyAttempts) || s.longRun.maxVerifyAttempts),
  };
}

/** Cap on chained auto-continues of one task (each continue starts a fresh step budget). */
export const MAX_AUTO_CONTINUES = 50;

export function shouldAutoContinue(p: { status: RunStatus; source: string; autoContinue: boolean; continueCount: number }): boolean {
  if (!p.autoContinue) return false;
  if (p.source === 'eval' || p.source === 'subagent') return false;
  if (p.continueCount >= MAX_AUTO_CONTINUES) return false;
  return p.status === 'max_steps' || p.status === 'budget_exhausted';
}

/** System-prompt section for long-run mode, including the current plan/progress files. */
export function longRunPromptSection(root: string, lr: LongRunOptions): string {
  const plan = readIfExists(planPath(root), 6000);
  const progress = readIfExists(progressPath(root), 10000);
  return `# LONG-RUN MODE (autonomous)
You are running unattended for up to ${lr.maxMinutes} minutes / ${lr.maxSteps} steps per checkpoint. Hitting the step budget is a checkpoint, not the end of the task: the harness will save progress and continue automatically. The user is not watching; do not stop to ask for confirmation, and do not end your turn until the whole task is finished and verified.
- Start by writing a complete plan with update_plan (it is saved to ${AGENT_DIR}/plan.md). Follow that plan strictly: keep exactly one item in_progress, do not skip ahead, and do not invent extra work that is not on the plan. Update the plan as you go.
- Work in small, verifiable increments: implement, run, test, fix. Commit working milestones with git_commit when the project uses git.
- After each milestone, append a short note to ${AGENT_DIR}/progress.md (what was done, what's next, gotchas) with edit_file/write_file. Your older messages WILL be deleted when the context fills up; ${AGENT_DIR}/plan.md, ${AGENT_DIR}/progress.md and the code are your durable memory.
- If you are stuck (same error repeatedly), stop, re-read the relevant code and errors, write down hypotheses, and try a genuinely different approach.
- ${lr.doneCommand ? `When you believe you are done, the harness runs the definition-of-done command \`${lr.doneCommand}\`. You can only finish when it exits 0, so run it yourself first.` : 'Before finishing, run the project tests/build to verify your work.'}
- Only give your final answer (no tool calls) when every plan item is completed or explicitly cancelled with a reason.
${plan ? `\n## Current ${AGENT_DIR}/plan.md\n${plan}` : ''}${progress ? `\n## Current ${AGENT_DIR}/progress.md\n${progress}` : ''}`;
}
