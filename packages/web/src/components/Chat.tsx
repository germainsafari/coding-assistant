import { useEffect } from 'react';
import { ChevronRight, Command, PanelLeft, PanelRight, RotateCcw, ShieldAlert, TriangleAlert } from 'lucide-react';
import { api } from '../api';
import { errText, useStore } from '../store';
import { useThread, type ThreadState } from '../chat/useThread';
import { MessageList } from '../chat/MessageList';
import { Composer } from '../chat/Composer';
import { ModelOfflineBanner, NewThreadHero, ServerError, Welcome } from './Welcome';
import { Badge, Button, IconButton, MOD, Skeleton, Spinner } from './ui';

export function Chat() {
  const projectId = useStore((s) => s.projectId);
  const threadId = useStore((s) => s.threadId);
  const projects = useStore((s) => s.projects);
  const projectsLoaded = useStore((s) => s.projectsLoaded);
  const projectsError = useStore((s) => s.projectsError);
  const threads = useStore((s) => s.threads);
  const project = projects.find((p) => p.id === projectId);
  const thread = projectId ? threads[projectId]?.find((t) => t.id === threadId) : undefined;
  const { state, attach, reload } = useThread(threadId);
  const running = state.live.status === 'running';
  useRunStats(state);

  if (!projectsLoaded) return <ChatSkeleton />;
  if (projectsError && !projects.length) return <ServerError error={projectsError} />;
  if (!project) return <Welcome />;

  const resumable = !running && state.lastRun && ['interrupted', 'max_steps', 'budget_exhausted', 'error'].includes(state.lastRun.status) && threadId;

  return (
    <div className="flex h-full min-w-0 flex-col bg-canvas" data-chat>
      <ChatHeader projectName={project.name} projectPath={project.path} title={thread?.title ?? 'New thread'} running={running} step={state.live.step} longRun={!!state.live.longRun} />
      <MessageList key={threadId ?? 'new'} state={state} empty={<NewThreadHero projectName={project.name} projectPath={project.path} />} />
      <div className="px-6">
        {(threadId || state.messages.length > 0) && <ModelOfflineBanner />}
        <AttentionBanner state={state} />
        {resumable && <ResumeBanner status={state.lastRun!.status} error={state.lastRun!.error} threadId={threadId!} onStarted={attach} />}
      </div>
      <Composer projectId={project.id} projectName={project.name} running={running} live={state.live} onStarted={attach} reload={reload} />
    </div>
  );
}

/** Mirrors the live run into the global store for the status bar and the Esc shortcut. */
function useRunStats(state: ThreadState) {
  const setRun = useStore((s) => s.setRun);
  const { live } = state;
  const running = live.status === 'running';
  const waiting = Object.keys(live.approvals).length + Object.keys(live.questions).length > 0;
  useEffect(() => {
    setRun({
      runId: live.runId,
      running,
      step: live.step,
      longRun: !!live.longRun,
      waiting,
      tokensPerSec: live.usage?.tokensPerSec,
      promptTokens: live.usage?.promptTokens,
      contextLimit: live.usage?.contextLimit,
    });
  }, [setRun, live.runId, running, live.step, live.longRun, waiting, live.usage?.tokensPerSec, live.usage?.promptTokens, live.usage?.contextLimit]);
  useEffect(() => () => setRun({ runId: null, running: false, step: 0, longRun: false, waiting: false }), [setRun]);
}

function ChatHeader({ projectName, projectPath, title, running, step, longRun }: { projectName: string; projectPath: string; title: string; running: boolean; step: number; longRun: boolean }) {
  const sidebarOpen = useStore((s) => s.sidebarOpen);
  const toggleSidebar = useStore((s) => s.toggleSidebar);
  const rightOpen = useStore((s) => s.rightOpen);
  const toggleRight = useStore((s) => s.toggleRight);
  const openModal = useStore((s) => s.openModal);
  return (
    <header className="flex h-12 shrink-0 items-center gap-2 border-b border-line px-3">
      {!sidebarOpen && (
        <IconButton label="Show sidebar" shortcut={`${MOD}+B`} onClick={toggleSidebar}>
          <PanelLeft className="h-4 w-4" />
        </IconButton>
      )}
      <div className="flex min-w-0 flex-1 items-center gap-1.5 pl-1 text-[13px]">
        <span className="max-w-[40%] shrink-0 truncate text-fg-subtle" title={projectPath}>
          {projectName}
        </span>
        <ChevronRight className="h-3.5 w-3.5 shrink-0 text-fg-faint" />
        <h1 className="min-w-0 truncate font-medium text-fg" title={title}>
          {title}
        </h1>
      </div>
      {running && (
        <Badge tone="accent" className="animate-fade-in">
          <Spinner className="h-3 w-3" /> {longRun ? 'Long-run · ' : ''}Step {step || 1}
        </Badge>
      )}
      <IconButton label="Command palette" shortcut={`${MOD}+K`} onClick={() => openModal('palette')}>
        <Command className="h-4 w-4" />
      </IconButton>
      <IconButton label={rightOpen ? 'Hide side panel' : 'Show side panel'} shortcut={`${MOD}+J`} onClick={toggleRight} active={rightOpen}>
        <PanelRight className="h-4 w-4" />
      </IconButton>
    </header>
  );
}

function AttentionBanner({ state }: { state: ThreadState }) {
  const ids = [...Object.keys(state.live.approvals), ...Object.keys(state.live.questions)];
  if (!ids.length) return null;
  const isQuestion = !Object.keys(state.live.approvals).length;
  return (
    <div className="mx-auto mb-2 flex w-full max-w-[46rem] animate-slide-up items-center gap-2.5 rounded-xl border border-accent/40 bg-accent/[0.08] px-3.5 py-2 text-[13px]" role="status">
      <ShieldAlert className="h-4 w-4 shrink-0 text-accent-ink" />
      <span className="min-w-0 flex-1 text-fg">{isQuestion ? 'Hearth has a question for you.' : `Hearth is waiting for your approval${ids.length > 1 ? ` (${ids.length})` : ''}.`}</span>
      <Button size="xs" variant="primary" onClick={() => document.getElementById(`call-${ids[0]}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })}>
        Review
      </Button>
    </div>
  );
}

function ResumeBanner({ status, error, threadId, onStarted }: { status: string; error?: string | null; threadId: string; onStarted: (runId: string) => void }) {
  const notify = useStore((s) => s.notify);
  const label: Record<string, string> = { interrupted: 'was interrupted (the server stopped)', max_steps: 'hit the step limit', budget_exhausted: 'used up its time budget', error: 'ended with an error' };
  return (
    <div className="mx-auto mb-2 flex w-full max-w-[46rem] items-center gap-2.5 rounded-xl border border-warn/30 bg-warn/[0.07] px-3.5 py-2 text-xs text-fg-muted">
      <TriangleAlert className="h-4 w-4 shrink-0 text-warn-ink" />
      <span className="min-w-0 flex-1 truncate" title={error ?? ''}>
        <span className="font-medium text-fg">The last run {label[status] ?? status}.</span>
        {error ? ` ${error}` : ''}
      </span>
      <Button
        size="xs"
        onClick={async () => {
          try {
            onStarted((await api.resume(threadId)).runId);
          } catch (e) {
            notify(errText(e), 'error');
          }
        }}
      >
        <RotateCcw className="h-3 w-3" /> Resume
      </Button>
    </div>
  );
}

function ChatSkeleton() {
  return (
    <div className="flex h-full flex-col" aria-busy="true" aria-label="Loading">
      <div className="flex h-12 items-center gap-2 border-b border-line px-4">
        <Skeleton className="h-3.5 w-24" />
        <Skeleton className="h-3.5 w-40" />
      </div>
      <div className="mx-auto w-full max-w-[46rem] flex-1 space-y-5 px-6 pt-10">
        <Skeleton className="ml-auto h-10 w-1/2 rounded-2xl" />
        <Skeleton className="h-3.5 w-2/3" />
        <Skeleton className="h-9 w-full rounded-xl" />
        <Skeleton className="h-3.5 w-1/2" />
      </div>
      <div className="mx-auto mb-4 w-full max-w-[46rem] px-6">
        <Skeleton className="h-24 w-full rounded-2xl" />
      </div>
    </div>
  );
}
