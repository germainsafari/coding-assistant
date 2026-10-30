import fs from 'node:fs';
import path from 'node:path';
import type { ApprovalMode, ToolRisk } from '@hearth/shared';
import { isWindows } from './util.ts';

export class SandboxError extends Error {}

const norm = (p: string) => (isWindows ? p.toLowerCase() : p);

/** Resolve `p` (absolute or relative to `root`) and ensure it stays inside `root`. */
export function resolveInProject(root: string, p: string | undefined | null): string {
  const rootAbs = path.resolve(root);
  const target = path.resolve(rootAbs, (p ?? '.').toString().trim() || '.');
  const check = (abs: string) => {
    const rel = path.relative(norm(rootAbs), norm(abs));
    if (rel.startsWith('..') || path.isAbsolute(rel)) {
      throw new SandboxError(`Path "${p}" is outside the project folder (${rootAbs}). Access denied.`);
    }
  };
  check(target);
  // Follow symlinks for existing paths (or their nearest existing parent).
  let probe = target;
  while (!fs.existsSync(probe) && path.dirname(probe) !== probe) probe = path.dirname(probe);
  try {
    const real = fs.realpathSync.native(probe);
    const realRoot = fs.realpathSync.native(rootAbs);
    const rel = path.relative(norm(realRoot), norm(real));
    if (rel.startsWith('..') || path.isAbsolute(rel)) throw new SandboxError(`Path "${p}" resolves outside the project via a symlink.`);
  } catch (e) {
    if (e instanceof SandboxError) throw e;
  }
  return target;
}

export const relPath = (root: string, abs: string) => path.relative(root, abs).split(path.sep).join('/') || '.';

// Commands that are never allowed, regardless of approval mode.
const DENY: { re: RegExp; why: string }[] = [
  { re: /\brm\s+(-[a-z]*r[a-z]*f|-[a-z]*f[a-z]*r)[a-z]*\s+(\/|~|\$HOME|\*|\.\.?)(\s|$)/i, why: 'recursive force delete of root/home/parent' },
  { re: /\brm\s+-[a-z]*\s+--no-preserve-root/i, why: 'rm --no-preserve-root' },
  { re: /\b(mkfs(\.\w+)?|fdisk|diskpart|format(\.com)?\s+[a-z]:)/i, why: 'disk formatting / partitioning' },
  { re: /\bdd\s+[^|]*\bof=\/dev\//i, why: 'raw disk write' },
  { re: /:\(\)\s*\{\s*:\|:&\s*\};:/, why: 'fork bomb' },
  { re: /\b(shutdown|reboot|halt|poweroff|Stop-Computer|Restart-Computer)\b/i, why: 'shutdown / reboot' },
  { re: /Remove-Item\b[^\n]*-Recurse[^\n]*\s([a-z]:\\?|\\|\/|~|\$env:USERPROFILE|\$HOME)(\s|$|["'])/i, why: 'recursive delete of a drive/home root' },
  { re: /\b(rd|rmdir)\s+\/s\s+(\/q\s+)?[a-z]:\\?(\s|$)/i, why: 'recursive delete of a drive root' },
  { re: /\bdel\s+(\/[a-z]\s+)*[a-z]:\\\*?(\s|$)/i, why: 'delete drive root' },
  { re: /\bgit\s+push\b[^\n]*(--force\b|-f\b)(?![^\n]*--force-with-lease)/i, why: 'force push (use --force-with-lease and ask the user)' },
  { re: /\bchmod\s+-R\s+777\s+\//i, why: 'chmod 777 on root' },
  { re: /\b(reg\s+delete|bcdedit|vssadmin\s+delete)\b/i, why: 'system configuration change' },
  { re: /\bcurl\b[^|\n]*\|\s*(sudo\s+)?(ba|z)?sh\b|\biwr\b[^|\n]*\|\s*iex\b|Invoke-Expression\s*\(\s*(New-Object\s+Net\.WebClient|iwr|Invoke-WebRequest)/i, why: 'piping a remote script into a shell' },
  { re: /\bsudo\b/i, why: 'sudo (privilege escalation)' },
];

export function deniedReason(command: string): string | null {
  for (const d of DENY) if (d.re.test(command)) return d.why;
  return null;
}

// Read-only commands that may run without approval in "auto-edit" mode.
const SAFE_PREFIXES = [
  'ls', 'dir', 'pwd', 'cat', 'type', 'head', 'tail', 'wc', 'echo', 'which', 'where', 'whoami', 'tree',
  'git status', 'git diff', 'git log', 'git show', 'git branch', 'git remote -v', 'git rev-parse',
  'get-childitem', 'get-content', 'get-location', 'get-item', 'test-path', 'select-string', 'resolve-path',
  'node --version', 'node -v', 'npm --version', 'npm -v', 'npm ls', 'python --version', 'python3 --version', 'pip list',
  'rg ', 'grep ', 'find ',
];

export function isSafeReadOnly(command: string): boolean {
  const c = command.trim().toLowerCase();
  if (/[;&|>`]|\$\(/.test(c.replace(/\|\s*(select-object|select|head|tail|sort|measure-object|wc|grep|findstr)\b[^|;&>]*/g, ''))) return false;
  if (/^find\b.*\s-(delete|exec)\b/.test(c)) return false;
  return SAFE_PREFIXES.some((p) => c === p.trim() || c.startsWith(p.endsWith(' ') ? p : p + ' ') || c === p);
}

export function approvalNeeded(risk: ToolRisk, mode: ApprovalMode, opts: { command?: string; autoApprove?: boolean } = {}): string | null {
  if (opts.autoApprove) return null;
  switch (risk) {
    case 'read':
    case 'network':
      return null;
    case 'edit':
      return mode === 'ask' ? 'File modification requires approval in "ask" mode.' : null;
    case 'shell':
      if (mode === 'full-auto') return null;
      if (opts.command && isSafeReadOnly(opts.command)) return null;
      return 'Shell commands require approval unless approval mode is "full-auto".';
    case 'external':
      return mode === 'full-auto' ? null : 'This action affects external systems (remote/MCP) and requires approval.';
  }
}
