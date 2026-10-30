import { useCallback, useEffect, useRef, useState } from 'react';
import { Play, Square, SquareTerminal, Trash } from 'lucide-react';
import { api } from '../../api';
import { errText, useStore } from '../../store';
import { Badge, Button, IconButton } from '../ui';

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

  const loadProcs = useCallback(() => api.processes(projectId).then(setProcs, () => {}), [projectId]);
  useEffect(() => {
    void loadProcs();
    const t = setInterval(loadProcs, 3000);
    return () => clearInterval(t);
  }, [loadProcs]);
  useEffect(() => {
    if (!view) return;
    let stop = false;
    const tick = () => api.processOutput(view).then((r) => !stop && setProcOut(r.output), () => {});
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
    setOut((o) => o + `\n$ ${command}\n`);
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

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center gap-1 overflow-x-auto border-b border-zinc-800 px-2 py-1.5">
        <button onClick={() => setView(null)} className={`flex items-center gap-1 rounded px-2 py-0.5 text-xs ${view === null ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-400 hover:text-zinc-200'}`}>
          <SquareTerminal className="h-3.5 w-3.5" /> Shell
        </button>
        {procs.map((p) => (
          <span key={p.id} className={`flex items-center gap-1 rounded px-2 py-0.5 text-xs ${view === p.id ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-400'}`}>
            <button onClick={() => setView(p.id)} className="max-w-48 truncate hover:text-zinc-200" title={p.command}>
              <span className={`mr-1 inline-block h-1.5 w-1.5 rounded-full ${p.running ? 'bg-emerald-500' : 'bg-zinc-600'}`} />
              {p.command}
            </button>
            {p.running && (
              <button title="Stop process" className="text-zinc-500 hover:text-rose-400" onClick={() => api.killProcess(p.id).then(loadProcs)}>
                <Square className="h-3 w-3" />
              </button>
            )}
          </span>
        ))}
      </div>
      <pre ref={pre} className="min-h-0 flex-1 overflow-auto bg-black/40 p-3 font-mono text-[12px] leading-snug whitespace-pre-wrap text-zinc-300">
        {view ? procOut || '(no output yet)' : out || 'Run commands in the project folder. Commands run non-interactively (PowerShell on Windows, bash on Linux/macOS). Tick "background" for dev servers.'}
      </pre>
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-t border-zinc-800 px-2 py-1.5">
        <span className="font-mono text-xs text-orange-400">$</span>
        <input
          className="min-w-40 flex-1 border-0 bg-transparent font-mono text-xs focus:border-0"
          value={cmd}
          placeholder={running ? 'running…' : 'npm test'}
          onChange={(e) => setCmd(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !running) void run();
            if (e.key === 'ArrowUp' && history.current.length) {
              hIdx.current = Math.min(history.current.length - 1, hIdx.current + 1);
              setCmd(history.current[hIdx.current]);
            }
            if (e.key === 'ArrowDown') {
              hIdx.current = Math.max(-1, hIdx.current - 1);
              setCmd(hIdx.current === -1 ? '' : history.current[hIdx.current]);
            }
          }}
        />
        <label className="flex items-center gap-1 text-[11px] whitespace-nowrap text-zinc-500">
          <input type="checkbox" checked={bg} onChange={(e) => setBg(e.target.checked)} /> background
        </label>
        {running ? (
          <Button size="sm" variant="danger" onClick={() => abort.current?.abort()}>
            <Square className="h-3 w-3" /> Stop
          </Button>
        ) : (
          <Button size="sm" onClick={run} disabled={!cmd.trim()}>
            <Play className="h-3 w-3" /> Run
          </Button>
        )}
        <IconButton title="Clear" onClick={() => setOut('')}>
          <Trash className="h-3.5 w-3.5" />
        </IconButton>
        {procs.some((p) => p.running) && <Badge tone="green">{procs.filter((p) => p.running).length} bg</Badge>}
      </div>
    </div>
  );
}
