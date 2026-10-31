import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, CornerDownLeft, Globe, Lock, MousePointerClick, Play, RotateCcw, X } from 'lucide-react';
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
      if (s.ok) {
        const blob = await s.blob();
        setShot((old) => {
          if (old) URL.revokeObjectURL(old);
          return URL.createObjectURL(blob);
        });
      }
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

  const secure = url.startsWith('https://');

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-9 shrink-0 items-center border-b border-line px-2">
        <Tabs
          value={mode}
          onChange={setMode}
          label="Browser mode"
          tabs={[
            { id: 'live', label: 'Agent browser', title: 'The headless Chromium the agent uses' },
            { id: 'iframe', label: 'Preview (iframe)', title: 'Embed one of your local dev servers' },
          ]}
        />
      </div>
      {mode === 'live' ? (
        <>
          <div className="flex shrink-0 items-center gap-1 border-b border-line px-2 py-1.5">
            <IconButton label="Back" disabled={!info?.running} onClick={() => act('history', { dir: 'back' })}>
              <ArrowLeft className="h-4 w-4" />
            </IconButton>
            <IconButton label="Forward" disabled={!info?.running} onClick={() => act('history', { dir: 'forward' })}>
              <ArrowRight className="h-4 w-4" />
            </IconButton>
            <IconButton label="Reload" disabled={!info?.running} onClick={() => act('history', { dir: 'reload' })}>
              <RotateCcw className="h-3.5 w-3.5" />
            </IconButton>
            <div className="relative min-w-0 flex-1">
              <span className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-fg-faint">{secure ? <Lock className="h-3 w-3" /> : <Globe className="h-3 w-3" />}</span>
              <input
                className="h-7 w-full rounded-full py-0 pl-7 font-mono text-xs"
                aria-label="Address"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && url && act('navigate', { url })}
                placeholder="Enter a URL (localhost:5173, example.com) and press Enter"
              />
            </div>
            {busy && <Spinner className="h-4 w-4" />}
            {info?.running && (
              <IconButton label="Close browser" onClick={() => act('close')}>
                <X className="h-4 w-4" />
              </IconButton>
            )}
          </div>
          <div
            className="relative min-h-0 flex-1 overflow-auto bg-canvas p-3"
            onWheel={(e) => {
              if (!info?.running || Date.now() - lastWheel.current < 250) return;
              lastWheel.current = Date.now();
              void act('scroll', { dy: Math.sign(e.deltaY) * 500 });
            }}
          >
            {info?.running && shot ? (
              <img ref={img} src={shot} onClick={onClickShot} className="w-full cursor-crosshair rounded-lg border border-line shadow-card" alt="Browser viewport (click to click in the page)" draggable={false} />
            ) : (
              <Empty
                icon={<Globe />}
                title="Shared headless browser"
                action={
                  <Button size="sm" onClick={() => act('navigate', { url: url || 'about:blank' })}>
                    <Play className="h-3.5 w-3.5" /> Start browser
                  </Button>
                }
              >
                The agent drives this Chromium with its browser tools. You can use it too: enter a URL above, then click the screenshot to click in the page.
              </Empty>
            )}
          </div>
          {info?.running && (
            <div className="flex shrink-0 items-center gap-1.5 border-t border-line px-2 py-1.5">
              <MousePointerClick className="h-3.5 w-3.5 shrink-0 text-fg-subtle" />
              <input
                className="h-7 min-w-0 flex-1 py-0 text-xs"
                aria-label="Text to type into the focused element"
                placeholder="Type into the focused element…"
                value={typing}
                onChange={(e) => setTyping(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && typing && act('type', { text: typing }).then(() => setTyping(''))}
              />
              <Button size="xs" disabled={!typing} onClick={() => act('type', { text: typing }).then(() => setTyping(''))}>
                Type
              </Button>
              {['Enter', 'Tab', 'Escape', 'Backspace'].map((k) => (
                <Button key={k} size="xs" variant="ghost" title={`Press ${k}`} onClick={() => act('key', { key: k })}>
                  {k === 'Enter' ? <CornerDownLeft className="h-3 w-3" /> : k === 'Backspace' ? '⌫' : k === 'Escape' ? 'Esc' : k}
                </Button>
              ))}
              <span className="ml-1 hidden text-[10.5px] text-fg-faint xl:inline">{info.engine}</span>
            </div>
          )}
        </>
      ) : (
        <>
          <div className="flex shrink-0 items-center gap-1 border-b border-line px-2 py-1.5">
            <div className="relative min-w-0 flex-1">
              <Globe className="pointer-events-none absolute top-1/2 left-2.5 h-3 w-3 -translate-y-1/2 text-fg-faint" />
              <input className="h-7 w-full rounded-full py-0 pl-7 font-mono text-xs" aria-label="Preview URL" defaultValue={iframeUrl} onKeyDown={(e) => e.key === 'Enter' && setIframeUrl((e.target as HTMLInputElement).value)} placeholder="http://localhost:5173" />
            </div>
            <IconButton label="Reload" onClick={() => setIframeUrl((u) => (u.includes('#') ? u.split('#')[0] : u + '#'))}>
              <RotateCcw className="h-3.5 w-3.5" />
            </IconButton>
          </div>
          <iframe title="Preview" src={iframeUrl} className="min-h-0 flex-1 bg-white" sandbox="allow-scripts allow-forms allow-same-origin allow-popups allow-modals" />
          <div className="shrink-0 border-t border-line px-3 py-1.5 text-[11px] text-fg-subtle">For your own dev servers (for example one the agent started). Many public sites refuse to be framed; use the agent browser for those.</div>
        </>
      )}
    </div>
  );
}
