import { useEffect } from 'react';
import { Group, Panel, Separator, useDefaultLayout } from 'react-resizable-panels';
import { CircleCheck, Info, TriangleAlert, X } from 'lucide-react';
import { useStore } from './store';
import { onSystemThemeChange } from './theme';
import { useGlobalShortcuts } from './shortcuts';
import { Sidebar } from './components/Sidebar';
import { Chat } from './components/Chat';
import { RightPanel } from './components/RightPanel';
import { StatusBar } from './components/StatusBar';
import { ProjectDialog } from './components/ProjectDialog';
import { SettingsDialog } from './components/settings/SettingsDialog';
import { CommandPalette } from './components/CommandPalette';
import { ShortcutsDialog } from './components/ShortcutsDialog';
import { cx } from './components/ui';

export function App() {
  const loadSettings = useStore((s) => s.loadSettings);
  const loadProjects = useStore((s) => s.loadProjects);
  const probe = useStore((s) => s.probe);
  const reachable = useStore((s) => s.caps?.reachable);
  const syncSystemTheme = useStore((s) => s.syncSystemTheme);
  const rightOpen = useStore((s) => s.rightOpen && !!s.projectId);
  const modal = useStore((s) => s.modal);
  useGlobalShortcuts();

  useEffect(() => {
    void loadSettings().catch(() => {});
    void loadProjects();
  }, [loadSettings, loadProjects]);
  // Re-check the model server: every minute when connected, every 15 s while it's down.
  useEffect(() => {
    if (reachable === undefined) void probe();
    const t = setInterval(() => void probe(), reachable === false ? 15_000 : 60_000);
    return () => clearInterval(t);
  }, [probe, reachable]);
  useEffect(() => onSystemThemeChange(syncSystemTheme), [syncSystemTheme]);

  const layout = useDefaultLayout({ id: 'hearth-main', panelIds: rightOpen ? ['chat', 'right'] : ['chat'], storage: localStorage });

  return (
    <div className="flex h-full flex-col overflow-hidden bg-canvas text-fg">
      <div className="flex min-h-0 flex-1">
        <Sidebar />
        <main className="min-w-0 flex-1">
          <Group orientation="horizontal" className="h-full" defaultLayout={layout.defaultLayout} onLayoutChanged={layout.onLayoutChanged}>
            <Panel id="chat" minSize="420px">
              <Chat />
            </Panel>
            {rightOpen && (
              <>
                <Separator />
                <Panel id="right" defaultSize="44" minSize="340px" maxSize="68">
                  <RightPanel />
                </Panel>
              </>
            )}
          </Group>
        </main>
      </div>
      <StatusBar />
      {modal === 'project' && <ProjectDialog />}
      {modal === 'settings' && <SettingsDialog />}
      {modal === 'palette' && <CommandPalette />}
      {modal === 'shortcuts' && <ShortcutsDialog />}
      <Toast />
    </div>
  );
}

function Toast() {
  const toast = useStore((s) => s.toast);
  if (!toast) return null;
  const Icon = toast.kind === 'error' ? TriangleAlert : toast.kind === 'success' ? CircleCheck : Info;
  return (
    <div
      key={toast.id}
      role={toast.kind === 'error' ? 'alert' : 'status'}
      className="fixed right-4 bottom-10 z-[60] flex max-w-md animate-toast-in items-start gap-2.5 rounded-xl border border-line-strong bg-overlay py-2.5 pr-2 pl-3.5 text-[13px] text-fg shadow-pop"
    >
      <Icon className={cx('mt-0.5 h-4 w-4 shrink-0', toast.kind === 'error' ? 'text-danger' : toast.kind === 'success' ? 'text-ok' : 'text-fg-subtle')} />
      <span className="min-w-0 flex-1 break-words">{toast.text}</span>
      <button type="button" aria-label="Dismiss" onClick={() => useStore.setState({ toast: null })} className="rounded p-0.5 text-fg-faint hover:text-fg">
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
