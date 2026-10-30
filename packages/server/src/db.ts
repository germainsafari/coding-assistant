// Persistence layer on Node's built-in SQLite (node:sqlite, includes FTS5).
import { DatabaseSync } from 'node:sqlite';
import type { ChatMessage, Project, RunOptions, RunRecord, SpanRecord, Thread, TodoItem } from '@hearth/shared';
import { DB_PATH } from './config.ts';
import { newId, now } from './util.ts';

export const db = new DatabaseSync(process.env.HEARTH_DB_PATH || DB_PATH);
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');

db.exec(`
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, path TEXT NOT NULL UNIQUE, created_at INTEGER NOT NULL,
  hidden INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS threads (
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
  parent_thread_id TEXT, hidden INTEGER NOT NULL DEFAULT 0,
  summary TEXT, summary_upto INTEGER NOT NULL DEFAULT 0, todos TEXT
);
CREATE TABLE IF NOT EXISTS messages (
  seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE,
  thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
  role TEXT NOT NULL, content TEXT NOT NULL, reasoning TEXT, tool_calls TEXT,
  tool_call_id TEXT, name TEXT, meta TEXT, run_id TEXT, created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_messages_thread ON messages(thread_id, seq);
CREATE TABLE IF NOT EXISTS runs (
  id TEXT PRIMARY KEY, thread_id TEXT NOT NULL, project_id TEXT NOT NULL, parent_run_id TEXT,
  status TEXT NOT NULL, started_at INTEGER NOT NULL, ended_at INTEGER, model TEXT NOT NULL,
  steps INTEGER NOT NULL DEFAULT 0, prompt_tokens INTEGER NOT NULL DEFAULT 0,
  completion_tokens INTEGER NOT NULL DEFAULT 0, user_message TEXT NOT NULL, error TEXT,
  source TEXT NOT NULL DEFAULT 'ui'
);
CREATE INDEX IF NOT EXISTS idx_runs_started ON runs(started_at DESC);
CREATE TABLE IF NOT EXISTS spans (
  id TEXT PRIMARY KEY, run_id TEXT NOT NULL, parent_id TEXT, kind TEXT NOT NULL, name TEXT NOT NULL,
  started_at INTEGER NOT NULL, ended_at INTEGER, duration_ms INTEGER, status TEXT NOT NULL,
  input TEXT, output TEXT, prompt_tokens INTEGER, completion_tokens INTEGER, ttft_ms INTEGER,
  tokens_per_sec REAL, error TEXT
);
CREATE INDEX IF NOT EXISTS idx_spans_run ON spans(run_id, started_at);
CREATE TABLE IF NOT EXISTS memories (
  id INTEGER PRIMARY KEY AUTOINCREMENT, project_id TEXT, content TEXT NOT NULL, tags TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);
CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(content, tags, content='memories', content_rowid='id');
CREATE TRIGGER IF NOT EXISTS memories_ai AFTER INSERT ON memories BEGIN
  INSERT INTO memories_fts(rowid, content, tags) VALUES (new.id, new.content, new.tags);
END;
CREATE TRIGGER IF NOT EXISTS memories_ad AFTER DELETE ON memories BEGIN
  INSERT INTO memories_fts(memories_fts, rowid, content, tags) VALUES ('delete', old.id, old.content, old.tags);
END;
`);

// additive migrations for databases created by older versions
for (const sql of ['ALTER TABLE runs ADD COLUMN options TEXT']) {
  try {
    db.exec(sql);
  } catch {}
}

/**
 * Any run still "running" when the server starts was interrupted (crash / restart).
 * Returns the interrupted top-level runs so long-run ones can be resumed.
 */
export function markInterruptedRuns(): RunRecord[] {
  const rows = db.prepare(`SELECT * FROM runs WHERE status='running'`).all().map(rowToRun);
  db.prepare(`UPDATE runs SET status='interrupted', error='interrupted (server stopped while running)', ended_at=? WHERE status='running'`).run(now());
  return rows.filter((r) => !r.parentRunId);
}

const j = (v: unknown) => (v === undefined || v === null ? null : JSON.stringify(v));
const pj = (v: unknown) => (typeof v === 'string' && v ? JSON.parse(v) : null);

// ---------- projects ----------
const rowToProject = (r: any): Project => ({ id: r.id, name: r.name, path: r.path, createdAt: r.created_at });

export const projects = {
  list(): Project[] {
    return db.prepare('SELECT * FROM projects WHERE hidden=0 ORDER BY created_at DESC').all().map(rowToProject);
  },
  get(id: string): Project | undefined {
    const r = db.prepare('SELECT * FROM projects WHERE id=?').get(id);
    return r ? rowToProject(r) : undefined;
  },
  byPath(p: string): Project | undefined {
    const r = db.prepare('SELECT * FROM projects WHERE lower(path)=lower(?)').get(p);
    return r ? rowToProject(r) : undefined;
  },
  create(name: string, p: string, hidden = false): Project {
    const id = newId('p_');
    db.prepare('INSERT INTO projects (id,name,path,created_at,hidden) VALUES (?,?,?,?,?)').run(id, name, p, now(), hidden ? 1 : 0);
    return projects.get(id)!;
  },
  delete(id: string) {
    db.prepare('DELETE FROM projects WHERE id=?').run(id);
  },
};

// ---------- threads ----------
const rowToThread = (r: any): Thread => ({
  id: r.id,
  projectId: r.project_id,
  title: r.title,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
  parentThreadId: r.parent_thread_id,
});

export const threads = {
  list(projectId: string): Thread[] {
    return db
      .prepare('SELECT * FROM threads WHERE project_id=? AND hidden=0 ORDER BY updated_at DESC')
      .all(projectId)
      .map(rowToThread);
  },
  get(id: string): Thread | undefined {
    const r = db.prepare('SELECT * FROM threads WHERE id=?').get(id);
    return r ? rowToThread(r) : undefined;
  },
  create(projectId: string, title = 'New thread', opts: { parentThreadId?: string; hidden?: boolean } = {}): Thread {
    const id = newId('t_');
    const t = now();
    db.prepare(
      'INSERT INTO threads (id,project_id,title,created_at,updated_at,parent_thread_id,hidden) VALUES (?,?,?,?,?,?,?)',
    ).run(id, projectId, title, t, t, opts.parentThreadId ?? null, opts.hidden ? 1 : 0);
    return threads.get(id)!;
  },
  rename(id: string, title: string) {
    db.prepare('UPDATE threads SET title=?, updated_at=? WHERE id=?').run(title, now(), id);
  },
  touch(id: string) {
    db.prepare('UPDATE threads SET updated_at=? WHERE id=?').run(now(), id);
  },
  delete(id: string) {
    db.prepare('DELETE FROM threads WHERE id=?').run(id);
  },
  getSummary(id: string): { summary: string | null; upto: number } {
    const r: any = db.prepare('SELECT summary, summary_upto FROM threads WHERE id=?').get(id);
    return { summary: r?.summary ?? null, upto: r?.summary_upto ?? 0 };
  },
  setSummary(id: string, summary: string, upto: number) {
    db.prepare('UPDATE threads SET summary=?, summary_upto=? WHERE id=?').run(summary, upto, id);
  },
  getTodos(id: string): TodoItem[] {
    const r: any = db.prepare('SELECT todos FROM threads WHERE id=?').get(id);
    return pj(r?.todos) ?? [];
  },
  setTodos(id: string, todos: TodoItem[]) {
    db.prepare('UPDATE threads SET todos=? WHERE id=?').run(JSON.stringify(todos), id);
  },
};

// ---------- messages ----------
export type StoredMessage = ChatMessage & { seq: number };
const rowToMessage = (r: any): StoredMessage => ({
  seq: r.seq,
  id: r.id,
  threadId: r.thread_id,
  role: r.role,
  content: r.content,
  reasoning: r.reasoning,
  toolCalls: pj(r.tool_calls),
  toolCallId: r.tool_call_id,
  name: r.name,
  meta: pj(r.meta),
  runId: r.run_id,
  createdAt: r.created_at,
});

export const messages = {
  list(threadId: string, afterSeq = 0): StoredMessage[] {
    return db
      .prepare('SELECT * FROM messages WHERE thread_id=? AND seq>? ORDER BY seq')
      .all(threadId, afterSeq)
      .map(rowToMessage);
  },
  add(m: Omit<ChatMessage, 'id' | 'createdAt'> & { id?: string }): StoredMessage {
    const id = m.id ?? newId('m_');
    db.prepare(
      'INSERT INTO messages (id,thread_id,role,content,reasoning,tool_calls,tool_call_id,name,meta,run_id,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
    ).run(
      id,
      m.threadId,
      m.role,
      m.content,
      m.reasoning ?? null,
      j(m.toolCalls),
      m.toolCallId ?? null,
      m.name ?? null,
      j(m.meta),
      m.runId ?? null,
      now(),
    );
    threads.touch(m.threadId);
    return rowToMessage(db.prepare('SELECT * FROM messages WHERE id=?').get(id));
  },
  count(threadId: string): number {
    return (db.prepare('SELECT count(*) c FROM messages WHERE thread_id=?').get(threadId) as any).c;
  },
};

// ---------- runs & spans (observability) ----------
const rowToRun = (r: any): RunRecord => ({
  id: r.id,
  threadId: r.thread_id,
  projectId: r.project_id,
  parentRunId: r.parent_run_id,
  status: r.status,
  startedAt: r.started_at,
  endedAt: r.ended_at,
  model: r.model,
  steps: r.steps,
  promptTokens: r.prompt_tokens,
  completionTokens: r.completion_tokens,
  userMessage: r.user_message,
  error: r.error,
  source: r.source,
  options: pj(r.options),
});
const rowToSpan = (r: any): SpanRecord => ({
  id: r.id,
  runId: r.run_id,
  parentId: r.parent_id,
  kind: r.kind,
  name: r.name,
  startedAt: r.started_at,
  endedAt: r.ended_at,
  durationMs: r.duration_ms,
  status: r.status,
  input: r.input,
  output: r.output,
  promptTokens: r.prompt_tokens,
  completionTokens: r.completion_tokens,
  ttftMs: r.ttft_ms,
  tokensPerSec: r.tokens_per_sec,
  error: r.error,
});

export const runs = {
  create(r: { id: string; threadId: string; projectId: string; parentRunId?: string | null; model: string; userMessage: string; source: string; options?: RunOptions | null }) {
    db.prepare(
      'INSERT INTO runs (id,thread_id,project_id,parent_run_id,status,started_at,model,user_message,source,options) VALUES (?,?,?,?,?,?,?,?,?,?)',
    ).run(r.id, r.threadId, r.projectId, r.parentRunId ?? null, 'running', now(), r.model, r.userMessage, r.source, j(r.options));
  },
  lastForThread(threadId: string): RunRecord | undefined {
    const r = db.prepare('SELECT * FROM runs WHERE thread_id=? AND parent_run_id IS NULL ORDER BY started_at DESC LIMIT 1').get(threadId);
    return r ? rowToRun(r) : undefined;
  },
  update(id: string, f: Partial<{ status: string; steps: number; promptTokens: number; completionTokens: number; error: string | null; endedAt: number }>) {
    const cols: string[] = [];
    const vals: any[] = [];
    const map: Record<string, string> = {
      status: 'status',
      steps: 'steps',
      promptTokens: 'prompt_tokens',
      completionTokens: 'completion_tokens',
      error: 'error',
      endedAt: 'ended_at',
    };
    for (const [k, v] of Object.entries(f)) {
      if (v === undefined) continue;
      cols.push(`${map[k]}=?`);
      vals.push(v);
    }
    if (!cols.length) return;
    db.prepare(`UPDATE runs SET ${cols.join(',')} WHERE id=?`).run(...vals, id);
  },
  get(id: string): RunRecord | undefined {
    const r = db.prepare('SELECT * FROM runs WHERE id=?').get(id);
    return r ? rowToRun(r) : undefined;
  },
  list(opts: { limit?: number; projectId?: string; includeChildren?: boolean } = {}): RunRecord[] {
    const where: string[] = [];
    const vals: any[] = [];
    if (opts.projectId) {
      where.push('project_id=?');
      vals.push(opts.projectId);
    }
    if (!opts.includeChildren) where.push('parent_run_id IS NULL');
    const sql = `SELECT * FROM runs ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY started_at DESC LIMIT ?`;
    return db.prepare(sql).all(...vals, opts.limit ?? 100).map(rowToRun);
  },
  children(id: string): RunRecord[] {
    return db.prepare('SELECT * FROM runs WHERE parent_run_id=? ORDER BY started_at').all(id).map(rowToRun);
  },
};

export const spans = {
  start(s: { runId: string; parentId?: string | null; kind: SpanRecord['kind']; name: string; input?: string }): string {
    const id = newId('s_');
    db.prepare('INSERT INTO spans (id,run_id,parent_id,kind,name,started_at,status,input) VALUES (?,?,?,?,?,?,?,?)').run(
      id,
      s.runId,
      s.parentId ?? null,
      s.kind,
      s.name,
      now(),
      'running',
      s.input ?? null,
    );
    return id;
  },
  end(
    id: string,
    f: { status: SpanRecord['status']; output?: string; error?: string; promptTokens?: number; completionTokens?: number; ttftMs?: number; tokensPerSec?: number },
  ) {
    const s: any = db.prepare('SELECT started_at FROM spans WHERE id=?').get(id);
    const end = now();
    db.prepare(
      'UPDATE spans SET ended_at=?, duration_ms=?, status=?, output=?, error=?, prompt_tokens=?, completion_tokens=?, ttft_ms=?, tokens_per_sec=? WHERE id=?',
    ).run(
      end,
      s ? end - s.started_at : null,
      f.status,
      f.output ?? null,
      f.error ?? null,
      f.promptTokens ?? null,
      f.completionTokens ?? null,
      f.ttftMs ?? null,
      f.tokensPerSec ?? null,
      id,
    );
  },
  forRun(runId: string): SpanRecord[] {
    return db.prepare('SELECT * FROM spans WHERE run_id=? ORDER BY started_at').all(runId).map(rowToSpan);
  },
};

// ---------- long-term memory (FTS5) ----------
export interface MemoryRow {
  id: number;
  projectId: string | null;
  content: string;
  tags: string;
  createdAt: number;
}
const rowToMemory = (r: any): MemoryRow => ({ id: r.id, projectId: r.project_id, content: r.content, tags: r.tags, createdAt: r.created_at });

/** Turn free text into a safe FTS5 OR-query of quoted terms. */
export function ftsQuery(text: string): string | null {
  const terms = Array.from(new Set(text.toLowerCase().match(/[\p{L}\p{N}_]{3,}/gu) ?? [])).slice(0, 24);
  if (!terms.length) return null;
  return terms.map((t) => `"${t}"`).join(' OR ');
}

export const memories = {
  add(projectId: string | null, content: string, tags = ''): MemoryRow {
    const r = db.prepare('INSERT INTO memories (project_id, content, tags, created_at) VALUES (?,?,?,?)').run(projectId, content, tags, now());
    return rowToMemory(db.prepare('SELECT * FROM memories WHERE id=?').get(r.lastInsertRowid as number));
  },
  search(query: string, projectId: string | null, limit = 8): MemoryRow[] {
    const q = ftsQuery(query);
    if (!q) return [];
    return db
      .prepare(
        `SELECT m.* FROM memories_fts f JOIN memories m ON m.id = f.rowid
         WHERE memories_fts MATCH ? AND (m.project_id IS NULL OR m.project_id = ?)
         ORDER BY bm25(memories_fts) LIMIT ?`,
      )
      .all(q, projectId, limit)
      .map(rowToMemory);
  },
  list(projectId?: string | null, limit = 200): MemoryRow[] {
    if (projectId === undefined) return db.prepare('SELECT * FROM memories ORDER BY id DESC LIMIT ?').all(limit).map(rowToMemory);
    return db
      .prepare('SELECT * FROM memories WHERE project_id IS NULL OR project_id=? ORDER BY id DESC LIMIT ?')
      .all(projectId, limit)
      .map(rowToMemory);
  },
  delete(id: number) {
    db.prepare('DELETE FROM memories WHERE id=?').run(id);
  },
};
