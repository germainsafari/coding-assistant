// npm run eval -- [--tasks id1,id2] [--profile <profile id or name>] [--tool-mode native|template|prompt]
//                 [--no-thinking] [--label name] [--list]
// Runs the eval tasks headless against a model profile and writes evals/results/<id>.{json,md}.
// A/B test: run twice with different --profile values and compare the reports.
import { closeMcp } from '../mcp.ts';
import { stopAllBackground } from '../shell.ts';
import { closeBrowser } from '../browser.ts';
import { getSettings } from '../config.ts';
import { listTasks, runEvals } from './runner.ts';

const args = process.argv.slice(2);
const get = (flag: string) => {
  const i = args.indexOf(flag);
  return i !== -1 ? args[i + 1] : undefined;
};

if (args.includes('--list')) {
  for (const t of listTasks()) console.log(`${t.id.padEnd(28)} ${t.title}`);
  console.log(`\nProfiles: ${getSettings().profiles.map((p) => `${p.id} (${p.model} @ ${p.baseUrl})`).join(', ')}`);
  process.exit(0);
}

const taskIds = get('--tasks')?.split(',').filter(Boolean);
const toolMode = get('--tool-mode') as any;
const model: Record<string, unknown> = {};
if (toolMode) model.toolMode = toolMode;
if (args.includes('--no-thinking')) model.thinking = false;

try {
  const report = await runEvals({ taskIds, profileId: get('--profile'), model, label: get('--label'), log: (s) => console.log(s) });
  console.log(`\nDone: ${report.passed}/${report.total} passed.`);
  process.exitCode = report.passed === report.total ? 0 : 1;
} catch (e) {
  console.error('Eval failed:', (e as Error).message);
  process.exitCode = 2;
} finally {
  stopAllBackground();
  await closeBrowser();
  await closeMcp();
  setTimeout(() => process.exit(), 500).unref();
}
