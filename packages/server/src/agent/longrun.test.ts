import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MAX_AUTO_CONTINUES, shouldAutoContinue } from './longrun.ts';

test('auto-continues at step and time checkpoints', () => {
  for (const status of ['max_steps', 'budget_exhausted'] as const) {
    assert.equal(shouldAutoContinue({ status, source: 'ui', autoContinue: true, continueCount: 0 }), true);
  }
});

test('does not auto-continue completed, cancelled or error runs', () => {
  for (const status of ['completed', 'cancelled', 'error', 'interrupted'] as const) {
    assert.equal(shouldAutoContinue({ status, source: 'ui', autoContinue: true, continueCount: 0 }), false);
  }
});

test('evals and subagents never auto-continue', () => {
  assert.equal(shouldAutoContinue({ status: 'max_steps', source: 'eval', autoContinue: true, continueCount: 0 }), false);
  assert.equal(shouldAutoContinue({ status: 'max_steps', source: 'subagent', autoContinue: true, continueCount: 0 }), false);
});

test('stops auto-continuing after the cap', () => {
  assert.equal(shouldAutoContinue({ status: 'max_steps', source: 'ui', autoContinue: true, continueCount: MAX_AUTO_CONTINUES }), false);
  assert.equal(shouldAutoContinue({ status: 'max_steps', source: 'ui', autoContinue: true, continueCount: MAX_AUTO_CONTINUES - 1 }), true);
});

test('honours the autoContinue setting', () => {
  assert.equal(shouldAutoContinue({ status: 'max_steps', source: 'ui', autoContinue: false, continueCount: 0 }), false);
});
