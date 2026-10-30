import { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { api, type McpStatus } from '../../api';
import { errText, useStore } from '../../store';
import { Badge, Button, Spinner } from '../ui';

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

export function McpTab() {
  const { settings, saveSettings, notify } = useStore();
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
      notify('MCP servers saved and reconnected');
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
      <div className="col-span-3 flex flex-col gap-2 border-r border-zinc-800 p-4">
        <p className="text-xs text-zinc-400">
          Same format as Cursor / Claude Desktop <code>mcpServers</code>. Stdio servers use <code>command/args/env</code>; remote servers use <code>url/headers</code> (Streamable HTTP, falls back to SSE). Tools appear to the agent as <code>mcp__server__tool</code>. Add{' '}
          <code>"autoApprove": true</code> to skip approval prompts for a trusted server.
        </p>
        <div className="flex flex-wrap gap-1">
          {Object.keys(TEMPLATES).map((k) => (
            <Button key={k} size="sm" variant="ghost" onClick={() => addTemplate(k)}>
              + {k}
            </Button>
          ))}
        </div>
        <textarea className="min-h-0 flex-1 resize-none font-mono text-xs" spellCheck={false} value={text} onChange={(e) => setText(e.target.value)} />
        {err && <div className="text-xs text-rose-400">{err}</div>}
        <div>
          <Button variant="primary" disabled={busy} onClick={save}>
            {busy && <Spinner className="h-3.5 w-3.5 text-white" />} Save & connect
          </Button>
        </div>
      </div>
      <div className="col-span-2 space-y-2 overflow-auto p-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-zinc-200">Status</h3>
          <Button size="sm" variant="ghost" onClick={async () => setStatus(await api.reloadMcp())}>
            <RefreshCw className="h-3.5 w-3.5" /> Reconnect
          </Button>
        </div>
        {status === null && <Spinner />}
        {status?.length === 0 && <div className="text-xs text-zinc-500">No MCP servers configured.</div>}
        {status?.map((s) => (
          <div key={s.name} className="rounded-md border border-zinc-800 p-2 text-xs">
            <div className="flex items-center gap-2">
              <span className="font-medium text-zinc-200">{s.name}</span>
              <Badge tone={s.status === 'connected' ? 'green' : s.status === 'disabled' ? 'zinc' : s.status === 'error' ? 'red' : 'amber'}>{s.status}</Badge>
              <Badge>{s.transport}</Badge>
            </div>
            {s.error && <pre className="mt-1 max-h-24 overflow-auto whitespace-pre-wrap text-rose-300">{s.error}</pre>}
            {s.tools.length > 0 && <div className="mt-1 text-zinc-500">{s.tools.map((t) => t.name).join(', ')}</div>}
          </div>
        ))}
      </div>
    </div>
  );
}
