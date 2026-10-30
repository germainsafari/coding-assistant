// npm run eval [-- --tasks id1,id2] [--tool-mode template|prompt|native] [--no-thinking]
import { closeMcp } from '../mcp.ts';
import { stopAllBackground } from '../shell.ts';
import { closeBrowser } from '../browser.ts';
import { listTasks, runEvals } from './runner.ts';

const args = process.argv.slice(2);
const get = (flag: string) => {
  const i = args.indexOf(flag);
  return i !== -1 ? args[i + 1] : undefined;
};

if (args.includes('--list')) {
  for (const t of listTasks()) console.log(`${t.id.padEnd(28)} ${t.title}`);
  process.exit(0);
}

const taskIds = get('--tasks')?.split(',').filter(Boolean);
const toolMode = get('--tool-mode') as any;
const model: any = {};
if (toolMode) model.toolMode = toolMode;
if (args.includes('--no-thinking')) model.thinking = false;

try {
  const report = await runEvals({ taskIds, log: (s) => console.log(s), settings: { model } as any });
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
