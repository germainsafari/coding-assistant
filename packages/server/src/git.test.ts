import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.HEARTH_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'hearth-git-data-'));
const G = await import('./git.ts');

const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'hearth-git-'));

test('initRepo creates main with a default .gitignore', async () => {
  assert.equal((await G.initRepo(repo)).code, 0);
  assert.match(fs.readFileSync(path.join(repo, '.gitignore'), 'utf8'), /__pycache__\//);
  fs.mkdirSync(path.join(repo, '__pycache__'));
  fs.writeFileSync(path.join(repo, '__pycache__', 'x.pyc'), '');
  fs.writeFileSync(path.join(repo, 'a.py'), 'print(1)\n');
  const st = await G.status(repo);
  assert.deepEqual(st.files.map((f) => f.path).sort(), ['.gitignore', 'a.py']);
});

test('commit, log and branches parse correctly', async () => {
  assert.equal((await G.commit(repo, 'feat: first commit\n\nbody')).code, 0);
  const log = await G.log(repo);
  assert.equal(log.length, 1);
  assert.equal(log[0].subject, 'feat: first commit');
  assert.match(log[0].short, /^[0-9a-f]{7,}$/);
  assert.equal((await G.git(repo, ['branch', 'feature/x'])).code, 0);
  const br = await G.branches(repo);
  assert.deepEqual(br.map((b) => [b.name, b.current, b.remote]).sort(), [
    ['feature/x', false, false],
    ['main', true, false],
  ]);
});

test('existing .gitignore is left alone', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hearth-git-'));
  fs.writeFileSync(path.join(dir, '.gitignore'), 'custom\n');
  await G.initRepo(dir);
  assert.equal(fs.readFileSync(path.join(dir, '.gitignore'), 'utf8'), 'custom\n');
});
