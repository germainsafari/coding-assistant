import { Octokit } from '@octokit/rest';
import { getSettings } from './config.ts';
import { parseGithubRemote, remoteUrl } from './git.ts';

export function octokit(): Octokit {
  const token = getSettings().githubToken;
  if (!token) throw new Error('No GitHub token configured. Add a personal access token in Settings → Connectors (or GITHUB_TOKEN in .env).');
  return new Octokit({ auth: token, userAgent: 'hearth-local-agent' });
}

export async function repoFor(cwd: string, explicit?: string): Promise<{ owner: string; repo: string }> {
  if (explicit) {
    const [owner, repo] = explicit.split('/');
    if (owner && repo) return { owner, repo };
  }
  const r = parseGithubRemote(await remoteUrl(cwd));
  if (!r) throw new Error('This project has no GitHub "origin" remote. Pass repo="owner/name" explicitly.');
  return r;
}

export async function whoami() {
  const { data } = await octokit().users.getAuthenticated();
  return { login: data.login, name: data.name, avatarUrl: data.avatar_url };
}

export async function listRepos(query?: string) {
  const gh = octokit();
  if (query) {
    const me = await whoami();
    const { data } = await gh.search.repos({ q: `${query} user:${me.login}`, per_page: 30 });
    return data.items.map((r) => ({ fullName: r.full_name, private: r.private, description: r.description, cloneUrl: r.clone_url, updatedAt: r.updated_at }));
  }
  const { data } = await gh.repos.listForAuthenticatedUser({ per_page: 50, sort: 'updated' });
  return data.map((r) => ({ fullName: r.full_name, private: r.private, description: r.description, cloneUrl: r.clone_url, updatedAt: r.updated_at }));
}

export async function listPulls(cwd: string, repo?: string, state: 'open' | 'closed' | 'all' = 'open') {
  const { owner, repo: name } = await repoFor(cwd, repo);
  const { data } = await octokit().pulls.list({ owner, repo: name, state, per_page: 30 });
  return data.map((p) => ({ number: p.number, title: p.title, state: p.state, user: p.user?.login, url: p.html_url, head: p.head.ref, base: p.base.ref, draft: p.draft }));
}

export async function createPull(cwd: string, a: { title: string; body?: string; head: string; base?: string; draft?: boolean; repo?: string }) {
  const { owner, repo } = await repoFor(cwd, a.repo);
  const gh = octokit();
  const base = a.base || (await gh.repos.get({ owner, repo })).data.default_branch;
  const { data } = await gh.pulls.create({ owner, repo, title: a.title, body: a.body, head: a.head, base, draft: a.draft });
  return { number: data.number, url: data.html_url };
}

export async function listIssues(cwd: string, repo?: string, state: 'open' | 'closed' | 'all' = 'open') {
  const { owner, repo: name } = await repoFor(cwd, repo);
  const { data } = await octokit().issues.listForRepo({ owner, repo: name, state, per_page: 30 });
  return data
    .filter((i) => !i.pull_request)
    .map((i) => ({ number: i.number, title: i.title, state: i.state, user: i.user?.login, url: i.html_url, labels: i.labels.map((l: any) => (typeof l === 'string' ? l : l.name)) }));
}

export async function getIssue(cwd: string, number: number, repo?: string) {
  const { owner, repo: name } = await repoFor(cwd, repo);
  const gh = octokit();
  const { data } = await gh.issues.get({ owner, repo: name, issue_number: number });
  const comments = await gh.issues.listComments({ owner, repo: name, issue_number: number, per_page: 30 });
  return {
    number: data.number,
    title: data.title,
    state: data.state,
    body: data.body,
    url: data.html_url,
    comments: comments.data.map((c) => ({ user: c.user?.login, body: c.body })),
  };
}

export async function createIssue(cwd: string, a: { title: string; body?: string; repo?: string }) {
  const { owner, repo } = await repoFor(cwd, a.repo);
  const { data } = await octokit().issues.create({ owner, repo, title: a.title, body: a.body });
  return { number: data.number, url: data.html_url };
}
