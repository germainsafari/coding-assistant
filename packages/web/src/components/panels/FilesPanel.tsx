import { useCallback, useEffect, useState } from 'react';
import Editor from '@monaco-editor/react';
import { ChevronRight, FileText, Folder, FolderOpen, RefreshCw, Save } from 'lucide-react';
import { api, type FileEntry } from '../../api';
import { errText, useStore } from '../../store';
import { languageFor } from '../../monaco';
import { Button, Empty, IconButton, Spinner } from '../ui';

export default function FilesPanel({ projectId }: { projectId: string }) {
  const { fsVersion, openFile, setOpenFile, notify } = useStore();
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
      notify(`Saved ${file.path}`);
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
    (children[p] ?? []).map((e) => (
      <div key={e.path}>
        <button
          onClick={() => (e.dir ? toggle(e.path) : setOpenFile(e.path))}
          className={`flex w-full items-center gap-1 truncate py-[3px] pr-2 text-left text-[13px] hover:bg-zinc-800/60 ${file?.path === e.path ? 'bg-zinc-800 text-orange-300' : e.ignored ? 'text-zinc-600' : 'text-zinc-300'}`}
          style={{ paddingLeft: 8 + depth * 12 }}
          title={e.path}
        >
          {e.dir ? (
            <>
              <ChevronRight className={`h-3 w-3 shrink-0 text-zinc-500 transition-transform ${expanded.has(e.path) ? 'rotate-90' : ''}`} />
              {expanded.has(e.path) ? <FolderOpen className="h-3.5 w-3.5 shrink-0 text-orange-400/70" /> : <Folder className="h-3.5 w-3.5 shrink-0 text-orange-400/70" />}
            </>
          ) : (
            <FileText className="ml-4 h-3.5 w-3.5 shrink-0 text-zinc-500" />
          )}
          <span className="truncate">{e.name}</span>
        </button>
        {e.dir && expanded.has(e.path) && renderDir(e.path, depth + 1)}
      </div>
    ));

  return (
    <div className="flex h-full">
      <div className="flex w-56 shrink-0 flex-col border-r border-zinc-800">
        <div className="flex items-center justify-between px-2 py-1 text-[11px] font-medium tracking-wide text-zinc-500 uppercase">
          Explorer
          <IconButton title="Refresh" onClick={() => [...expanded].forEach((d) => void loadDir(d))}>
            <RefreshCw className="h-3.5 w-3.5" />
          </IconButton>
        </div>
        <div className="min-h-0 flex-1 overflow-auto pb-4">{children['.'] ? renderDir('.', 0) : <div className="p-3"><Spinner /></div>}</div>
      </div>
      <div className="flex min-w-0 flex-1 flex-col">
        {file ? (
          <>
            <div className="flex h-9 shrink-0 items-center gap-2 border-b border-zinc-800 px-3">
              <span className="min-w-0 flex-1 truncate font-mono text-xs text-zinc-300">
                {file.path}
                {dirty && <span className="ml-1 text-orange-400">●</span>}
              </span>
              {loadingFile && <Spinner className="h-3.5 w-3.5" />}
              <Button size="sm" variant={dirty ? 'primary' : 'ghost'} disabled={!dirty} onClick={save} title="Save (Ctrl+S)">
                <Save className="h-3.5 w-3.5" /> Save
              </Button>
            </div>
            <div className="min-h-0 flex-1">
              {file.binary ? (
                <Empty title="Binary file" />
              ) : (
                <Editor
                  theme="vs-dark"
                  path={file.path}
                  language={languageFor(file.path)}
                  value={draft}
                  onChange={(v) => setDraft(v ?? '')}
                  onMount={(editor, monaco) => {
                    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => document.getElementById('hearth-save-file')?.click());
                  }}
                  options={{ fontSize: 13, minimap: { enabled: false }, scrollBeyondLastLine: false, wordWrap: 'off', automaticLayout: true, tabSize: 2 }}
                />
              )}
              <button id="hearth-save-file" className="hidden" onClick={save} />
            </div>
          </>
        ) : (
          <Empty icon={<FileText className="h-8 w-8" />} title="No file open">
            Pick a file in the explorer. Files the agent edits refresh here automatically.
          </Empty>
        )}
      </div>
    </div>
  );
}
