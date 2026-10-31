import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { Check, ChevronRight, Folder, FolderPlus, Moon, PanelLeftClose, PanelLeftOpen, Pencil, Plus, Search, Settings, SquarePen, Sun, Trash2, TriangleAlert, X } from 'lucide-react';
import { api, type ProjectInfo, type ThreadInfo } from '../api';
import { errText, useStore } from '../store';
import { Logo } from './Welcome';
import { cx, IconButton, Keys, MOD, relTime, Skeleton } from './ui';

const EXPANDED_KEY = 'hearth.expanded';
const loadExpanded = () => {
  try {
    return new Set<string>(JSON.parse(localStorage.getItem(EXPANDED_KEY) ?? '[]'));
  } catch {
    return new Set<string>();
  }
};

// Rows contain nested buttons, so they can't be <button>s themselves.
const clickable = (fn: () => void) => ({
  role: 'button' as const,
  tabIndex: 0,
  onClick: fn,
  onKeyDown: (e: ReactKeyboardEvent) => {
    if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      fn();
    }
  },
});

export function Sidebar() {
  const sidebarOpen = useStore((s) => s.sidebarOpen);
  return sidebarOpen ? <SidebarFull /> : <SidebarRail />;
}

function ThemeButton() {
  const theme = useStore((s) => s.theme);
  const setThemePref = useStore((s) => s.setThemePref);
  return (
    <IconButton label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'} shortcut={`${MOD}+Shift+L`} onClick={() => setThemePref(theme === 'dark' ? 'light' : 'dark')}>
      {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
    </IconButton>
  );
}

function SidebarRail() {
  const toggleSidebar = useStore((s) => s.toggleSidebar);
  const newThread = useStore((s) => s.newThread);
  const openModal = useStore((s) => s.openModal);
  return (
    <aside aria-label="Sidebar (collapsed)" className="flex w-12 shrink-0 flex-col items-center gap-1 border-r border-line bg-sidebar py-2.5">
      <Logo className="mb-2 h-6 w-6" />
      <IconButton label="Show sidebar" shortcut={`${MOD}+B`} onClick={toggleSidebar} size="lg">
        <PanelLeftOpen className="h-4 w-4" />
      </IconButton>
      <IconButton label="New thread" shortcut="Alt+N" onClick={() => newThread()} size="lg">
        <SquarePen className="h-4 w-4" />
      </IconButton>
      <IconButton label="Search" shortcut={`${MOD}+K`} onClick={() => openModal('palette')} size="lg">
        <Search className="h-4 w-4" />
      </IconButton>
      <div className="flex-1" />
      <ThemeButton />
      <IconButton label="Settings" shortcut={`${MOD}+,`} onClick={() => openModal('settings')} size="lg">
        <Settings className="h-4 w-4" />
      </IconButton>
    </aside>
  );
}

function SidebarFull() {
  const projects = useStore((s) => s.projects);
  const projectsLoaded = useStore((s) => s.projectsLoaded);
  const threads = useStore((s) => s.threads);
  const projectId = useStore((s) => s.projectId);
  const openModal = useStore((s) => s.openModal);
  const newThread = useStore((s) => s.newThread);
  const toggleSidebar = useStore((s) => s.toggleSidebar);
  const loadThreads = useStore((s) => s.loadThreads);
  const [expanded, setExpanded] = useState(loadExpanded);
  const [q, setQ] = useState('');
  const query = q.trim().toLowerCase();

  useEffect(() => {
    localStorage.setItem(EXPANDED_KEY, JSON.stringify([...expanded]));
  }, [expanded]);
  // The selected project is always expanded.
  useEffect(() => {
    if (projectId) setExpanded((s) => (s.has(projectId) ? s : new Set(s).add(projectId)));
  }, [projectId]);
  // Load threads of expanded projects (and of all projects while filtering).
  useEffect(() => {
    for (const p of projects) if ((query || expanded.has(p.id)) && !threads[p.id]) void loadThreads(p.id).catch(() => {});
  }, [projects, expanded, query, threads, loadThreads]);

  const visible = useMemo(() => {
    if (!query) return projects.map((p) => ({ p, list: threads[p.id] ?? [] }));
    return projects
      .map((p) => ({ p, list: (threads[p.id] ?? []).filter((t) => t.title.toLowerCase().includes(query)), nameHit: p.name.toLowerCase().includes(query) }))
      .filter((x) => x.nameHit || x.list.length);
  }, [projects, threads, query]);

  const toggle = (id: string) =>
    setExpanded((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  return (
    <aside aria-label="Projects and threads" className="flex w-[260px] shrink-0 flex-col border-r border-line bg-sidebar max-[1200px]:w-[236px]">
      <div className="flex h-12 shrink-0 items-center gap-2 pr-2 pl-3.5">
        <Logo className="h-6 w-6" />
        <span className="text-[15px] font-semibold tracking-tight text-fg">Hearth</span>
        <div className="flex-1" />
        <IconButton label="Hide sidebar" shortcut={`${MOD}+B`} onClick={toggleSidebar}>
          <PanelLeftClose className="h-4 w-4" />
        </IconButton>
      </div>
      <div className="space-y-2 px-2.5 pb-3">
        <button
          type="button"
          onClick={() => newThread()}
          className="group flex h-8 w-full items-center gap-2 rounded-lg border border-line-strong bg-surface px-2.5 text-[13px] font-medium text-fg shadow-card transition-colors hover:bg-raised"
        >
          <SquarePen className="h-4 w-4 text-fg-muted" />
          <span className="flex-1 text-left">New thread</span>
          <Keys keys={['Alt', 'N']} className="opacity-0 transition-opacity group-hover:opacity-100" />
        </button>
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 h-3.5 w-3.5 -translate-y-1/2 text-fg-faint" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => e.key === 'Escape' && setQ('')}
            placeholder="Filter threads"
            aria-label="Filter threads"
            className="h-8 w-full border-transparent bg-raised/70 py-0 pr-7 pl-8 text-[13px] shadow-none focus:bg-field"
          />
          {q && (
            <button type="button" aria-label="Clear filter" onClick={() => setQ('')} className="absolute top-1/2 right-2 -translate-y-1/2 text-fg-faint hover:text-fg">
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>
      <div className="flex items-center justify-between pr-2 pb-1 pl-4">
        <span className="text-[11px] font-medium tracking-wide text-fg-subtle uppercase">Projects</span>
        <IconButton label="Add project" size="sm" onClick={() => openModal('project')}>
          <FolderPlus className="h-3.5 w-3.5" />
        </IconButton>
      </div>
      <nav className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        {!projectsLoaded && (
          <div className="space-y-2 px-2 pt-1">
            {[70, 55, 80, 45].map((w) => (
              <Skeleton key={w} className="h-5" />
            ))}
          </div>
        )}
        {projectsLoaded && projects.length === 0 && (
          <button type="button" onClick={() => openModal('project')} className="mx-1 mt-1 flex w-[calc(100%-0.5rem)] flex-col items-start gap-1 rounded-lg border border-dashed border-line-strong px-3 py-3 text-left hover:border-fg-faint">
            <span className="flex items-center gap-1.5 text-[13px] font-medium text-fg">
              <FolderPlus className="h-3.5 w-3.5 text-accent-ink" /> Add your first project
            </span>
            <span className="text-xs text-fg-subtle">Open a folder, create a project or clone a repository.</span>
          </button>
        )}
        {query && visible.length === 0 && <p className="px-3 py-4 text-xs text-fg-subtle">No threads match "{q}".</p>}
        {visible.map(({ p, list }) => (
          <ProjectNode key={p.id} p={p} list={list} open={!!query || expanded.has(p.id)} onToggle={() => toggle(p.id)} loaded={!!threads[p.id]} />
        ))}
      </nav>
      <div className="flex items-center gap-1 border-t border-line px-2 py-2">
        <button type="button" onClick={() => openModal('settings')} className="flex h-8 flex-1 items-center gap-2 rounded-lg px-2 text-[13px] text-fg-muted hover:bg-raised hover:text-fg" title={`Settings (${MOD}+,)`}>
          <Settings className="h-4 w-4" /> Settings
        </button>
        <ThemeButton />
      </div>
    </aside>
  );
}

function ProjectNode({ p, list, open, onToggle, loaded }: { p: ProjectInfo; list: ThreadInfo[]; open: boolean; onToggle: () => void; loaded: boolean }) {
  const projectId = useStore((s) => s.projectId);
  const threadId = useStore((s) => s.threadId);
  const selectProject = useStore((s) => s.selectProject);
  const newThread = useStore((s) => s.newThread);
  const loadProjects = useStore((s) => s.loadProjects);
  const notify = useStore((s) => s.notify);
  const [confirm, setConfirm] = useState(false);
  const active = p.id === projectId;
  const running = list.some((t) => t.activeRunId);

  return (
    <div className="mb-0.5">
      <div
        {...clickable(() => {
          if (!active) selectProject(p.id);
          if (!open || active) onToggle();
        })}
        aria-expanded={open}
        aria-label={`Project ${p.name}`}
        title={p.path}
        className={cx('group flex h-8 cursor-pointer items-center gap-1.5 rounded-lg pr-1 pl-1.5 text-[13px] transition-colors', active ? 'text-fg' : 'text-fg-muted hover:bg-raised/70 hover:text-fg')}
      >
        <ChevronRight className={cx('h-3.5 w-3.5 shrink-0 text-fg-faint transition-transform duration-150', open && 'rotate-90')} />
        <Folder className={cx('h-4 w-4 shrink-0', active ? 'text-accent-ink' : 'text-fg-subtle')} />
        <span className="min-w-0 flex-1 truncate font-medium">{p.name}</span>
        {!p.exists && <TriangleAlert className="h-3.5 w-3.5 shrink-0 text-warn-ink" aria-label="Folder missing" />}
        {running && !open && <span className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-accent" aria-label="Running" />}
        {confirm ? (
          <span className="flex items-center gap-0.5" onClick={(e) => e.stopPropagation()}>
            <span className="px-1 text-[11px] text-danger-ink">Remove?</span>
            <IconButton
              label="Confirm remove (the folder on disk is kept)"
              size="sm"
              className="text-danger-ink hover:text-danger-ink"
              onClick={async () => {
                setConfirm(false);
                await api.removeProject(p.id).catch((e) => notify(errText(e), 'error'));
                await loadProjects();
              }}
            >
              <Check className="h-3.5 w-3.5" />
            </IconButton>
            <IconButton label="Cancel" size="sm" onClick={() => setConfirm(false)}>
              <X className="h-3.5 w-3.5" />
            </IconButton>
          </span>
        ) : (
          <span className="hidden items-center gap-0.5 group-focus-within:flex group-hover:flex">
            <IconButton
              label="Remove project from list"
              size="sm"
              onClick={(e) => {
                e.stopPropagation();
                setConfirm(true);
              }}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </IconButton>
            <IconButton
              label="New thread in this project"
              size="sm"
              onClick={(e) => {
                e.stopPropagation();
                newThread(p.id);
              }}
            >
              <Plus className="h-3.5 w-3.5" />
            </IconButton>
          </span>
        )}
      </div>
      {open && (
        <div className="mt-0.5 mb-1.5 space-y-px pl-[18px]">
          {!loaded && <Skeleton className="mx-2 my-1.5 h-4" />}
          {loaded && list.length === 0 && (
            <button type="button" onClick={() => newThread(p.id)} className="flex h-7 w-full items-center gap-2 rounded-md px-2.5 text-left text-xs text-fg-subtle hover:bg-raised/70 hover:text-fg">
              <Plus className="h-3.5 w-3.5" /> Start a thread
            </button>
          )}
          {list.map((t) => (
            <ThreadRow key={t.id} t={t} projectId={p.id} selected={t.id === threadId && active} />
          ))}
        </div>
      )}
    </div>
  );
}

function ThreadRow({ t, projectId, selected }: { t: ThreadInfo; projectId: string; selected: boolean }) {
  const selectProject = useStore((s) => s.selectProject);
  const selectThread = useStore((s) => s.selectThread);
  const renameThread = useStore((s) => s.renameThread);
  const loadThreads = useStore((s) => s.loadThreads);
  const notify = useStore((s) => s.notify);
  const [mode, setMode] = useState<'view' | 'rename' | 'delete'>('view');
  const [title, setTitle] = useState(t.title);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (mode === 'rename') input.current?.select();
  }, [mode]);

  const commit = async () => {
    const v = title.trim();
    setMode('view');
    if (v && v !== t.title) await renameThread(projectId, t.id, v).catch((e) => notify(errText(e), 'error'));
  };
  const remove = async () => {
    setMode('view');
    await api.deleteThread(t.id).catch((e) => notify(errText(e), 'error'));
    if (selected) selectThread(null);
    await loadThreads(projectId);
  };
  const open = () => {
    selectProject(projectId);
    selectThread(t.id);
  };

  if (mode === 'rename')
    return (
      <div className="flex h-8 items-center px-1">
        <input
          ref={input}
          value={title}
          aria-label="Thread title"
          onChange={(e) => setTitle(e.target.value)}
          onBlur={() => void commit()}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void commit();
            if (e.key === 'Escape') {
              e.stopPropagation();
              setTitle(t.title);
              setMode('view');
            }
          }}
          className="h-7 w-full px-2 py-0 text-[13px]"
        />
      </div>
    );

  return (
    <div
      {...clickable(open)}
      data-thread-row
      aria-current={selected ? 'page' : undefined}
      aria-label={t.title}
      title={t.title}
      className={cx(
        'group/t relative flex h-8 cursor-pointer items-center gap-2 rounded-md pr-1 pl-2.5 text-[13px] transition-colors',
        selected ? 'bg-raised text-fg shadow-card' : 'text-fg-muted hover:bg-raised/60 hover:text-fg',
      )}
    >
      {t.activeRunId && <span className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-accent" title="Running" />}
      <span className="min-w-0 flex-1 truncate">{t.title}</span>
      {mode === 'delete' ? (
        <span className="flex items-center gap-0.5" onClick={(e) => e.stopPropagation()}>
          <span className="px-1 text-[11px] text-danger-ink">Delete?</span>
          <IconButton label="Confirm delete" size="sm" className="text-danger-ink hover:text-danger-ink" onClick={() => void remove()}>
            <Check className="h-3.5 w-3.5" />
          </IconButton>
          <IconButton label="Cancel" size="sm" onClick={() => setMode('view')}>
            <X className="h-3.5 w-3.5" />
          </IconButton>
        </span>
      ) : (
        <>
          <span className="shrink-0 text-[11px] text-fg-faint tabular-nums group-focus-within/t:hidden group-hover/t:hidden" title={new Date(t.updatedAt).toLocaleString()}>
            {relTime(t.updatedAt)}
          </span>
          <span className="hidden items-center gap-0.5 group-focus-within/t:flex group-hover/t:flex">
            <IconButton
              label="Rename thread"
              size="sm"
              onClick={(e) => {
                e.stopPropagation();
                setTitle(t.title);
                setMode('rename');
              }}
            >
              <Pencil className="h-3 w-3" />
            </IconButton>
            <IconButton
              label="Delete thread"
              size="sm"
              onClick={(e) => {
                e.stopPropagation();
                setMode('delete');
              }}
            >
              <Trash2 className="h-3 w-3" />
            </IconButton>
          </span>
        </>
      )}
    </div>
  );
}
