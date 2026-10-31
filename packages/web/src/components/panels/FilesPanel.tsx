import { useCallback, useEffect, useState } from 'react';
import Editor from '@monaco-editor/react';
import { ChevronRight, FileCode2, FileJson, FileText, Folder, FolderOpen, RefreshCw, Save } from 'lucide-react';
import { api, type FileEntry } from '../../api';
import { errText, useStore } from '../../store';
import { languageFor } from '../../monaco';
import { Button, cx, Empty, IconButton, MOD, Skeleton, Spinner } from '../ui';

const CODE_EXT = /\.(ts|tsx|js|jsx|mjs|cjs|py|rs|go|java|c|h|cpp|cs|rb|php|sh|ps1|css|scss|html|vue|svelte|sql|kt|swift|lua)$/i;
const fileIcon = (name: string) => (CODE_EXT.test(name) ? FileCode2 : /\.(json|ya?ml|toml|ini)$/i.test(name) ? FileJson : FileText);

const editorOptions = {
  fontSize: 13,
  lineHeight: 20,
  fontFamily: "'JetBrains Mono Variable', 'JetBrains Mono', 'Cascadia Code', Consolas, monospace",
  fontLigatures: false,
  minimap: { enabled: false },
  scrollBeyondLastLine: false,
  wordWrap: 'off' as const,
  automaticLayout: true,
  tabSize: 2,
  padding: { top: 10, bottom: 10 },
  smoothScrolling: true,
  cursorBlinking: 'smooth' as const,
  renderLineHighlight: 'line' as const,
  scrollbar: { verticalScrollbarSize: 10, horizontalScrollbarSize: 10 },
};

export default function FilesPanel({ projectId }: { projectId: string }) {
  const fsVersion = useStore((s) => s.fsVersion);
  const openFile = useStore((s) => s.openFile);
  const setOpenFile = useStore((s) => s.setOpenFile);
  const notify = useStore((s) => s.notify);
  const theme = useStore((s) => s.theme);
  const [children, setChildren] = useState<Record<string, FileEntry[]>>({});
  const [expanded, setExpanded] = useState<Set<string>>(new Set(['.']));
  const [file, setFile] = useState<{ path: string; content: string; binary: boolean } | null>(null);
  const [draft, setDraft] = useState('');
  const [loadingFile, setLoadingFile] = useState(false);
  const dirty = !!file && !file.binary && draft !== file.content;

  const loadDir = useCallback(
    async (p: string) => {
      try {
        const list = await api.files(projectId, p);
        setChildren((c) => ({ ...c, [p]: list }));
      } catch (e) {
        setChildren((c) => ({ ...c, [p]: [] }));
        if (p === '.') notify(errText(e), 'error');
      }
    },
    [projectId, notify],
  );

  useEffect(() => {
    setChildren({});
    setExpanded(new Set(['.']));
    setFile(null);
  }, [projectId]);

  // (re)load all expanded folders on project change / file changes
  useEffect(() => {
    for (const d of expanded) void loadDir(d);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, fsVersion]);

  const openPath = useCallback(
    async (p: string, keepDraft = false) => {
      setLoadingFile(true);
      try {
        const f = await api.file(projectId, p);
        setFile({ path: f.path, content: f.content, binary: f.binary });
        if (!keepDraft) setDraft(f.content);
      } catch (e) {
        notify(errText(e), 'error');
      } finally {
        setLoadingFile(false);
      }
    },
    [projectId, notify],
  );

  useEffect(() => {
    if (openFile && openFile !== file?.path) void openPath(openFile);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openFile]);

  // agent changed files: refresh the open file unless the user has unsaved edits
  useEffect(() => {
    if (file && !dirty) void openPath(file.path);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fsVersion]);

  const save = async () => {
    if (!file) return;
    try {
      await api.saveFile(projectId, file.path, draft);
      setFile({ ...file, content: draft });
      notify(`Saved ${file.path}`, 'success');
    } catch (e) {
      notify(errText(e), 'error');
    }
  };

  const toggle = (p: string) => {
    const next = new Set(expanded);
    if (next.has(p)) next.delete(p);
    else {
      next.add(p);
      if (!children[p]) void loadDir(p);
    }
    setExpanded(next);
  };

  const renderDir = (p: string, depth: number) =>
    (children[p] ?? []).map((e) => {
      const Icon = fileIcon(e.name);
      const selected = file?.path === e.path;
      return (
        <div key={e.path} role="treeitem" aria-expanded={e.dir ? expanded.has(e.path) : undefined} aria-selected={selected}>
          <button
            type="button"
            onClick={() => (e.dir ? toggle(e.path) : setOpenFile(e.path))}
            className={cx(
              'flex h-[26px] w-full items-center gap-1.5 truncate rounded-md pr-2 text-left text-[13px] transition-colors',
              selected ? 'bg-accent/10 text-fg' : e.ignored ? 'text-fg-faint hover:bg-raised' : 'text-fg-muted hover:bg-raised hover:text-fg',
            )}
            style={{ paddingLeft: 6 + depth * 14 }}
            title={e.path}
          >
            {e.dir ? (
              <>
                <ChevronRight className={cx('h-3 w-3 shrink-0 text-fg-faint transition-transform duration-150', expanded.has(e.path) && 'rotate-90')} />
                {expanded.has(e.path) ? <FolderOpen className="h-3.5 w-3.5 shrink-0 text-accent-ink/80" /> : <Folder className="h-3.5 w-3.5 shrink-0 text-accent-ink/80" />}
              </>
            ) : (
              <Icon className={cx('ml-[18px] h-3.5 w-3.5 shrink-0', selected ? 'text-accent-ink' : 'text-fg-subtle')} />
            )}
            <span className="truncate">{e.name}</span>
          </button>
          {e.dir && expanded.has(e.path) && renderDir(e.path, depth + 1)}
        </div>
      );
    });

  const crumbs = file?.path.split('/') ?? [];

  return (
    <div className="flex h-full">
      <div className="flex w-56 shrink-0 flex-col border-r border-line max-[1280px]:w-48">
        <div className="flex h-9 shrink-0 items-center justify-between pr-1.5 pl-3 text-[11px] font-medium tracking-wide text-fg-subtle uppercase">
          Explorer
          <IconButton label="Refresh" size="sm" onClick={() => [...expanded].forEach((d) => void loadDir(d))}>
            <RefreshCw className="h-3.5 w-3.5" />
          </IconButton>
        </div>
        <div role="tree" aria-label="Project files" className="min-h-0 flex-1 overflow-auto px-1.5 pb-4">
          {children['.'] ? (
            children['.'].length ? (
              renderDir('.', 0)
            ) : (
              <p className="px-2 py-3 text-xs text-fg-subtle">This folder is empty. Ask the agent to create something.</p>
            )
          ) : (
            <div className="space-y-1.5 px-1.5 pt-1">
              {[60, 75, 50, 66, 40].map((w) => (
                <Skeleton key={w} className="h-4" />
              ))}
            </div>
          )}
        </div>
      </div>
      <div className="flex min-w-0 flex-1 flex-col">
        {file ? (
          <>
            <div className="flex h-9 shrink-0 items-center gap-2 border-b border-line pr-2 pl-3">
              <span className="flex min-w-0 flex-1 items-center gap-1 truncate font-mono text-xs">
                {crumbs.map((c, i) => (
                  <span key={i} className="flex shrink-0 items-center gap-1 last:shrink">
                    {i > 0 && <ChevronRight className="h-3 w-3 text-fg-faint" />}
                    <span className={cx('truncate', i === crumbs.length - 1 ? 'text-fg' : 'text-fg-subtle')}>{c}</span>
                  </span>
                ))}
                {dirty && <span className="ml-1 h-2 w-2 shrink-0 rounded-full bg-accent" title="Unsaved changes" />}
              </span>
              {loadingFile && <Spinner className="h-3.5 w-3.5" />}
              <Button size="xs" variant={dirty ? 'primary' : 'ghost'} disabled={!dirty} onClick={save} title={`Save (${MOD}+S)`}>
                <Save className="h-3.5 w-3.5" /> Save
              </Button>
            </div>
            <div className="min-h-0 flex-1">
              {file.binary ? (
                <Empty icon={<FileText />} title="Binary file">
                  This file can't be shown as text.
                </Empty>
              ) : (
                <Editor
                  theme={theme === 'dark' ? 'hearth-dark' : 'hearth-light'}
                  path={file.path}
                  language={languageFor(file.path)}
                  value={draft}
                  onChange={(v) => setDraft(v ?? '')}
                  loading={<Spinner />}
                  onMount={(editor, monaco) => {
                    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => document.getElementById('hearth-save-file')?.click());
                  }}
                  options={editorOptions}
                />
              )}
              <button id="hearth-save-file" type="button" className="hidden" onClick={save} />
            </div>
          </>
        ) : (
          <Empty icon={<FileText />} title="No file open">
            Pick a file in the explorer. Files the agent edits refresh here automatically.
          </Empty>
        )}
      </div>
    </div>
  );
}
