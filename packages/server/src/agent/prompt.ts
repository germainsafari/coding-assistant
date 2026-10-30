import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { LongRunOptions, Project, Settings } from '@hearth/shared';
import { longRunPromptSection } from './longrun.ts';
import { memories } from '../db.ts';
import { listSkills } from '../skills.ts';
import { shellName } from '../shell.ts';
import { projectNotesPath } from '../tools/agentic.ts';
import type { ToolDef } from '../tools/types.ts';
import { truncateMiddle } from '../util.ts';

export function buildSystemPrompt(opts: {
  project: Project;
  settings: Settings;
  tools: ToolDef[];
  mode: 'native' | 'template' | 'prompt';
  userMessage: string;
  subagent?: boolean;
  readOnly?: boolean;
  longRun?: LongRunOptions | null;
}): string {
  const { project, settings, tools } = opts;
  const parts: string[] = [];
  parts.push(
    `You are Hearth, an expert autonomous software engineering agent running fully locally on the user's machine. ` +
      `You work inside the project folder "${project.name}" and accomplish coding tasks by calling tools: reading and editing files, running shell commands, using git, browsing, and more.`,
  );
  if (opts.subagent) {
    parts.push(
      `You are running as a SUBAGENT with a fresh context, delegated a single task by the main agent. Work autonomously, then finish with a concise but complete report of what you found/did (file paths, key facts). The report is all the main agent will see.${opts.readOnly ? ' You are READ-ONLY: do not attempt to modify files or run commands that change state.' : ''}`,
    );
  }
  parts.push(`# Environment
- Operating system: ${os.type()} ${os.release()} (${process.platform}/${process.arch})
- Shell used by run_shell: ${shellName()}${process.platform === 'win32' ? ' — use PowerShell syntax (e.g. `;` to chain, `$env:VAR`, `Get-ChildItem`); `&&` is not available in Windows PowerShell 5.1.' : ''}
- Project root (all paths are relative to it): ${project.path}
- Today: ${new Date().toISOString().slice(0, 10)}
- Approval mode: ${settings.approvalMode} (risky actions may need user approval; if a tool call is denied, adapt or ask).`);

  parts.push(`# How to work
- Be proactive and autonomous: gather context with list_dir / glob / grep / read_file, then act. Don't ask the user for things you can find out yourself.
- For multi-step tasks, start with update_plan and keep it updated.
- Always read a file before editing it. Prefer edit_file (exact search/replace) for changes; use write_file for new files or full rewrites.
- After changing code, verify: run the tests, build, or the program with run_shell, and fix problems you find. For web UIs, start the dev server with run_shell(background=true) and check it with browser_navigate / browser_screenshot.
- Keep changes focused and consistent with the existing code style. Don't add unrelated refactors.
- Never fabricate tool results or file contents. If something fails, read the error and try a different approach; don't repeat the exact same failing call.
- When finished, reply with a short summary of what you did and anything the user should know (how to run it, caveats). Use Markdown. Do not call tools in your final answer.
- Save durable learnings (user preferences, how to build/test this project) with memory_save or update_project_notes.`);

  const notesPath = projectNotesPath(project.path);
  if (fs.existsSync(notesPath)) {
    const notes = truncateMiddle(fs.readFileSync(notesPath, 'utf8'), 8000).text;
    parts.push(`# Project notes (${path.basename(notesPath)})\n${notes}`);
  }

  if (settings.memoryAutoRecall && opts.userMessage) {
    const recalled = memories.search(opts.userMessage, project.id, 6);
    if (recalled.length) parts.push(`# Relevant long-term memories\n${recalled.map((m) => `- (#${m.id}) ${m.content}`).join('\n')}`);
  }

  const skills = listSkills(project.path).filter((s) => s.enabled);
  if (skills.length && tools.some((t) => t.name === 'load_skill')) {
    parts.push(
      `# Skills\nSkills are packaged instructions for specific tasks. When a task matches a skill, call load_skill with its name first and follow it.\n${skills.map((s) => `- ${s.name}: ${s.description}`).join('\n')}`,
    );
  }

  if (opts.longRun?.enabled && !opts.subagent) parts.push(longRunPromptSection(project.path, opts.longRun));

  if (opts.mode === 'prompt') parts.push(promptModeToolInstructions(tools));
  return parts.join('\n\n');
}

/** Used when the server cannot render tools itself: describe them and the call syntax. */
export function promptModeToolInstructions(tools: ToolDef[]): string {
  const defs = tools.map((t) => JSON.stringify({ type: 'function', function: { name: t.name, description: t.description, parameters: t.parameters } })).join('\n');
  return `# Tools
You may call one or more functions to assist with the user query. Function signatures are inside <tools></tools>:
<tools>
${defs}
</tools>

To call a function, output exactly this format (one block per call) and then STOP generating:
<tool_call>
<function=FUNCTION_NAME>
<parameter=PARAM_NAME>
value
</parameter>
</function>
</tool_call>

Results come back in the next message inside <tool_response></tool_response>. Only call functions that exist above.`;
}
