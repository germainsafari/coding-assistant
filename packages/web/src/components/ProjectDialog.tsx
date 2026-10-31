import { useEffect, useState } from 'react';
import { ArrowUp, Folder, FolderOpen, GitFork, HardDrive, Home, Lock, Plus } from 'lucide-react';
import { api } from '../api';
import { errText, useStore } from '../store';
import { Badge, Button, cx, Modal, Skeleton, Spinner, Tabs } from './ui';

type Mode = 'open' | 'create' | 'clone';
const MODES: Mode[] = ['open', 'create', 'clone'];

export function ProjectDialog() {
  const openModal = useStore((s) => s.openModal);
  const modalTab = useStore((s) => s.modalTab);
  const loadProjects = useStore((s) => s.loadProjects);
  const selectProject = useStore((s) => s.selectProject);
  const settings = useStore((s) => s.settings);
  const notify = useStore((s) => s.notify);
  const [mode, setMode] = useState<Mode>(MODES.includes(modalTab as Mode) ? (modalTab as Mode) : 'open');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [dir, setDir] = useState<Awaited<ReturnType<typeof api.browse>> | null>(null);
  const [pathInput, setPathInput] = useState('');
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [repos, setRepos] = useState<{ fullName: string; private: boolean; description: string | null; cloneUrl: string }[] | null>(null);

  const browse = async (p?: string) => {
    try {
      const d = await api.browse(p);
      setDir(d);
      setPathInput(d.path);
      setError('');
    } catch (e) {
      setError(errText(e));
    }
  };
  useEffect(() => {
    void browse();
  }, []);
  useEffect(() => {
    if (mode === 'clone' && settings?.hasGithubToken && repos === null) api.githubRepos().then(setRepos, () => setRepos([]));
  }, [mode, settings?.hasGithubToken, repos]);

  const close = () => openModal(null);
  const canSubmit = mode === 'open' ? !!pathInput : mode === 'create' ? !!name.trim() : !!url.trim();
  const submit = async () => {
    if (!canSubmit || busy) return;
    setBusy(true);
    setError('');
    try {
      const p =
        mode === 'open'
          ? await api.addProject({ mode, path: pathInput })
          : mode === 'create'
            ? await api.addProject({ mode, name: name.trim() })
            : await api.addProject({ mode, url: url.trim(), name: name.trim() || undefined });
      await loadProjects();
      selectProject(p.id);
      notify(`Project "${p.name}" is ready`, 'success');
      close();
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  };
  const sep = settings?.projectsDir?.includes('\\') ? '\\' : '/';

  return (
    <Modal
      title="Add a project"
      description="Hearth works inside one folder per project. The agent can't read or write outside it."
      onClose={close}
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={close}>
            Cancel
          </Button>
          <Button variant="primary" onClick={submit} disabled={busy || !canSubmit}>
            {busy && <Spinner className="h-3.5 w-3.5 text-primary-fg" />}
            {mode === 'open' ? 'Open this folder' : mode === 'create' ? 'Create project' : 'Clone repository'}
          </Button>
        </>
      }
    >
      <div className="space-y-4 px-5 pt-1 pb-5">
        <Tabs
          label="How to add the project"
          value={mode}
          onChange={setMode}
          className="w-fit rounded-lg border border-line bg-panel p-0.5"
          tabs={[
            { id: 'open', label: <><FolderOpen className="h-3.5 w-3.5" /> Open folder</> },
            { id: 'create', label: <><Plus className="h-3.5 w-3.5" /> New project</> },
            { id: 'clone', label: <><GitFork className="h-3.5 w-3.5" /> Clone Git repo</> },
          ]}
        />
        {mode === 'open' && (
          <div className="space-y-2">
            <form
              className="flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                void browse(pathInput);
              }}
            >
              <input className="flex-1 font-mono text-xs" aria-label="Folder path" value={pathInput} onChange={(e) => setPathInput(e.target.value)} placeholder="C:\path\to\folder or /home/me/code" />
              <Button type="submit">Go</Button>
            </form>
            <div className="overflow-hidden rounded-xl border border-line bg-surface">
              <div className="flex items-center gap-1 border-b border-line bg-panel px-1.5 py-1">
                <Button size="xs" variant="ghost" disabled={!dir?.parent} onClick={() => dir?.parent && browse(dir.parent)}>
                  <ArrowUp className="h-3.5 w-3.5" /> Up
                </Button>
                {dir && (
                  <Button size="xs" variant="ghost" onClick={() => browse(dir.home)}>
                    <Home className="h-3.5 w-3.5" /> Home
                  </Button>
                )}
                {dir?.roots.map((r) => (
                  <Button key={r} size="xs" variant="ghost" onClick={() => browse(r)}>
                    <HardDrive className="h-3.5 w-3.5" /> {r}
                  </Button>
                ))}
              </div>
              <div className="h-60 overflow-y-auto p-1" role="listbox" aria-label="Sub-folders">
                {!dir && [0, 1, 2, 3, 4].map((i) => <Skeleton key={i} className="m-1 h-6" />)}
                {dir?.entries.length === 0 && <div className="p-3 text-xs text-fg-subtle">No sub-folders here.</div>}
                {dir?.entries.map((e) => (
                  <button
                    key={e.path}
                    type="button"
                    role="option"
                    aria-selected={pathInput === e.path}
                    onDoubleClick={() => browse(e.path)}
                    onClick={() => setPathInput(e.path)}
                    onKeyDown={(k) => k.key === 'ArrowRight' && browse(e.path)}
                    className={cx('flex h-7 w-full items-center gap-2 rounded-md px-2 text-left text-[13px] transition-colors', pathInput === e.path ? 'bg-accent/10 text-fg' : 'text-fg-muted hover:bg-hover hover:text-fg')}
                  >
                    <Folder className={cx('h-4 w-4 shrink-0', pathInput === e.path ? 'text-accent' : 'text-fg-subtle')} /> <span className="truncate">{e.name}</span>
                  </button>
                ))}
              </div>
            </div>
            <p className="text-xs text-fg-subtle">Click to select, double-click to open a folder.</p>
          </div>
        )}
        {mode === 'create' && (
          <div className="space-y-2">
            <label className="field">
              Project name
              <input data-autofocus autoFocus value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && submit()} placeholder="my-app" />
            </label>
            <p className="text-xs leading-relaxed text-fg-subtle">
              Creates <code className="rounded bg-raised px-1 py-px font-mono text-fg">{(settings?.projectsDir ?? '~/HearthProjects') + sep + (name || '<name>')}</code> and initializes a Git repository. Change the parent folder in Settings → Agent.
            </p>
          </div>
        )}
        {mode === 'clone' && (
          <div className="space-y-3">
            <label className="field">
              Repository URL or GitHub owner/name
              <input data-autofocus autoFocus className="font-mono text-[13px]" value={url} onChange={(e) => setUrl(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && submit()} placeholder="https://github.com/owner/repo.git  or  owner/repo" />
            </label>
            <label className="field">
              Folder name <span className="hint">optional, defaults to the repository name</span>
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="repo" />
            </label>
            {settings?.hasGithubToken ? (
              <div>
                <div className="mb-1.5 text-xs font-medium text-fg-muted">Your GitHub repositories</div>
                <div className="h-44 overflow-y-auto rounded-xl border border-line bg-surface p-1">
                  {repos === null && [0, 1, 2].map((i) => <Skeleton key={i} className="m-1 h-9" />)}
                  {repos?.length === 0 && <div className="p-3 text-xs text-fg-subtle">No repositories found.</div>}
                  {repos?.map((r) => (
                    <button
                      key={r.fullName}
                      type="button"
                      onClick={() => setUrl(r.cloneUrl)}
                      className={cx('block w-full rounded-md px-2.5 py-1.5 text-left text-[13px] transition-colors', url === r.cloneUrl ? 'bg-accent/10 text-fg' : 'text-fg-muted hover:bg-hover hover:text-fg')}
                    >
                      <span className="flex items-center gap-1.5">
                        <span className="truncate font-medium">{r.fullName}</span>
                        {r.private && (
                          <Badge tone="warn">
                            <Lock className="h-2.5 w-2.5" /> private
                          </Badge>
                        )}
                      </span>
                      {r.description && <span className="block truncate text-xs text-fg-subtle">{r.description}</span>}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <p className="text-xs text-fg-subtle">
                Tip: add a GitHub token in{' '}
                <button type="button" className="text-accent-ink underline-offset-2 hover:underline" onClick={() => openModal('settings', 'connectors')}>
                  Settings → Connectors
                </button>{' '}
                to browse and clone your private repositories.
              </p>
            )}
          </div>
        )}
        {error && (
          <div role="alert" className="rounded-lg border border-danger/30 bg-danger/[0.07] px-3 py-2 text-xs whitespace-pre-wrap text-danger-ink">
            {error}
          </div>
        )}
      </div>
    </Modal>
  );
}
