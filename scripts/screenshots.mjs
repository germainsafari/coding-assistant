// Captures documentation screenshots of a running Hearth instance with Playwright.
// Usage: node scripts/screenshots.mjs [--base http://127.0.0.1:3000] [--out docs/images] [--thread <threadId>]
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const arg = (name, def) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : def;
};
const base = arg('base', 'http://127.0.0.1:3000').replace(/\/$/, '');
const out = path.resolve(arg('out', 'docs/images'));
fs.mkdirSync(out, { recursive: true });

const api = async (p) => {
  const r = await fetch(base + p);
  if (!r.ok) throw new Error(`${p}: ${r.status} ${await r.text()}`);
  return r.json();
};

// Pick the thread with the most messages unless one is given.
let threadId = arg('thread');
let projectId;
const projects = await api('/api/projects');
if (!projects.length) throw new Error('No projects yet: run a task first (e.g. node scripts/smoke.mjs).');
if (threadId) {
  projectId = (await api(`/api/threads/${threadId}`)).thread.projectId;
} else {
  let best = -1;
  for (const p of projects) {
    for (const t of await api(`/api/projects/${p.id}/threads`)) {
      const n = (await api(`/api/threads/${t.id}`)).messages.length;
      if (n > best) [best, threadId, projectId] = [n, t.id, p.id];
    }
  }
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 960 } });
const ui = (rightTab, rightOpen = true) =>
  page.addInitScript((v) => localStorage.setItem('hearth.ui', v), JSON.stringify({ projectId, threadId, rightTab, rightOpen }));
const shot = async (name) => {
  await page.waitForTimeout(700);
  await page.screenshot({ path: path.join(out, name) });
  console.log('saved', path.join(out, name));
};
const clickText = (text) => page.getByRole('button', { name: text, exact: true }).first().click();

await ui('files');
await page.goto(base);
await page.getByText('Explorer', { exact: true }).waitFor();
await page.waitForTimeout(1500);
await shot('chat.png');

const firstPy = page.getByRole('button', { name: /\.(py|js|ts)$/ }).first();
if (await firstPy.count()) {
  await firstPy.click();
  await page.locator('.monaco-editor').first().waitFor({ timeout: 15000 });
  await shot('files.png');
}

await clickText('Git');
await page.waitForTimeout(1200);
await shot('git.png');

await clickText('Traces');
await page.waitForTimeout(1200);
const runRow = page.locator('[data-run-row]').first();
if (await runRow.count()) {
  await runRow.click();
  await page.waitForTimeout(1200);
}
await shot('traces.png');

await clickText('Settings');
await page.getByRole('dialog').waitFor();
await shot('settings-models.png');
for (const [tab, file] of [
  ['Agent', 'settings-agent.png'],
  ['MCP servers', 'settings-mcp.png'],
  ['Skills', 'settings-skills.png'],
]) {
  await page.getByRole('dialog').getByRole('button', { name: tab, exact: true }).click();
  await shot(file);
}
await page.keyboard.press('Escape');

await clickText('Long-run');
await shot('long-run.png');

await browser.close();
