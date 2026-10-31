// Bottom status bar: model connection, tool mode, context, live run stats, theme and help.
import { Gauge, Keyboard, Moon, ShieldCheck, Sun, Zap } from 'lucide-react';
import { useStore } from '../store';
import { cx, Spinner, StatusDot } from './ui';

const approvalLabel = { ask: 'Ask first', 'auto-edit': 'Auto-edit', 'full-auto': 'Full auto' } as const;

function Item({ children, onClick, title, className = '' }: { children: React.ReactNode; onClick?: () => void; title?: string; className?: string }) {
  const cls = cx('inline-flex h-full shrink-0 items-center gap-1.5 px-2 whitespace-nowrap', onClick && 'hover:bg-raised hover:text-fg', className);
  return onClick ? (
    <button type="button" onClick={onClick} title={title} className={cls}>
      {children}
    </button>
  ) : (
    <span title={title} className={cls}>
      {children}
    </span>
  );
}

export function StatusBar() {
  const caps = useStore((s) => s.caps);
  const settings = useStore((s) => s.settings);
  const run = useStore((s) => s.run);
  const theme = useStore((s) => s.theme);
  const setThemePref = useStore((s) => s.setThemePref);
  const openModal = useStore((s) => s.openModal);
  const probing = useStore((s) => s.probing);
  const profile = settings?.profiles.find((p) => p.id === settings.activeProfileId);
  const tone = caps == null ? 'neutral' : caps.reachable ? 'ok' : 'danger';
  const ctxPct = run.promptTokens && run.contextLimit ? Math.round((run.promptTokens / run.contextLimit) * 100) : null;

  return (
    <footer className="flex h-7 shrink-0 items-stretch overflow-hidden border-t border-line bg-sidebar px-1 text-[11.5px] text-fg-subtle" aria-label="Status bar">
      <Item onClick={() => openModal('settings', 'models')} title={caps?.reachable ? `Connected to ${profile?.baseUrl ?? 'model server'}` : (caps?.error ?? 'Checking model server…')}>
        {probing && !caps ? <Spinner className="h-3 w-3" /> : <StatusDot tone={tone} />}
        <span className="font-medium text-fg-muted">{profile?.name ?? 'model'}</span>
        <span>{caps == null ? 'checking…' : caps.reachable ? 'connected' : 'offline'}</span>
      </Item>
      {caps?.reachable && (
        <>
          <Item title={`Tool calling mode: ${caps.effectiveToolMode} (native=${caps.nativeTools}, template=${caps.templateTools})`} className="max-[1180px]:hidden">
            <Zap className="h-3 w-3" /> {caps.effectiveToolMode} tools
          </Item>
          {caps.maxModelLen ? (
            <Item title={`Context window: ${caps.maxModelLen.toLocaleString('en-US')} tokens`} className="max-[1100px]:hidden">
              {Math.round(caps.maxModelLen / 1024)}k context
            </Item>
          ) : null}
        </>
      )}
      {run.running && (
        <Item className="text-accent-ink" title={run.waiting ? 'Waiting for you' : 'The agent is working'}>
          <span className="relative flex h-2 w-2">
            <span className="absolute inset-0 animate-ping rounded-full bg-accent opacity-60" />
            <span className="relative h-2 w-2 rounded-full bg-accent" />
          </span>
          {run.waiting ? 'Waiting for you' : `${run.longRun ? 'Long-run · ' : ''}Running · step ${run.step || 1}`}
        </Item>
      )}
      {run.tokensPerSec ? (
        <Item title="Generation speed of the last model call">
          <Gauge className="h-3 w-3" /> {Math.round(run.tokensPerSec)} tok/s
        </Item>
      ) : null}
      {ctxPct !== null && <Item title={`Context used: ${run.promptTokens!.toLocaleString('en-US')} / ${run.contextLimit!.toLocaleString('en-US')} tokens`}>ctx {ctxPct}%</Item>}
      <div className="flex-1" />
      {settings && (
        <Item onClick={() => openModal('settings', 'agent')} title="Approval mode (change in the composer or Settings → Agent)" className={settings.approvalMode === 'full-auto' ? 'text-warn-ink' : ''}>
          <ShieldCheck className="h-3 w-3" /> {approvalLabel[settings.approvalMode]}
        </Item>
      )}
      <Item onClick={() => setThemePref(theme === 'dark' ? 'light' : 'dark')} title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}>
        {theme === 'dark' ? <Moon className="h-3 w-3" /> : <Sun className="h-3 w-3" />}
        <span className="max-[1180px]:hidden">{theme === 'dark' ? 'Dark' : 'Light'}</span>
      </Item>
      <Item onClick={() => openModal('shortcuts')} title="Keyboard shortcuts">
        <Keyboard className="h-3 w-3" /> <span className="max-[1180px]:hidden">Shortcuts</span>
      </Item>
    </footer>
  );
}
