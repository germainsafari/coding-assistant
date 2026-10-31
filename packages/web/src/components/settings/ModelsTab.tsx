import { useEffect, useState } from 'react';
import { Check, CircleCheck, CircleX, Copy, Plus, RefreshCw, Trash2 } from 'lucide-react';
import type { Capabilities, ModelProfile } from '@hearth/shared';
import { api } from '../../api';
import { errText, useStore } from '../../store';
import { Badge, Button, cx, Section, Spinner, StatusDot, Toggle } from '../ui';

const blank = (n: number): ModelProfile => ({
  id: `profile-${Date.now().toString(36)}`,
  name: `New profile ${n}`,
  baseUrl: 'http://localhost:8082/v1',
  apiKey: 'local',
  model: '',
  temperature: 0.6,
  topP: 0.95,
  topK: 20,
  maxOutputTokens: 12000,
  contextLimit: 0,
  thinking: true,
  reasoningEffort: '',
  toolMode: 'auto',
  vision: false,
});

export function ModelsTab() {
  const settings = useStore((s) => s.settings);
  const saveSettings = useStore((s) => s.saveSettings);
  const notify = useStore((s) => s.notify);
  const probe = useStore((s) => s.probe);
  const activeCaps = useStore((s) => s.caps);
  const [profiles, setProfiles] = useState<ModelProfile[]>(settings?.profiles ?? []);
  const [sel, setSel] = useState(settings?.activeProfileId ?? profiles[0]?.id);
  const [caps, setCaps] = useState<Record<string, Capabilities | 'loading'>>({});
  const [dirty, setDirty] = useState(false);
  const p = profiles.find((x) => x.id === sel) ?? profiles[0];

  useEffect(() => {
    if (settings && !dirty) setProfiles(settings.profiles);
  }, [settings, dirty]);

  const update = (patch: Partial<ModelProfile>) => {
    setProfiles((ps) => ps.map((x) => (x.id === p.id ? { ...x, ...patch } : x)));
    setDirty(true);
  };
  const save = async () => {
    try {
      await saveSettings({ profiles });
      setDirty(false);
      notify('Model profiles saved', 'success');
    } catch (e) {
      notify(errText(e), 'error');
    }
  };
  const test = async (id: string) => {
    if (dirty) await save();
    setCaps((c) => ({ ...c, [id]: 'loading' }));
    try {
      const r = await api.capabilities(id, true);
      setCaps((c) => ({ ...c, [id]: r }));
      void probe();
    } catch (e) {
      notify(errText(e), 'error');
      setCaps((c) => ({ ...c, [id]: undefined as never }));
    }
  };
  if (!p) return null;
  const c = caps[p.id] ?? (p.id === settings?.activeProfileId && activeCaps ? activeCaps : undefined);
  const isActive = settings?.activeProfileId === p.id;

  return (
    <div className="flex h-full">
      <div className="flex w-56 shrink-0 flex-col gap-1 border-r border-line p-3">
        <div className="px-1 pb-1 text-[11px] font-medium tracking-wide text-fg-subtle uppercase">Profiles</div>
        {profiles.map((x) => (
          <button
            key={x.id}
            type="button"
            onClick={() => setSel(x.id)}
            aria-current={x.id === p.id ? 'true' : undefined}
            className={cx('flex h-8 w-full items-center gap-2 rounded-lg px-2.5 text-left text-[13px] transition-colors', x.id === p.id ? 'bg-raised text-fg shadow-card' : 'text-fg-muted hover:bg-raised/60')}
          >
            <span className="min-w-0 flex-1 truncate">{x.name}</span>
            {settings?.activeProfileId === x.id && (
              <Badge tone="accent" dot>
                active
              </Badge>
            )}
          </button>
        ))}
        <div className="flex gap-1 pt-2">
          <Button
            size="sm"
            onClick={() => {
              const n = blank(profiles.length + 1);
              setProfiles([...profiles, n]);
              setSel(n.id);
              setDirty(true);
            }}
          >
            <Plus className="h-3.5 w-3.5" /> Add
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              const n = { ...p, id: `profile-${Date.now().toString(36)}`, name: `${p.name} (copy)` };
              setProfiles([...profiles, n]);
              setSel(n.id);
              setDirty(true);
            }}
          >
            <Copy className="h-3.5 w-3.5" /> Duplicate
          </Button>
        </div>
        <p className="px-1 pt-3 text-[11.5px] leading-relaxed text-fg-subtle">A profile is any OpenAI-compatible endpoint: vLLM, llama.cpp server, Ollama, LM Studio… Use one per model, for example a second vLLM on port 8082.</p>
      </div>
      <div className="min-w-0 flex-1 space-y-4 overflow-auto p-5">
        {c && (
          <div className={cx('flex items-start gap-3 rounded-xl border p-3.5 text-xs', c === 'loading' ? 'border-line bg-surface' : c.reachable ? 'border-ok/30 bg-ok/[0.06]' : 'border-danger/30 bg-danger/[0.06]')}>
            {c === 'loading' ? (
              <>
                <Spinner /> <span className="text-fg-muted">Testing the connection…</span>
              </>
            ) : c.reachable ? (
              <>
                <CircleCheck className="h-4 w-4 shrink-0 text-ok" />
                <div className="min-w-0 flex-1 space-y-1 text-fg-muted">
                  <div className="text-[13px] font-medium text-fg">Connected</div>
                  <div className="flex flex-wrap gap-1.5">
                    {c.models.map((m) => (
                      <Badge key={m}>{m}</Badge>
                    ))}
                    <Badge tone="info">{c.maxModelLen ? `${c.maxModelLen.toLocaleString('en-US')} tokens` : 'context unknown'}</Badge>
                    <Badge tone={c.effectiveToolMode === 'native' ? 'ok' : 'warn'}>{c.effectiveToolMode} tool calling</Badge>
                    {c.reasoning && <Badge tone="violet">reasoning</Badge>}
                  </div>
                  {!c.nativeTools && <div className="text-warn-ink">Tip: start vLLM with --enable-auto-tool-choice --tool-call-parser qwen3_coder for native tool calls. Hearth also works without it.</div>}
                </div>
              </>
            ) : (
              <>
                <CircleX className="h-4 w-4 shrink-0 text-danger" />
                <div className="text-fg-muted">
                  <div className="text-[13px] font-medium text-fg">Not reachable</div>
                  {c.error}. Check the base URL, or run <code className="font-mono">npm run doctor</code>.
                </div>
              </>
            )}
          </div>
        )}
        <Section
          title={
            <span className="flex items-center gap-2">
              <StatusDot tone={c && c !== 'loading' ? (c.reachable ? 'ok' : 'danger') : 'neutral'} /> Connection
            </span>
          }
          description="Where the model is served and which model id to request."
        >
          <div className="grid grid-cols-2 gap-4">
            <label className="field">
              Profile name
              <input value={p.name} onChange={(e) => update({ name: e.target.value })} />
            </label>
            <label className="field">
              Model id (as served)
              <input value={p.model} onChange={(e) => update({ model: e.target.value })} placeholder="qwen3.6-35b-a3b" list={`models-${p.id}`} />
              <datalist id={`models-${p.id}`}>{c && c !== 'loading' && c.models.map((m) => <option key={m} value={m} />)}</datalist>
            </label>
            <label className="field col-span-2">
              Base URL <span className="hint">OpenAI-compatible, ends with /v1</span>
              <input className="font-mono text-[13px]" value={p.baseUrl} onChange={(e) => update({ baseUrl: e.target.value })} />
            </label>
            <label className="field">
              API key <span className="hint">any value for local servers</span>
              <input type="password" value={p.apiKey} onChange={(e) => update({ apiKey: e.target.value })} />
            </label>
            <label className="field">
              Tool calling
              <select value={p.toolMode} onChange={(e) => update({ toolMode: e.target.value as ModelProfile['toolMode'] })}>
                <option value="auto">Auto-detect (recommended)</option>
                <option value="native">Native (server parses tool calls)</option>
                <option value="template">Template (tools in chat template, Hearth parses)</option>
                <option value="prompt">Prompt (tools described in system prompt)</option>
              </select>
            </label>
          </div>
        </Section>
        <Section title="Generation" description="Sampling and limits for each step of the agent.">
          <div className="grid grid-cols-3 gap-4">
            <label className="field">
              Temperature
              <input type="number" step="0.05" min="0" max="2" value={p.temperature} onChange={(e) => update({ temperature: Number(e.target.value) })} />
            </label>
            <label className="field">
              Top-p
              <input type="number" step="0.01" min="0" max="1" value={p.topP} onChange={(e) => update({ topP: Number(e.target.value) })} />
            </label>
            <label className="field">
              Top-k <span className="hint">0 = server default</span>
              <input type="number" min="0" value={p.topK} onChange={(e) => update({ topK: Number(e.target.value) })} />
            </label>
            <label className="field">
              Max output tokens per step
              <input type="number" min="256" value={p.maxOutputTokens} onChange={(e) => update({ maxOutputTokens: Number(e.target.value) })} />
            </label>
            <label className="field">
              Context window <span className="hint">0 = from server</span>
              <input type="number" min="0" value={p.contextLimit} onChange={(e) => update({ contextLimit: Number(e.target.value) })} />
            </label>
            <label className="field">
              Reasoning effort
              <select value={p.reasoningEffort} onChange={(e) => update({ reasoningEffort: e.target.value as ModelProfile['reasoningEffort'] })}>
                <option value="">Not sent (model default)</option>
                <option value="low">low</option>
                <option value="medium">medium</option>
                <option value="high">high</option>
              </select>
            </label>
          </div>
          <div className="mt-5 flex flex-wrap gap-8">
            <Toggle checked={p.thinking} onChange={(v) => update({ thinking: v })} label="Thinking" description="Let the model reason before answering" />
            <Toggle checked={p.vision} onChange={(v) => update({ vision: v })} label="Vision" description="Send browser screenshots to the model" />
          </div>
        </Section>
        <div className="sticky bottom-0 -mx-5 -mb-5 flex flex-wrap items-center gap-2 border-t border-line bg-overlay/95 px-5 py-3 backdrop-blur">
          <Button variant="primary" disabled={!dirty} onClick={save}>
            Save changes
          </Button>
          <Button onClick={() => test(p.id)}>
            <RefreshCw className="h-3.5 w-3.5" /> Test connection
          </Button>
          <Button
            disabled={isActive}
            onClick={async () => {
              if (dirty) await save();
              await saveSettings({ activeProfileId: p.id });
            }}
          >
            <Check className="h-3.5 w-3.5" /> {isActive ? 'Active profile' : 'Use this profile'}
          </Button>
          <div className="flex-1" />
          <Button
            variant="danger-ghost"
            disabled={profiles.length <= 1}
            onClick={() => {
              const rest = profiles.filter((x) => x.id !== p.id);
              setProfiles(rest);
              setSel(rest[0].id);
              setDirty(true);
            }}
          >
            <Trash2 className="h-3.5 w-3.5" /> Delete profile
          </Button>
        </div>
      </div>
    </div>
  );
}
