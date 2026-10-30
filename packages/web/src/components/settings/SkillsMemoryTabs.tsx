import { useCallback, useEffect, useState } from 'react';
import { Plus, Search, Trash } from 'lucide-react';
import type { SkillInfo } from '@hearth/shared';
import { api, type Memory } from '../../api';
import { errText, useStore } from '../../store';
import { Markdown } from '../Markdown';
import { Badge, Button, fmtTime, IconButton, Spinner, Toggle } from '../ui';

export function SkillsTab() {
  const { settings, saveSettings, projectId, notify } = useStore();
  const [skills, setSkills] = useState<SkillInfo[] | null>(null);
  const [view, setView] = useState<{ name: string; body: string; files: string[] } | null>(null);
  useEffect(() => {
    void api.skills(projectId ?? undefined).then(setSkills, () => setSkills([]));
  }, [projectId, settings?.disabledSkills]);
  const toggle = async (name: string, enabled: boolean) => {
    const disabled = new Set(settings?.disabledSkills ?? []);
    if (enabled) disabled.delete(name);
    else disabled.add(name);
    await saveSettings({ disabledSkills: [...disabled] }).catch((e) => notify(errText(e), 'error'));
  };
  return (
    <div className="grid h-full grid-cols-2">
      <div className="space-y-2 overflow-auto border-r border-zinc-800 p-4">
        <p className="text-xs text-zinc-400">
          Skills are folders with a <code>SKILL.md</code> (frontmatter: name, description). The agent sees each description and loads the full instructions on demand with <code>load_skill</code>. Locations: built-in <code>skills/</code>, your own in{' '}
          <code>data/skills/</code>, and per project in <code>.hearth/skills/</code> or <code>.claude/skills/</code>.
        </p>
        {skills === null && <Spinner />}
        {skills?.map((s) => (
          <div key={s.name} className="rounded-md border border-zinc-800 p-2">
            <div className="flex items-center gap-2">
              <button className="font-medium text-zinc-200 hover:text-orange-300" onClick={async () => setView({ name: s.name, ...(await api.skill(s.name, projectId ?? undefined)) })}>
                {s.name}
              </button>
              <Badge>{s.source}</Badge>
              <div className="flex-1" />
              <Toggle checked={s.enabled} onChange={(v) => toggle(s.name, v)} />
            </div>
            <div className="mt-1 text-xs text-zinc-500">{s.description}</div>
          </div>
        ))}
      </div>
      <div className="overflow-auto p-4">
        {view ? (
          <>
            <Markdown text={view.body} className="text-xs" />
            {view.files.length > 0 && <div className="mt-3 text-xs text-zinc-500">Files: {view.files.join(', ')}</div>}
          </>
        ) : (
          <div className="text-xs text-zinc-500">Click a skill name to preview its instructions.</div>
        )}
      </div>
    </div>
  );
}

export function MemoryTab() {
  const { projectId, projects, notify } = useStore();
  const [list, setList] = useState<Memory[] | null>(null);
  const [q, setQ] = useState('');
  const [text, setText] = useState('');
  const [global, setGlobal] = useState(false);
  const load = useCallback(() => api.memories(projectId ?? undefined, q || undefined).then(setList, () => setList([])), [projectId, q]);
  useEffect(() => {
    void load();
  }, [load]);
  const name = (pid: string | null) => (pid ? (projects.find((p) => p.id === pid)?.name ?? 'project') : 'global');
  return (
    <div className="space-y-3 p-4">
      <p className="text-xs text-zinc-400">
        Long-term memory (SQLite full-text search). The agent saves facts with <code>memory_save</code> and relevant ones are recalled automatically. Per-project notes live in the project's <code>AGENTS.md</code>.
      </p>
      <div className="flex gap-2">
        <input className="flex-1" placeholder="Remember that… (e.g. 'Use pnpm, not npm, in this project')" value={text} onChange={(e) => setText(e.target.value)} />
        <label className="flex items-center gap-1 text-xs text-zinc-400">
          <input type="checkbox" checked={global} onChange={(e) => setGlobal(e.target.checked)} /> all projects
        </label>
        <Button
          disabled={!text.trim()}
          onClick={async () => {
            try {
              await api.addMemory(text.trim(), global ? null : projectId);
              setText('');
              void load();
            } catch (e) {
              notify(errText(e), 'error');
            }
          }}
        >
          <Plus className="h-3.5 w-3.5" /> Add
        </Button>
      </div>
      <div className="flex items-center gap-2">
        <Search className="h-4 w-4 text-zinc-500" />
        <input className="flex-1" placeholder="Search memories" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      {list === null && <Spinner />}
      {list?.length === 0 && <div className="text-xs text-zinc-500">No memories yet.</div>}
      <div className="space-y-1">
        {list?.map((m) => (
          <div key={m.id} className="flex items-start gap-2 rounded-md border border-zinc-800 px-2 py-1.5 text-sm">
            <div className="min-w-0 flex-1">
              <div className="text-zinc-200">{m.content}</div>
              <div className="text-[11px] text-zinc-500">
                #{m.id} · {name(m.projectId)} · {fmtTime(m.createdAt)} {m.tags && `· ${m.tags}`}
              </div>
            </div>
            <IconButton title="Delete" onClick={() => api.deleteMemory(m.id).then(load)}>
              <Trash className="h-3.5 w-3.5" />
            </IconButton>
          </div>
        ))}
      </div>
    </div>
  );
}
