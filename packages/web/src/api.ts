// Thin typed client for the Hearth HTTP API (see packages/server/src/routes).
import type { AgentEvent, Capabilities, ChatMessage, EvalReport, Metrics, Project, RunRecord, Settings, SkillInfo, SpanRecord, Thread, TodoItem } from '@hearth/shared';

export type PublicSettings = Settings & { hasGithubToken: boolean };
export type ProjectInfo = Project & { exists: boolean };
export type ThreadInfo = Thread & { activeRunId: string | null };
export interface ThreadDetail {
  thread: ThreadInfo;
  messages: ChatMessage[];
  todos: TodoItem[];
  summary: string | null;
  lastRun: RunRecord | null;
}
export interface FileEntry {
  name: string;
  path: string;
  dir: boolean;
  ignored: boolean;
}
export interface GitStatus {
  isRepo: boolean;
  branch: string | null;
  ahead: number;
  behind: number;
  upstream: string | null;
  files: { path: string; index: string; worktree: string; status: string }[];
  remote: string | null;
  github: { owner: string; repo: string } | null;
}
export interface McpStatus {
  name: string;
  status: string;
  error?: string;
  transport: string;
  tools: { name: string; description: string }[];
}
export interface Memory {
  id: number;
  projectId: string | null;
  content: string;
  tags: string;
  createdAt: number;
}
export interface Trace {
  run: RunRecord;
  spans: SpanRecord[];
  children: { run: RunRecord; spans: SpanRecord[] }[];
}

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

async function req<T>(method: string, path: string, body?: unknown): Promise<T> {
  const r = await fetch(path, {
    method,
    headers: body !== undefined ? { 'content-type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!r.ok) throw new ApiError(data?.error ?? `HTTP ${r.status}`, r.status);
  return data as T;
}

const q = (o: Record<string, string | number | boolean | undefined | null>) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(o)) if (v !== undefined && v !== null && v !== '') p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : '';
};

export const api = {
  health: () => req<{ ok: boolean; platform: string }>('GET', '/api/health'),
  settings: () => req<PublicSettings>('GET', '/api/settings'),
  saveSettings: (patch: Partial<Settings>) => req<PublicSettings>('PUT', '/api/settings', patch),
  capabilities: (profileId?: string, force = false) => req<Capabilities>('GET', `/api/capabilities${q({ profileId, force: force ? 1 : undefined })}`),

  projects: () => req<ProjectInfo[]>('GET', '/api/projects'),
  addProject: (b: { mode: 'open' | 'create' | 'clone'; path?: string; name?: string; url?: string }) => req<Project>('POST', '/api/projects', b),
  removeProject: (id: string) => req('DELETE', `/api/projects/${id}`),
  browse: (path?: string) =>
    req<{ path: string; parent: string | null; entries: { name: string; path: string }[]; roots: string[]; home: string; projectsDir: string }>('GET', `/api/browse${q({ path })}`),

  threads: (projectId: string) => req<ThreadInfo[]>('GET', `/api/projects/${projectId}/threads`),
  createThread: (projectId: string, title?: string) => req<Thread>('POST', `/api/projects/${projectId}/threads`, { title }),
  thread: (id: string) => req<ThreadDetail>('GET', `/api/threads/${id}`),
  renameThread: (id: string, title: string) => req('PATCH', `/api/threads/${id}`, { title }),
  deleteThread: (id: string) => req('DELETE', `/api/threads/${id}`),

  startRun: (threadId: string, b: { message: string; profileId?: string; longRun?: { enabled: boolean; doneCommand?: string; maxMinutes?: number } }) =>
    req<{ runId: string }>('POST', `/api/threads/${threadId}/runs`, b),
  resume: (threadId: string) => req<{ runId: string }>('POST', `/api/threads/${threadId}/resume`),
  cancelRun: (runId: string) => req('POST', `/api/runs/${runId}/cancel`),
  approve: (runId: string, callId: string, b: { decision: 'approved' | 'denied'; feedback?: string; always?: boolean }) => req('POST', `/api/runs/${runId}/approvals/${callId}`, b),
  answer: (runId: string, callId: string, answer: string) => req('POST', `/api/runs/${runId}/answers/${callId}`, { answer }),

  files: (projectId: string, path = '.') => req<FileEntry[]>('GET', `/api/projects/${projectId}/files${q({ path })}`),
  file: (projectId: string, path: string) => req<{ path: string; content: string; binary: boolean; size: number; mtime: number }>('GET', `/api/projects/${projectId}/file${q({ path })}`),
  saveFile: (projectId: string, path: string, content: string) => req('PUT', `/api/projects/${projectId}/file`, { path, content }),

  gitStatus: (pid: string) => req<GitStatus>('GET', `/api/projects/${pid}/git/status`),
  gitDiff: (pid: string, path?: string) => req<{ diff: string }>('GET', `/api/projects/${pid}/git/diff${q({ path })}`),
  gitLog: (pid: string) => req<{ hash: string; short: string; author: string; date: string; subject: string }[]>('GET', `/api/projects/${pid}/git/log`),
  gitBranches: (pid: string) => req<{ name: string; current: boolean; remote: boolean }[]>('GET', `/api/projects/${pid}/git/branches`),
  gitInit: (pid: string) => req('POST', `/api/projects/${pid}/git/init`),
  gitCommit: (pid: string, message: string) => req<{ ok: boolean; output: string }>('POST', `/api/projects/${pid}/git/commit`, { message }),
  gitCheckout: (pid: string, branch: string, create = false) => req('POST', `/api/projects/${pid}/git/checkout`, { branch, create }),
  gitPush: (pid: string) => req<{ ok: boolean; output: string }>('POST', `/api/projects/${pid}/git/push`),
  gitDiscard: (pid: string, path: string) => req('POST', `/api/projects/${pid}/git/discard`, { path }),
  gitGenerate: (pid: string, kind: 'commit' | 'pr') => req<{ text: string; languageToolFixes: number }>('POST', `/api/projects/${pid}/git/generate`, { kind }),

  githubMe: () => req<{ login: string; name: string; avatarUrl: string }>('GET', '/api/github/me'),
  githubRepos: (query?: string) => req<{ fullName: string; private: boolean; description: string | null; cloneUrl: string }[]>('GET', `/api/github/repos${q({ q: query })}`),
  pulls: (pid: string) => req<{ number: number; title: string; state: string; user?: string; url: string; head: string; base: string; draft?: boolean }[]>('GET', `/api/projects/${pid}/github/pulls`),
  createPull: (pid: string, b: { title: string; body?: string; base?: string; draft?: boolean }) => req<{ number: number; url: string }>('POST', `/api/projects/${pid}/github/pulls`, b),

  processes: (pid: string) => req<{ id: string; command: string; running: boolean; exitCode: number | null; startedAt: number }[]>('GET', `/api/projects/${pid}/processes`),
  processOutput: (id: string) => req<{ output: string; running: boolean; exitCode: number | null }>('GET', `/api/processes/${id}/output`),
  killProcess: (id: string) => req('POST', `/api/processes/${id}/kill`),
  startBackground: (pid: string, command: string) => req<{ id: string }>('POST', `/api/projects/${pid}/terminal`, { command, background: true }),

  browserInfo: () => req<{ running: boolean; engine: string; url: string | null; viewport: { width: number; height: number }; version: number }>('GET', '/api/browser/info'),
  browserAct: (action: 'navigate' | 'click' | 'type' | 'key' | 'scroll' | 'history' | 'close', body: Record<string, unknown> = {}) =>
    req<{ ok: boolean; info: { url: string | null; version: number } }>('POST', `/api/browser/${action}`, body),

  runs: (projectId?: string) => req<RunRecord[]>('GET', `/api/runs${q({ projectId, limit: 100 })}`),
  trace: (runId: string) => req<Trace>('GET', `/api/runs/${runId}/trace`),
  metrics: (hours = 168) => req<Metrics>('GET', `/api/metrics${q({ hours })}`),

  evalTasks: () => req<{ id: string; title: string; prompt: string; check: string; tags?: string[] }[]>('GET', '/api/evals/tasks'),
  evalReports: () => req<EvalReport[]>('GET', '/api/evals/reports'),
  evalStatus: () => req<{ running: boolean; reportId?: string; current?: string; done: number; total: number; results: EvalReport['results'] }>('GET', '/api/evals/status'),
  runEvals: (b: { taskIds?: string[]; profileId?: string }) => req('POST', '/api/evals/run', b),
  evalMarkdown: async (id: string) => (await fetch(`/api/evals/reports/${encodeURIComponent(id)}/markdown`)).text(),

  skills: (projectId?: string) => req<SkillInfo[]>('GET', `/api/skills${q({ projectId })}`),
  skill: (name: string, projectId?: string) => req<{ info: SkillInfo; body: string; files: string[] }>('GET', `/api/skills/${encodeURIComponent(name)}${q({ projectId })}`),
  memories: (projectId?: string, query?: string) => req<Memory[]>('GET', `/api/memories${q({ projectId, q: query })}`),
  addMemory: (content: string, projectId?: string | null, tags?: string) => req<Memory>('POST', '/api/memories', { content, projectId, tags }),
  deleteMemory: (id: number) => req('DELETE', `/api/memories/${id}`),
  mcp: () => req<McpStatus[]>('GET', '/api/mcp'),
  reloadMcp: () => req<McpStatus[]>('POST', '/api/mcp/reload'),
  languageTool: (text: string) => req<{ language: string; matches: unknown[] }>('POST', '/api/languagetool/check', { text }),
};

/**
 * Subscribe to a run's event stream (Server-Sent Events over fetch, so we control
 * reconnects). The server replays all buffered events first, so the consumer must
 * be idempotent (it is: messages are de-duplicated by id).
 */
export function subscribeRun(runId: string, onEvent: (e: AgentEvent) => void, onEnd: (reason: 'finished' | 'gone' | 'error') => void): () => void {
  const ac = new AbortController();
  let finished = false;
  (async () => {
    try {
      const r = await fetch(`/api/runs/${runId}/events`, { signal: ac.signal });
      if (r.status === 404) return onEnd('gone');
      if (!r.ok || !r.body) return onEnd('error');
      const reader = r.body.getReader();
      const dec = new TextDecoder();
      let buf = '';
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let i: number;
        while ((i = buf.indexOf('\n\n')) !== -1) {
          const chunk = buf.slice(0, i);
          buf = buf.slice(i + 2);
          for (const line of chunk.split('\n')) {
            if (!line.startsWith('data:')) continue;
            const e = JSON.parse(line.slice(5)) as AgentEvent;
            if (e.type === 'run_finished') finished = true;
            onEvent(e);
          }
        }
      }
      onEnd(finished ? 'finished' : 'error');
    } catch {
      if (!ac.signal.aborted) onEnd('error');
    }
  })();
  return () => ac.abort();
}
