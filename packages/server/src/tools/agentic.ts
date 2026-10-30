// Tools about the agent itself: memory, project notes, plan/todos, asking the user,
// skills and subagents.
import fs from 'node:fs';
import path from 'node:path';
import type { TodoItem } from '@hearth/shared';
import { memories, threads } from '../db.ts';
import { loadSkill } from '../skills.ts';
import { writePlanFile } from '../agent/longrun.ts';
import { fail, ok, str, type ToolDef } from './types.ts';

export const NOTES_FILES = ['AGENTS.md', 'AGENT.md', 'CLAUDE.md'];
export function projectNotesPath(root: string): string {
  for (const f of NOTES_FILES) if (fs.existsSync(path.join(root, f))) return path.join(root, f);
  return path.join(root, 'AGENTS.md');
}

const memorySave: ToolDef = {
  name: 'memory_save',
  description:
    'Save a durable fact to long-term memory (e.g. user preferences, project conventions, how to run tests, decisions). scope="project" (default) or "global" (all projects). Keep each memory short and self-contained.',
  parameters: {
    type: 'object',
    properties: {
      content: { type: 'string' },
      tags: { type: 'string', description: 'Optional space-separated keywords' },
      scope: { type: 'string', enum: ['project', 'global'] },
    },
    required: ['content'],
  },
  risk: 'read',
  async execute(a, ctx) {
    const m = memories.add(a.scope === 'global' ? null : ctx.project.id, str(a.content, 'content'), a.tags ?? '');
    return ok(`Saved memory #${m.id}.`);
  },
};

const memorySearch: ToolDef = {
  name: 'memory_search',
  description: 'Full-text search the long-term memory (this project + global memories).',
  parameters: { type: 'object', properties: { query: { type: 'string' }, limit: { type: 'integer' } }, required: ['query'] },
  risk: 'read',
  async execute(a, ctx) {
    const rows = memories.search(str(a.query, 'query'), ctx.project.id, Math.min(30, Number(a.limit) || 10));
    return ok(rows.length ? rows.map((r) => `#${r.id} [${r.projectId ? 'project' : 'global'}] ${r.content}${r.tags ? ` (tags: ${r.tags})` : ''}`).join('\n') : 'No matching memories.');
  },
};

const memoryDelete: ToolDef = {
  name: 'memory_delete',
  description: 'Delete a long-term memory by id (e.g. when it is outdated or wrong).',
  parameters: { type: 'object', properties: { id: { type: 'integer' } }, required: ['id'] },
  risk: 'read',
  async execute(a) {
    memories.delete(Number(a.id));
    return ok(`Deleted memory #${a.id}.`);
  },
};

const updateNotes: ToolDef = {
  name: 'update_project_notes',
  description:
    'Append to (or replace) the project notes file AGENTS.md, which is automatically included in your instructions for every conversation in this project. Use it for build/test commands, architecture notes and conventions.',
  parameters: {
    type: 'object',
    properties: {
      content: { type: 'string' },
      mode: { type: 'string', enum: ['append', 'replace'], description: 'Default append' },
    },
    required: ['content'],
  },
  risk: 'edit',
  async execute(a, ctx) {
    const file = projectNotesPath(ctx.root);
    const content = str(a.content, 'content');
    const before = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
    const next = a.mode === 'replace' ? content : (before ? before.replace(/\s*$/, '\n\n') : '# Project notes\n\n') + content + '\n';
    fs.writeFileSync(file, next, 'utf8');
    return ok(`Updated ${path.basename(file)}.`, { changedFiles: [path.basename(file)] });
  },
};

const updatePlan: ToolDef = {
  name: 'update_plan',
  description:
    'Create or update your task plan (todo list) shown to the user. Send the full list each time. Use for multi-step tasks; mark exactly one item in_progress while working, and completed when done.',
  parameters: {
    type: 'object',
    properties: {
      todos: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            content: { type: 'string' },
            status: { type: 'string', enum: ['pending', 'in_progress', 'completed', 'cancelled'] },
          },
          required: ['content', 'status'],
        },
      },
    },
    required: ['todos'],
  },
  risk: 'read',
  async execute(a, ctx) {
    let list = a.todos;
    if (typeof list === 'string') {
      try {
        list = JSON.parse(list);
      } catch {
        return fail('todos must be a JSON array of {content,status}.');
      }
    }
    if (!Array.isArray(list)) return fail('todos must be an array.');
    const todos: TodoItem[] = list.map((t: any, i: number) => ({
      id: String(t.id ?? i + 1),
      content: String(t.content ?? t.task ?? t.title ?? ''),
      status: ['pending', 'in_progress', 'completed', 'cancelled'].includes(t.status) ? t.status : 'pending',
    }));
    threads.setTodos(ctx.threadId, todos);
    if (ctx.longRun?.enabled && ctx.depth === 0) writePlanFile(ctx.root, todos);
    ctx.emit({ type: 'plan_updated', todos });
    const done = todos.filter((t) => t.status === 'completed').length;
    return ok(`Plan updated (${done}/${todos.length} done).`);
  },
};

const askUser: ToolDef = {
  name: 'ask_user',
  description:
    'Ask the user a clarifying question and wait for the answer. Only use when you truly cannot proceed (ambiguous requirements, missing credentials, choice between very different options).',
  parameters: {
    type: 'object',
    properties: {
      question: { type: 'string' },
      options: { type: 'array', items: { type: 'string' }, description: 'Optional quick-reply choices' },
    },
    required: ['question'],
  },
  risk: 'read',
  async execute(a, ctx) {
    const answer = await ctx.askUser(str(a.question, 'question'), Array.isArray(a.options) ? a.options.map(String) : undefined);
    return ok(`User answered: ${answer}`);
  },
};

const loadSkillTool: ToolDef = {
  name: 'load_skill',
  description: 'Load the full instructions of a skill listed in your system prompt (by name). Do this before performing a task the skill covers.',
  parameters: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] },
  risk: 'read',
  async execute(a, ctx) {
    const s = loadSkill(str(a.name, 'name'), ctx.root);
    if (!s) return fail(`Unknown skill "${a.name}".`);
    const dir = path.dirname(s.info.path);
    const extra = s.files.length ? `\n\nSupporting files of this skill (small ones are inlined below):\n${s.files.map((f) => '- ' + f).join('\n')}` : '';
    let inlined = '';
    for (const f of s.files.slice(0, 5)) {
      const p = path.join(dir, f);
      if (fs.statSync(p).size < 20_000) inlined += `\n\n--- ${f} ---\n${fs.readFileSync(p, 'utf8')}`;
    }
    return ok(`# Skill: ${s.info.name}\n\n${s.body.trim()}${extra}${inlined}`);
  },
};

const spawnSubagent: ToolDef = {
  name: 'spawn_subagent',
  description:
    'Delegate a self-contained sub-task to a subagent with a fresh, empty context (it has the same tools). Useful for broad codebase research or isolated work that would otherwise flood your context. Give a complete, specific task description; it returns the subagent\'s final report. read_only=true restricts it to non-modifying tools.',
  parameters: {
    type: 'object',
    properties: {
      task: { type: 'string', description: 'Detailed task and what to report back' },
      read_only: { type: 'boolean', description: 'Default true' },
    },
    required: ['task'],
  },
  risk: 'read',
  async execute(a, ctx) {
    if (ctx.depth >= 1) return fail('Subagents cannot spawn further subagents.');
    const report = await ctx.runSubagent(str(a.task, 'task'), { readOnly: a.read_only !== false });
    return ok(`Subagent report:\n${report}`);
  },
};

export const agenticTools: ToolDef[] = [updatePlan, askUser, loadSkillTool, memorySave, memorySearch, memoryDelete, updateNotes, spawnSubagent];
