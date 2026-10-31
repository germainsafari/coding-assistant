import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ArrowUp, Cpu, Infinity as InfinityIcon, ShieldCheck, Square } from 'lucide-react';
import type { ApprovalMode } from '@hearth/shared';
import { api } from '../api';
import { errText, useStore } from '../store';
import type { LiveState } from './useThread';
import { cx, Keys, Spinner, StatusDot } from '../components/ui';

const APPROVAL: Record<ApprovalMode, { label: string; hint: string }> = {
  ask: { label: 'Ask first', hint: 'Approve every file edit and command' },
  'auto-edit': { label: 'Auto-edit', hint: 'Edits are automatic; commands need approval' },
  'full-auto': { label: 'Full auto', hint: 'Everything automatic (dangerous commands are still blocked)' },
};

/** A native <select> dressed as a toolbar pill. */
function PillSelect({ icon, value, onChange, label, title, children, className = '' }: { icon: ReactNode; value: string; onChange: (v: string) => void; label: string; title?: string; children: ReactNode; className?: string }) {
  return (
    <label className={cx('relative inline-flex h-7 min-w-0 items-center', className)} title={title}>
      <span className="pointer-events-none absolute left-2 flex items-center text-fg-subtle">{icon}</span>
      <select
        aria-label={label}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-7 w-full min-w-0 truncate rounded-md border-transparent bg-transparent py-0 pr-6 pl-7 text-xs font-medium text-fg-muted shadow-none hover:bg-raised hover:text-fg focus:border-line-strong"
      >
        {children}
      </select>
    </label>
  );
}

function ContextRing({ pct, title }: { pct: number; title: string }) {
  const r = 7;
  const c = 2 * Math.PI * r;
  const tone = pct > 85 ? 'var(--hx-danger)' : pct > 65 ? 'var(--hx-warn)' : 'var(--hx-fg-subtle)';
  return (
    <span className="inline-flex items-center gap-1.5 text-[11px] text-fg-subtle tabular-nums" title={title}>
      <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden>
        <circle cx="9" cy="9" r={r} fill="none" stroke="var(--hx-line-strong)" strokeWidth="2" />
        <circle cx="9" cy="9" r={r} fill="none" stroke={tone} strokeWidth="2" strokeDasharray={`${(pct / 100) * c} ${c}`} strokeLinecap="round" transform="rotate(-90 9 9)" />
      </svg>
      {pct}%
    </span>
  );
}

export function Composer({ projectId, projectName, running, live, onStarted, reload }: { projectId: string; projectName: string; running: boolean; live: LiveState; onStarted: (runId: string) => void; reload: () => Promise<unknown> }) {
  const settings = useStore((s) => s.settings);
  const saveSettings = useStore((s) => s.saveSettings);
  const threadId = useStore((s) => s.threadId);
  const selectThread = useStore((s) => s.selectThread);
  const loadThreads = useStore((s) => s.loadThreads);
  const notify = useStore((s) => s.notify);
  const caps = useStore((s) => s.caps);
  const [text, setText] = useState('');
  const [longRun, setLongRun] = useState(false);
  const [doneCommand, setDoneCommand] = useState('');
  const [maxMinutes, setMaxMinutes] = useState<number | ''>('');
  const [busy, setBusy] = useState(false);
  const ta = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const onPrefill = (e: Event) => {
      setText((e as CustomEvent<string>).detail);
      ta.current?.focus();
    };
    const onFocus = () => ta.current?.focus();
    window.addEventListener('hearth:prefill', onPrefill);
    window.addEventListener('hearth:focus-composer', onFocus);
    return () => {
      window.removeEventListener('hearth:prefill', onPrefill);
      window.removeEventListener('hearth:focus-composer', onFocus);
    };
  }, []);
  useEffect(() => {
    const el = ta.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(window.innerHeight * 0.4, el.scrollHeight)}px`;
  }, [text]);

  const send = async () => {
    const message = text.trim();
    if (!message || busy || running) return;
    setBusy(true);
    try {
      const body = { message, longRun: longRun ? { enabled: true, doneCommand: doneCommand.trim(), maxMinutes: maxMinutes || undefined } : undefined };
      if (!threadId) {
        const t = await api.createThread(projectId);
        await api.startRun(t.id, body);
        await loadThreads(projectId);
        selectThread(t.id); // the thread view attaches to the active run on load
      } else {
        const { runId } = await api.startRun(threadId, body);
        onStarted(runId);
        void reload();
      }
      setText('');
    } catch (e) {
      notify(errText(e), 'error');
    } finally {
      setBusy(false);
    }
  };
  const stop = () => {
    if (live.runId) void api.cancelRun(live.runId);
  };

  const usagePct = live.usage ? Math.min(100, Math.round((live.usage.promptTokens / live.usage.contextLimit) * 100)) : null;
  const mode = settings?.approvalMode ?? 'auto-edit';
  const canSend = !!text.trim() && !busy;
  const modelTone = caps == null ? 'neutral' : caps.reachable ? 'ok' : 'danger';

  return (
    <div className="shrink-0 px-6 pb-4">
      <div className="@container mx-auto max-w-[46rem]">
        <div
          className={cx(
            'rounded-2xl border bg-surface shadow-composer transition-[border-color,box-shadow] duration-150',
            'border-line-strong focus-within:border-accent/50 focus-within:shadow-[var(--hx-shadow-composer),0_0_0_3px_color-mix(in_oklab,var(--hx-accent)_14%,transparent)]',
          )}
        >
          <textarea
            ref={ta}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                void send();
              } else if (e.key === 'Escape' && running) {
                e.preventDefault();
                e.stopPropagation();
                stop();
              }
            }}
            rows={2}
            aria-label="Message Hearth"
            placeholder={running ? 'Hearth is working… you can type the next message' : `Ask Hearth to build, fix or explain something in ${projectName}`}
            className="block max-h-[40vh] min-h-[56px] w-full resize-none rounded-t-2xl border-0 bg-transparent px-4 pt-3.5 pb-1 text-[14px] leading-relaxed shadow-none focus:shadow-none"
          />
          {longRun && (
            <div className="mx-2 mb-1.5 flex animate-slide-up flex-wrap items-center gap-x-2 gap-y-1.5 rounded-lg border border-accent/25 bg-accent/[0.06] px-3 py-2 text-xs text-fg-muted">
              <InfinityIcon className="h-3.5 w-3.5 text-accent-ink" />
              <span className="font-medium text-fg">Long-run</span>
              <span>done when</span>
              <input
                className="h-6 min-w-40 flex-1 py-0 font-mono text-xs"
                aria-label="Definition-of-done command"
                placeholder={settings?.longRun.doneCommand || 'npm test (optional)'}
                value={doneCommand}
                onChange={(e) => setDoneCommand(e.target.value)}
              />
              <span>exits 0 · budget</span>
              <input
                className="h-6 w-16 py-0 text-xs"
                type="number"
                min={1}
                aria-label="Time budget in minutes"
                placeholder={String(settings?.longRun.maxMinutes ?? 240)}
                value={maxMinutes}
                onChange={(e) => setMaxMinutes(e.target.value ? Number(e.target.value) : '')}
              />
              <span>min</span>
            </div>
          )}
          <div className="flex items-center gap-0.5 px-2 pb-2">
            <PillSelect
              icon={<span className="flex items-center gap-1.5"><Cpu className="h-3.5 w-3.5" /></span>}
              label="Model profile"
              value={settings?.activeProfileId ?? ''}
              onChange={(v) => void saveSettings({ activeProfileId: v })}
              title={caps?.reachable ? `Connected · ${caps.effectiveToolMode} tool calling · ${caps.maxModelLen ? `${Math.round(caps.maxModelLen / 1024)}k context` : 'context unknown'}` : (caps?.error ?? 'Model server status unknown')}
              className="max-w-32 @[34rem]:max-w-48"
            >
              {settings?.profiles.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </PillSelect>
            <StatusDot tone={modelTone} className="-ml-1 mr-1" />
            <PillSelect icon={<ShieldCheck className="h-3.5 w-3.5" />} label="Approval mode" value={mode} onChange={(v) => void saveSettings({ approvalMode: v as ApprovalMode })} title={APPROVAL[mode].hint} className="shrink-0">
              {(Object.keys(APPROVAL) as ApprovalMode[]).map((k) => (
                <option key={k} value={k}>
                  {APPROVAL[k].label}
                </option>
              ))}
            </PillSelect>
            <button
              type="button"
              onClick={() => setLongRun(!longRun)}
              aria-pressed={longRun}
              aria-label="Long-run"
              title="Long-run mode: works autonomously for hours with a plan file, progress log, checkpoints and a definition-of-done check"
              className={cx('inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md px-2 text-xs font-medium transition-colors', longRun ? 'bg-accent/12 text-accent-ink' : 'text-fg-muted hover:bg-raised hover:text-fg')}
            >
              <InfinityIcon className="h-3.5 w-3.5" /> <span className="hidden @[28rem]:inline">Long-run</span>
            </button>
            <div className="min-w-2 flex-1" />
            {usagePct !== null && <ContextRing pct={usagePct} title={`Context used: ${live.usage!.promptTokens.toLocaleString('en-US')} of ${live.usage!.contextLimit.toLocaleString('en-US')} tokens`} />}
            {running ? (
              <button type="button" onClick={stop} title="Stop the agent (Esc)" aria-label="Stop the agent" className="ml-2 inline-flex h-8 items-center gap-1.5 rounded-full bg-primary px-3 text-xs font-medium text-primary-fg shadow-card hover:bg-primary-hover">
                <Square className="h-3 w-3 fill-current" /> Stop
              </button>
            ) : (
              <button
                type="button"
                onClick={() => void send()}
                disabled={!canSend}
                title="Send (Enter)"
                aria-label="Send message"
                className="ml-2 inline-flex h-8 w-8 items-center justify-center rounded-full bg-accent text-white shadow-card transition-[background-color,opacity,transform] hover:bg-accent-hover active:scale-95 disabled:bg-line-strong disabled:text-fg-faint disabled:shadow-none"
              >
                {busy ? <Spinner className="h-4 w-4 text-white" /> : <ArrowUp className="h-4 w-4" strokeWidth={2.5} />}
              </button>
            )}
          </div>
        </div>
        <div className="mt-1.5 flex h-4 items-center justify-between gap-3 px-1 text-[11px] text-fg-subtle">
          {mode === 'full-auto' ? <span className="truncate text-warn-ink">Full auto: commands run without asking. Dangerous commands are still blocked.</span> : <span className="truncate">Runs locally on your machine. Files stay in this project.</span>}
          <span className="hidden shrink-0 items-center gap-3 @[36rem]:flex">
            {running ? (
              <span className="flex items-center gap-1">
                <Keys keys={['Esc']} /> stop
              </span>
            ) : (
              <span className="flex items-center gap-1">
                <Keys keys={['↵']} /> send
              </span>
            )}
            <span className="flex items-center gap-1">
              <Keys keys={['Shift', '↵']} /> new line
            </span>
          </span>
        </div>
      </div>
    </div>
  );
}
