import { useEffect, useState } from 'react';
import { Plus, RefreshCw } from 'lucide-react';
import { api, type McpStatus } from '../../api';
import { errText, useStore } from '../../store';
import { Badge, Button, Empty, Skeleton, Spinner } from '../ui';

const TEMPLATES: Record<string, Record<string, unknown>> = {
  filesystem: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem', 'C:/Users/me/Documents'] },
  'google-drive': {
    command: 'npx',
    args: ['-y', '@isaacphi/mcp-gdrive'],
    env: { CLIENT_ID: '<google oauth client id>', CLIENT_SECRET: '<google oauth client secret>', GDRIVE_CREDS_DIR: '<folder for tokens>' },
    disabled: true,
  },
  fetch: { command: 'uvx', args: ['mcp-server-fetch'] },
  'remote-http-example': { url: 'https://example.com/mcp', headers: { Authorization: 'Bearer <token>' }, disabled: true },
};

const statusTone = (s: string) => (s === 'connected' ? 'ok' : s === 'disabled' ? 'neutral' : s === 'error' ? 'danger' : 'warn');

export function McpTab() {
  const settings = useStore((s) => s.settings);
  const saveSettings = useStore((s) => s.saveSettings);
  const notify = useStore((s) => s.notify);
  const [text, setText] = useState('');
  const [status, setStatus] = useState<McpStatus[] | null>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (settings) setText(JSON.stringify({ mcpServers: settings.mcpServers }, null, 2));
  }, [settings]);
  useEffect(() => {
    void api.mcp().then(setStatus, () => setStatus([]));
  }, []);

  const parse = () => {
    const j = JSON.parse(text);
    return (j.mcpServers ?? j) as Record<string, unknown>;
  };
  const save = async () => {
    setBusy(true);
    try {
      const servers = parse();
      setErr('');
      await saveSettings({ mcpServers: servers as never });
      setStatus(await api.reloadMcp());
      notify('MCP servers saved and reconnected', 'success');
    } catch (e) {
      setErr(errText(e));
    } finally {
      setBusy(false);
    }
  };
  const addTemplate = (name: string) => {
    try {
      const servers = parse();
      setText(JSON.stringify({ mcpServers: { ...servers, [name]: TEMPLATES[name] } }, null, 2));
    } catch (e) {
      setErr(errText(e));
    }
  };

  return (
    <div className="grid h-full grid-cols-5">
      <div className="col-span-3 flex min-h-0 flex-col gap-3 border-r border-line p-5">
        <p className="text-xs leading-relaxed text-fg-muted">
          Same format as Cursor and Claude Desktop <code className="font-mono text-fg">mcpServers</code>. Stdio servers use <code className="font-mono text-fg">command / args / env</code>; remote servers use <code className="font-mono text-fg">url / headers</code> (Streamable HTTP, with SSE fallback). Tools appear to the agent as{' '}
          <code className="font-mono text-fg">mcp__server__tool</code>. Add <code className="font-mono text-fg">"autoApprove": true</code> to skip approvals for a trusted server.
        </p>
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] font-medium tracking-wide text-fg-subtle uppercase">Templates</span>
          {Object.keys(TEMPLATES).map((k) => (
            <Button key={k} size="xs" onClick={() => addTemplate(k)}>
              <Plus className="h-3 w-3" /> {k}
            </Button>
          ))}
        </div>
        <textarea className="min-h-0 flex-1 resize-none bg-code font-mono text-xs leading-relaxed" spellCheck={false} aria-label="MCP servers JSON" value={text} onChange={(e) => setText(e.target.value)} />
        {err && <div className="rounded-lg border border-danger/30 bg-danger/[0.07] px-3 py-2 text-xs text-danger-ink">{err}</div>}
        <div>
          <Button variant="primary" disabled={busy} onClick={save}>
            {busy && <Spinner className="h-3.5 w-3.5 text-primary-fg" />} Save & connect
          </Button>
        </div>
      </div>
      <div className="col-span-2 space-y-2 overflow-auto p-5">
        <div className="flex items-center justify-between">
          <h3 className="text-[13px] font-semibold text-fg">Status</h3>
          <Button size="xs" variant="ghost" onClick={async () => setStatus(await api.reloadMcp())}>
            <RefreshCw className="h-3 w-3" /> Reconnect
          </Button>
        </div>
        {status === null && <Skeleton className="h-16" />}
        {status?.length === 0 && (
          <Empty title="No MCP servers yet" className="h-auto rounded-xl border border-dashed border-line-strong py-8">
            Add a template on the left, then save.
          </Empty>
        )}
        {status?.map((s) => (
          <div key={s.name} className="rounded-xl border border-line bg-surface p-3 text-xs shadow-card">
            <div className="flex items-center gap-2">
              <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-fg">{s.name}</span>
              <Badge tone={statusTone(s.status)} dot>
                {s.status}
              </Badge>
              <Badge>{s.transport}</Badge>
            </div>
            {s.error && <pre className="mt-2 max-h-24 overflow-auto font-mono text-[11px] whitespace-pre-wrap text-danger-ink">{s.error}</pre>}
            {s.tools.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1">
                {s.tools.map((t) => (
                  <span key={t.name} title={t.description} className="rounded border border-line bg-raised px-1.5 py-px font-mono text-[10.5px] text-fg-muted">
                    {t.name}
                  </span>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
