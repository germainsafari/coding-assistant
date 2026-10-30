// `npm run doctor`: checks everything Hearth needs and explains how to fix what is missing.
import fs from 'node:fs';
import net from 'node:net';
import { DATA_DIR, HOST, PORT, WEB_DIST, getSettings } from './config.ts';
import { probeCapabilities } from './llm/client.ts';
import { execCommand, shellName } from './shell.ts';
import { errMsg } from './util.ts';

type Level = 'ok' | 'warn' | 'fail';
const icon: Record<Level, string> = { ok: '\x1b[32m✔\x1b[0m', warn: '\x1b[33m!\x1b[0m', fail: '\x1b[31m✘\x1b[0m' };
let failures = 0;
function report(level: Level, title: string, detail = '', fix = '') {
  if (level === 'fail') failures++;
  console.log(`${icon[level]} ${title}${detail ? `: ${detail}` : ''}`);
  if (fix && level !== 'ok') console.log(`    → ${fix.split('\n').join('\n      ')}`);
}

async function cmd(c: string) {
  try {
    const r = await execCommand(c, { cwd: process.cwd(), timeoutMs: 20_000 });
    return { ok: r.exitCode === 0, out: r.output.trim() };
  } catch (e) {
    return { ok: false, out: errMsg(e) };
  }
}

function portFree(port: number, host: string): Promise<boolean> {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.once('error', () => resolve(false));
    s.listen(port, host, () => s.close(() => resolve(true)));
  });
}

async function main() {
  console.log('Hearth doctor\n');
  const settings = getSettings();

  const [maj, min] = process.versions.node.split('.').map(Number);
  report(maj > 22 || (maj === 22 && min >= 13) ? 'ok' : 'fail', 'Node.js', process.versions.node, 'Install Node.js 22.13 or newer (https://nodejs.org). Hearth uses the built-in node:sqlite module.');

  report('ok', 'Shell for agent commands', shellName());

  const git = await cmd('git --version');
  report(git.ok ? 'ok' : 'fail', 'Git', git.ok ? git.out : 'not found', 'Install Git (https://git-scm.com) and make sure "git" is on your PATH.');

  const py = (await cmd('python --version')).ok ? await cmd('python --version') : await cmd('python3 --version');
  report(py.ok ? 'ok' : 'warn', 'Python (optional, used by some evals)', py.ok ? py.out : 'not found', 'Install Python 3 if you want to run the Python eval tasks.');

  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.accessSync(DATA_DIR, fs.constants.W_OK);
    report('ok', 'Data folder', DATA_DIR);
  } catch (e) {
    report('fail', 'Data folder', `${DATA_DIR} is not writable (${errMsg(e)})`, 'Set HEARTH_DATA_DIR to a writable folder.');
  }

  report(fs.existsSync(WEB_DIST) ? 'ok' : 'warn', 'Web UI build', fs.existsSync(WEB_DIST) ? WEB_DIST : 'not built yet', 'Run "npm run build" (or just "npm start", which builds first).');

  const free = await portFree(PORT, HOST);
  report(free ? 'ok' : 'warn', `Port ${PORT} on ${HOST}`, free ? 'free' : 'in use (Hearth already running, or another program)', `Stop the other program or start Hearth on another port: HEARTH_PORT=3005 npm start (PowerShell: $env:HEARTH_PORT=3005; npm start).`);

  for (const p of settings.profiles) {
    const m = { ...settings.model, ...p };
    const caps = await probeCapabilities(m, true);
    const label = `Model "${p.name}" (${m.model} @ ${m.baseUrl})`;
    if (!caps.reachable) {
      report(
        p.id === settings.activeProfileId ? 'fail' : 'warn',
        label,
        caps.error ?? 'unreachable',
        'Start your model server (see docs/setup-guide.md) and check the base URL / model id in Settings → Models.',
      );
      continue;
    }
    const served = caps.models.includes(m.model);
    report(served ? 'ok' : 'fail', label, served ? `served, context ${caps.maxModelLen ?? '?'} tokens` : `server is up but serves: ${caps.models.join(', ')}`, 'Set the model id to one of the served models.');
    if (served) {
      const lvl: Level = caps.effectiveToolMode === 'native' ? 'ok' : 'warn';
      report(
        lvl,
        '  Tool calling',
        `${caps.effectiveToolMode} mode (native=${caps.nativeTools}, template=${caps.templateTools}), reasoning=${caps.reasoning}`,
        'Template mode works fine. To enable native tool calling (the standard setup) add to vLLM: --enable-auto-tool-choice --tool-call-parser qwen3_coder (see docs/setup-guide.md).',
      );
    }
  }

  const lt = settings.languageToolUrl;
  try {
    const r = await fetch(`${lt.replace(/\/$/, '')}/v2/check`, {
      method: 'POST',
      body: new URLSearchParams({ text: 'This are a test.', language: 'en-US' }),
      signal: AbortSignal.timeout(8000),
    });
    report(r.ok ? 'ok' : 'warn', 'LanguageTool (optional)', r.ok ? lt : `HTTP ${r.status}`, 'docker run -d --name languagetool -p 8081:8081 meyay/languagetool');
  } catch (e) {
    report('warn', 'LanguageTool (optional)', `${lt} not reachable (${errMsg(e)})`, 'docker run -d --name languagetool -p 8081:8081 meyay/languagetool');
  }

  try {
    const { chromium } = await import('playwright');
    let found = '';
    for (const [label, opts] of [
      ['Playwright Chromium', {}],
      ['Google Chrome', { channel: 'chrome' }],
      ['Microsoft Edge', { channel: 'msedge' }],
    ] as const) {
      const b = await chromium.launch({ headless: true, ...opts }).catch(() => null);
      if (b) {
        await b.close();
        found = label;
        break;
      }
    }
    report(found ? 'ok' : 'warn', 'Browser for agent tools', found || 'no browser found', 'npm run setup:browser');
  } catch (e) {
    report('warn', 'Browser for agent tools', errMsg(e), 'npm install, then npm run setup:browser');
  }

  report(settings.githubToken ? 'ok' : 'warn', 'GitHub token (optional)', settings.githubToken ? 'configured' : 'not set', 'Settings → Connectors → GitHub (needed for PRs, issues, private clones and pushes).');

  console.log(failures ? `\n${failures} problem(s) must be fixed before Hearth can work.` : '\nAll required checks passed. Start Hearth with: npm start');
  process.exit(failures ? 1 : 0);
}

void main();
