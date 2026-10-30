// MCP client manager: connects to servers configured like Cursor / Claude Desktop
// ("mcpServers": { name: { command, args, env } | { url, headers } }) and exposes
// their tools to the agent as `mcp__<server>__<tool>`.
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport, getDefaultEnvironment } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import type { McpServerConfig } from '@hearth/shared';
import { getSettings, onSettingsChange } from './config.ts';
import { truncateMiddle } from './util.ts';
import { fail, ok, type ToolDef } from './tools/types.ts';

interface Conn {
  name: string;
  config: McpServerConfig;
  client: Client | null;
  status: 'connecting' | 'connected' | 'error' | 'disabled';
  error?: string;
  tools: { name: string; description: string; inputSchema: any }[];
  stderr: string;
}

const conns = new Map<string, Conn>();
const sanitize = (s: string) => s.replace(/[^A-Za-z0-9_-]/g, '_');

async function connect(name: string, config: McpServerConfig): Promise<Conn> {
  const conn: Conn = { name, config, client: null, status: 'connecting', tools: [], stderr: '' };
  conns.set(name, conn);
  if (config.disabled) {
    conn.status = 'disabled';
    return conn;
  }
  try {
    const client = new Client({ name: 'hearth', version: '0.1.0' });
    if (config.url) {
      const url = new URL(config.url);
      const opts = { requestInit: { headers: config.headers ?? {} } };
      try {
        await client.connect(new StreamableHTTPClientTransport(url, opts));
      } catch (e) {
        // older servers only speak the deprecated HTTP+SSE transport
        await client.connect(new SSEClientTransport(url, opts));
      }
    } else if (config.command) {
      const transport = new StdioClientTransport({
        command: config.command,
        args: config.args ?? [],
        env: { ...getDefaultEnvironment(), ...(config.env ?? {}) },
        cwd: config.cwd,
        stderr: 'pipe',
      });
      transport.stderr?.on('data', (d) => {
        conn.stderr = (conn.stderr + d.toString()).slice(-4000);
      });
      await client.connect(transport);
    } else {
      throw new Error('Server config needs either "command" (stdio) or "url" (HTTP).');
    }
    const listed = await client.listTools();
    conn.client = client;
    conn.tools = listed.tools.map((t) => ({ name: t.name, description: t.description ?? '', inputSchema: t.inputSchema }));
    conn.status = 'connected';
  } catch (e) {
    conn.status = 'error';
    conn.error = (e as Error).message + (conn.stderr ? `\n${conn.stderr}` : '');
  }
  return conn;
}

let syncing: Promise<void> | null = null;
let lastConfig = '';

export async function syncMcp(force = false): Promise<void> {
  const servers = getSettings().mcpServers ?? {};
  const key = JSON.stringify(servers);
  if (!force && key === lastConfig) return syncing ?? undefined;
  lastConfig = key;
  syncing = (async () => {
    for (const [name, c] of conns) {
      if (force || !servers[name] || JSON.stringify(servers[name]) !== JSON.stringify(c.config)) {
        await c.client?.close().catch(() => {});
        conns.delete(name);
      }
    }
    await Promise.all(
      Object.entries(servers)
        .filter(([name]) => !conns.has(name))
        .map(([name, cfg]) => connect(name, cfg)),
    );
  })();
  return syncing;
}

onSettingsChange(() => {
  syncMcp().catch((e) => console.error('[mcp] sync failed', e));
});

export function mcpStatus() {
  return [...conns.values()].map((c) => ({
    name: c.name,
    status: c.status,
    error: c.error,
    transport: c.config.url ? 'http' : 'stdio',
    tools: c.tools.map((t) => ({ name: t.name, description: t.description })),
  }));
}

function renderContent(content: any[]): { text: string; image?: string } {
  const parts: string[] = [];
  let image: string | undefined;
  for (const c of content ?? []) {
    if (c.type === 'text') parts.push(c.text);
    else if (c.type === 'image') {
      image ??= `data:${c.mimeType};base64,${c.data}`;
      parts.push('[image attached]');
    } else if (c.type === 'resource') parts.push(c.resource?.text ?? `[resource ${c.resource?.uri}]`);
    else if (c.type === 'resource_link') parts.push(`[resource link: ${c.uri}]`);
    else parts.push(JSON.stringify(c));
  }
  return { text: parts.join('\n'), image };
}

export function mcpTools(): ToolDef[] {
  const out: ToolDef[] = [];
  for (const c of conns.values()) {
    if (c.status !== 'connected' || !c.client) continue;
    for (const t of c.tools) {
      const schema = t.inputSchema && typeof t.inputSchema === 'object' ? t.inputSchema : { type: 'object', properties: {} };
      out.push({
        name: `mcp__${sanitize(c.name)}__${sanitize(t.name)}`.slice(0, 64),
        description: `[MCP server "${c.name}"] ${t.description}`.slice(0, 1200),
        parameters: { type: 'object', properties: schema.properties ?? {}, required: schema.required ?? [] },
        risk: 'external',
        autoApprove: !!c.config.autoApprove,
        async execute(args, ctx) {
          const r: any = await c.client!.callTool({ name: t.name, arguments: args ?? {} }, undefined, { signal: ctx.signal, timeout: 300_000 });
          const { text, image } = renderContent(r.content);
          const body = truncateMiddle(text || JSON.stringify(r.structuredContent ?? r), 20_000).text;
          return r.isError ? fail(body, { image }) : ok(body, { image });
        },
      });
    }
  }
  return out;
}

export async function closeMcp() {
  for (const c of conns.values()) await c.client?.close().catch(() => {});
  conns.clear();
}
