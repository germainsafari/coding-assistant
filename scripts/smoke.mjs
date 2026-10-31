// End-to-end smoke test against a running Hearth server and the live model.
//   node scripts/smoke.mjs [--base http://localhost:4545] [--prompt "..."] [--long-run] [--done "npm test"]
//                          [--profile <profile id or name>] [--dir <existing folder to use as the project>]
// Creates a scratch project (or opens --dir), starts a run in full-auto mode,
// streams the events to the console and prints a summary. Exit code 0 when the run completes.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const args = process.argv.slice(2);
const get = (f, d) => (args.includes(f) ? args[args.indexOf(f) + 1] : d);
const BASE = get('--base', 'http://localhost:4545');
const profileId = get('--profile', undefined);
const prompt = get(
  '--prompt',
  'Create a Python file hello.py with a function greet(name) that returns "Hello, <name>!" and a __main__ block that prints greet("World"). Then run it with python and tell me the output.',
);
const longRun = args.includes('--long-run');
const doneCommand = get('--done', '');

async function api(method, p, body) {
  const r = await fetch(BASE + p, { method, headers: body ? { 'content-type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`${method} ${p} -> ${r.status} ${JSON.stringify(j)}`);
  return j;
}

const dir = path.resolve(get('--dir', path.join(os.tmpdir(), 'hearth-smoke-' + Date.now())));
fs.mkdirSync(dir, { recursive: true });
const project = await api('POST', '/api/projects', { mode: 'open', path: dir, name: path.basename(dir) });
const thread = await api('POST', `/api/projects/${project.id}/threads`, {});
const prevSettings = await api('GET', '/api/settings');
await api('PUT', '/api/settings', { approvalMode: 'full-auto' });
console.log(`project ${project.id} at ${dir}\nthread ${thread.id}\n> ${prompt}\n`);

const t0 = Date.now();
const { runId } = await api('POST', `/api/threads/${thread.id}/runs`, {
  message: prompt,
  ...(profileId ? { profileId } : {}),
  ...(longRun ? { longRun: { enabled: true, doneCommand, maxMinutes: 30 } } : {}),
});
const res = await fetch(`${BASE}/api/runs/${runId}/events`);
const reader = res.body.getReader();
const dec = new TextDecoder();
let buf = '';
let status = 'unknown';
let tools = 0;
let inText = false;
outer: for (;;) {
  const { value, done } = await reader.read();
  if (done) break;
  buf += dec.decode(value, { stream: true });
  let i;
  while ((i = buf.indexOf('\n\n')) !== -1) {
    const chunk = buf.slice(0, i);
    buf = buf.slice(i + 2);
    const line = chunk.split('\n').find((l) => l.startsWith('data:'));
    if (!line) continue;
    const e = JSON.parse(line.slice(5));
    if (e.type === 'text_delta') {
      if (!inText) process.stdout.write('\n[assistant] ');
      inText = true;
      process.stdout.write(e.text);
      continue;
    }
    inText = false;
    if (e.type === 'step_started') console.log(`\n--- step ${e.step}`);
    else if (e.type === 'tool_call_started') {
      tools++;
      console.log(`[tool] ${e.call.name} ${JSON.stringify(e.call.arguments).slice(0, 200)}`);
    } else if (e.type === 'tool_call_finished') console.log(`[result ${e.message.meta?.ok ? 'ok' : 'FAIL'}] ${e.message.content.slice(0, 300).replace(/\n/g, ' | ')}`);
    else if (e.type === 'usage') console.log(`[usage] prompt=${e.promptTokens} completion=${e.completionTokens} tok/s=${e.tokensPerSec}`);
    else if (e.type === 'notice' || e.type === 'error' || e.type === 'context_compacted' || e.type === 'plan_updated' || e.type === 'verification') console.log(`[${e.type}]`, JSON.stringify(e).slice(0, 400));
    else if (e.type === 'subagent_event' && ['tool_call_started', 'run_finished'].includes(e.event.type))
      console.log(`  [subagent ${e.event.type}] ${JSON.stringify(e.event.call ?? e.event.status).slice(0, 200)}`);
    else if (e.type === 'run_finished') {
      status = e.status;
      console.log(`\n[run_finished] ${e.status} ${e.error ?? ''}`);
      break outer;
    }
  }
}
await api('PUT', '/api/settings', { approvalMode: prevSettings.approvalMode });
console.log(`\nstatus=${status} tools=${tools} time=${((Date.now() - t0) / 1000).toFixed(1)}s dir=${dir}`);
console.log('files:', fs.readdirSync(dir).join(', '));
process.exit(status === 'completed' ? 0 : 1);
