import { ChevronDown, ChevronRight, Folder, FolderPlus, MessageSquare, Plus, Settings, Trash, TriangleAlert } from 'lucide-react';
import { api } from '../api';
import { errText, useStore } from '../store';
import { IconButton } from './ui';

// Rows contain nested buttons, so they can't be <button>s themselves.
const clickable = (fn: () => void) => ({
  role: 'button' as const,
  tabIndex: 0,
  onClick: fn,
  onKeyDown: (e: React.KeyboardEvent) => {
    if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      fn();
    }
  },
});

export function Sidebar() {
  const { projects, projectsLoaded, threads, projectId, threadId, selectProject, selectThread, openModal, loadProjects, loadThreads, notify, caps, settings } = useStore();
  const profile = settings?.profiles.find((p) => p.id === settings.activeProfileId);

  const newThread = async (pid: string) => {
    selectProject(pid);
    selectThread(null);
  };
  const removeProject = async (id: string, name: string) => {
    if (!confirm(`Remove "${name}" from Hearth? (The folder on disk is NOT deleted.)`)) return;
    await api.removeProject(id).catch((e) => notify(errText(e), 'error'));
    await loadProjects();
  };
  const removeThread = async (pid: string, id: string) => {
    if (!confirm('Delete this thread and its messages?')) return;
    await api.deleteThread(id);
    if (threadId === id) selectThread(null);
    await loadThreads(pid);
  };

  return (
    <aside className="flex w-64 shrink-0 flex-col border-r border-zinc-800 bg-[#0d0d10]">
      <div className="flex items-center gap-2 px-3 pt-3 pb-2">
        <img src="/favicon.svg" className="h-6 w-6" alt="" />
        <span className="text-[15px] font-semibold tracking-tight text-zinc-100">Hearth</span>
        <span className="text-[11px] text-zinc-500">local coding agent</span>
      </div>
      <div className="px-2 pb-2">
        <button
          onClick={() => openModal('project')}
          className="flex w-full items-center gap-2 rounded-md border border-dashed border-zinc-700 px-2.5 py-1.5 text-sm text-zinc-300 hover:border-orange-500/60 hover:text-zinc-100"
        >
          <FolderPlus className="h-4 w-4 text-orange-400" /> Add project
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        {projectsLoaded && projects.length === 0 && <p className="px-2 py-4 text-xs text-zinc-500">No projects yet. Open a local folder, create a new project or clone a Git repo.</p>}
        {projects.map((p) => {
          const open = p.id === projectId;
          const list = threads[p.id] ?? [];
          return (
            <div key={p.id} className="mb-1">
              <div
                className={`group flex cursor-pointer items-center gap-1.5 rounded-md px-2 py-1.5 text-sm ${open ? 'bg-zinc-800/70 text-zinc-100' : 'text-zinc-300 hover:bg-zinc-800/40'}`}
                {...clickable(() => selectProject(p.id))}
                aria-label={p.name}
                title={p.path}
              >
                {open ? <ChevronDown className="h-3.5 w-3.5 text-zinc-500" /> : <ChevronRight className="h-3.5 w-3.5 text-zinc-500" />}
                <Folder className="h-4 w-4 shrink-0 text-orange-400/80" />
                <span className="min-w-0 flex-1 truncate">{p.name}</span>
                {!p.exists && <TriangleAlert className="h-3.5 w-3.5 text-amber-400" aria-label="Folder missing" />}
                <span className="hidden gap-0.5 group-hover:flex">
                  <IconButton
                    title="New thread"
                    className="h-6 w-6"
                    onClick={(e) => {
                      e.stopPropagation();
                      void newThread(p.id);
                    }}
                  >
                    <Plus className="h-3.5 w-3.5" />
                  </IconButton>
                  <IconButton
                    title="Remove project from list"
                    className="h-6 w-6"
                    onClick={(e) => {
                      e.stopPropagation();
                      void removeProject(p.id, p.name);
                    }}
                  >
                    <Trash className="h-3.5 w-3.5" />
                  </IconButton>
                </span>
              </div>
              {open && (
                <div className="mt-0.5 ml-4 border-l border-zinc-800 pl-1.5">
                  <button
                    onClick={() => selectThread(null)}
                    className={`flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-left text-[13px] ${threadId === null ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-400 hover:bg-zinc-800/40 hover:text-zinc-200'}`}
                  >
                    <Plus className="h-3.5 w-3.5" /> New thread
                  </button>
                  {list.map((t) => (
                    <div
                      key={t.id}
                      {...clickable(() => selectThread(t.id))}
                      aria-label={t.title}
                      className={`group/t flex cursor-pointer items-center gap-1.5 rounded-md px-2 py-1 text-[13px] ${t.id === threadId ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-400 hover:bg-zinc-800/40 hover:text-zinc-200'}`}
                      title={t.title}
                    >
                      {t.activeRunId ? <span className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-orange-500" title="Running" /> : <MessageSquare className="h-3.5 w-3.5 shrink-0 opacity-60" />}
                      <span className="min-w-0 flex-1 truncate">{t.title}</span>
                      <button
                        className="hidden text-zinc-500 group-hover/t:block hover:text-rose-400"
                        title="Delete thread"
                        onClick={(e) => {
                          e.stopPropagation();
                          void removeThread(p.id, t.id);
                        }}
                      >
                        <Trash className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
      <div className="border-t border-zinc-800 p-2">
        <button
          onClick={() => openModal('settings', 'models')}
          className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs text-zinc-400 hover:bg-zinc-800/60"
          title={caps?.error ?? 'Model server status'}
        >
          <span className={`h-2 w-2 shrink-0 rounded-full ${caps == null ? 'bg-zinc-500' : caps.reachable ? 'bg-emerald-500' : 'bg-rose-500'}`} />
          <span className="min-w-0 flex-1 truncate">
            {profile?.name ?? 'model'}
            {caps?.reachable ? ` · ${caps.effectiveToolMode} tools · ${caps.maxModelLen ? Math.round(caps.maxModelLen / 1024) + 'k ctx' : ''}` : caps ? ' · offline' : ''}
          </span>
        </button>
        <button onClick={() => openModal('settings')} className="mt-0.5 flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm text-zinc-300 hover:bg-zinc-800/60">
          <Settings className="h-4 w-4" /> Settings
        </button>
      </div>
    </aside>
  );
}
