import { useCallback, useEffect, useState } from 'react';
import { Brain, FileText, Plus, Puzzle, Search, Trash2 } from 'lucide-react';
import type { SkillInfo } from '@hearth/shared';
import { api, type Memory } from '../../api';
import { errText, useStore } from '../../store';
import { Markdown } from '../Markdown';
import { Badge, Button, cx, Empty, IconButton, relTime, Skeleton, Toggle } from '../ui';

const sourceTone = (s: string) => (s === 'builtin' ? 'neutral' : s === 'project' ? 'info' : 'violet');

export function SkillsTab() {
  const settings = useStore((s) => s.settings);
  const saveSettings = useStore((s) => s.saveSettings);
  const projectId = useStore((s) => s.projectId);
  const notify = useStore((s) => s.notify);
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
  const open = async (name: string) => {
    try {
      setView({ name, ...(await api.skill(name, projectId ?? undefined)) });
    } catch (e) {
      notify(errText(e), 'error');
    }
  };
  return (
    <div className="grid h-full grid-cols-2">
      <div className="space-y-2 overflow-auto border-r border-line p-5">
        <p className="pb-1 text-xs leading-relaxed text-fg-muted">
          Skills are folders with a <code className="font-mono text-fg">SKILL.md</code> (frontmatter: name, description). The agent sees each description and loads the full instructions on demand with <code className="font-mono text-fg">load_skill</code>. Locations: built-in{' '}
          <code className="font-mono text-fg">skills/</code>, your own in <code className="font-mono text-fg">data/skills/</code>, and per project in <code className="font-mono text-fg">.hearth/skills/</code> or <code className="font-mono text-fg">.claude/skills/</code>.
        </p>
        {skills === null && [0, 1, 2].map((i) => <Skeleton key={i} className="h-16" />)}
        {skills?.length === 0 && <Empty icon={<Puzzle />} title="No skills found" className="h-auto py-10" />}
        {skills?.map((s) => (
          <div key={s.name} className={cx('rounded-xl border bg-surface p-3 shadow-card transition-colors', view?.name === s.name ? 'border-accent/50' : 'border-line')}>
            <div className="flex items-center gap-2">
              <button type="button" className="min-w-0 truncate text-[13px] font-medium text-fg hover:text-accent-ink" onClick={() => open(s.name)}>
                {s.name}
              </button>
              <Badge tone={sourceTone(s.source)}>{s.source}</Badge>
              <div className="flex-1" />
              <Toggle checked={s.enabled} onChange={(v) => toggle(s.name, v)} label={<span className="sr-only">Enable {s.name}</span>} />
            </div>
            <div className={cx('mt-1 text-xs leading-relaxed', s.enabled ? 'text-fg-muted' : 'text-fg-faint')}>{s.description}</div>
          </div>
        ))}
      </div>
      <div className="overflow-auto p-5">
        {view ? (
          <>
            <div className="mb-3 flex items-center gap-2 text-[13px] font-semibold text-fg">
              <FileText className="h-4 w-4 text-fg-subtle" /> {view.name}
            </div>
            <Markdown text={view.body} className="text-[13px]" />
            {view.files.length > 0 && (
              <div className="mt-4 flex flex-wrap gap-1 border-t border-line pt-3">
                {view.files.map((f) => (
                  <span key={f} className="rounded border border-line bg-raised px-1.5 py-px font-mono text-[11px] text-fg-muted">
                    {f}
                  </span>
                ))}
              </div>
            )}
          </>
        ) : (
          <Empty icon={<FileText />} title="Preview a skill">
            Click a skill name to read its instructions.
          </Empty>
        )}
      </div>
    </div>
  );
}

export function MemoryTab() {
  const projectId = useStore((s) => s.projectId);
  const projects = useStore((s) => s.projects);
  const notify = useStore((s) => s.notify);
  const [list, setList] = useState<Memory[] | null>(null);
  const [q, setQ] = useState('');
  const [text, setText] = useState('');
  const [global, setGlobal] = useState(false);
  const load = useCallback(() => api.memories(projectId ?? undefined, q || undefined).then(setList, () => setList([])), [projectId, q]);
  useEffect(() => {
    void load();
  }, [load]);
  const name = (pid: string | null) => (pid ? (projects.find((p) => p.id === pid)?.name ?? 'project') : 'global');
  const add = async () => {
    try {
      await api.addMemory(text.trim(), global ? null : projectId);
      setText('');
      void load();
    } catch (e) {
      notify(errText(e), 'error');
    }
  };
  return (
    <div className="space-y-4 p-5">
      <p className="text-xs leading-relaxed text-fg-muted">
        Long-term memory uses SQLite full-text search. The agent saves facts with <code className="font-mono text-fg">memory_save</code> and relevant ones are recalled automatically. Per-project notes live in the project's <code className="font-mono text-fg">AGENTS.md</code>.
      </p>
      <form
        className="flex items-center gap-2 rounded-xl border border-line bg-surface p-2 shadow-card"
        onSubmit={(e) => {
          e.preventDefault();
          if (text.trim()) void add();
        }}
      >
        <input className="flex-1 border-transparent bg-transparent shadow-none" aria-label="New memory" placeholder="Remember that… (for example: use pnpm, not npm, in this project)" value={text} onChange={(e) => setText(e.target.value)} />
        <label className="flex shrink-0 items-center gap-1.5 text-xs text-fg-muted">
          <input type="checkbox" checked={global} onChange={(e) => setGlobal(e.target.checked)} /> All projects
        </label>
        <Button type="submit" variant="primary" size="sm" disabled={!text.trim()}>
          <Plus className="h-3.5 w-3.5" /> Add
        </Button>
      </form>
      <div className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-2.5 h-3.5 w-3.5 -translate-y-1/2 text-fg-subtle" />
        <input className="w-full pl-8" type="search" aria-label="Search memories" placeholder="Search memories" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      {list === null && [0, 1, 2].map((i) => <Skeleton key={i} className="h-12" />)}
      {list?.length === 0 && (
        <Empty icon={<Brain />} title={q ? 'No matching memories' : 'No memories yet'} className="h-auto py-10">
          {q ? 'Try a different search.' : 'The agent will add facts here as it learns about your projects.'}
        </Empty>
      )}
      {!!list?.length && (
        <div className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-surface shadow-card">
          {list.map((m) => (
            <div key={m.id} className="group flex items-start gap-3 px-3.5 py-2.5">
              <div className="min-w-0 flex-1">
                <div className="text-[13px] text-fg">{m.content}</div>
                <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-fg-subtle">
                  <Badge tone={m.projectId ? 'info' : 'neutral'}>{name(m.projectId)}</Badge>
                  <span>#{m.id}</span>·<span title={new Date(m.createdAt).toLocaleString()}>{relTime(m.createdAt)}</span>
                  {m.tags && <span>· {m.tags}</span>}
                </div>
              </div>
              <IconButton label="Delete memory" size="sm" className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100" onClick={() => api.deleteMemory(m.id).then(load)}>
                <Trash2 className="h-3.5 w-3.5" />
              </IconButton>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
