import type { AgentEventBody, Project, Settings, ToolRisk } from '@hearth/shared';

export interface ToolContext {
  project: Project;
  root: string;
  threadId: string;
  runId: string;
  settings: Settings;
  signal: AbortSignal;
  depth: number;
  callId: string;
  emit: (e: AgentEventBody) => void;
  askUser: (question: string, options?: string[]) => Promise<string>;
  runSubagent: (task: string, opts: { readOnly: boolean }) => Promise<string>;
}

export interface ToolResult {
  /** Text sent back to the model. */
  content: string;
  ok: boolean;
  diff?: string;
  /** data URL; attached to the model context as an image when vision is enabled */
  image?: string;
  /** Files changed by the tool (relative paths), used by the UI to refresh. */
  changedFiles?: string[];
}

export interface ToolDef {
  name: string;
  description: string;
  parameters: { type: 'object'; properties: Record<string, any>; required?: string[] };
  risk: ToolRisk;
  /** Override the risk classification per call (e.g. git_branch list = read). */
  riskFor?: (args: any) => ToolRisk;
  /** MCP server tools may be auto-approved per server config. */
  autoApprove?: boolean;
  /** Produce a preview (e.g. a diff) shown in the approval prompt. */
  preview?: (args: any, ctx: ToolContext) => Promise<string | undefined>;
  execute: (args: any, ctx: ToolContext) => Promise<ToolResult>;
}

export const ok = (content: string, extra: Partial<ToolResult> = {}): ToolResult => ({ content, ok: true, ...extra });
export const fail = (content: string, extra: Partial<ToolResult> = {}): ToolResult => ({ content, ok: false, ...extra });

export function str(v: unknown, name: string, required = true): string {
  if (v === undefined || v === null || v === '') {
    if (required) throw new Error(`Missing required argument "${name}"`);
    return '';
  }
  return typeof v === 'string' ? v : JSON.stringify(v);
}
