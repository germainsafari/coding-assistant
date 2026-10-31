// Onboarding and empty states: first run (no projects), a new thread, and
// friendly errors when the Hearth server or the model server can't be reached.
import { ArrowRight, Bug, FolderOpen, FolderPlus, GitFork, Lightbulb, Network, RefreshCw, ServerCrash, Settings2, TestTube2, Wand2 } from 'lucide-react';
import { useStore } from '../store';
import { Button, cx, Keys, MOD, Spinner, StatusDot } from './ui';

export function Logo({ className = 'h-7 w-7' }: { className?: string }) {
  return <img src="/favicon.svg" className={className} alt="" />;
}

function ModelStatusLine({ className = '' }: { className?: string }) {
  const caps = useStore((s) => s.caps);
  const settings = useStore((s) => s.settings);
  const probing = useStore((s) => s.probing);
  const probe = useStore((s) => s.probe);
  const profile = settings?.profiles.find((p) => p.id === settings.activeProfileId);
  if (!caps)
    return (
      <div className={cx('flex items-center gap-2 text-xs text-fg-subtle', className)}>
        <Spinner className="h-3.5 w-3.5" /> Checking the model server…
      </div>
    );
  if (!caps.reachable)
    return (
      <div className={cx('flex items-start gap-3 rounded-xl border border-warn/30 bg-warn/[0.07] px-4 py-3 text-left', className)}>
        <ServerCrash className="mt-0.5 h-4 w-4 shrink-0 text-warn-ink" />
        <div className="min-w-0 flex-1 text-[13px]">
          <div className="font-medium text-fg">Can't reach the model server</div>
          <div className="mt-0.5 text-xs leading-relaxed text-fg-muted">
            Hearth expects an OpenAI-compatible server at <code className="font-mono text-fg">{profile?.baseUrl ?? 'http://localhost:8080/v1'}</code>. Start it (see the setup guide), then run <code className="rounded border border-line bg-raised px-1 font-mono text-fg">npm run doctor</code> to check everything.
          </div>
        </div>
        <Button size="sm" onClick={() => void probe(true)} disabled={probing}>
          {probing ? <Spinner className="h-3.5 w-3.5" /> : <RefreshCw className="h-3.5 w-3.5" />} Retry
        </Button>
      </div>
    );
  return (
    <div className={cx('flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-xs text-fg-subtle', className)}>
      <StatusDot tone="ok" />
      <span className="font-medium text-fg-muted">{profile?.name ?? caps.models[0]}</span>
      <span>·</span>
      <span>{caps.effectiveToolMode} tool calling</span>
      {caps.maxModelLen ? (
        <>
          <span>·</span>
          <span>{Math.round(caps.maxModelLen / 1024)}k context</span>
        </>
      ) : null}
    </div>
  );
}

export function Welcome() {
  const openModal = useStore((s) => s.openModal);
  const actions = [
    { mode: 'open', Icon: FolderOpen, title: 'Open a folder', text: 'Point Hearth at code you already have on disk.' },
    { mode: 'create', Icon: FolderPlus, title: 'Start a new project', text: 'An empty folder with Git, ready for the agent.' },
    { mode: 'clone', Icon: GitFork, title: 'Clone a repository', text: 'From GitHub or any Git URL.' },
  ] as const;
  return (
    <div className="flex h-full overflow-y-auto">
      <div className="m-auto w-full max-w-2xl px-8 py-12 text-center">
        <div className="relative mx-auto mb-6 flex h-16 w-16 items-center justify-center">
          <div className="absolute inset-0 rounded-2xl bg-accent/20 blur-xl" />
          <div className="relative flex h-16 w-16 items-center justify-center rounded-2xl border border-line bg-surface shadow-card">
            <Logo className="h-9 w-9" />
          </div>
        </div>
        <h1 className="text-[28px] font-semibold tracking-tight text-fg">Welcome to Hearth</h1>
        <p className="mx-auto mt-2 max-w-md text-[14.5px] leading-relaxed text-fg-muted">A coding agent that runs entirely on your own machine. It reads and edits code, runs commands, uses Git and a browser, and can work on its own for hours.</p>
        <div className="mt-9 grid gap-3 text-left sm:grid-cols-3">
          {actions.map(({ mode, Icon, title, text }) => (
            <button
              key={mode}
              type="button"
              onClick={() => openModal('project', mode)}
              className="group flex flex-col gap-2 rounded-xl border border-line bg-surface p-4 shadow-card transition-[border-color,transform,box-shadow] duration-150 hover:-translate-y-0.5 hover:border-line-strong hover:shadow-pop"
            >
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent/10 text-accent-ink">
                <Icon className="h-4 w-4" />
              </span>
              <span className="flex items-center gap-1 text-[13.5px] font-medium text-fg">
                {title} <ArrowRight className="h-3.5 w-3.5 -translate-x-1 text-fg-faint opacity-0 transition-all group-hover:translate-x-0 group-hover:opacity-100" />
              </span>
              <span className="text-xs leading-relaxed text-fg-subtle">{text}</span>
            </button>
          ))}
        </div>
        <ModelStatusLine className="mt-8" />
        <div className="mt-8 flex items-center justify-center gap-4 text-xs text-fg-subtle">
          <span className="flex items-center gap-1.5">
            <Keys keys={[MOD, 'K']} /> command palette
          </span>
          <span className="flex items-center gap-1.5">
            <Keys keys={[MOD, '/']} /> shortcuts
          </span>
          <button type="button" onClick={() => openModal('settings', 'models')} className="flex items-center gap-1.5 hover:text-fg">
            <Settings2 className="h-3.5 w-3.5" /> Model settings
          </button>
        </div>
      </div>
    </div>
  );
}

const SUGGESTIONS = [
  { Icon: Network, title: 'Explain this project', prompt: 'Explain the structure of this project, how the pieces fit together, and how to run it.' },
  { Icon: Bug, title: 'Find and fix failing tests', prompt: 'Run the test suite, find the failing tests and fix them. Explain each fix.' },
  { Icon: TestTube2, title: 'Add tests', prompt: 'Find the least-tested module in this project and add focused unit tests for it.' },
  { Icon: Wand2, title: 'Build a feature', prompt: 'Add a small CLI entry point with --help, then write a README section that shows how to use it.' },
];

export function NewThreadHero({ projectName, projectPath }: { projectName: string; projectPath: string }) {
  return (
    <div className="animate-fade-in pt-[8vh] pb-6">
      <div className="text-center">
        <Logo className="mx-auto mb-4 h-10 w-10" />
        <h2 className="text-[22px] font-semibold tracking-tight text-fg">What should we build in {projectName}?</h2>
        <p className="mx-auto mt-1.5 max-w-md truncate font-mono text-xs text-fg-subtle" title={projectPath}>
          {projectPath}
        </p>
      </div>
      <div className="mt-8 grid gap-2.5 sm:grid-cols-2">
        {SUGGESTIONS.map(({ Icon, title, prompt }) => (
          <button
            key={title}
            type="button"
            onClick={() => window.dispatchEvent(new CustomEvent('hearth:prefill', { detail: prompt }))}
            className="group flex items-start gap-3 rounded-xl border border-line bg-surface p-3.5 text-left shadow-card transition-[border-color,background-color] duration-150 hover:border-line-strong hover:bg-raised/50"
          >
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-line bg-raised text-fg-muted group-hover:text-accent-ink">
              <Icon className="h-3.5 w-3.5" />
            </span>
            <span className="min-w-0">
              <span className="block text-[13px] font-medium text-fg">{title}</span>
              <span className="mt-0.5 line-clamp-2 block text-xs leading-relaxed text-fg-subtle">{prompt}</span>
            </span>
          </button>
        ))}
      </div>
      <div className="mt-6 flex items-start justify-center gap-2 text-xs text-fg-subtle">
        <Lightbulb className="mt-px h-3.5 w-3.5 shrink-0 text-accent" />
        <span>For big tasks, turn on Long-run: the agent plans, checkpoints its progress and keeps going until your tests pass.</span>
      </div>
      <ModelStatusLine className="mt-6" />
    </div>
  );
}

export function ModelOfflineBanner() {
  const caps = useStore((s) => s.caps);
  const probing = useStore((s) => s.probing);
  const probe = useStore((s) => s.probe);
  const openModal = useStore((s) => s.openModal);
  if (!caps || caps.reachable) return null;
  return (
    <div className="mx-auto mb-2 flex w-full max-w-[46rem] items-center gap-2.5 rounded-xl border border-warn/30 bg-warn/[0.07] px-3.5 py-2 text-xs text-fg-muted" role="status">
      <ServerCrash className="h-4 w-4 shrink-0 text-warn-ink" />
      <span className="min-w-0 flex-1">
        <span className="font-medium text-fg">Model server unreachable.</span> Start it, then run <code className="font-mono text-fg">npm run doctor</code> if it still fails.
      </span>
      <Button size="xs" variant="ghost" onClick={() => openModal('settings', 'models')}>
        Settings
      </Button>
      <Button size="xs" onClick={() => void probe(true)} disabled={probing}>
        {probing ? <Spinner className="h-3 w-3" /> : <RefreshCw className="h-3 w-3" />} Retry
      </Button>
    </div>
  );
}

export function ServerError({ error }: { error: string }) {
  const loadProjects = useStore((s) => s.loadProjects);
  return (
    <div className="flex h-full items-center justify-center p-8">
      <div className="max-w-md text-center">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl border border-danger/30 bg-danger/[0.07] text-danger-ink">
          <ServerCrash className="h-5 w-5" />
        </div>
        <h1 className="text-lg font-semibold text-fg">Can't reach the Hearth server</h1>
        <p className="mt-1.5 text-[13px] leading-relaxed text-fg-muted">
          The page loaded, but the API didn't answer ({error}). Make sure <code className="font-mono text-fg">npm start</code> is still running in your terminal, then try again.
        </p>
        <Button className="mt-5" variant="primary" onClick={() => void loadProjects()}>
          <RefreshCw className="h-3.5 w-3.5" /> Try again
        </Button>
      </div>
    </div>
  );
}
