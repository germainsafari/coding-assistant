import * as G from '../git.ts';
import * as GH from '../github.ts';
import { resolveInProject, relPath } from '../safety.ts';
import { truncateMiddle } from '../util.ts';
import { fail, ok, str, type ToolDef } from './types.ts';

const gitStatus: ToolDef = {
  name: 'git_status',
  description: 'Show git branch and changed files of the project.',
  parameters: { type: 'object', properties: {} },
  risk: 'read',
  async execute(_a, ctx) {
    const s = await G.status(ctx.root);
    if (!s.isRepo) return ok('Not a git repository. You can initialize one with run_shell("git init").');
    const files = s.files.map((f) => `${f.index}${f.worktree} ${f.path}`).join('\n');
    return ok(`Branch: ${s.branch}${s.upstream ? ` (tracking ${s.upstream}, ahead ${s.ahead}, behind ${s.behind})` : ''}\n${files || 'Working tree clean.'}`);
  },
};

const gitDiff: ToolDef = {
  name: 'git_diff',
  description: 'Show the git diff of uncommitted changes (optionally one file, or staged changes).',
  parameters: { type: 'object', properties: { path: { type: 'string' }, staged: { type: 'boolean' } } },
  risk: 'read',
  async execute(a, ctx) {
    const p = a.path ? relPath(ctx.root, resolveInProject(ctx.root, a.path)) : undefined;
    const d = await G.diff(ctx.root, { path: p, staged: !!a.staged });
    return ok(truncateMiddle(d || 'No changes.', 20_000).text);
  },
};

const gitLog: ToolDef = {
  name: 'git_log',
  description: 'Show recent commits.',
  parameters: { type: 'object', properties: { n: { type: 'integer', description: 'Number of commits (default 15)' } } },
  risk: 'read',
  async execute(a, ctx) {
    const l = await G.log(ctx.root, Math.min(100, Number(a.n) || 15));
    return ok(l.map((c) => `${c.short} ${c.date.slice(0, 10)} ${c.author}: ${c.subject}`).join('\n') || 'No commits.');
  },
};

const gitCommit: ToolDef = {
  name: 'git_commit',
  description: 'Stage changes (all, or the given paths) and create a commit with the given message. Write a clear conventional message.',
  parameters: {
    type: 'object',
    properties: {
      message: { type: 'string', description: 'Commit message (subject line, blank line, optional body)' },
      paths: { type: 'array', items: { type: 'string' }, description: 'Optional list of paths to stage; default all changes' },
    },
    required: ['message'],
  },
  risk: 'edit',
  async execute(a, ctx) {
    if (!(await G.isRepo(ctx.root))) return fail('Not a git repository.');
    const paths = Array.isArray(a.paths) ? a.paths.map((p: string) => relPath(ctx.root, resolveInProject(ctx.root, p))) : undefined;
    const r = await G.commit(ctx.root, str(a.message, 'message'), paths);
    return r.code === 0 ? ok(r.stdout.trim()) : fail(`git commit failed:\n${r.stdout}\n${r.stderr}`);
  },
};

const gitBranch: ToolDef = {
  name: 'git_branch',
  description: 'List branches, create a new branch (and switch to it), or switch to an existing branch.',
  parameters: {
    type: 'object',
    properties: {
      action: { type: 'string', enum: ['list', 'create', 'checkout'] },
      name: { type: 'string' },
    },
    required: ['action'],
  },
  risk: 'edit',
  riskFor: (a) => (a.action === 'list' ? 'read' : 'edit'),
  async execute(a, ctx) {
    if (a.action === 'list') {
      const b = await G.branches(ctx.root);
      return ok(b.map((x) => `${x.current ? '* ' : '  '}${x.name}`).join('\n') || 'No branches.');
    }
    const name = str(a.name, 'name');
    const r = await G.git(ctx.root, a.action === 'create' ? ['checkout', '-b', name] : ['checkout', name]);
    return r.code === 0 ? ok((r.stdout + r.stderr).trim() || `On branch ${name}`) : fail(r.stderr || r.stdout);
  },
};

const gitPush: ToolDef = {
  name: 'git_push',
  description: 'Push the current branch (or a named branch) to the "origin" remote, setting upstream. Uses the GitHub token from settings for github.com.',
  parameters: { type: 'object', properties: { branch: { type: 'string' } } },
  risk: 'external',
  async execute(a, ctx) {
    const r = await G.push(ctx.root, a.branch);
    return r.code === 0 ? ok((r.stdout + r.stderr).trim() || 'Pushed.') : fail(`git push failed:\n${r.stderr || r.stdout}`);
  },
};

const ghListIssues: ToolDef = {
  name: 'github_list_issues',
  description: 'List GitHub issues of the project repository (from the origin remote) or of repo="owner/name".',
  parameters: { type: 'object', properties: { repo: { type: 'string' }, state: { type: 'string', enum: ['open', 'closed', 'all'] } } },
  risk: 'network',
  async execute(a, ctx) {
    const list = await GH.listIssues(ctx.root, a.repo, a.state ?? 'open');
    return ok(list.map((i) => `#${i.number} [${i.state}] ${i.title} (${i.user}) ${i.labels.join(',')}`).join('\n') || 'No issues.');
  },
};

const ghGetIssue: ToolDef = {
  name: 'github_get_issue',
  description: 'Read a GitHub issue with its comments.',
  parameters: { type: 'object', properties: { number: { type: 'integer' }, repo: { type: 'string' } }, required: ['number'] },
  risk: 'network',
  async execute(a, ctx) {
    const i = await GH.getIssue(ctx.root, Number(a.number), a.repo);
    const text = `#${i.number} ${i.title} [${i.state}]\n${i.url}\n\n${i.body ?? ''}\n\n${i.comments.map((c) => `--- ${c.user}:\n${c.body}`).join('\n\n')}`;
    return ok(truncateMiddle(text, 15_000).text);
  },
};

const ghCreateIssue: ToolDef = {
  name: 'github_create_issue',
  description: 'Create a GitHub issue.',
  parameters: { type: 'object', properties: { title: { type: 'string' }, body: { type: 'string' }, repo: { type: 'string' } }, required: ['title'] },
  risk: 'external',
  async execute(a, ctx) {
    const r = await GH.createIssue(ctx.root, { title: str(a.title, 'title'), body: a.body, repo: a.repo });
    return ok(`Created issue #${r.number}: ${r.url}`);
  },
};

const ghListPrs: ToolDef = {
  name: 'github_list_prs',
  description: 'List pull requests of the project GitHub repository.',
  parameters: { type: 'object', properties: { repo: { type: 'string' }, state: { type: 'string', enum: ['open', 'closed', 'all'] } } },
  risk: 'network',
  async execute(a, ctx) {
    const list = await GH.listPulls(ctx.root, a.repo, a.state ?? 'open');
    return ok(list.map((p) => `#${p.number} [${p.state}${p.draft ? ', draft' : ''}] ${p.title} (${p.head} → ${p.base}) ${p.url}`).join('\n') || 'No pull requests.');
  },
};

const ghCreatePr: ToolDef = {
  name: 'github_create_pr',
  description: 'Open a GitHub pull request from a pushed branch (push it first with git_push). base defaults to the repo default branch.',
  parameters: {
    type: 'object',
    properties: {
      title: { type: 'string' },
      body: { type: 'string', description: 'PR description in Markdown' },
      head: { type: 'string', description: 'Source branch (default: current branch)' },
      base: { type: 'string' },
      draft: { type: 'boolean' },
    },
    required: ['title'],
  },
  risk: 'external',
  async execute(a, ctx) {
    const head = a.head || (await G.git(ctx.root, ['rev-parse', '--abbrev-ref', 'HEAD'])).stdout.trim();
    const r = await GH.createPull(ctx.root, { title: str(a.title, 'title'), body: a.body, head, base: a.base, draft: !!a.draft });
    return ok(`Opened PR #${r.number}: ${r.url}`);
  },
};

export const gitTools: ToolDef[] = [gitStatus, gitDiff, gitLog, gitCommit, gitBranch, gitPush];
export const githubTools: ToolDef[] = [ghListIssues, ghGetIssue, ghCreateIssue, ghListPrs, ghCreatePr];
