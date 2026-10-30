import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, CornerDownLeft, Globe, MousePointerClick, Play, RotateCcw, Square } from 'lucide-react';
import { api } from '../../api';
import { errText, useStore } from '../../store';
import { Button, Empty, IconButton, Spinner, Tabs } from '../ui';

type Info = Awaited<ReturnType<typeof api.browserInfo>>;

export function BrowserPanel() {
  const notify = useStore((s) => s.notify);
  const [mode, setMode] = useState<'live' | 'iframe'>('live');
  const [info, setInfo] = useState<Info | null>(null);
  const [url, setUrl] = useState('');
  const [shot, setShot] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [typing, setTyping] = useState('');
  const [iframeUrl, setIframeUrl] = useState('http://localhost:5173');
  const img = useRef<HTMLImageElement>(null);
  const lastWheel = useRef(0);

  // poll browser state + screenshots while visible
  useEffect(() => {
    if (mode !== 'live') return;
    let stop = false;
    let prevUrl: string | null = null;
    const tick = async () => {
      try {
        const i = await api.browserInfo();
        if (stop) return;
        setInfo(i);
        if (i.url && i.url !== prevUrl) {
          prevUrl = i.url;
          setUrl(i.url);
        }
        if (i.running) {
          const r = await fetch(`/api/browser/screenshot?t=${Date.now()}`);
          if (r.ok && !stop) {
            const blob = await r.blob();
            setShot((old) => {
              if (old) URL.revokeObjectURL(old);
              return URL.createObjectURL(blob);
            });
          }
        }
      } catch {}
    };
    void tick();
    const t = setInterval(tick, 1500);
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, [mode]);

  const act = async (action: Parameters<typeof api.browserAct>[0], body: Record<string, unknown> = {}) => {
    setBusy(true);
    try {
      const r = await api.browserAct(action, body);
      if (r.info?.url) setUrl(r.info.url);
      const s = await fetch(`/api/browser/screenshot?t=${Date.now()}`);
      if (s.ok) setShot(URL.createObjectURL(await s.blob()));
      setInfo(await api.browserInfo());
    } catch (e) {
      notify(errText(e), 'error');
    } finally {
      setBusy(false);
    }
  };

  const onClickShot = (e: React.MouseEvent<HTMLImageElement>) => {
    if (!info || !img.current) return;
    const r = img.current.getBoundingClientRect();
    const x = Math.round(((e.clientX - r.left) / r.width) * info.viewport.width);
    const y = Math.round(((e.clientY - r.top) / r.height) * info.viewport.height);
    void act('click', { x, y });
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center gap-1 border-b border-zinc-800 px-2 py-1.5">
        <Tabs value={mode} onChange={setMode} tabs={[{ id: 'live', label: 'Agent browser' }, { id: 'iframe', label: 'Iframe (localhost)' }]} />
      </div>
      {mode === 'live' ? (
        <>
          <div className="flex shrink-0 items-center gap-1 border-b border-zinc-800 px-2 py-1.5">
            <IconButton title="Back" disabled={!info?.running} onClick={() => act('history', { dir: 'back' })}>
              <ArrowLeft className="h-4 w-4" />
            </IconButton>
            <IconButton title="Forward" disabled={!info?.running} onClick={() => act('history', { dir: 'forward' })}>
              <ArrowRight className="h-4 w-4" />
            </IconButton>
            <IconButton title="Reload" disabled={!info?.running} onClick={() => act('history', { dir: 'reload' })}>
              <RotateCcw className="h-4 w-4" />
            </IconButton>
            <input className="min-w-0 flex-1 font-mono text-xs" value={url} onChange={(e) => setUrl(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && url && act('navigate', { url })} placeholder="Enter a URL (e.g. localhost:5173 or example.com) and press Enter" />
            {busy && <Spinner className="h-4 w-4" />}
            {info?.running && (
              <IconButton title="Close browser" onClick={() => act('close')}>
                <Square className="h-3.5 w-3.5" />
              </IconButton>
            )}
          </div>
          <div
            className="relative min-h-0 flex-1 overflow-auto bg-zinc-950 p-2"
            onWheel={(e) => {
              if (!info?.running || Date.now() - lastWheel.current < 250) return;
              lastWheel.current = Date.now();
              void act('scroll', { dy: Math.sign(e.deltaY) * 500 });
            }}
          >
            {info?.running && shot ? (
              <img ref={img} src={shot} onClick={onClickShot} className="w-full cursor-crosshair rounded border border-zinc-800" alt="Browser viewport" draggable={false} />
            ) : (
              <Empty icon={<Globe className="h-8 w-8" />} title="Shared headless browser">
                The agent uses this Chromium (via Playwright) with its browser_* tools. You can drive it too: enter a URL above, then click on the screenshot to click in the page.
                <div className="mt-3">
                  <Button size="sm" onClick={() => act('navigate', { url: url || 'about:blank' })}>
                    <Play className="h-3.5 w-3.5" /> Start browser
                  </Button>
                </div>
              </Empty>
            )}
          </div>
          {info?.running && (
            <div className="flex shrink-0 items-center gap-1.5 border-t border-zinc-800 px-2 py-1.5">
              <MousePointerClick className="h-3.5 w-3.5 text-zinc-500" />
              <input className="min-w-0 flex-1 text-xs" placeholder="Type into the focused element…" value={typing} onChange={(e) => setTyping(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && typing && act('type', { text: typing }).then(() => setTyping(''))} />
              <Button size="sm" disabled={!typing} onClick={() => act('type', { text: typing }).then(() => setTyping(''))}>
                Type
              </Button>
              {['Enter', 'Tab', 'Escape', 'Backspace'].map((k) => (
                <Button key={k} size="sm" variant="ghost" onClick={() => act('key', { key: k })}>
                  {k === 'Enter' ? <CornerDownLeft className="h-3 w-3" /> : k}
                </Button>
              ))}
              <span className="text-[10px] text-zinc-600">{info.engine}</span>
            </div>
          )}
        </>
      ) : (
        <>
          <div className="flex shrink-0 items-center gap-1 border-b border-zinc-800 px-2 py-1.5">
            <input className="min-w-0 flex-1 font-mono text-xs" defaultValue={iframeUrl} onKeyDown={(e) => e.key === 'Enter' && setIframeUrl((e.target as HTMLInputElement).value)} placeholder="http://localhost:5173" />
            <IconButton title="Reload" onClick={() => setIframeUrl((u) => (u.includes('#') ? u.split('#')[0] : u + '#'))}>
              <RotateCcw className="h-4 w-4" />
            </IconButton>
          </div>
          <iframe title="preview" src={iframeUrl} className="min-h-0 flex-1 bg-white" sandbox="allow-scripts allow-forms allow-same-origin allow-popups allow-modals" />
          <div className="shrink-0 px-2 py-1 text-[11px] text-zinc-500">Iframe mode is for your own dev servers (e.g. one the agent started). Many public sites refuse to be framed; use Agent browser for those.</div>
        </>
      )}
    </div>
  );
}
