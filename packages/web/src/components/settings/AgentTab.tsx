import { useEffect, useState } from 'react';
import type { Settings } from '@hearth/shared';
import { errText, useStore } from '../../store';
import { Button, Section, Toggle } from '../ui';

type Draft = Pick<Settings, 'approvalMode' | 'maxSteps' | 'shellTimeoutSec' | 'compactAt' | 'projectsDir' | 'memoryAutoRecall' | 'longRun' | 'longRunEnabled' | 'otel' | 'languageToolUrl'>;

export function AgentTab() {
  const settings = useStore((s) => s.settings);
  const saveSettings = useStore((s) => s.saveSettings);
  const notify = useStore((s) => s.notify);
  const [d, setD] = useState<Draft | null>(null);
  useEffect(() => {
    if (settings) {
      const { approvalMode, maxSteps, shellTimeoutSec, compactAt, projectsDir, memoryAutoRecall, longRun, longRunEnabled, otel, languageToolUrl } = settings;
      setD({ approvalMode, maxSteps, shellTimeoutSec, compactAt, projectsDir, memoryAutoRecall, longRun, longRunEnabled, otel, languageToolUrl });
    }
  }, [settings]);
  if (!d) return null;
  const set = (patch: Partial<Draft>) => setD({ ...d, ...patch });
  const lr = (patch: Partial<Draft['longRun']>) => set({ longRun: { ...d.longRun, ...patch } });

  return (
    <div className="space-y-4 p-5">
      <Section title="Safety & approvals" description="The agent can only touch files inside the project folder. A deny list blocks destructive commands (rm -rf /, format, shutdown, force-push, sudo, curl | sh…) in every mode.">
        <label className="field">
          Approval mode
          <select value={d.approvalMode} onChange={(e) => set({ approvalMode: e.target.value as Draft['approvalMode'] })}>
            <option value="ask">Ask first: approve every file edit and command</option>
            <option value="auto-edit">Auto-edit: edits are automatic, commands need approval (read-only commands are allowed)</option>
            <option value="full-auto">Full auto: everything automatic (dangerous commands are always blocked)</option>
          </select>
        </label>
      </Section>
      <Section title="Agent loop" description="A step is one model turn (it may call several tools). Hitting the limit is a checkpoint: Hearth saves progress and continues automatically unless you turn that off below.">
        <div className="grid grid-cols-3 gap-4">
          <label className="field">
            Steps per checkpoint
            <input type="number" min={1} value={d.maxSteps} onChange={(e) => set({ maxSteps: Number(e.target.value) })} />
          </label>
          <label className="field">
            Shell timeout (seconds)
            <input type="number" min={5} value={d.shellTimeoutSec} onChange={(e) => set({ shellTimeoutSec: Number(e.target.value) })} />
          </label>
          <label className="field">
            Compact context at (% of window)
            <input type="number" min={30} max={90} value={Math.round(d.compactAt * 100)} onChange={(e) => set({ compactAt: Number(e.target.value) / 100 })} />
          </label>
          <label className="field col-span-3">
            Folder for new projects
            <input className="font-mono text-[13px]" value={d.projectsDir} onChange={(e) => set({ projectsDir: e.target.value })} />
          </label>
          <div className="col-span-3 pt-1">
            <Toggle checked={d.memoryAutoRecall} onChange={(v) => set({ memoryAutoRecall: v })} label="Recall memories automatically" description="Add relevant long-term memories to the prompt of every run" />
          </div>
        </div>
      </Section>
      <Section title="Long-run mode defaults" description="Used when Long-run is on in the composer (it stays on until you turn it off). The agent follows the plan strictly, writes .agent/plan.md and .agent/progress.md, and only finishes when the plan is done.">
        <div className="grid grid-cols-3 gap-4">
          <div className="col-span-3">
            <Toggle checked={d.longRunEnabled} onChange={(v) => set({ longRunEnabled: v })} label="Long-run on by default" description="New messages use long-run until you toggle it off in the composer" />
          </div>
          <label className="field col-span-3">
            Definition-of-done command <span className="hint">empty = none; the run only finishes when this exits 0</span>
            <input className="font-mono text-[13px]" value={d.longRun.doneCommand} onChange={(e) => lr({ doneCommand: e.target.value })} placeholder="npm test" />
          </label>
          <label className="field">
            Time budget (minutes)
            <input type="number" min={1} value={d.longRun.maxMinutes} onChange={(e) => lr({ maxMinutes: Number(e.target.value) })} />
          </label>
          <label className="field">
            Steps per checkpoint
            <input type="number" min={5} value={d.longRun.maxSteps} onChange={(e) => lr({ maxSteps: Number(e.target.value) })} />
          </label>
          <label className="field">
            Verification attempts
            <input type="number" min={1} value={d.longRun.maxVerifyAttempts} onChange={(e) => lr({ maxVerifyAttempts: Number(e.target.value) })} />
          </label>
          <div className="col-span-3 space-y-3 pt-1">
            <Toggle checked={d.longRun.autoContinue !== false} onChange={(v) => lr({ autoContinue: v })} label="Continue automatically at a checkpoint" description="Save progress and keep going when the step or time budget is reached, instead of waiting for Resume" />
            <Toggle checked={d.longRun.autoResume} onChange={(v) => lr({ autoResume: v })} label="Auto-resume after a restart" description="Continue interrupted long runs when Hearth starts again" />
          </div>
        </div>
      </Section>
      <Section title="Observability" description="Every run is always recorded locally (see Traces). Optionally export it to an OpenTelemetry collector such as Jaeger.">
        <div className="space-y-4">
          <Toggle checked={d.otel.enabled} onChange={(v) => set({ otel: { ...d.otel, enabled: v } })} label="Export finished runs to OpenTelemetry" description="OTLP/HTTP JSON" />
          <label className="field">
            OTLP traces endpoint
            <input className="font-mono text-[13px]" value={d.otel.endpoint} onChange={(e) => set({ otel: { ...d.otel, endpoint: e.target.value } })} />
          </label>
        </div>
      </Section>
      <div className="flex justify-end">
        <Button
          variant="primary"
          onClick={async () => {
            try {
              await saveSettings(d);
              notify('Settings saved', 'success');
            } catch (e) {
              notify(errText(e), 'error');
            }
          }}
        >
          Save changes
        </Button>
      </div>
    </div>
  );
}
