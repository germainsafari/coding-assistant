// Routes for the right-hand panels: files, git/GitHub, terminal and browser.
import fs from 'node:fs';
import path from 'node:path';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { getSettings } from '../config.ts';
import { projects } from '../db.ts';
import { chatOnce } from '../llm/client.ts';
import { relPath, resolveInProject, deniedReason } from '../safety.ts';
import { background, execCommand, startBackground, stopBackground } from '../shell.ts';
import { IGNORED_DIRS } from '../tools/fs.ts';
import { truncateMiddle } from '../util.ts';
import * as G from '../git.ts';
import * as GH from '../github.ts';
import * as B from '../browser.ts';

function project(id: string) {
  const p = projects.get(id);
  if (!p) throw Object.assign(new Error('Project not found'), { statusCode: 404 });
  return p;
}

const bad = (reply: FastifyReply, e: unknown, code = 400) => reply.code((e as any)?.statusCode ?? code).send({ error: (e as Error).message ?? String(e) });

export function workspaceRoutes(app: FastifyInstance) {
  // ---------- files ----------
  app.get('/api/projects/:id/files', async (req, reply) => {
    try {
      const p = project((req.params as any).id);
      const abs = resolveInProject(p.path, (req.query as any).path || '.');
      const entries = fs
        .readdirSync(abs, { withFileTypes: true })
        .filter((e) => e.name !== '.git')
        .map((e) => ({ name: e.name, path: relPath(p.path, path.join(abs, e.name)), dir: e.isDirectory(), ignored: IGNORED_DIRS.includes(e.name) }))
        .sort((a, b) => Number(b.dir) - Number(a.dir) || a.name.localeCompare(b.name));
      return entries;
    } catch (e) {
      return bad(reply, e);
    }
  });

  app.get('/api/projects/:id/file', async (req, reply) => {
    try {
      const p = project((req.params as any).id);
      const abs = resolveInProject(p.path, (req.query as any).path);
      const st = fs.statSync(abs);
      if (st.size > 5_000_000) return reply.code(413).send({ error: 'File too large to open (>5MB)' });
      const buf = fs.readFileSync(abs);
      const binary = buf.subarray(0, 8000).includes(0);
      return { path: relPath(p.path, abs), content: binary ? '' : buf.toString('utf8'), binary, size: st.size, mtime: st.mtimeMs };
    } catch (e) {
      return bad(reply, e);
    }
  });

  app.put('/api/projects/:id/file', async (req, reply) => {
    try {
      const p = project((req.params as any).id);
      const b = req.body as { path: string; content: string };
      const abs = resolveInProject(p.path, b.path);
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, b.content, 'utf8');
      return { ok: true };
    } catch (e) {
      return bad(reply, e);
    }
  });

  // ---------- git ----------
  app.get('/api/projects/:id/git/status', async (req) => {
    const p = project((req.params as any).id);
    const st = await G.status(p.path);
    return { ...st, remote: st.isRepo ? await G.remoteUrl(p.path) : null, github: G.parseGithubRemote(st.isRepo ? await G.remoteUrl(p.path) : null) };
  });
  app.get('/api/projects/:id/git/diff', async (req) => {
    const p = project((req.params as any).id);
    const q = req.query as any;
    return { diff: await G.diff(p.path, { path: q.path, staged: q.staged === '1' }) };
  });
  app.get('/api/projects/:id/git/log', async (req) => G.log(project((req.params as any).id).path, 40));
  app.get('/api/projects/:id/git/branches', async (req) => G.branches(project((req.params as any).id).path));
  app.post('/api/projects/:id/git/init', async (req) => {
    const r = await G.initRepo(project((req.params as any).id).path);
    return { ok: r.code === 0, output: r.stdout + r.stderr };
  });
  app.post('/api/projects/:id/git/commit', async (req, reply) => {
    const b = req.body as { message: string; paths?: string[] };
    if (!b.message?.trim()) return reply.code(400).send({ error: 'Commit message required' });
    const r = await G.commit(project((req.params as any).id).path, b.message, b.paths);
    return r.code === 0 ? { ok: true, output: r.stdout } : reply.code(400).send({ error: r.stderr || r.stdout });
  });
  app.post('/api/projects/:id/git/checkout', async (req, reply) => {
    const b = req.body as { branch: string; create?: boolean };
    const r = await G.git(project((req.params as any).id).path, b.create ? ['checkout', '-b', b.branch] : ['checkout', b.branch]);
    return r.code === 0 ? { ok: true } : reply.code(400).send({ error: r.stderr || r.stdout });
  });
  app.post('/api/projects/:id/git/push', async (req, reply) => {
    const r = await G.push(project((req.params as any).id).path);
    return r.code === 0 ? { ok: true, output: r.stdout + r.stderr } : reply.code(400).send({ error: r.stderr || r.stdout });
  });
  app.post('/api/projects/:id/git/discard', async (req, reply) => {
    const p = project((req.params as any).id);
    const b = req.body as { path: string };
    const rel = relPath(p.path, resolveInProject(p.path, b.path));
    const st = await G.status(p.path);
    const f = st.files.find((x) => x.path === rel);
    if (f?.status === 'untracked') fs.rmSync(path.join(p.path, rel), { force: true });
    else {
      const r = await G.git(p.path, ['checkout', 'HEAD', '--', rel]);
      if (r.code !== 0) return reply.code(400).send({ error: r.stderr });
    }
    return { ok: true };
  });

  /** Ask the model for a commit message (or PR description) based on the diff, then polish with LanguageTool. */
  app.post('/api/projects/:id/git/generate', async (req, reply) => {
    const p = project((req.params as any).id);
    const kind = ((req.body as any)?.kind ?? 'commit') as 'commit' | 'pr';
    const d = await G.diff(p.path);
    const logs = kind === 'pr' ? (await G.log(p.path, 15)).map((c) => `- ${c.subject}`).join('\n') : '';
    if (!d.trim() && kind === 'commit') return reply.code(400).send({ error: 'No changes to describe' });
    const s = getSettings();
    const system =
      kind === 'commit'
        ? 'Write a git commit message for the diff. Conventional Commits style: "type(scope): summary" (imperative, <= 72 chars), then a blank line and 1-5 short bullet points explaining what and why. Output only the message.'
        : 'Write a GitHub pull request title and description for these changes. First line: the title. Then a blank line and a Markdown body with "## Summary" (bullets) and "## Testing" sections. Output only that.';
    try {
      const r = await chatOnce(s.model, [{ role: 'system', content: system }, { role: 'user', content: truncateMiddle(`${logs ? 'Recent commits:\n' + logs + '\n\n' : ''}Diff:\n${d}`, 40_000).text }], { maxTokens: 600 });
      let text = r.content.replace(/^```\w*\n?|```$/g, '').trim();
      let issues = 0;
      try {
        const { languageToolCheck, applyLanguageToolFixes } = await import('../tools/web.ts');
        const lt = await languageToolCheck(text, 'en-US');
        // Spelling rules mangle identifiers, scopes and file names, so only grammar fixes away from code-ish tokens are applied.
        const safe = lt.matches.filter(
          (m: any) =>
            m.categoryId !== 'TYPOS' &&
            m.categoryId !== 'TYPOGRAPHY' &&
            m.rule !== 'UPPERCASE_SENTENCE_START' &&
            !/[`_()/:.]/.test(text.slice(Math.max(0, m.offset - 1), m.offset + m.length + 1).replace(/\.$/, '')),
        );
        issues = safe.length;
        text = applyLanguageToolFixes(text, safe);
      } catch {}
      return { text, languageToolFixes: issues };
    } catch (e) {
      return bad(reply, e, 502);
    }
  });

  // ---------- GitHub ----------
  app.get('/api/github/me', async (_req, reply) => {
    try {
      return await GH.whoami();
    } catch (e) {
      return bad(reply, e);
    }
  });
  app.get('/api/github/repos', async (req, reply) => {
    try {
      return await GH.listRepos((req.query as any).q);
    } catch (e) {
      return bad(reply, e);
    }
  });
  app.get('/api/projects/:id/github/pulls', async (req, reply) => {
    try {
      return await GH.listPulls(project((req.params as any).id).path, undefined, ((req.query as any).state ?? 'open') as any);
    } catch (e) {
      return bad(reply, e);
    }
  });
  app.post('/api/projects/:id/github/pulls', async (req, reply) => {
    try {
      const p = project((req.params as any).id);
      const b = req.body as { title: string; body?: string; base?: string; draft?: boolean };
      const head = (await G.git(p.path, ['rev-parse', '--abbrev-ref', 'HEAD'])).stdout.trim();
      const pushed = await G.push(p.path, head);
      if (pushed.code !== 0) throw new Error(`git push failed: ${pushed.stderr}`);
      return await GH.createPull(p.path, { ...b, head });
    } catch (e) {
      return bad(reply, e);
    }
  });
  app.get('/api/projects/:id/github/issues', async (req, reply) => {
    try {
      return await GH.listIssues(project((req.params as any).id).path);
    } catch (e) {
      return bad(reply, e);
    }
  });

  // ---------- terminal (non-PTY command runner) ----------
  app.post('/api/projects/:id/terminal', async (req, reply) => {
    const p = project((req.params as any).id);
    const b = req.body as { command: string; cwd?: string; background?: boolean };
    const why = deniedReason(b.command ?? '');
    if (why) return reply.code(400).send({ error: `Blocked by denylist: ${why}` });
    let cwd: string;
    try {
      cwd = resolveInProject(p.path, b.cwd || '.');
    } catch (e) {
      return bad(reply, e);
    }
    if (b.background) {
      const bg = startBackground(b.command, cwd, p.id);
      return { id: bg.id };
    }
    reply.raw.writeHead(200, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-cache', 'x-accel-buffering': 'no' });
    const ac = new AbortController();
    req.raw.on('close', () => ac.abort());
    const r = await execCommand(b.command, { cwd, timeoutMs: 30 * 60_000, signal: ac.signal, onData: (s) => reply.raw.write(s) });
    reply.raw.end(`\n[exit code ${r.exitCode}${r.timedOut ? ', timed out' : ''} in ${(r.durationMs / 1000).toFixed(1)}s]\n`);
    return reply;
  });
  app.get('/api/projects/:id/processes', async (req) => {
    const pid = (req.params as any).id;
    return [...background.values()]
      .filter((b) => b.projectId === pid)
      .map((b) => ({ id: b.id, command: b.command, running: b.running, exitCode: b.exitCode, startedAt: b.startedAt }));
  });
  app.get('/api/processes/:id/output', async (req, reply) => {
    const bg = background.get((req.params as any).id);
    if (!bg) return reply.code(404).send({ error: 'not found' });
    return { output: truncateMiddle(bg.output, 100_000).text, running: bg.running, exitCode: bg.exitCode };
  });
  app.post('/api/processes/:id/kill', async (req) => ({ ok: stopBackground((req.params as any).id) }));

  // ---------- browser ----------
  app.get('/api/browser/info', async () => B.browserInfo());
  app.get('/api/browser/screenshot', async (_req, reply) => {
    try {
      const img = await B.screenshot(70);
      return reply.header('content-type', 'image/jpeg').header('cache-control', 'no-store').send(img);
    } catch (e) {
      return bad(reply, e, 500);
    }
  });
  const act = (fn: (b: any) => Promise<unknown>) => async (req: any, reply: FastifyReply) => {
    try {
      const r = await fn(req.body ?? {});
      return { ok: true, result: r ?? null, info: B.browserInfo() };
    } catch (e) {
      return bad(reply, e, 500);
    }
  };
  app.post('/api/browser/navigate', act((b) => B.navigate(b.url)));
  app.post('/api/browser/click', act((b) => B.clickAt(Number(b.x), Number(b.y))));
  app.post('/api/browser/type', act((b) => B.typeText(String(b.text ?? ''))));
  app.post('/api/browser/key', act((b) => B.pressKey(String(b.key))));
  app.post('/api/browser/scroll', act((b) => B.scroll(Number(b.dy) || 400)));
  app.post('/api/browser/history', act((b) => B.history(b.dir)));
  app.post('/api/browser/close', act(() => B.closeBrowser()));
}
