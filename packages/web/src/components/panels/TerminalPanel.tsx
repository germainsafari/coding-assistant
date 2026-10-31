import { useCallback, useEffect, useRef, useState } from 'react';
import { CornerDownLeft, Square, SquareTerminal, Trash2 } from 'lucide-react';
import { api } from '../../api';
import { errText, useStore } from '../../store';
import { Badge, Button, cx, IconButton, StatusDot } from '../ui';

type Proc = Awaited<ReturnType<typeof api.processes>>[number];

export function TerminalPanel({ projectId }: { projectId: string }) {
  const notify = useStore((s) => s.notify);
  const [cmd, setCmd] = useState('');
  const [out, setOut] = useState('');
  const [running, setRunning] = useState(false);
  const [bg, setBg] = useState(false);
  const [procs, setProcs] = useState<Proc[]>([]);
  const [view, setView] = useState<string | null>(null); // background process id or null = shell
  const [procOut, setProcOut] = useState('');
  const history = useRef<string[]>([]);
  const hIdx = useRef(-1);
  const abort = useRef<AbortController | null>(null);
  const pre = useRef<HTMLPreElement>(null);
  const input = useRef<HTMLInputElement>(null);

  const loadProcs = useCallback(() => api.processes(projectId).then(setProcs, () => {}), [projectId]);
  useEffect(() => {
    void loadProcs();
    const t = setInterval(loadProcs, 3000);
    return () => clearInterval(t);
  }, [loadProcs]);
  useEffect(() => {
    if (!view) return;
    let stop = false;
    const tick = () =>
      api.processOutput(view).then(
        (r) => !stop && setProcOut(r.output),
        () => {},
      );
    void tick();
    const t = setInterval(tick, 1500);
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, [view]);
  useEffect(() => {
    if (pre.current) pre.current.scrollTop = pre.current.scrollHeight;
  }, [out, procOut, view]);

  const run = async () => {
    const command = cmd.trim();
    if (!command) return;
    history.current = [command, ...history.current.filter((h) => h !== command)].slice(0, 50);
    hIdx.current = -1;
    setCmd('');
    if (bg) {
      try {
        const r = await api.startBackground(projectId, command);
        await loadProcs();
        setView(r.id);
      } catch (e) {
        notify(errText(e), 'error');
      }
      return;
    }
    setView(null);
    setRunning(true);
    setOut((o) => `${o}${o ? '\n' : ''}$ ${command}\n`);
    const ac = new AbortController();
    abort.current = ac;
    try {
      const r = await fetch(`/api/projects/${projectId}/terminal`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ command }), signal: ac.signal });
      if (!r.ok || !r.body) {
        const j = await r.json().catch(() => ({}));
        setOut((o) => o + `${j.error ?? `HTTP ${r.status}`}\n`);
      } else {
        const reader = r.body.getReader();
        const dec = new TextDecoder();
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          const s = dec.decode(value, { stream: true });
          setOut((o) => (o + s).slice(-200_000));
        }
      }
    } catch {
      setOut((o) => o + '\n[stopped]\n');
    } finally {
      setRunning(false);
      abort.current = null;
    }
  };

  const shown = view ? procOut : out;
  const runningCount = procs.filter((p) => p.running).length;

  return (
    <div className="flex h-full flex-col bg-term" onClick={(e) => e.target === e.currentTarget && input.current?.focus()}>
      <div className="flex h-9 shrink-0 items-center gap-1 overflow-x-auto border-b border-line px-2 [scrollbar-width:none]">
        <button type="button" onClick={() => setView(null)} className={cx('flex h-6 shrink-0 items-center gap-1.5 rounded-md px-2 text-xs font-medium', view === null ? 'bg-raised text-fg' : 'text-fg-subtle hover:text-fg')}>
          <SquareTerminal className="h-3.5 w-3.5" /> Shell
        </button>
        {procs.map((p) => (
          <span key={p.id} className={cx('flex h-6 shrink-0 items-center gap-1 rounded-md pr-1 pl-2 text-xs', view === p.id ? 'bg-raised text-fg' : 'text-fg-subtle')}>
            <button type="button" onClick={() => setView(p.id)} className="flex max-w-48 items-center gap-1.5 truncate font-mono hover:text-fg" title={p.command}>
              <StatusDot tone={p.running ? 'ok' : 'neutral'} pulse={p.running} />
              <span className="truncate">{p.command}</span>
            </button>
            {p.running && (
              <IconButton label="Stop process" size="sm" className="h-5 w-5 hover:text-danger-ink" onClick={() => api.killProcess(p.id).then(loadProcs)}>
                <Square className="h-2.5 w-2.5 fill-current" />
              </IconButton>
            )}
          </span>
        ))}
        <div className="flex-1" />
        {runningCount > 0 && (
          <Badge tone="ok" dot>
            {runningCount} running
          </Badge>
        )}
        <IconButton label="Clear output" size="sm" onClick={() => setOut('')}>
          <Trash2 className="h-3.5 w-3.5" />
        </IconButton>
      </div>
      <pre ref={pre} className="min-h-0 flex-1 overflow-auto px-4 py-3 font-mono text-[12.5px] leading-[1.6] whitespace-pre-wrap text-fg-muted" aria-live="polite">
        {shown ? (
          shown.split('\n').map((l, i) => (
            <span key={i} className={l.startsWith('$ ') ? 'text-fg' : /exit code [1-9]/.test(l) ? 'text-danger-ink' : /exit code 0/.test(l) ? 'text-ok-ink' : undefined}>
              {l.startsWith('$ ') ? (
                <>
                  <span className="text-accent-ink">❯</span> {l.slice(2)}
                </>
              ) : (
                l
              )}
              {'\n'}
            </span>
          ))
        ) : (
          <span className="text-fg-subtle">
            {view ? '(no output yet)' : 'Run commands in the project folder. They run non-interactively (PowerShell on Windows, bash elsewhere).\nTurn on "background" for dev servers and watchers.'}
          </span>
        )}
      </pre>
      <div className="flex shrink-0 items-center gap-2 border-t border-line px-3 py-2">
        <span className="font-mono text-sm text-accent-ink">❯</span>
        <input
          ref={input}
          className="h-7 min-w-32 flex-1 border-0 bg-transparent px-0 py-0 font-mono text-[12.5px] shadow-none focus:shadow-none"
          value={cmd}
          aria-label="Command"
          placeholder={running ? 'running…' : 'npm test'}
          onChange={(e) => setCmd(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !running) void run();
            if (e.key === 'ArrowUp' && history.current.length) {
              e.preventDefault();
              hIdx.current = Math.min(history.current.length - 1, hIdx.current + 1);
              setCmd(history.current[hIdx.current]);
            }
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              hIdx.current = Math.max(-1, hIdx.current - 1);
              setCmd(hIdx.current === -1 ? '' : history.current[hIdx.current]);
            }
          }}
        />
        <label className="flex shrink-0 cursor-pointer items-center gap-1.5 text-[11.5px] whitespace-nowrap text-fg-subtle select-none">
          <input type="checkbox" checked={bg} onChange={(e) => setBg(e.target.checked)} /> background
        </label>
        {running ? (
          <Button size="xs" variant="danger" onClick={() => abort.current?.abort()}>
            <Square className="h-2.5 w-2.5 fill-current" /> Stop
          </Button>
        ) : (
          <Button size="xs" onClick={run} disabled={!cmd.trim()}>
            <CornerDownLeft className="h-3 w-3" /> Run
          </Button>
        )}
      </div>
    </div>
  );
}
