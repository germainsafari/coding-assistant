import type { OAITool } from '../llm/client.ts';
import { mcpTools } from '../mcp.ts';
import { agenticTools } from './agentic.ts';
import { browserTools } from './browser.ts';
import { fsTools } from './fs.ts';
import { gitTools, githubTools } from './git.ts';
import { shellTools } from './shell.ts';
import type { ToolDef } from './types.ts';
import { webTools } from './web.ts';

export function builtinTools(): ToolDef[] {
  return [...fsTools, ...shellTools, ...gitTools, ...githubTools, ...webTools, ...browserTools, ...agenticTools];
}

export function allTools(opts: { readOnly?: boolean; subagent?: boolean } = {}): ToolDef[] {
  let tools = [...builtinTools(), ...mcpTools()];
  if (opts.subagent) tools = tools.filter((t) => t.name !== 'spawn_subagent' && t.name !== 'ask_user' && t.name !== 'update_plan');
  if (opts.readOnly) tools = tools.filter((t) => t.risk === 'read' || t.risk === 'network').filter((t) => !t.name.startsWith('memory_save') && t.name !== 'memory_delete');
  return tools;
}

export function toOpenAITools(tools: ToolDef[]): OAITool[] {
  return tools.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.parameters } }));
}
