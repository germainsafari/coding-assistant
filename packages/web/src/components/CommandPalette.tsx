// Ctrl/⌘+K: jump to threads and projects, run actions, open panels and settings.
import { useEffect, useMemo, type ReactNode } from 'react';
import { Command } from 'cmdk';
import { Bot, Brain, Cpu, Folder, FolderPlus, Keyboard, Link as LinkIcon, MessageSquare, Moon, PanelLeft, PanelRight, Plug, Puzzle, Search, Settings, SquarePen, Sun, SunMoon } from 'lucide-react';
import { useStore } from '../store';
import { RIGHT_TABS } from './RightPanel';
import { Keys, Kbd, MOD, Modal, relTime } from './ui';

function Item({ icon, children, hint, onSelect, value, keywords }: { icon: ReactNode; children: ReactNode; hint?: ReactNode; onSelect: () => void; value: string; keywords?: string[] }) {
  return (
    <Command.Item value={value} keywords={keywords} onSelect={onSelect} className="flex h-9 cursor-pointer items-center gap-2.5 rounded-lg px-2.5 text-[13px] text-fg-muted select-none [&>svg]:h-4 [&>svg]:w-4 [&>svg]:shrink-0 [&>svg]:text-fg-subtle">
      {icon}
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {hint && <span className="shrink-0 text-[11px] text-fg-subtle">{hint}</span>}
    </Command.Item>
  );
}

const SETTINGS_TABS = [
  { id: 'models', label: 'Models', Icon: Cpu },
  { id: 'agent', label: 'Agent', Icon: Bot },
  { id: 'mcp', label: 'MCP servers', Icon: Plug },
  { id: 'connectors', label: 'Connectors', Icon: LinkIcon },
  { id: 'skills', label: 'Skills', Icon: Puzzle },
  { id: 'memory', label: 'Memory', Icon: Brain },
];

export function CommandPalette() {
  const projects = useStore((s) => s.projects);
  const threads = useStore((s) => s.threads);
  const projectId = useStore((s) => s.projectId);
  const theme = useStore((s) => s.theme);
  const s = useStore.getState;

  useEffect(() => {
    for (const p of projects) if (!threads[p.id]) void s().loadThreads(p.id).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const allThreads = useMemo(
    () =>
      projects
        .flatMap((p) => (threads[p.id] ?? []).map((t) => ({ t, p })))
        .sort((a, b) => (a.p.id === projectId ? 0 : 1) - (b.p.id === projectId ? 0 : 1) || b.t.updatedAt - a.t.updatedAt)
        .slice(0, 50),
    [projects, threads, projectId],
  );

  const close = () => s().openModal(null);
  const run = (fn: () => void) => () => {
    close();
    fn();
  };

  return (
    <Modal title="Command palette" bare onClose={close} size="md" position="top">
      <Command label="Command palette" loop className="flex max-h-[min(60vh,520px)] flex-col">
        <div className="flex items-center gap-2.5 border-b border-line px-4">
          <Search className="h-4 w-4 shrink-0 text-fg-subtle" />
          <Command.Input autoFocus placeholder="Search threads, projects and actions…" className="h-12 flex-1 rounded-none border-0 bg-transparent px-0 text-[14px] shadow-none focus:shadow-none" />
          <Kbd>Esc</Kbd>
        </div>
        <Command.List className="min-h-0 overflow-y-auto p-1.5">
          <Command.Empty className="py-10 text-center text-[13px] text-fg-subtle">Nothing found.</Command.Empty>
          <Command.Group heading="Actions">
            <Item value="new thread" icon={<SquarePen />} hint={<Keys keys={['Alt', 'N']} />} onSelect={run(() => s().newThread())}>
              New thread
            </Item>
            <Item value="add project open folder create clone" icon={<FolderPlus />} onSelect={run(() => s().openModal('project'))}>
              Add project…
            </Item>
            <Item value="toggle sidebar" icon={<PanelLeft />} hint={<Keys keys={[MOD, 'B']} />} onSelect={run(() => s().toggleSidebar())}>
              Toggle sidebar
            </Item>
            <Item value="toggle side panel" icon={<PanelRight />} hint={<Keys keys={[MOD, 'J']} />} onSelect={run(() => s().toggleRight())}>
              Toggle side panel
            </Item>
            <Item value={`theme ${theme === 'dark' ? 'light' : 'dark'}`} keywords={['theme', 'appearance', 'mode']} icon={theme === 'dark' ? <Sun /> : <Moon />} hint={<Keys keys={[MOD, 'Shift', 'L']} />} onSelect={run(() => s().setThemePref(theme === 'dark' ? 'light' : 'dark'))}>
              Switch to {theme === 'dark' ? 'light' : 'dark'} theme
            </Item>
            <Item value="theme system" keywords={['appearance']} icon={<SunMoon />} onSelect={run(() => s().setThemePref('system'))}>
              Use the system theme
            </Item>
            <Item value="keyboard shortcuts help" icon={<Keyboard />} hint={<Keys keys={[MOD, '/']} />} onSelect={run(() => s().openModal('shortcuts'))}>
              Keyboard shortcuts
            </Item>
          </Command.Group>
          {allThreads.length > 0 && (
            <Command.Group heading="Threads">
              {allThreads.map(({ t, p }) => (
                <Item
                  key={t.id}
                  value={`thread ${t.id}`}
                  keywords={[t.title, p.name]}
                  icon={t.activeRunId ? <span className="flex h-4 w-4 items-center justify-center"><span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent" /></span> : <MessageSquare />}
                  hint={`${p.name} · ${relTime(t.updatedAt)}`}
                  onSelect={run(() => {
                    s().selectProject(p.id);
                    s().selectThread(t.id);
                  })}
                >
                  {t.title}
                </Item>
              ))}
            </Command.Group>
          )}
          {projects.length > 0 && (
            <Command.Group heading="Projects">
              {projects.map((p) => (
                <Item key={p.id} value={`project ${p.id}`} keywords={[p.name, p.path]} icon={<Folder />} hint={p.id === projectId ? 'current' : undefined} onSelect={run(() => s().selectProject(p.id))}>
                  {p.name}
                </Item>
              ))}
            </Command.Group>
          )}
          <Command.Group heading="Panels">
            {RIGHT_TABS.map(({ id, label, Icon }, i) => (
              <Item key={id} value={`panel ${label}`} icon={<Icon />} hint={<Keys keys={['Alt', String(i + 1)]} />} onSelect={run(() => s().setRightTab(id))}>
                Open {label}
              </Item>
            ))}
          </Command.Group>
          <Command.Group heading="Settings">
            {SETTINGS_TABS.map(({ id, label, Icon }) => (
              <Item key={id} value={`settings ${label}`} icon={<Icon />} onSelect={run(() => s().openModal('settings', id))}>
                Settings: {label}
              </Item>
            ))}
            <Item value="settings preferences" icon={<Settings />} hint={<Keys keys={[MOD, ',']} />} onSelect={run(() => s().openModal('settings'))}>
              Open settings
            </Item>
          </Command.Group>
        </Command.List>
        <div className="flex items-center gap-4 border-t border-line bg-panel/60 px-4 py-2 text-[11px] text-fg-subtle">
          <span className="flex items-center gap-1">
            <Keys keys={['↑', '↓']} /> navigate
          </span>
          <span className="flex items-center gap-1">
            <Keys keys={['↵']} /> open
          </span>
        </div>
      </Command>
    </Modal>
  );
}
