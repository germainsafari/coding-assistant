import { useCallback, useEffect, useState } from 'react';
import { ExternalLink, GitBranch, GitCommitHorizontal, GitPullRequest, RefreshCw, Sparkles, Undo2, Upload } from 'lucide-react';
import { api, type GitStatus } from '../../api';
import { errText, useStore } from '../../store';
import { DiffView } from '../Markdown';
import { Badge, Button, Empty, IconButton, Spinner, Tabs } from '../ui';

const tone: Record<string, 'green' | 'red' | 'amber' | 'blue' | 'zinc'> = { added: 'green', untracked: 'green', deleted: 'red', modified: 'amber', renamed: 'blue' };

export function GitPanel({ projectId }: { projectId: string }) {
  const { fsVersion, notify, settings, openModal } = useStore();
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
        setBranches(await api.gitBranches(projectId));
        setLog(await api.gitLog(projectId));
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
    api.gitDiff(projectId, selected ?? undefined).then((d) => setDiff(d.diff), () => setDiff(''));
  }, [projectId, selected, st]);

  const act = async (name: string, fn: () => Promise<unknown>, ok?: string) => {
    setBusy(name);
    try {
      await fn();
      if (ok) notify(ok);
      await refresh();
    } catch (e) {
      notify(errText(e), 'error');
    } finally {
      setBusy(null);
    }
  };

  if (!st) return <div className="p-6"><Spinner /></div>;
  if (!st.isRepo)
    return (
      <Empty icon={<GitBranch className="h-8 w-8" />} title="Not a Git repository">
        <Button className="mt-2" onClick={() => act('init', () => api.gitInit(projectId), 'Initialized Git repository')}>
          Initialize repository
        </Button>
      </Empty>
    );

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-zinc-800 px-3 py-2">
        <GitBranch className="h-4 w-4 text-zinc-400" />
        <select
          className="text-xs"
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
        {st.upstream && (
          <span className="text-[11px] text-zinc-500">
            ↑{st.ahead} ↓{st.behind}
          </span>
        )}
        <div className="flex-1" />
        <Button size="sm" disabled={!!busy || !st.remote} title={st.remote ? `Push to ${st.remote}` : 'No "origin" remote'} onClick={() => act('push', () => api.gitPush(projectId), 'Pushed')}>
          {busy === 'push' ? <Spinner className="h-3 w-3" /> : <Upload className="h-3.5 w-3.5" />} Push
        </Button>
        <IconButton title="Refresh" onClick={refresh}>
          <RefreshCw className="h-3.5 w-3.5" />
        </IconButton>
      </div>
      <div className="shrink-0 border-b border-zinc-800 px-2 py-1.5">
        <Tabs
          value={tab}
          onChange={setTab}
          tabs={[
            { id: 'changes', label: `Changes (${st.files.length})` },
            { id: 'history', label: 'History' },
            { id: 'prs', label: <><GitPullRequest className="h-3.5 w-3.5" /> Pull requests</> },
          ]}
        />
      </div>
      {tab === 'changes' && (
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="max-h-48 shrink-0 overflow-auto border-b border-zinc-800">
            {st.files.length === 0 && <div className="px-3 py-3 text-xs text-zinc-500">Working tree clean.</div>}
            {st.files.map((f) => (
              <div key={f.path} className={`group flex cursor-pointer items-center gap-2 px-3 py-1 text-[13px] hover:bg-zinc-800/60 ${selected === f.path ? 'bg-zinc-800' : ''}`} onClick={() => setSelected(selected === f.path ? null : f.path)}>
                <Badge tone={tone[f.status] ?? 'zinc'}>{f.status[0].toUpperCase()}</Badge>
                <span className="min-w-0 flex-1 truncate font-mono text-xs text-zinc-300">{f.path}</span>
                <button
                  className="hidden text-zinc-500 group-hover:block hover:text-rose-400"
                  title="Discard changes"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (confirm(`Discard all changes to ${f.path}?`)) void act('discard', () => api.gitDiscard(projectId, f.path));
                  }}
                >
                  <Undo2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
          <div className="shrink-0 space-y-1.5 border-b border-zinc-800 p-2">
            <textarea className="h-20 w-full resize-none font-mono text-xs" placeholder="Commit message" value={msg} onChange={(e) => setMsg(e.target.value)} />
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
                {busy === 'gen' ? <Spinner className="h-3 w-3" /> : <Sparkles className="h-3.5 w-3.5" />} Generate
              </Button>
              <Button
                size="sm"
                variant="primary"
                className="flex-1"
                disabled={!!busy || !msg.trim() || !st.files.length}
                onClick={() =>
                  act('commit', async () => {
                    await api.gitCommit(projectId, msg);
                    setMsg('');
                  }, 'Committed')
                }
              >
                <GitCommitHorizontal className="h-3.5 w-3.5" /> Commit all
              </Button>
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-auto p-2">{diff ? <DiffView diff={diff} maxHeight="" /> : <div className="p-2 text-xs text-zinc-500">No diff.</div>}</div>
        </div>
      )}
      {tab === 'history' && (
        <div className="min-h-0 flex-1 overflow-auto">
          {log.map((c) => (
            <div key={c.hash} className="border-b border-zinc-900 px-3 py-1.5">
              <div className="truncate text-[13px] text-zinc-200">{c.subject}</div>
              <div className="text-[11px] text-zinc-500">
                <span className="font-mono">{c.short}</span> · {c.author} · {new Date(c.date).toLocaleString()}
              </div>
            </div>
          ))}
          {!log.length && <div className="p-3 text-xs text-zinc-500">No commits yet.</div>}
        </div>
      )}
      {tab === 'prs' &&
        (settings?.hasGithubToken ? (
          st.github ? (
            <PullRequests projectId={projectId} />
          ) : (
            <Empty title="No GitHub remote">This repository has no github.com "origin" remote.</Empty>
          )
        ) : (
          <Empty title="GitHub not connected">
            <Button className="mt-2" size="sm" onClick={() => openModal('settings', 'connectors')}>
              Add a GitHub token
            </Button>
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
  const load = useCallback(() => api.pulls(projectId).then(setPrs, (e) => (notify(errText(e), 'error'), setPrs([]))), [projectId, notify]);
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
    <div className="min-h-0 flex-1 overflow-auto p-2">
      {form ? (
        <div className="space-y-2">
          <input className="w-full text-sm" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="PR title" />
          <textarea className="h-40 w-full font-mono text-xs" value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} placeholder="Description (Markdown)" />
          <div className="flex gap-2">
            <Button size="sm" disabled={busy} onClick={generate}>
              <Sparkles className="h-3.5 w-3.5" /> Generate
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
                  notify(`Opened PR #${r.number}`);
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
      <div className="mt-3 space-y-1">
        {prs === null && <Spinner />}
        {prs?.length === 0 && <div className="text-xs text-zinc-500">No open pull requests.</div>}
        {prs?.map((p) => (
          <a key={p.number} href={p.url} target="_blank" rel="noreferrer" className="block rounded-md border border-zinc-800 px-3 py-2 hover:border-zinc-600">
            <div className="flex items-center gap-2 text-[13px] text-zinc-200">
              #{p.number} {p.title} {p.draft && <Badge>draft</Badge>} <ExternalLink className="h-3 w-3 text-zinc-500" />
            </div>
            <div className="text-[11px] text-zinc-500">
              {p.head} → {p.base} · {p.user}
            </div>
          </a>
        ))}
      </div>
    </div>
  );
}
