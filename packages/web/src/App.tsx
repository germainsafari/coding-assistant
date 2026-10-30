import { useEffect } from 'react';
import { Group, Panel, Separator } from 'react-resizable-panels';
import { useStore } from './store';
import { Sidebar } from './components/Sidebar';
import { Chat } from './components/Chat';
import { RightPanel } from './components/RightPanel';
import { ProjectDialog } from './components/ProjectDialog';
import { SettingsDialog } from './components/settings/SettingsDialog';

export function App() {
  const { loadSettings, loadProjects, probe, rightOpen, modal, toast } = useStore();

  useEffect(() => {
    void loadSettings();
    void loadProjects();
    void probe();
    const t = setInterval(() => void probe(), 60_000);
    return () => clearInterval(t);
  }, [loadSettings, loadProjects, probe]);

  return (
    <div className="flex h-full overflow-hidden">
      <Sidebar />
      <Group orientation="horizontal" className="min-w-0 flex-1">
        <Panel id="chat" minSize="30">
          <Chat />
        </Panel>
        {rightOpen && (
          <>
            <Separator />
            <Panel id="right" defaultSize="46" minSize="22">
              <RightPanel />
            </Panel>
          </>
        )}
      </Group>
      {modal === 'project' && <ProjectDialog />}
      {modal === 'settings' && <SettingsDialog />}
      {toast && (
        <div
          className={`fixed right-4 bottom-4 z-[60] max-w-md rounded-lg border px-4 py-2.5 text-sm shadow-xl ${toast.kind === 'error' ? 'border-rose-800 bg-rose-950 text-rose-200' : 'border-zinc-700 bg-zinc-800 text-zinc-100'}`}
        >
          {toast.text}
        </div>
      )}
    </div>
  );
}
