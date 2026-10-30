import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { getSettings, publicSettings, updateSettings } from '../config.ts';
import { memories, messages, projects, threads } from '../db.ts';
import { probeCapabilities } from '../llm/client.ts';
import { activeByThread, activeRuns } from '../agent/runs.ts';
import { startRun } from '../agent/loop.ts';
import * as G from '../git.ts';
import { listSkills, loadSkill } from '../skills.ts';
import { mcpStatus, syncMcp } from '../mcp.ts';
import { languageToolCheck, applyLanguageToolFixes } from '../tools/web.ts';

export function coreRoutes(app: FastifyInstance) {
  app.get('/api/health', async () => ({ ok: true, name: 'hearth', version: '0.1.0', platform: process.platform }));

  app.get('/api/capabilities', async (req) => {
    const force = (req.query as any).force === '1';
    return probeCapabilities(getSettings().model, force);
  });

  app.get('/api/settings', async () => publicSettings());
  app.put('/api/settings', async (req) => {
    const patch: any = { ...(req.body as any) };
    delete patch.hasGithubToken;
    if (typeof patch.githubToken === 'string' && patch.githubToken.startsWith('••••')) delete patch.githubToken;
    updateSettings(patch);
    return publicSettings();
  });

  // ---------- projects ----------
  app.get('/api/projects', async () =>
    projects.list().map((p) => ({ ...p, exists: fs.existsSync(p.path) })),
  );

  app.post('/api/projects', async (req, reply) => {
    const b = req.body as { mode: 'open' | 'create' | 'clone'; path?: string; name?: string; url?: string };
    const s = getSettings();
    let dir: string;
    if (b.mode === 'open') {
      if (!b.path) return reply.code(400).send({ error: 'path is required' });
      dir = path.resolve(b.path.replace(/^~(?=$|[\\/])/, os.homedir()));
      if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) return reply.code(400).send({ error: `Folder not found: ${dir}` });
    } else if (b.mode === 'create') {
      const name = (b.name || '').trim();
      if (!name || /[<>:"|?*]/.test(name)) return reply.code(400).send({ error: 'A valid project name is required' });
      dir = b.path ? path.resolve(b.path) : path.join(s.projectsDir, name);
      fs.mkdirSync(dir, { recursive: true });
      if (!(await G.isRepo(dir))) await G.git(dir, ['init', '-b', 'main']);
    } else if (b.mode === 'clone') {
      if (!b.url) return reply.code(400).send({ error: 'url is required' });
      let url = b.url.trim();
      if (/^[\w.-]+\/[\w.-]+$/.test(url)) url = `https://github.com/${url}.git`;
      const name = b.name || url.split('/').pop()!.replace(/\.git$/, '');
      dir = b.path ? path.resolve(b.path) : path.join(s.projectsDir, name);
      if (fs.existsSync(dir) && fs.readdirSync(dir).length) return reply.code(400).send({ error: `Destination exists and is not empty: ${dir}` });
      fs.mkdirSync(path.dirname(dir), { recursive: true });
      const r = await G.clone(url, dir);
      if (r.code !== 0) return reply.code(400).send({ error: `git clone failed: ${r.stderr}` });
    } else return reply.code(400).send({ error: 'invalid mode' });
    const existing = projects.byPath(dir);
    if (existing) return existing;
    return projects.create(b.name?.trim() || path.basename(dir), dir);
  });

  app.delete('/api/projects/:id', async (req) => {
    projects.delete((req.params as any).id);
    return { ok: true };
  });

  // simple folder browser for the "open project" dialog
  app.get('/api/browse', async (req) => {
    const q = (req.query as any).path as string | undefined;
    const dir = path.resolve(q || os.homedir());
    let entries: { name: string; path: string }[] = [];
    try {
      entries = fs
        .readdirSync(dir, { withFileTypes: true })
        .filter((e) => e.isDirectory() && !e.name.startsWith('.') && e.name !== 'node_modules')
        .map((e) => ({ name: e.name, path: path.join(dir, e.name) }))
        .sort((a, b) => a.name.localeCompare(b.name));
    } catch {}
    const roots = process.platform === 'win32' ? ['C:\\', 'D:\\', 'E:\\'].filter((d) => fs.existsSync(d)) : ['/'];
    return { path: dir, parent: path.dirname(dir) !== dir ? path.dirname(dir) : null, entries, roots, home: os.homedir(), projectsDir: getSettings().projectsDir };
  });

  // ---------- threads ----------
  app.get('/api/projects/:id/threads', async (req) => {
    return threads.list((req.params as any).id).map((t) => ({ ...t, activeRunId: activeByThread.get(t.id) ?? null }));
  });
  app.post('/api/projects/:id/threads', async (req) => {
    const b = (req.body ?? {}) as { title?: string };
    return threads.create((req.params as any).id, b.title || 'New thread');
  });
  app.get('/api/threads/:id', async (req, reply) => {
    const id = (req.params as any).id;
    const t = threads.get(id);
    if (!t) return reply.code(404).send({ error: 'not found' });
    return {
      thread: { ...t, activeRunId: activeByThread.get(id) ?? null },
      messages: messages.list(id),
      todos: threads.getTodos(id),
      summary: threads.getSummary(id).summary,
    };
  });
  app.patch('/api/threads/:id', async (req) => {
    const b = req.body as { title?: string };
    if (b.title) threads.rename((req.params as any).id, b.title);
    return threads.get((req.params as any).id);
  });
  app.delete('/api/threads/:id', async (req) => {
    threads.delete((req.params as any).id);
    return { ok: true };
  });

  // ---------- runs ----------
  app.post('/api/threads/:id/runs', async (req, reply) => {
    const id = (req.params as any).id;
    const b = req.body as { message: string };
    if (!b?.message?.trim()) return reply.code(400).send({ error: 'message is required' });
    if (activeByThread.has(id)) return reply.code(409).send({ error: 'A run is already active in this thread', runId: activeByThread.get(id) });
    const h = startRun(id, b.message.trim());
    return { runId: h.id };
  });

  app.get('/api/runs/:id/events', async (req, reply) => {
    const h = activeRuns.get((req.params as any).id);
    if (!h) return reply.code(404).send({ error: 'run not active' });
    const after = Number((req.query as any).after ?? 0);
    reply.raw.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    });
    const send = (e: unknown) => reply.raw.write(`data: ${JSON.stringify(e)}\n\n`);
    for (const e of h.events) if (e.seq > after) send(e);
    // pending approvals/questions are part of the replay already
    if (h.status !== 'running') {
      reply.raw.end();
      return reply;
    }
    const off = h.subscribe((e) => {
      send(e);
      if (e.type === 'run_finished') {
        off();
        clearInterval(ping);
        reply.raw.end();
      }
    });
    const ping = setInterval(() => reply.raw.write(': ping\n\n'), 15000);
    req.raw.on('close', () => {
      off();
      clearInterval(ping);
    });
    return reply;
  });

  app.post('/api/runs/:id/cancel', async (req) => {
    const h = activeRuns.get((req.params as any).id);
    h?.abort.abort();
    return { ok: !!h };
  });
  app.post('/api/runs/:id/approvals/:callId', async (req, reply) => {
    const { id, callId } = req.params as any;
    const h = activeRuns.get(id);
    const b = req.body as { decision: 'approved' | 'denied'; feedback?: string; always?: boolean };
    if (!h || !h.resolveApproval(callId, b)) return reply.code(404).send({ error: 'no pending approval' });
    return { ok: true };
  });
  app.post('/api/runs/:id/answers/:callId', async (req, reply) => {
    const { id, callId } = req.params as any;
    const h = activeRuns.get(id);
    const b = req.body as { answer: string };
    if (!h || !h.answer(callId, b.answer)) return reply.code(404).send({ error: 'no pending question' });
    return { ok: true };
  });

  // ---------- skills / memory / mcp / languagetool ----------
  app.get('/api/skills', async (req) => {
    const pid = (req.query as any).projectId;
    const p = pid ? projects.get(pid) : undefined;
    return listSkills(p?.path);
  });
  app.get('/api/skills/:name', async (req, reply) => {
    const pid = (req.query as any).projectId;
    const p = pid ? projects.get(pid) : undefined;
    const s = loadSkill((req.params as any).name, p?.path);
    if (!s) return reply.code(404).send({ error: 'not found' });
    return s;
  });

  app.get('/api/memories', async (req) => {
    const { projectId, q } = req.query as any;
    return q ? memories.search(q, projectId ?? null, 50) : memories.list(projectId);
  });
  app.post('/api/memories', async (req) => {
    const b = req.body as { content: string; projectId?: string | null; tags?: string };
    return memories.add(b.projectId ?? null, b.content, b.tags ?? '');
  });
  app.delete('/api/memories/:id', async (req) => {
    memories.delete(Number((req.params as any).id));
    return { ok: true };
  });

  app.get('/api/mcp', async () => mcpStatus());
  app.post('/api/mcp/reload', async () => {
    await syncMcp(true);
    return mcpStatus();
  });

  app.post('/api/languagetool/check', async (req, reply) => {
    const b = req.body as { text: string; language?: string; apply?: boolean };
    try {
      const r = await languageToolCheck(b.text ?? '', b.language || 'auto');
      return { ...r, fixed: b.apply ? applyLanguageToolFixes(b.text, r.matches) : undefined };
    } catch (e) {
      return reply.code(502).send({ error: (e as Error).message });
    }
  });
}
