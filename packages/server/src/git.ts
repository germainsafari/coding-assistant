import { execFile } from 'node:child_process';
import { getSettings } from './config.ts';

export interface GitResult {
  code: number;
  stdout: string;
  stderr: string;
}

export function git(cwd: string, args: string[], opts: { timeoutMs?: number; input?: string } = {}): Promise<GitResult> {
  return new Promise((resolve) => {
    const p = execFile(
      'git',
      args,
      {
        cwd,
        timeout: opts.timeoutMs ?? 60_000,
        maxBuffer: 20 * 1024 * 1024,
        env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_PAGER: 'cat', LC_ALL: 'C' },
        windowsHide: true,
      },
      (err: any, stdout, stderr) => {
        resolve({ code: err ? (typeof err.code === 'number' ? err.code : 1) : 0, stdout: String(stdout), stderr: String(stderr || (err && !stderr ? err.message : '')) });
      },
    );
    if (opts.input !== undefined) {
      p.stdin?.write(opts.input);
      p.stdin?.end();
    }
  });
}

/** Extra args that authenticate HTTPS GitHub operations with the configured token. */
export function githubAuthArgs(): string[] {
  const token = getSettings().githubToken;
  if (!token) return [];
  const basic = Buffer.from(`x-access-token:${token}`).toString('base64');
  return ['-c', `http.https://github.com/.extraheader=AUTHORIZATION: basic ${basic}`];
}

export async function isRepo(cwd: string) {
  return (await git(cwd, ['rev-parse', '--is-inside-work-tree'])).stdout.trim() === 'true';
}

export interface StatusEntry {
  path: string;
  index: string;
  worktree: string;
  status: string;
}

export async function status(cwd: string): Promise<{ isRepo: boolean; branch: string | null; ahead: number; behind: number; upstream: string | null; files: StatusEntry[] }> {
  if (!(await isRepo(cwd))) return { isRepo: false, branch: null, ahead: 0, behind: 0, upstream: null, files: [] };
  const r = await git(cwd, ['status', '--porcelain=v1', '-b', '-uall']);
  const lines = r.stdout.split(/\r?\n/).filter(Boolean);
  let branch: string | null = null;
  let upstream: string | null = null;
  let ahead = 0;
  let behind = 0;
  const files: StatusEntry[] = [];
  for (const l of lines) {
    if (l.startsWith('## ')) {
      const m = l.slice(3).match(/^(?:No commits yet on )?([^.\s]+)(?:\.\.\.(\S+))?(?: \[(.*)\])?/);
      branch = m?.[1] ?? null;
      upstream = m?.[2] ?? null;
      const ab = m?.[3] ?? '';
      ahead = Number(ab.match(/ahead (\d+)/)?.[1] ?? 0);
      behind = Number(ab.match(/behind (\d+)/)?.[1] ?? 0);
      continue;
    }
    const index = l[0];
    const worktree = l[1];
    let p = l.slice(3);
    if (p.includes(' -> ')) p = p.split(' -> ')[1];
    p = p.replace(/^"|"$/g, '');
    const st = index === '?' ? 'untracked' : index === 'A' || worktree === 'A' ? 'added' : index === 'D' || worktree === 'D' ? 'deleted' : index === 'R' ? 'renamed' : 'modified';
    files.push({ path: p, index, worktree, status: st });
  }
  return { isRepo: true, branch, ahead, behind, upstream, files };
}

export async function diff(cwd: string, opts: { path?: string; staged?: boolean } = {}): Promise<string> {
  const args = ['diff', '--no-color', '--no-ext-diff'];
  if (opts.staged) args.push('--cached');
  if (opts.path) args.push('--', opts.path);
  let out = (await git(cwd, args)).stdout;
  // include untracked files as "new file" diffs
  if (!opts.staged) {
    const st = await status(cwd);
    for (const f of st.files.filter((f) => f.status === 'untracked' && (!opts.path || f.path === opts.path)).slice(0, 30)) {
      const r = await git(cwd, ['diff', '--no-color', '--no-index', '--', process.platform === 'win32' ? 'NUL' : '/dev/null', f.path]);
      out += r.stdout;
    }
  }
  return out;
}

export async function log(cwd: string, n = 20) {
  const r = await git(cwd, ['log', `-n${n}`, '--date=iso-strict', '--pretty=format:%H%x1f%h%x1f%an%x1f%ad%x1f%s']);
  if (r.code !== 0) return [];
  return r.stdout
    .split(/\r?\n/)
    .filter(Boolean)
    .map((l) => {
      const [hash, short, author, date, subject] = l.split('\x1f');
      return { hash, short, author, date, subject };
    });
}

export async function branches(cwd: string) {
  const r = await git(cwd, ['branch', '-a', '--format=%(HEAD)%x1f%(refname:short)']);
  return r.stdout
    .split(/\r?\n/)
    .filter(Boolean)
    .map((l) => {
      const [head, name] = l.split('\x1f');
      return { name, current: head === '*', remote: name.startsWith('origin/') || name.startsWith('remotes/') };
    });
}

export async function commit(cwd: string, message: string, paths?: string[]): Promise<GitResult> {
  const add = await git(cwd, paths?.length ? ['add', '--', ...paths] : ['add', '-A']);
  if (add.code !== 0) return add;
  const hasIdentity = (await git(cwd, ['config', 'user.email'])).stdout.trim();
  const idArgs = hasIdentity ? [] : ['-c', 'user.name=Hearth Agent', '-c', 'user.email=hearth@localhost'];
  return git(cwd, [...idArgs, 'commit', '-F', '-'], { input: message });
}

export async function remoteUrl(cwd: string): Promise<string | null> {
  const r = await git(cwd, ['remote', 'get-url', 'origin']);
  return r.code === 0 ? r.stdout.trim() : null;
}

export function parseGithubRemote(url: string | null): { owner: string; repo: string } | null {
  if (!url) return null;
  const m = url.match(/github\.com[:/]([^/]+)\/([^/]+?)(?:\.git)?\/?$/);
  return m ? { owner: m[1], repo: m[2] } : null;
}

export async function push(cwd: string, branch?: string): Promise<GitResult> {
  const b = branch || (await git(cwd, ['rev-parse', '--abbrev-ref', 'HEAD'])).stdout.trim();
  return git(cwd, [...githubAuthArgs(), 'push', '-u', 'origin', b], { timeoutMs: 120_000 });
}

export async function clone(url: string, dest: string): Promise<GitResult> {
  return git(process.cwd(), [...(url.includes('github.com') ? githubAuthArgs() : []), 'clone', url, dest], { timeoutMs: 600_000 });
}
