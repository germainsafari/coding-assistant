import { lazy, Suspense } from 'react';
import { Activity, FileText, GitBranch, Globe, SquareTerminal } from 'lucide-react';
import { useStore, type RightTab } from '../store';
import { Empty, Spinner, Tabs } from './ui';
import { GitPanel } from './panels/GitPanel';
import { BrowserPanel } from './panels/BrowserPanel';
import { TerminalPanel } from './panels/TerminalPanel';
import { TracesPanel } from './panels/TracesPanel';

const FilesPanel = lazy(() => import('./panels/FilesPanel'));

export function RightPanel() {
  const { rightTab, setRightTab, projectId } = useStore();
  const tabs: { id: RightTab; label: React.ReactNode }[] = [
    { id: 'files', label: <><FileText className="h-3.5 w-3.5" /> Files</> },
    { id: 'git', label: <><GitBranch className="h-3.5 w-3.5" /> Git</> },
    { id: 'browser', label: <><Globe className="h-3.5 w-3.5" /> Browser</> },
    { id: 'terminal', label: <><SquareTerminal className="h-3.5 w-3.5" /> Terminal</> },
    { id: 'traces', label: <><Activity className="h-3.5 w-3.5" /> Traces</> },
  ];
  return (
    <div className="flex h-full min-w-0 flex-col border-l border-zinc-800 bg-[#0c0c0f]">
      <div className="flex h-11 shrink-0 items-center border-b border-zinc-800 px-2">
        <Tabs tabs={tabs} value={rightTab} onChange={setRightTab} />
      </div>
      <div className="min-h-0 flex-1">
        {rightTab === 'traces' ? (
          <TracesPanel />
        ) : rightTab === 'browser' ? (
          <BrowserPanel />
        ) : !projectId ? (
          <Empty title="No project selected" />
        ) : rightTab === 'files' ? (
          <Suspense fallback={<div className="p-6"><Spinner /></div>}>
            <FilesPanel projectId={projectId} />
          </Suspense>
        ) : rightTab === 'git' ? (
          <GitPanel projectId={projectId} />
        ) : (
          <TerminalPanel projectId={projectId} />
        )}
      </div>
    </div>
  );
}
