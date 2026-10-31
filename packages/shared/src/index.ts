// Shared types between the Hearth server and web UI.
// The server streams AgentEvent objects to the browser over Server-Sent Events.

export type ApprovalMode = 'ask' | 'auto-edit' | 'full-auto';
export type ToolMode = 'auto' | 'native' | 'template' | 'prompt';
export type RunStatus = 'running' | 'completed' | 'cancelled' | 'error' | 'max_steps' | 'budget_exhausted' | 'interrupted';
export type ToolRisk = 'read' | 'edit' | 'shell' | 'network' | 'external';
export type ReasoningEffort = '' | 'low' | 'medium' | 'high';

export interface ModelSettings {
  baseUrl: string;
  apiKey: string;
  model: string;
  temperature: number;
  topP: number;
  /** 0 = server default */
  topK: number;
  maxOutputTokens: number;
  /** 0 = auto-detect from the server (/v1/models max_model_len) */
  contextLimit: number;
  thinking: boolean;
  /** Sent as `reasoning_effort` when non-empty (models that support it). */
  reasoningEffort: ReasoningEffort;
  toolMode: ToolMode;
  vision: boolean;
}

/** A named OpenAI-compatible endpoint + sampling settings. */
export interface ModelProfile extends ModelSettings {
  id: string;
  name: string;
}

/** Options of an autonomous long-running run ("long-run mode"). */
export interface LongRunOptions {
  enabled: boolean;
  /** Command that must exit 0 before the run may finish (e.g. "npm test"). Empty = no gate. */
  doneCommand: string;
  maxMinutes: number;
  maxSteps: number;
  /** How many times the done-command may fail before the run gives up. */
  maxVerifyAttempts: number;
}

export interface RunOptions {
  profileId?: string;
  longRun?: LongRunOptions;
  /** id of the interrupted run this one resumes */
  resumeOf?: string;
  /** How many times Hearth has auto-continued this task after a step/time checkpoint. */
  autoContinueCount?: number;
}

export interface McpServerConfig {
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
  url?: string;
  headers?: Record<string, string>;
  disabled?: boolean;
  /** if true, tools from this server never require approval */
  autoApprove?: boolean;
}

export interface Settings {
  /** Resolved active profile (read-only view of profiles[activeProfileId]). */
  model: ModelSettings;
  profiles: ModelProfile[];
  activeProfileId: string;
  approvalMode: ApprovalMode;
  /** Compact the conversation when the prompt exceeds this fraction of the context window. */
  compactAt: number;
  longRun: Omit<LongRunOptions, 'enabled'> & { autoResume: boolean; autoContinue: boolean };
  /** Composer Long-run toggle. Persisted so it stays on across threads and reloads. */
  longRunEnabled: boolean;
  maxSteps: number;
  shellTimeoutSec: number;
  projectsDir: string;
  languageToolUrl: string;
  githubToken: string;
  mcpServers: Record<string, McpServerConfig>;
  disabledSkills: string[];
  memoryAutoRecall: boolean;
  otel: { enabled: boolean; endpoint: string };
}

export interface Project {
  id: string;
  name: string;
  path: string;
  createdAt: number;
  gitRemote?: string | null;
}

export interface Thread {
  id: string;
  projectId: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  parentThreadId?: string | null;
  activeRunId?: string | null;
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface ToolResultMeta {
  ok: boolean;
  durationMs?: number;
  diff?: string;
  /** data URL of an image (e.g. browser screenshot) */
  image?: string;
  denied?: boolean;
  truncated?: boolean;
}

export interface ChatMessage {
  id: string;
  threadId: string;
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  reasoning?: string | null;
  toolCalls?: ToolCall[] | null;
  toolCallId?: string | null;
  name?: string | null;
  meta?: (ToolResultMeta & Record<string, unknown>) | null;
  runId?: string | null;
  createdAt: number;
}

export interface TodoItem {
  id: string;
  content: string;
  status: 'pending' | 'in_progress' | 'completed' | 'cancelled';
}

export type AgentEventBody =
  | { type: 'run_started'; threadId: string; userMessage: string; model: string; longRun?: LongRunOptions | null }
  | { type: 'step_started'; step: number }
  | { type: 'reasoning_delta'; text: string }
  | { type: 'text_delta'; text: string }
  | { type: 'tool_call_generating'; name: string }
  | { type: 'assistant_message'; message: ChatMessage }
  | { type: 'tool_call_started'; call: ToolCall }
  | { type: 'approval_required'; call: ToolCall; reason: string; preview?: string }
  | { type: 'approval_resolved'; callId: string; decision: 'approved' | 'denied'; feedback?: string }
  | { type: 'tool_output_delta'; callId: string; text: string }
  | { type: 'tool_call_finished'; callId: string; name: string; message: ChatMessage }
  | { type: 'ask_user'; callId: string; question: string; options?: string[] }
  | { type: 'ask_user_answered'; callId: string; answer: string }
  | { type: 'plan_updated'; todos: TodoItem[] }
  | { type: 'context_compacted'; beforeTokens: number; afterTokens: number; summary: string }
  | { type: 'usage'; promptTokens: number; completionTokens: number; contextLimit: number; tokensPerSec?: number }
  | { type: 'notice'; level: 'info' | 'warn'; text: string }
  | { type: 'verification'; command: string; passed: boolean; output: string; attempt: number }
  | { type: 'subagent_event'; parentCallId: string; event: AgentEvent }
  | { type: 'error'; message: string }
  | { type: 'run_finished'; status: RunStatus; error?: string };

export type AgentEvent = AgentEventBody & { seq: number; runId: string; ts: number };

export interface SpanRecord {
  id: string;
  runId: string;
  parentId?: string | null;
  kind: 'llm' | 'tool' | 'compaction' | 'subagent';
  name: string;
  startedAt: number;
  endedAt?: number | null;
  durationMs?: number | null;
  status: 'ok' | 'error' | 'running' | 'denied';
  input?: string | null;
  output?: string | null;
  promptTokens?: number | null;
  completionTokens?: number | null;
  ttftMs?: number | null;
  tokensPerSec?: number | null;
  error?: string | null;
}

export interface RunRecord {
  id: string;
  threadId: string;
  projectId: string;
  parentRunId?: string | null;
  status: RunStatus;
  startedAt: number;
  endedAt?: number | null;
  model: string;
  steps: number;
  promptTokens: number;
  completionTokens: number;
  userMessage: string;
  error?: string | null;
  source: string;
  options?: RunOptions | null;
}

export interface Metrics {
  runs: number;
  runsByStatus: Record<string, number>;
  llmCalls: number;
  avgTokensPerSec: number;
  avgTtftMs: number;
  avgLlmLatencyMs: number;
  totalPromptTokens: number;
  totalCompletionTokens: number;
  toolCalls: number;
  toolSuccessRate: number;
  tools: { name: string; calls: number; errors: number; avgMs: number }[];
  recentLlm: { startedAt: number; tokensPerSec: number; durationMs: number; promptTokens: number; completionTokens: number }[];
}

export interface Capabilities {
  reachable: boolean;
  error?: string;
  models: string[];
  maxModelLen?: number;
  nativeTools: boolean;
  templateTools: boolean;
  reasoning: boolean;
  effectiveToolMode: Exclude<ToolMode, 'auto'>;
  checkedAt: number;
}

export interface SkillInfo {
  name: string;
  description: string;
  path: string;
  source: 'builtin' | 'project' | 'user';
  enabled: boolean;
}

export interface EvalTaskInfo {
  id: string;
  title: string;
  prompt: string;
  check: string;
  tags?: string[];
}

export interface EvalTaskResult {
  id: string;
  title: string;
  passed: boolean;
  durationMs: number;
  steps: number;
  promptTokens: number;
  completionTokens: number;
  toolCalls: number;
  runStatus: string;
  checkOutput: string;
  error?: string;
}

export interface EvalReport {
  id: string;
  startedAt: number;
  finishedAt: number;
  model: string;
  profile?: string;
  thinking?: boolean;
  toolMode: string;
  passed: number;
  total: number;
  results: EvalTaskResult[];
}
