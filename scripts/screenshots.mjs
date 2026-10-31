// Captures the documentation screenshots of a running Hearth instance with Playwright.
// Usage: node scripts/screenshots.mjs [--base http://localhost:4545] [--out docs/images] [--scale 2]
//                                     [--thread <threadId>] [--git-thread <threadId>] [--only chat,git]
// Run it against a server with a few real threads (for example a separate HEARTH_DATA_DIR with demo projects).
// By default it picks the thread with the most messages for the chat shots and the thread whose
// project has uncommitted changes for the Git shot.
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const arg = (name, def) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : def;
};
const base = arg('base', 'http://localhost:4545').replace(/\/$/, '');
const out = path.resolve(arg('out', 'docs/images'));
const scale = Number(arg('scale', '2'));
const only = arg('only', '')?.split(',').filter(Boolean);
fs.mkdirSync(out, { recursive: true });

const api = async (p) => {
  const r = await fetch(base + p);
  if (!r.ok) throw new Error(`${p}: ${r.status} ${await r.text()}`);
  return r.json();
};

const projects = await api('/api/projects');
if (!projects.length) throw new Error('No projects yet: run a task first (for example node scripts/smoke.mjs).');
const threads = [];
for (const p of projects) for (const t of await api(`/api/projects/${p.id}/threads`)) threads.push({ ...t, projectId: p.id, size: (await api(`/api/threads/${t.id}`)).messages.length });
const pick = (id) => threads.find((t) => t.id === id);
const main = pick(arg('thread')) ?? [...threads].sort((a, b) => b.size - a.size)[0];
let gitThread = pick(arg('git-thread'));
if (!gitThread) {
  for (const t of [...threads].sort((a, b) => b.size - a.size)) {
    const st = await api(`/api/projects/${t.projectId}/git/status`).catch(() => null);
    if (st?.files?.length) {
      gitThread = t;
      break;
    }
  }
}
gitThread ??= main;

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: scale });

/** A fresh page with the given UI state and theme already in localStorage. */
async function open({ thread = main, rightTab = 'files', rightOpen = true, sidebarOpen = true, theme = 'dark', empty = false } = {}) {
  const page = await ctx.newPage();
  if (empty) await page.route('**/api/projects', (r) => (r.request().method() === 'GET' ? r.fulfill({ json: [] }) : r.continue()));
  await page.addInitScript(
    ([ui, th]) => {
      if (sessionStorage.getItem('shot')) return;
      sessionStorage.setItem('shot', '1');
      localStorage.clear();
      localStorage.setItem('hearth.ui', ui);
      localStorage.setItem('hearth.theme', th);
    },
    [JSON.stringify({ projectId: thread.projectId, threadId: thread.id, rightTab, rightOpen, sidebarOpen }), theme],
  );
  await page.goto(base);
  await page.locator(empty ? 'text=Welcome to Hearth' : '[data-chat]').first().waitFor();
  await page.waitForTimeout(1200);
  return page;
}
const want = (name) => !only?.length || only.includes(name.replace(/\.png$/, ''));
async function shot(page, name) {
  await page.waitForTimeout(500);
  await page.mouse.move(0, 999);
  await page.screenshot({ path: path.join(out, name) });
  console.log('saved', path.join(out, name));
}

if (want('welcome.png')) {
  const page = await open({ empty: true });
  await shot(page, 'welcome.png');
  await page.close();
}

if (want('chat.png') || want('light-theme.png')) {
  for (const [name, theme] of [
    ['chat.png', 'dark'],
    ['light-theme.png', 'light'],
  ]) {
    if (!want(name)) continue;
    const page = await open({ theme, rightTab: theme === 'light' ? 'git' : 'files', thread: theme === 'light' ? gitThread : main });
    // Show the middle of the run (tool cards and a diff) rather than only the final answer.
    const edit = page.getByRole('button', { name: /^Edit / }).first();
    if (theme === 'dark' && (await edit.count())) {
      await edit.click();
      await edit.evaluate((el) => el.scrollIntoView({ block: 'start' }));
      await page.locator('[data-chat] .overflow-y-auto').first().evaluate((el) => el.scrollBy(0, -260));
    }
    await shot(page, name);
    await page.close();
  }
}

if (want('files.png')) {
  const page = await open({ rightTab: 'files', sidebarOpen: false });
  const tree = page.getByRole('tree', { name: 'Project files' });
  const dir = tree.getByRole('button').filter({ hasNotText: '.' }).first();
  if (await dir.count()) await dir.click();
  await page.waitForTimeout(400);
  const file = tree
    .getByRole('button', { name: /\.(py|js|ts|tsx)$/ })
    .filter({ hasNotText: '__' })
    .first();
  if (await file.count()) {
    await file.click();
    await page.locator('.monaco-editor').first().waitFor({ timeout: 15000 });
  }
  await shot(page, 'files.png');
  await page.close();
}

if (want('git.png')) {
  const page = await open({ thread: gitThread, rightTab: 'git' });
  await shot(page, 'git.png');
  await page.close();
}

if (want('terminal.png')) {
  const page = await open({ rightTab: 'terminal' });
  const cmd = page.getByRole('textbox', { name: 'Command' });
  await cmd.fill('git log --oneline -5');
  await cmd.press('Enter');
  await page.getByText(/exit code/).first().waitFor({ timeout: 15000 }).catch(() => {});
  await cmd.fill('git status --short');
  await cmd.press('Enter');
  await page.waitForTimeout(1500);
  await shot(page, 'terminal.png');
  await page.close();
}

if (want('traces.png')) {
  const page = await open({ rightTab: 'traces' });
  const row = page.locator('[data-run-row]').first();
  if (await row.count()) {
    await row.click();
    await page.waitForTimeout(1200);
  }
  await shot(page, 'traces.png');
  await page.close();
}

if (['settings-models', 'settings-agent', 'settings-mcp', 'settings-connectors', 'settings-skills'].some((n) => want(n))) {
  const page = await open();
  await page.keyboard.press('Control+,');
  const dialog = page.getByRole('dialog');
  await dialog.waitFor();
  await shot(page, 'settings-models.png');
  for (const [tab, file] of [
    ['Agent', 'settings-agent.png'],
    ['MCP servers', 'settings-mcp.png'],
    ['Connectors', 'settings-connectors.png'],
    ['Skills', 'settings-skills.png'],
  ]) {
    await dialog.getByRole('navigation').getByRole('button', { name: tab, exact: true }).click();
    if (want(file)) await shot(page, file);
  }
  await page.close();
}

if (want('long-run.png')) {
  const page = await open();
  await page.getByRole('button', { name: 'Long-run', exact: true }).click();
  await page.getByRole('textbox', { name: 'Definition-of-done command' }).fill('python -m unittest discover -s tests');
  await page.getByRole('textbox', { name: 'Message Hearth' }).fill('Add a budget command: set a monthly limit per category and warn when a report goes over it. Keep going until all tests pass.');
  await shot(page, 'long-run.png');
  await page.close();
}

if (want('command-palette.png')) {
  const page = await open();
  await page.keyboard.press('Control+k');
  await page.getByRole('dialog').waitFor();
  await page.waitForTimeout(400);
  await shot(page, 'command-palette.png');
  await page.close();
}

await browser.close();
