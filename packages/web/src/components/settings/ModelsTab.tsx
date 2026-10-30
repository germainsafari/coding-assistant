import { useEffect, useState } from 'react';
import { Check, Copy, Plus, RefreshCw, Trash } from 'lucide-react';
import type { Capabilities, ModelProfile } from '@hearth/shared';
import { api } from '../../api';
import { errText, useStore } from '../../store';
import { Badge, Button, Spinner, Toggle } from '../ui';

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
  const { settings, saveSettings, notify, probe } = useStore();
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
      notify('Model profiles saved');
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
  const c = caps[p.id];

  return (
    <div className="flex h-full">
      <div className="w-56 shrink-0 space-y-1 border-r border-zinc-800 p-2">
        {profiles.map((x) => (
          <button key={x.id} onClick={() => setSel(x.id)} className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm ${x.id === p.id ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-400 hover:bg-zinc-800/50'}`}>
            <span className="min-w-0 flex-1 truncate">{x.name}</span>
            {settings?.activeProfileId === x.id && <Badge tone="orange">active</Badge>}
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
        <p className="pt-3 text-[11px] text-zinc-500">A profile is any OpenAI-compatible endpoint (vLLM, llama.cpp server, Ollama, LM Studio…). Use one per model, e.g. a second vLLM on port 8082.</p>
      </div>
      <div className="min-w-0 flex-1 space-y-4 overflow-auto p-4">
        <div className="grid grid-cols-2 gap-3">
          <label className="field">
            Profile name
            <input value={p.name} onChange={(e) => update({ name: e.target.value })} />
          </label>
          <label className="field">
            Model id (as served)
            <div className="flex gap-1">
              <input className="flex-1" value={p.model} onChange={(e) => update({ model: e.target.value })} placeholder="qwen3.6-35b-a3b" list={`models-${p.id}`} />
              <datalist id={`models-${p.id}`}>{c && c !== 'loading' && c.models.map((m) => <option key={m} value={m} />)}</datalist>
            </div>
          </label>
          <label className="field col-span-2">
            Base URL (OpenAI-compatible, ends with /v1)
            <input className="font-mono" value={p.baseUrl} onChange={(e) => update({ baseUrl: e.target.value })} />
          </label>
          <label className="field">
            API key (any value for local servers)
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
          <label className="field">
            Temperature
            <input type="number" step="0.05" min="0" max="2" value={p.temperature} onChange={(e) => update({ temperature: Number(e.target.value) })} />
          </label>
          <label className="field">
            Top-p
            <input type="number" step="0.01" min="0" max="1" value={p.topP} onChange={(e) => update({ topP: Number(e.target.value) })} />
          </label>
          <label className="field">
            Top-k (0 = server default)
            <input type="number" min="0" value={p.topK} onChange={(e) => update({ topK: Number(e.target.value) })} />
          </label>
          <label className="field">
            Max output tokens per step
            <input type="number" min="256" value={p.maxOutputTokens} onChange={(e) => update({ maxOutputTokens: Number(e.target.value) })} />
          </label>
          <label className="field">
            Context window (0 = auto from server)
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
        <div className="flex flex-wrap gap-6">
          <Toggle checked={p.thinking} onChange={(v) => update({ thinking: v })} label="Thinking / reasoning" />
          <Toggle checked={p.vision} onChange={(v) => update({ vision: v })} label="Vision (send screenshots)" />
        </div>
        <div className="flex flex-wrap items-center gap-2 border-t border-zinc-800 pt-3">
          <Button variant="primary" disabled={!dirty} onClick={save}>
            Save profiles
          </Button>
          <Button onClick={() => test(p.id)}>
            <RefreshCw className="h-3.5 w-3.5" /> Test connection
          </Button>
          <Button
            disabled={settings?.activeProfileId === p.id}
            onClick={async () => {
              if (dirty) await save();
              await saveSettings({ activeProfileId: p.id });
            }}
          >
            <Check className="h-3.5 w-3.5" /> Use this profile
          </Button>
          <div className="flex-1" />
          <Button
            variant="ghost"
            disabled={profiles.length <= 1}
            onClick={() => {
              const rest = profiles.filter((x) => x.id !== p.id);
              setProfiles(rest);
              setSel(rest[0].id);
              setDirty(true);
            }}
          >
            <Trash className="h-3.5 w-3.5" /> Delete
          </Button>
        </div>
        {c === 'loading' && <Spinner />}
        {c && c !== 'loading' && (
          <div className={`rounded-md border p-3 text-xs ${c.reachable ? 'border-emerald-900 bg-emerald-950/20 text-emerald-200' : 'border-rose-900 bg-rose-950/30 text-rose-200'}`}>
            {c.reachable ? (
              <>
                <div>✓ Reachable. Models: {c.models.join(', ') || '(none)'}</div>
                <div>Context window: {c.maxModelLen ?? 'unknown'} tokens · reasoning output: {c.reasoning ? 'yes' : 'no'}</div>
                <div>
                  Native tool calling: {c.nativeTools ? 'yes' : 'no'} · template tools: {c.templateTools ? 'yes' : 'no'} → Hearth uses <b>{c.effectiveToolMode}</b> mode
                </div>
                {!c.nativeTools && <div className="mt-1 text-amber-300">Tip: start vLLM with --enable-auto-tool-choice --tool-call-parser qwen3_coder for native tool calls (Hearth works without it, see docs/setup-guide.md).</div>}
              </>
            ) : (
              <div>✗ Not reachable: {c.error}</div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
