import { lazy, Suspense } from 'react';
import { Activity, FileText, FolderOpen, GitBranch, Globe, PanelRightClose, SquareTerminal } from 'lucide-react';
import { useStore, type RightTab } from '../store';
import { Empty, IconButton, MOD, Spinner, Tabs } from './ui';
import { GitPanel } from './panels/GitPanel';
import { BrowserPanel } from './panels/BrowserPanel';
import { TerminalPanel } from './panels/TerminalPanel';
import { TracesPanel } from './panels/TracesPanel';

const FilesPanel = lazy(() => import('./panels/FilesPanel'));

export const RIGHT_TABS: { id: RightTab; label: string; Icon: typeof FileText }[] = [
  { id: 'files', label: 'Files', Icon: FileText },
  { id: 'git', label: 'Git', Icon: GitBranch },
  { id: 'browser', label: 'Browser', Icon: Globe },
  { id: 'terminal', label: 'Terminal', Icon: SquareTerminal },
  { id: 'traces', label: 'Traces', Icon: Activity },
];

const tabs = RIGHT_TABS.map(({ id, label, Icon }, i) => ({
  id,
  title: `${label} (Alt+${i + 1})`,
  label: (
    <>
      <Icon className="h-3.5 w-3.5" /> <span className="max-[1280px]:hidden">{label}</span>
    </>
  ),
}));

export function RightPanel() {
  const rightTab = useStore((s) => s.rightTab);
  const setRightTab = useStore((s) => s.setRightTab);
  const projectId = useStore((s) => s.projectId);
  const toggleRight = useStore((s) => s.toggleRight);
  return (
    <div className="flex h-full min-w-0 flex-col bg-panel">
      <div className="flex h-12 shrink-0 items-center gap-2 border-b border-line pr-2 pl-2.5">
        <Tabs tabs={tabs} value={rightTab} onChange={setRightTab} label="Side panel" className="min-w-0 flex-1" />
        <IconButton label="Hide side panel" shortcut={`${MOD}+J`} onClick={toggleRight}>
          <PanelRightClose className="h-4 w-4" />
        </IconButton>
      </div>
      <div className="min-h-0 flex-1" role="tabpanel">
        {rightTab === 'traces' ? (
          <TracesPanel />
        ) : rightTab === 'browser' ? (
          <BrowserPanel />
        ) : !projectId ? (
          <Empty icon={<FolderOpen />} title="No project selected">
            Add or select a project in the sidebar to see its files, Git status and terminal.
          </Empty>
        ) : rightTab === 'files' ? (
          <Suspense
            fallback={
              <div className="flex h-full items-center justify-center">
                <Spinner />
              </div>
            }
          >
            <FilesPanel key={projectId} projectId={projectId} />
          </Suspense>
        ) : rightTab === 'git' ? (
          <GitPanel key={projectId} projectId={projectId} />
        ) : (
          <TerminalPanel key={projectId} projectId={projectId} />
        )}
      </div>
    </div>
  );
}
