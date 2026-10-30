import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import fg from 'fast-glob';
import { createTwoFilesPatch } from 'diff';
import { relPath, resolveInProject } from '../safety.ts';
import { truncateMiddle } from '../util.ts';
import { fail, ok, str, type ToolDef } from './types.ts';

export const IGNORED_DIRS = ['node_modules', '.git', 'dist', 'build', '.next', '.venv', 'venv', '__pycache__', '.cache', 'coverage', '.turbo', 'target'];
const MAX_READ_CHARS = 60_000;

export function unifiedDiff(file: string, before: string, after: string): string {
  return createTwoFilesPatch('a/' + file, 'b/' + file, before, after, '', '', { context: 3 });
}

function isBinary(buf: Buffer): boolean {
  const n = Math.min(buf.length, 8000);
  for (let i = 0; i < n; i++) if (buf[i] === 0) return true;
  return false;
}

const readFile: ToolDef = {
  name: 'read_file',
  description:
    'Read a text file from the project. Returns numbered lines ("LINE|content"). For large files use offset/limit (1-based line numbers). Always read a file before editing it.',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'File path relative to the project root' },
      offset: { type: 'integer', description: 'First line to read (1-based). Optional.' },
      limit: { type: 'integer', description: 'Max number of lines. Optional (default 800).' },
    },
    required: ['path'],
  },
  risk: 'read',
  async execute(a, ctx) {
    const abs = resolveInProject(ctx.root, str(a.path, 'path'));
    if (!fs.existsSync(abs)) return fail(`File not found: ${a.path}`);
    if (fs.statSync(abs).isDirectory()) return fail(`${a.path} is a directory. Use list_dir.`);
    const buf = fs.readFileSync(abs);
    if (isBinary(buf)) return fail(`${a.path} looks like a binary file (${buf.length} bytes); not shown.`);
    const lines = buf.toString('utf8').split(/\r?\n/);
    const start = Math.max(1, Number(a.offset) || 1);
    const limit = Math.max(1, Number(a.limit) || 800);
    const slice = lines.slice(start - 1, start - 1 + limit);
    const width = String(start + slice.length).length;
    let out = slice.map((l, i) => `${String(start + i).padStart(width)}|${l}`).join('\n');
    const t = truncateMiddle(out, MAX_READ_CHARS);
    out = t.text;
    const end = start + slice.length - 1;
    const more = end < lines.length ? `\n\n[Showing lines ${start}-${end} of ${lines.length}. Use offset=${end + 1} to read more.]` : '';
    if (!lines.length || (lines.length === 1 && lines[0] === '')) return ok(`(${a.path} is empty)`);
    return ok(out + more);
  },
};

const writeFile: ToolDef = {
  name: 'write_file',
  description:
    'Create a new file or completely overwrite an existing file with the given content. Parent folders are created automatically. Prefer edit_file for small changes to existing files.',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'File path relative to the project root' },
      content: { type: 'string', description: 'The full file content' },
    },
    required: ['path', 'content'],
  },
  risk: 'edit',
  async preview(a, ctx) {
    const abs = resolveInProject(ctx.root, str(a.path, 'path'));
    const before = fs.existsSync(abs) ? fs.readFileSync(abs, 'utf8') : '';
    return unifiedDiff(relPath(ctx.root, abs), before, str(a.content, 'content', false));
  },
  async execute(a, ctx) {
    const abs = resolveInProject(ctx.root, str(a.path, 'path'));
    const content = str(a.content, 'content', false);
    const existed = fs.existsSync(abs);
    const before = existed ? fs.readFileSync(abs, 'utf8') : '';
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content, 'utf8');
    const rel = relPath(ctx.root, abs);
    const lines = content.split('\n').length;
    return ok(`${existed ? 'Overwrote' : 'Created'} ${rel} (${lines} lines).`, {
      diff: unifiedDiff(rel, before, content),
      changedFiles: [rel],
    });
  },
};

function applyEdit(content: string, oldStr: string, newStr: string, replaceAll: boolean): { result?: string; error?: string; count: number } {
  if (oldStr === newStr) return { error: 'old_string and new_string are identical.', count: 0 };
  if (oldStr === '') return { error: 'old_string is empty. Use write_file to create files.', count: 0 };
  // Normalise line endings so CRLF files can be edited with LF snippets.
  const crlf = content.includes('\r\n');
  const c = crlf ? content.replace(/\r\n/g, '\n') : content;
  const o = oldStr.replace(/\r\n/g, '\n');
  const n = newStr.replace(/\r\n/g, '\n');
  let count = c.split(o).length - 1;
  let target = o;
  if (count === 0) {
    // fall back to whitespace-tolerant match on trailing spaces
    const trimmedLines = (s: string) => s.split('\n').map((l) => l.trimEnd()).join('\n');
    const ct = trimmedLines(c);
    const ot = trimmedLines(o);
    const cnt = ct.split(ot).length - 1;
    if (cnt === 0) return { error: 'old_string was not found in the file. Re-read the file and copy the exact text (including indentation).', count: 0 };
    if (cnt > 1 && !replaceAll) return { error: `old_string matches ${cnt} places; add more surrounding context or set replace_all=true.`, count: cnt };
    const out = replaceAll ? ct.split(ot).join(n) : ct.replace(ot, () => n);
    return { result: crlf ? out.replace(/\n/g, '\r\n') : out, count: cnt };
  }
  if (count > 1 && !replaceAll) return { error: `old_string matches ${count} places; add more surrounding context or set replace_all=true.`, count };
  const out = replaceAll ? c.split(target).join(n) : c.replace(target, () => n);
  return { result: crlf ? out.replace(/\n/g, '\r\n') : out, count };
}

const editFile: ToolDef = {
  name: 'edit_file',
  description:
    'Edit an existing file by replacing an exact snippet (old_string) with new text (new_string). old_string must match the file exactly (including indentation) and be unique unless replace_all is true. Returns a diff.',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'File path relative to the project root' },
      old_string: { type: 'string', description: 'Exact text to replace' },
      new_string: { type: 'string', description: 'Replacement text' },
      replace_all: { type: 'boolean', description: 'Replace every occurrence (default false)' },
    },
    required: ['path', 'old_string', 'new_string'],
  },
  risk: 'edit',
  async preview(a, ctx) {
    const abs = resolveInProject(ctx.root, str(a.path, 'path'));
    if (!fs.existsSync(abs)) return undefined;
    const before = fs.readFileSync(abs, 'utf8');
    const r = applyEdit(before, str(a.old_string, 'old_string', false), str(a.new_string, 'new_string', false), !!a.replace_all);
    return r.result !== undefined ? unifiedDiff(relPath(ctx.root, abs), before, r.result) : undefined;
  },
  async execute(a, ctx) {
    const abs = resolveInProject(ctx.root, str(a.path, 'path'));
    if (!fs.existsSync(abs)) return fail(`File not found: ${a.path}. Use write_file to create it.`);
    const before = fs.readFileSync(abs, 'utf8');
    const r = applyEdit(before, str(a.old_string, 'old_string', false), str(a.new_string, 'new_string', false), !!a.replace_all);
    if (r.error || r.result === undefined) return fail(`Edit failed for ${a.path}: ${r.error}`);
    fs.writeFileSync(abs, r.result, 'utf8');
    const rel = relPath(ctx.root, abs);
    return ok(`Edited ${rel} (${r.count} replacement${r.count === 1 ? '' : 's'}).`, {
      diff: unifiedDiff(rel, before, r.result),
      changedFiles: [rel],
    });
  },
};

const deleteFile: ToolDef = {
  name: 'delete_file',
  description: 'Delete a file (or an empty folder) inside the project.',
  parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
  risk: 'edit',
  async execute(a, ctx) {
    const abs = resolveInProject(ctx.root, str(a.path, 'path'));
    if (path.resolve(abs) === path.resolve(ctx.root)) return fail('Refusing to delete the project root.');
    if (!fs.existsSync(abs)) return fail(`Not found: ${a.path}`);
    const st = fs.statSync(abs);
    const rel = relPath(ctx.root, abs);
    if (st.isDirectory()) {
      if (fs.readdirSync(abs).length) return fail(`${rel} is a non-empty folder; delete its files first or use run_shell.`);
      fs.rmdirSync(abs);
      return ok(`Deleted empty folder ${rel}`, { changedFiles: [rel] });
    }
    const before = fs.readFileSync(abs, 'utf8');
    fs.unlinkSync(abs);
    return ok(`Deleted ${rel}`, { diff: unifiedDiff(rel, before, ''), changedFiles: [rel] });
  },
};

const listDir: ToolDef = {
  name: 'list_dir',
  description: 'List files and folders (tree view). Skips node_modules, .git, build outputs. depth defaults to 2.',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Folder relative to project root (default ".")' },
      depth: { type: 'integer', description: 'Recursion depth (1-5, default 2)' },
    },
  },
  risk: 'read',
  async execute(a, ctx) {
    const abs = resolveInProject(ctx.root, (a.path as string) || '.');
    if (!fs.existsSync(abs)) return fail(`Not found: ${a.path}`);
    const maxDepth = Math.min(5, Math.max(1, Number(a.depth) || 2));
    const out: string[] = [];
    let count = 0;
    const walk = (dir: string, depth: number, indent: string) => {
      if (count > 400) return;
      let entries: fs.Dirent[] = [];
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }
      entries.sort((x, y) => Number(y.isDirectory()) - Number(x.isDirectory()) || x.name.localeCompare(y.name));
      for (const e of entries) {
        if (++count > 400) {
          out.push(indent + '… (truncated)');
          return;
        }
        if (e.isDirectory()) {
          const skip = IGNORED_DIRS.includes(e.name);
          out.push(`${indent}${e.name}/${skip ? ' (skipped)' : ''}`);
          if (!skip && depth < maxDepth) walk(path.join(dir, e.name), depth + 1, indent + '  ');
        } else {
          let size = '';
          try {
            const s = fs.statSync(path.join(dir, e.name)).size;
            size = s > 1024 ? ` (${(s / 1024).toFixed(1)} KB)` : ` (${s} B)`;
          } catch {}
          out.push(`${indent}${e.name}${size}`);
        }
      }
    };
    walk(abs, 1, '');
    return ok(`${relPath(ctx.root, abs)}/\n${out.join('\n') || '(empty)'}`);
  },
};

const globTool: ToolDef = {
  name: 'glob',
  description: 'Find files by glob pattern (e.g. "src/**/*.ts", "**/*.test.js"). Returns up to 200 paths.',
  parameters: {
    type: 'object',
    properties: { pattern: { type: 'string' }, path: { type: 'string', description: 'Base folder (default project root)' } },
    required: ['pattern'],
  },
  risk: 'read',
  async execute(a, ctx) {
    const base = resolveInProject(ctx.root, (a.path as string) || '.');
    const files = await fg(str(a.pattern, 'pattern'), {
      cwd: base,
      dot: true,
      ignore: IGNORED_DIRS.map((d) => `**/${d}/**`),
      onlyFiles: true,
      suppressErrors: true,
    });
    files.sort();
    const shown = files.slice(0, 200).map((f) => relPath(ctx.root, path.join(base, f)));
    return ok(shown.length ? shown.join('\n') + (files.length > 200 ? `\n… ${files.length - 200} more` : '') : 'No files matched.');
  },
};

let rgAvailable: boolean | null = null;
async function hasRipgrep(): Promise<boolean> {
  if (rgAvailable !== null) return rgAvailable;
  rgAvailable = await new Promise<boolean>((resolve) => {
    const p = spawn('rg', ['--version'], { stdio: 'ignore' });
    p.on('error', () => resolve(false));
    p.on('exit', (code) => resolve(code === 0));
  });
  return rgAvailable;
}

async function jsGrep(root: string, base: string, pattern: string, globPat: string | undefined, ci: boolean, max: number): Promise<string[]> {
  const re = new RegExp(pattern, ci ? 'i' : '');
  const files = await fg(globPat || '**/*', { cwd: base, dot: true, ignore: IGNORED_DIRS.map((d) => `**/${d}/**`), onlyFiles: true, suppressErrors: true });
  const out: string[] = [];
  for (const f of files) {
    const abs = path.join(base, f);
    let buf: Buffer;
    try {
      if (fs.statSync(abs).size > 2_000_000) continue;
      buf = fs.readFileSync(abs);
    } catch {
      continue;
    }
    if (isBinary(buf)) continue;
    const lines = buf.toString('utf8').split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      if (re.test(lines[i])) {
        out.push(`${relPath(root, abs)}:${i + 1}:${lines[i].slice(0, 300)}`);
        if (out.length >= max) return out;
      }
    }
  }
  return out;
}

const grepTool: ToolDef = {
  name: 'grep',
  description:
    'Search file contents with a regular expression (ripgrep syntax). Returns "path:line:text" matches. Use glob to filter files (e.g. "*.ts").',
  parameters: {
    type: 'object',
    properties: {
      pattern: { type: 'string', description: 'Regex to search for' },
      path: { type: 'string', description: 'Folder or file to search (default project root)' },
      glob: { type: 'string', description: 'Optional file glob filter, e.g. "*.py"' },
      case_insensitive: { type: 'boolean' },
      max_results: { type: 'integer', description: 'Default 100' },
    },
    required: ['pattern'],
  },
  risk: 'read',
  async execute(a, ctx) {
    const base = resolveInProject(ctx.root, (a.path as string) || '.');
    const pattern = str(a.pattern, 'pattern');
    const max = Math.min(500, Number(a.max_results) || 100);
    let lines: string[] = [];
    if (await hasRipgrep()) {
      const args = ['--line-number', '--no-heading', '--color', 'never', '--max-columns', '300', '--hidden'];
      for (const d of IGNORED_DIRS) args.push('--glob', `!${d}`);
      if (a.case_insensitive) args.push('-i');
      if (a.glob) args.push('--glob', String(a.glob));
      args.push('-e', pattern, base);
      const out = await new Promise<string>((resolve) => {
        const p = spawn('rg', args, { cwd: ctx.root });
        let buf = '';
        p.stdout.on('data', (d) => {
          buf += d;
          if (buf.length > 400_000) p.kill();
        });
        p.on('error', () => resolve(''));
        p.on('close', () => resolve(buf));
      });
      lines = out
        .split(/\r?\n/)
        .filter(Boolean)
        .slice(0, max)
        .map((l) => {
          const m = l.match(/^(.*?):(\d+):(.*)$/);
          return m ? `${relPath(ctx.root, path.resolve(ctx.root, m[1]))}:${m[2]}:${m[3]}` : l;
        });
    } else {
      lines = await jsGrep(ctx.root, base, pattern, a.glob as string | undefined, !!a.case_insensitive, max);
    }
    return ok(lines.length ? lines.join('\n') + (lines.length >= max ? `\n… (limited to ${max} results)` : '') : 'No matches.');
  },
};

export const fsTools: ToolDef[] = [readFile, writeFile, editFile, deleteFile, listDir, globTool, grepTool];
export { applyEdit };
