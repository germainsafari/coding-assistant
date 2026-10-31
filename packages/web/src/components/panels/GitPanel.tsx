import { useCallback, useEffect, useState } from 'react';
import { ExternalLink, GitBranch, GitCommitHorizontal, GitPullRequest, RefreshCw, Sparkles, Undo2, Upload } from 'lucide-react';
import { api, type GitStatus } from '../../api';
import { errText, useStore } from '../../store';
import { DiffView } from '../Markdown';
import { Badge, Button, cx, Empty, IconButton, relTime, Skeleton, Spinner, Tabs, type Tone } from '../ui';

const statusStyle: Record<string, { tone: Tone; letter: string }> = {
  added: { tone: 'ok', letter: 'A' },
  untracked: { tone: 'ok', letter: 'U' },
  deleted: { tone: 'danger', letter: 'D' },
  modified: { tone: 'warn', letter: 'M' },
  renamed: { tone: 'info', letter: 'R' },
};
const letterCls: Record<Tone, string> = { ok: 'text-ok-ink', danger: 'text-danger-ink', warn: 'text-warn-ink', info: 'text-info-ink', neutral: 'text-fg-subtle', accent: 'text-accent-ink', violet: 'text-violet' };

export function GitPanel({ projectId }: { projectId: string }) {
  const fsVersion = useStore((s) => s.fsVersion);
  const notify = useStore((s) => s.notify);
  const settings = useStore((s) => s.settings);
  const openModal = useStore((s) => s.openModal);
  const [st, setSt] = useState<GitStatus | null>(null);
  const [tab, setTab] = useState<'changes' | 'history' | 'prs'>('changes');
  const [selected, setSelected] = useState<string | null>(null);
  const [diff, setDiff] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [branches, setBranches] = useState<{ name: string; current: boolean; remote: boolean }[]>([]);
  const [log, setLog] = useState<Awaited<ReturnType<typeof api.gitLog>>>([]);

  const refresh = useCallback(async () => {
    try {
      const s = await api.gitStatus(projectId);
      setSt(s);
      if (s.isRepo) {
        const [b, l] = await Promise.all([api.gitBranches(projectId), api.gitLog(projectId)]);
        setBranches(b);
        setLog(l);
      }
    } catch (e) {
      notify(errText(e), 'error');
    }
  }, [projectId, notify]);

  useEffect(() => {
    setSelected(null);
    setDiff('');
    void refresh();
  }, [refresh, fsVersion]);

  useEffect(() => {
    if (!st?.isRepo) return;
    api.gitDiff(projectId, selected ?? undefined).then(
      (d) => setDiff(d.diff),
      () => setDiff(''),
    );
  }, [projectId, selected, st]);

  const act = async (name: string, fn: () => Promise<unknown>, ok?: string) => {
    setBusy(name);
    try {
      await fn();
      if (ok) notify(ok, 'success');
      await refresh();
    } catch (e) {
      notify(errText(e), 'error');
    } finally {
      setBusy(null);
    }
  };

  if (!st)
    return (
      <div className="space-y-3 p-4">
        <Skeleton className="h-7 w-1/2" />
        <Skeleton className="h-4" />
        <Skeleton className="h-4 w-4/5" />
        <Skeleton className="h-24" />
      </div>
    );
  if (!st.isRepo)
    return (
      <Empty icon={<GitBranch />} title="Not a Git repository" action={<Button onClick={() => act('init', () => api.gitInit(projectId), 'Initialized Git repository')}>Initialize repository</Button>}>
        Track the agent's changes, review diffs and commit with AI-written messages.
      </Empty>
    );

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-line px-3 py-2">
        <label className="relative flex min-w-0 items-center">
          <GitBranch className="pointer-events-none absolute left-2.5 h-3.5 w-3.5 text-fg-subtle" />
          <select
            aria-label="Branch"
            className="h-7 max-w-48 py-0 pl-8 text-xs font-medium"
            value={st.branch ?? ''}
            onChange={(e) => {
              const v = e.target.value;
              if (v === '__new__') {
                const name = prompt('New branch name');
                if (name) void act('checkout', () => api.gitCheckout(projectId, name, true), `Switched to new branch ${name}`);
              } else void act('checkout', () => api.gitCheckout(projectId, v), `Switched to ${v}`);
            }}
          >
            {st.branch && !branches.some((b) => b.name === st.branch) && <option value={st.branch}>{st.branch}</option>}
            {branches
              .filter((b) => !b.remote)
              .map((b) => (
                <option key={b.name} value={b.name}>
                  {b.name}
                </option>
              ))}
            <option value="__new__">+ New branch…</option>
          </select>
        </label>
        {st.upstream && (
          <span className="font-mono text-[11px] text-fg-subtle tabular-nums" title={`Tracking ${st.upstream}`}>
            ↑{st.ahead} ↓{st.behind}
          </span>
        )}
        <div className="flex-1" />
        <Button size="sm" disabled={!!busy || !st.remote} title={st.remote ? `Push to ${st.remote}` : 'No "origin" remote'} onClick={() => act('push', () => api.gitPush(projectId), 'Pushed')}>
          {busy === 'push' ? <Spinner className="h-3 w-3" /> : <Upload className="h-3.5 w-3.5" />} Push
        </Button>
        <IconButton label="Refresh" onClick={refresh}>
          <RefreshCw className="h-3.5 w-3.5" />
        </IconButton>
      </div>
      <div className="shrink-0 border-b border-line px-3">
        <Tabs
          variant="underline"
          value={tab}
          onChange={setTab}
          label="Git views"
          tabs={[
            {
              id: 'changes',
              label: (
                <>
                  Changes {st.files.length > 0 && <Badge tone="accent">{st.files.length}</Badge>}
                </>
              ),
            },
            { id: 'history', label: 'History' },
            {
              id: 'prs',
              label: (
                <>
                  <GitPullRequest className="h-3.5 w-3.5" /> Pull requests
                </>
              ),
            },
          ]}
        />
      </div>
      {tab === 'changes' && (
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="max-h-48 shrink-0 overflow-auto border-b border-line py-1">
            {st.files.length === 0 && <div className="px-3 py-3 text-xs text-fg-subtle">Working tree clean. Nothing to commit.</div>}
            {st.files.map((f) => {
              const s = statusStyle[f.status] ?? { tone: 'neutral' as Tone, letter: f.status[0]?.toUpperCase() ?? '?' };
              const name = f.path.split('/').pop();
              const dir = f.path.slice(0, f.path.length - (name?.length ?? 0));
              return (
                <div
                  key={f.path}
                  role="button"
                  tabIndex={0}
                  aria-pressed={selected === f.path}
                  className={cx('group mx-1.5 flex h-7 cursor-pointer items-center gap-2 rounded-md px-2 text-[13px] transition-colors', selected === f.path ? 'bg-raised text-fg' : 'text-fg-muted hover:bg-raised/60')}
                  onClick={() => setSelected(selected === f.path ? null : f.path)}
                  onKeyDown={(e) => e.key === 'Enter' && setSelected(selected === f.path ? null : f.path)}
                  title={`${f.status}: ${f.path}`}
                >
                  <span className={cx('w-3 shrink-0 text-center font-mono text-[11px] font-semibold', letterCls[s.tone])}>{s.letter}</span>
                  <span className="min-w-0 flex-1 truncate">
                    <span className="text-fg">{name}</span> <span className="text-xs text-fg-subtle">{dir}</span>
                  </span>
                  <IconButton
                    label="Discard changes"
                    size="sm"
                    className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (confirm(`Discard all changes to ${f.path}?`)) void act('discard', () => api.gitDiscard(projectId, f.path));
                    }}
                  >
                    <Undo2 className="h-3.5 w-3.5" />
                  </IconButton>
                </div>
              );
            })}
          </div>
          <div className="shrink-0 space-y-2 border-b border-line p-3">
            <textarea className="h-[72px] w-full resize-none font-mono text-xs leading-relaxed" placeholder="Commit message" aria-label="Commit message" value={msg} onChange={(e) => setMsg(e.target.value)} />
            <div className="flex gap-2">
              <Button
                size="sm"
                disabled={!!busy || !st.files.length}
                title="Write a commit message with the local model, then grammar-check it with LanguageTool"
                onClick={() =>
                  act('gen', async () => {
                    const r = await api.gitGenerate(projectId, 'commit');
                    setMsg(r.text);
                    if (r.languageToolFixes) notify(`LanguageTool fixed ${r.languageToolFixes} issue(s)`);
                  })
                }
              >
                {busy === 'gen' ? <Spinner className="h-3 w-3" /> : <Sparkles className="h-3.5 w-3.5 text-accent-ink" />} Generate message
              </Button>
              <Button
                size="sm"
                variant="primary"
                className="flex-1"
                disabled={!!busy || !msg.trim() || !st.files.length}
                onClick={() =>
                  act(
                    'commit',
                    async () => {
                      await api.gitCommit(projectId, msg);
                      setMsg('');
                    },
                    'Committed',
                  )
                }
              >
                <GitCommitHorizontal className="h-3.5 w-3.5" /> Commit all
              </Button>
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-auto p-3">{diff ? <DiffView diff={diff} maxHeight="" /> : <div className="p-2 text-xs text-fg-subtle">No changes to show.</div>}</div>
        </div>
      )}
      {tab === 'history' && (
        <div className="min-h-0 flex-1 overflow-auto py-2">
          {log.map((c, i) => (
            <div key={c.hash} className="relative flex gap-3 px-4 py-2">
              <div className="flex flex-col items-center pt-1.5">
                <span className={cx('h-2.5 w-2.5 rounded-full border-2', i === 0 ? 'border-accent bg-accent/20' : 'border-line-strong bg-panel')} />
                {i < log.length - 1 && <span className="mt-1 w-px flex-1 bg-line" />}
              </div>
              <div className="min-w-0 flex-1 pb-1">
                <div className="truncate text-[13px] text-fg">{c.subject}</div>
                <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-fg-subtle">
                  <span className="rounded border border-line bg-raised px-1 font-mono">{c.short}</span>
                  <span>{c.author}</span>
                  <span>·</span>
                  <span title={new Date(c.date).toLocaleString()}>{relTime(new Date(c.date).getTime())} ago</span>
                </div>
              </div>
            </div>
          ))}
          {!log.length && <div className="p-4 text-xs text-fg-subtle">No commits yet.</div>}
        </div>
      )}
      {tab === 'prs' &&
        (settings?.hasGithubToken ? (
          st.github ? (
            <PullRequests projectId={projectId} />
          ) : (
            <Empty icon={<GitPullRequest />} title="No GitHub remote">
              This repository has no github.com "origin" remote.
            </Empty>
          )
        ) : (
          <Empty
            icon={<GitPullRequest />}
            title="GitHub not connected"
            action={
              <Button size="sm" onClick={() => openModal('settings', 'connectors')}>
                Add a GitHub token
              </Button>
            }
          >
            Connect GitHub to list, write and open pull requests from here.
          </Empty>
        ))}
    </div>
  );
}

function PullRequests({ projectId }: { projectId: string }) {
  const notify = useStore((s) => s.notify);
  const [prs, setPrs] = useState<Awaited<ReturnType<typeof api.pulls>> | null>(null);
  const [form, setForm] = useState<{ title: string; body: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(
    () =>
      api.pulls(projectId).then(setPrs, (e) => {
        notify(errText(e), 'error');
        setPrs([]);
      }),
    [projectId, notify],
  );
  useEffect(() => {
    void load();
  }, [load]);

  const generate = async () => {
    setBusy(true);
    try {
      const r = await api.gitGenerate(projectId, 'pr');
      const [title, ...rest] = r.text.split('\n');
      setForm({ title: title.replace(/^#+\s*/, ''), body: rest.join('\n').trim() });
    } catch (e) {
      notify(errText(e), 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-0 flex-1 space-y-3 overflow-auto p-3">
      {form ? (
        <div className="space-y-2 rounded-xl border border-line bg-surface p-3 shadow-card">
          <input className="w-full text-[13px]" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="PR title" aria-label="Pull request title" />
          <textarea className="h-40 w-full font-mono text-xs" value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} placeholder="Description (Markdown)" aria-label="Pull request description" />
          <div className="flex gap-2">
            <Button size="sm" disabled={busy} onClick={generate}>
              <Sparkles className="h-3.5 w-3.5 text-accent-ink" /> Generate
            </Button>
            <div className="flex-1" />
            <Button size="sm" variant="ghost" onClick={() => setForm(null)}>
              Cancel
            </Button>
            <Button
              size="sm"
              variant="primary"
              disabled={busy || !form.title.trim()}
              onClick={async () => {
                setBusy(true);
                try {
                  const r = await api.createPull(projectId, form);
                  notify(`Opened PR #${r.number}`, 'success');
                  setForm(null);
                  void load();
                } catch (e) {
                  notify(errText(e), 'error');
                } finally {
                  setBusy(false);
                }
              }}
            >
              {busy && <Spinner className="h-3 w-3" />} Push & open PR
            </Button>
          </div>
        </div>
      ) : (
        <Button size="sm" onClick={() => setForm({ title: '', body: '' })}>
          <GitPullRequest className="h-3.5 w-3.5" /> New pull request
        </Button>
      )}
      <div className="space-y-1.5">
        {prs === null && <Skeleton className="h-12" />}
        {prs?.length === 0 && <div className="text-xs text-fg-subtle">No open pull requests.</div>}
        {prs?.map((p) => (
          <a key={p.number} href={p.url} target="_blank" rel="noreferrer" className="block rounded-xl border border-line bg-surface px-3 py-2.5 shadow-card transition-colors hover:border-line-strong">
            <div className="flex items-center gap-2 text-[13px] text-fg">
              <GitPullRequest className="h-3.5 w-3.5 shrink-0 text-ok-ink" />
              <span className="text-fg-subtle">#{p.number}</span>
              <span className="min-w-0 flex-1 truncate">{p.title}</span>
              {p.draft && <Badge>draft</Badge>}
              <ExternalLink className="h-3 w-3 shrink-0 text-fg-faint" />
            </div>
            <div className="mt-0.5 pl-5.5 font-mono text-[11px] text-fg-subtle">
              {p.head} → {p.base} · {p.user}
            </div>
          </a>
        ))}
      </div>
    </div>
  );
}
