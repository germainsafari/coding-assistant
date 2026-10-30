import { useEffect, useState } from 'react';
import type { Settings } from '@hearth/shared';
import { errText, useStore } from '../../store';
import { Button, Toggle } from '../ui';

type Draft = Pick<Settings, 'approvalMode' | 'maxSteps' | 'shellTimeoutSec' | 'compactAt' | 'projectsDir' | 'memoryAutoRecall' | 'longRun' | 'otel' | 'languageToolUrl'>;

export function AgentTab() {
  const { settings, saveSettings, notify } = useStore();
  const [d, setD] = useState<Draft | null>(null);
  useEffect(() => {
    if (settings) {
      const { approvalMode, maxSteps, shellTimeoutSec, compactAt, projectsDir, memoryAutoRecall, longRun, otel, languageToolUrl } = settings;
      setD({ approvalMode, maxSteps, shellTimeoutSec, compactAt, projectsDir, memoryAutoRecall, longRun, otel, languageToolUrl });
    }
  }, [settings]);
  if (!d) return null;
  const set = (patch: Partial<Draft>) => setD({ ...d, ...patch });
  const lr = (patch: Partial<Draft['longRun']>) => set({ longRun: { ...d.longRun, ...patch } });

  return (
    <div className="max-w-3xl space-y-6 p-4">
      <section className="space-y-3">
        <h3 className="text-sm font-semibold text-zinc-200">Safety & approvals</h3>
        <label className="field">
          Approval mode
          <select value={d.approvalMode} onChange={(e) => set({ approvalMode: e.target.value as Draft['approvalMode'] })}>
            <option value="ask">Ask: approve every file edit and command</option>
            <option value="auto-edit">Auto-edit: edits are automatic, commands need approval (read-only commands are allowed)</option>
            <option value="full-auto">Full auto: everything automatic (dangerous commands are always blocked)</option>
          </select>
        </label>
        <p className="text-xs text-zinc-500">The agent can only touch files inside the project folder. A denylist blocks destructive commands (rm -rf /, format, shutdown, force-push, sudo, curl | sh…) in every mode.</p>
      </section>
      <section className="grid grid-cols-3 gap-3">
        <h3 className="col-span-3 text-sm font-semibold text-zinc-200">Agent loop</h3>
        <label className="field">
          Max steps per run
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
          <input className="font-mono" value={d.projectsDir} onChange={(e) => set({ projectsDir: e.target.value })} />
        </label>
        <div className="col-span-3">
          <Toggle checked={d.memoryAutoRecall} onChange={(v) => set({ memoryAutoRecall: v })} label="Automatically recall relevant long-term memories into the prompt" />
        </div>
      </section>
      <section className="grid grid-cols-3 gap-3">
        <h3 className="col-span-3 text-sm font-semibold text-zinc-200">Long-run mode defaults</h3>
        <label className="field col-span-3">
          Default definition-of-done command (empty = none; can be set per run)
          <input className="font-mono" value={d.longRun.doneCommand} onChange={(e) => lr({ doneCommand: e.target.value })} placeholder="npm test" />
        </label>
        <label className="field">
          Time budget (minutes)
          <input type="number" min={1} value={d.longRun.maxMinutes} onChange={(e) => lr({ maxMinutes: Number(e.target.value) })} />
        </label>
        <label className="field">
          Step budget
          <input type="number" min={5} value={d.longRun.maxSteps} onChange={(e) => lr({ maxSteps: Number(e.target.value) })} />
        </label>
        <label className="field">
          Verification attempts
          <input type="number" min={1} value={d.longRun.maxVerifyAttempts} onChange={(e) => lr({ maxVerifyAttempts: Number(e.target.value) })} />
        </label>
        <div className="col-span-3">
          <Toggle checked={d.longRun.autoResume} onChange={(v) => lr({ autoResume: v })} label="Auto-resume interrupted long runs when Hearth restarts" />
        </div>
      </section>
      <section className="grid grid-cols-3 gap-3">
        <h3 className="col-span-3 text-sm font-semibold text-zinc-200">Observability</h3>
        <div className="col-span-3">
          <Toggle checked={d.otel.enabled} onChange={(v) => set({ otel: { ...d.otel, enabled: v } })} label="Export finished runs to OpenTelemetry (OTLP/HTTP JSON)" />
        </div>
        <label className="field col-span-3">
          OTLP traces endpoint
          <input className="font-mono" value={d.otel.endpoint} onChange={(e) => set({ otel: { ...d.otel, endpoint: e.target.value } })} />
        </label>
      </section>
      <div className="border-t border-zinc-800 pt-3">
        <Button
          variant="primary"
          onClick={async () => {
            try {
              await saveSettings(d);
              notify('Settings saved');
            } catch (e) {
              notify(errText(e), 'error');
            }
          }}
        >
          Save
        </Button>
      </div>
    </div>
  );
}
