// Cross-platform command execution: PowerShell on Windows, bash (or sh) elsewhere.
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { isWindows, newId, truncateMiddle } from './util.ts';

let shellCache: { cmd: string; kind: 'pwsh' | 'powershell' | 'bash' | 'sh' } | null = null;

export function detectShell() {
  if (shellCache) return shellCache;
  if (isWindows) {
    const pwsh = spawnSync('pwsh', ['-NoLogo', '-NoProfile', '-Command', '1'], { stdio: 'ignore', timeout: 8000 });
    shellCache = pwsh.status === 0 ? { cmd: 'pwsh', kind: 'pwsh' } : { cmd: 'powershell.exe', kind: 'powershell' };
  } else {
    const bash = spawnSync('bash', ['-c', 'true'], { stdio: 'ignore' });
    shellCache = bash.status === 0 ? { cmd: 'bash', kind: 'bash' } : { cmd: 'sh', kind: 'sh' };
  }
  return shellCache;
}

export function shellName() {
  const s = detectShell();
  return s.kind === 'pwsh' ? 'PowerShell 7 (pwsh)' : s.kind === 'powershell' ? 'Windows PowerShell 5.1' : s.kind;
}

function spawnShell(command: string, cwd: string, env?: Record<string, string>): ChildProcess {
  const sh = detectShell();
  const fullEnv = { ...process.env, ...env, FORCE_COLOR: '0', NO_COLOR: '1', CI: process.env.CI ?? '1', GIT_TERMINAL_PROMPT: '0', GIT_PAGER: 'cat', PAGER: 'cat' };
  if (sh.kind === 'pwsh' || sh.kind === 'powershell') {
    const script = `$ProgressPreference='SilentlyContinue'; [Console]::OutputEncoding=[System.Text.Encoding]::UTF8; $OutputEncoding=[System.Text.Encoding]::UTF8;\n${command}\nif ($LASTEXITCODE -ne $null) { exit $LASTEXITCODE }`;
    const encoded = Buffer.from(script, 'utf16le').toString('base64');
    return spawn(sh.cmd, ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded], {
      cwd,
      env: fullEnv,
      windowsHide: true,
    });
  }
  return spawn(sh.cmd, ['-lc', command], { cwd, env: fullEnv, detached: true });
}

export function killTree(p: ChildProcess) {
  if (!p.pid || p.exitCode !== null) return;
  try {
    if (isWindows) spawnSync('taskkill', ['/pid', String(p.pid), '/T', '/F'], { stdio: 'ignore' });
    else process.kill(-p.pid, 'SIGKILL');
  } catch {
    try {
      p.kill('SIGKILL');
    } catch {}
  }
}

export interface ExecResult {
  exitCode: number | null;
  output: string;
  timedOut: boolean;
  cancelled: boolean;
  durationMs: number;
}

/** Run a command to completion, streaming combined stdout/stderr through onData. */
export function execCommand(
  command: string,
  opts: { cwd: string; timeoutMs: number; signal?: AbortSignal; onData?: (chunk: string) => void; env?: Record<string, string> },
): Promise<ExecResult> {
  return new Promise((resolve) => {
    const t0 = Date.now();
    let output = '';
    let timedOut = false;
    let cancelled = false;
    const p = spawnShell(command, opts.cwd, opts.env);
    const onChunk = (d: Buffer) => {
      const s = d.toString('utf8');
      if (output.length < 2_000_000) output += s;
      opts.onData?.(s);
    };
    p.stdout?.on('data', onChunk);
    p.stderr?.on('data', onChunk);
    const timer = setTimeout(() => {
      timedOut = true;
      killTree(p);
    }, opts.timeoutMs);
    const onAbort = () => {
      cancelled = true;
      killTree(p);
    };
    opts.signal?.addEventListener('abort', onAbort, { once: true });
    p.on('error', (e) => {
      output += `\n[failed to start shell: ${e.message}]`;
    });
    p.on('close', (code) => {
      clearTimeout(timer);
      opts.signal?.removeEventListener('abort', onAbort);
      resolve({ exitCode: code, output, timedOut, cancelled, durationMs: Date.now() - t0 });
    });
  });
}

// ---------- background processes (dev servers, watchers) ----------
export interface BgProcess {
  id: string;
  command: string;
  cwd: string;
  projectId: string;
  startedAt: number;
  output: string;
  exitCode: number | null;
  running: boolean;
  proc: ChildProcess;
  readOffset: number;
}

export const background = new Map<string, BgProcess>();

export function startBackground(command: string, cwd: string, projectId: string): BgProcess {
  const proc = spawnShell(command, cwd);
  const bg: BgProcess = { id: newId('bg_'), command, cwd, projectId, startedAt: Date.now(), output: '', exitCode: null, running: true, proc, readOffset: 0 };
  const onChunk = (d: Buffer) => {
    bg.output += d.toString('utf8');
    if (bg.output.length > 400_000) {
      const cut = bg.output.length - 200_000;
      bg.output = bg.output.slice(cut);
      bg.readOffset = Math.max(0, bg.readOffset - cut);
    }
  };
  proc.stdout?.on('data', onChunk);
  proc.stderr?.on('data', onChunk);
  proc.on('close', (code) => {
    bg.running = false;
    bg.exitCode = code;
  });
  proc.on('error', (e) => {
    bg.output += `\n[failed to start: ${e.message}]`;
    bg.running = false;
  });
  background.set(bg.id, bg);
  return bg;
}

/** Return output since the last read (or the whole tail). */
export function readBackground(bg: BgProcess, all = false): string {
  const text = all ? bg.output : bg.output.slice(bg.readOffset);
  bg.readOffset = bg.output.length;
  return truncateMiddle(text, 12_000).text;
}

export function stopBackground(id: string): boolean {
  const bg = background.get(id);
  if (!bg) return false;
  killTree(bg.proc);
  bg.running = false;
  return true;
}

export function stopAllBackground() {
  for (const bg of background.values()) if (bg.running) killTree(bg.proc);
}
