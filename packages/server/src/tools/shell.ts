import { resolveInProject, deniedReason } from '../safety.ts';
import { background, execCommand, readBackground, shellName, startBackground, stopBackground } from '../shell.ts';
import { truncateMiddle } from '../util.ts';
import { fail, ok, str, type ToolDef } from './types.ts';

const MAX_OUTPUT = 14_000;

const runShell: ToolDef = {
  name: 'run_shell',
  description:
    'Run a shell command in the project folder (PowerShell on Windows, bash on Linux/macOS). Use for installing deps, running tests/builds, scripts. ' +
    'Set background=true for long-running processes such as dev servers or watchers; then use shell_output / shell_kill. ' +
    'Commands are non-interactive: pass flags like -y/--yes. Output is truncated if very long.',
  parameters: {
    type: 'object',
    properties: {
      command: { type: 'string', description: 'The command line to execute' },
      cwd: { type: 'string', description: 'Working directory relative to the project root (default ".")' },
      timeout_sec: { type: 'integer', description: 'Timeout in seconds (default from settings, max 1800)' },
      background: { type: 'boolean', description: 'Start as a background process and return immediately' },
    },
    required: ['command'],
  },
  risk: 'shell',
  async execute(a, ctx) {
    const command = str(a.command, 'command');
    const why = deniedReason(command);
    if (why) return fail(`Command blocked by safety denylist (${why}). Ask the user to run it manually if it is really needed.`);
    const cwd = resolveInProject(ctx.root, (a.cwd as string) || '.');
    if (a.background) {
      const bg = startBackground(command, cwd, ctx.project.id);
      await new Promise((r) => setTimeout(r, 4000));
      const out = readBackground(bg);
      ctx.emit({ type: 'tool_output_delta', callId: ctx.callId, text: out });
      return ok(
        `Started background process ${bg.id} (${bg.running ? 'running' : `exited with code ${bg.exitCode}`}).\nInitial output:\n${out || '(no output yet)'}\n\nUse shell_output with id="${bg.id}" to read more output, shell_kill to stop it.`,
      );
    }
    const timeoutSec = Math.min(1800, Math.max(1, Number(a.timeout_sec) || ctx.settings.shellTimeoutSec));
    let pending = '';
    let timer: NodeJS.Timeout | null = null;
    const flush = () => {
      if (pending) ctx.emit({ type: 'tool_output_delta', callId: ctx.callId, text: pending });
      pending = '';
      timer = null;
    };
    const r = await execCommand(command, {
      cwd,
      timeoutMs: timeoutSec * 1000,
      signal: ctx.signal,
      onData: (s) => {
        pending += s;
        if (!timer) timer = setTimeout(flush, 150);
      },
    });
    if (timer) clearTimeout(timer);
    flush();
    const out = truncateMiddle(r.output.replace(/\x1b\[[0-9;]*[A-Za-z]/g, ''), MAX_OUTPUT).text;
    const status = r.timedOut
      ? `TIMED OUT after ${timeoutSec}s (process killed). For servers use background=true.`
      : r.cancelled
        ? 'CANCELLED'
        : `exit code ${r.exitCode}`;
    const body = `$ ${command}\n${out.trim() || '(no output)'}\n[${status}, ${(r.durationMs / 1000).toFixed(1)}s]`;
    return r.exitCode === 0 && !r.timedOut ? ok(body) : fail(body);
  },
};

const shellOutput: ToolDef = {
  name: 'shell_output',
  description: 'Read new output from a background process started with run_shell(background=true). Lists processes if id is omitted.',
  parameters: { type: 'object', properties: { id: { type: 'string' } } },
  risk: 'read',
  async execute(a, ctx) {
    if (!a.id) {
      const list = [...background.values()].filter((b) => b.projectId === ctx.project.id);
      if (!list.length) return ok('No background processes.');
      return ok(list.map((b) => `${b.id}  ${b.running ? 'running' : `exited(${b.exitCode})`}  ${b.command}`).join('\n'));
    }
    const bg = background.get(String(a.id));
    if (!bg) return fail(`No background process ${a.id}`);
    const out = readBackground(bg);
    return ok(`[${bg.running ? 'running' : `exited with code ${bg.exitCode}`}]\n${out || '(no new output)'}`);
  },
};

const shellKill: ToolDef = {
  name: 'shell_kill',
  description: 'Stop a background process started with run_shell(background=true).',
  parameters: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
  risk: 'read',
  async execute(a) {
    return stopBackground(String(a.id)) ? ok(`Stopped ${a.id}`) : fail(`No background process ${a.id}`);
  },
};

export const shellTools: ToolDef[] = [runShell, shellOutput, shellKill];
export { shellName };
