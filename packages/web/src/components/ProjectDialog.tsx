import { useEffect, useState } from 'react';
import { ArrowUp, Folder, FolderOpen, GitFork, HardDrive, Plus } from 'lucide-react';
import { api } from '../api';
import { errText, useStore } from '../store';
import { Button, Modal, Spinner, Tabs } from './ui';

type Mode = 'open' | 'create' | 'clone';

export function ProjectDialog() {
  const { openModal, loadProjects, selectProject, settings, notify } = useStore();
  const [mode, setMode] = useState<Mode>('open');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  // open
  const [dir, setDir] = useState<Awaited<ReturnType<typeof api.browse>> | null>(null);
  const [pathInput, setPathInput] = useState('');
  // create / clone
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
  const submit = async () => {
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
      notify(`Project "${p.name}" ready`);
      close();
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title="Add project"
      onClose={close}
      footer={
        <>
          <Button variant="ghost" onClick={close}>
            Cancel
          </Button>
          <Button variant="primary" onClick={submit} disabled={busy || (mode === 'open' ? !pathInput : mode === 'create' ? !name.trim() : !url.trim())}>
            {busy && <Spinner className="h-3.5 w-3.5 text-white" />}
            {mode === 'open' ? 'Open this folder' : mode === 'create' ? 'Create project' : 'Clone repository'}
          </Button>
        </>
      }
    >
      <div className="space-y-3 p-4">
        <Tabs
          value={mode}
          onChange={setMode}
          tabs={[
            { id: 'open', label: <><FolderOpen className="h-3.5 w-3.5" /> Open folder</> },
            { id: 'create', label: <><Plus className="h-3.5 w-3.5" /> New project</> },
            { id: 'clone', label: <><GitFork className="h-3.5 w-3.5" /> Clone Git repo</> },
          ]}
        />
        {mode === 'open' && (
          <div className="space-y-2">
            <div className="flex gap-2">
              <input className="flex-1 font-mono text-xs" value={pathInput} onChange={(e) => setPathInput(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && browse(pathInput)} placeholder="C:\\path\\to\\folder or /home/me/code" />
              <Button size="sm" onClick={() => browse(pathInput)}>
                Go
              </Button>
            </div>
            <div className="flex flex-wrap gap-1">
              {dir?.parent && (
                <Button size="sm" variant="ghost" onClick={() => browse(dir.parent!)}>
                  <ArrowUp className="h-3.5 w-3.5" /> Up
                </Button>
              )}
              {dir?.roots.map((r) => (
                <Button key={r} size="sm" variant="ghost" onClick={() => browse(r)}>
                  <HardDrive className="h-3.5 w-3.5" /> {r}
                </Button>
              ))}
              {dir && (
                <Button size="sm" variant="ghost" onClick={() => browse(dir.home)}>
                  Home
                </Button>
              )}
            </div>
            <div className="h-64 overflow-y-auto rounded-md border border-zinc-800 bg-zinc-950/60">
              {dir?.entries.length === 0 && <div className="p-3 text-xs text-zinc-500">No sub-folders.</div>}
              {dir?.entries.map((e) => (
                <button key={e.path} onDoubleClick={() => browse(e.path)} onClick={() => setPathInput(e.path)} className={`flex w-full items-center gap-2 px-3 py-1 text-left text-sm hover:bg-zinc-800 ${pathInput === e.path ? 'bg-zinc-800 text-orange-300' : 'text-zinc-300'}`}>
                  <Folder className="h-4 w-4 text-orange-400/70" /> {e.name}
                </button>
              ))}
            </div>
            <p className="text-xs text-zinc-500">Click to select, double-click to enter a folder. The agent can only read/write files inside the selected folder.</p>
          </div>
        )}
        {mode === 'create' && (
          <div className="space-y-2">
            <label className="field">
              Project name
              <input autoFocus value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && name.trim() && submit()} placeholder="my-app" />
            </label>
            <p className="text-xs text-zinc-500">
              Creates <code className="text-zinc-300">{(settings?.projectsDir ?? '~/HearthProjects') + (settings?.projectsDir?.includes('\\') ? '\\' : '/') + (name || '<name>')}</code> and initializes a Git repository. Change the parent folder in Settings → Agent.
            </p>
          </div>
        )}
        {mode === 'clone' && (
          <div className="space-y-2">
            <label className="field">
              Repository URL or GitHub owner/name
              <input autoFocus value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://github.com/owner/repo.git  or  owner/repo" />
            </label>
            <label className="field">
              Folder name (optional)
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="defaults to the repo name" />
            </label>
            {settings?.hasGithubToken ? (
              <div>
                <div className="mb-1 text-xs text-zinc-400">Your GitHub repositories</div>
                <div className="h-44 overflow-y-auto rounded-md border border-zinc-800">
                  {repos === null && <div className="p-3"><Spinner /></div>}
                  {repos?.map((r) => (
                    <button key={r.fullName} onClick={() => setUrl(r.cloneUrl)} className={`block w-full px-3 py-1.5 text-left text-sm hover:bg-zinc-800 ${url === r.cloneUrl ? 'bg-zinc-800 text-orange-300' : 'text-zinc-300'}`}>
                      {r.fullName} {r.private && <span className="text-[10px] text-amber-400">private</span>}
                      {r.description && <div className="truncate text-xs text-zinc-500">{r.description}</div>}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <p className="text-xs text-zinc-500">Tip: add a GitHub token in Settings → Connectors to browse and clone your private repositories.</p>
            )}
          </div>
        )}
        {error && <div className="rounded-md border border-rose-900 bg-rose-950/50 px-3 py-2 text-xs whitespace-pre-wrap text-rose-300">{error}</div>}
      </div>
    </Modal>
  );
}
