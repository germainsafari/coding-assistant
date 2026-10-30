import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// context.ts opens the database on import; keep tests away from the real data folder.
process.env.HEARTH_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'hearth-test-'));
const { toOpenAIMessages, compactionCut } = await import('./context.ts');

const msg = (m: Record<string, unknown>) => ({ id: Math.random().toString(36), threadId: 't', createdAt: 0, content: '', ...m }) as any;
const call = (id: string, name = 'run_shell') => ({ id, name, arguments: { command: 'npm test' } });

test('every tool call gets a result, even when the run crashed mid-tool', () => {
  const stored = [
    msg({ role: 'user', content: 'go' }),
    msg({ role: 'assistant', toolCalls: [call('a'), call('b')] }),
    msg({ role: 'tool', toolCallId: 'a', content: 'ok' }),
    msg({ role: 'assistant', toolCalls: [call('c')] }),
    msg({ role: 'user', content: '[harness] Resume' }),
  ];
  const out = toOpenAIMessages(stored, 'template', { vision: false });
  const toolIds = out.filter((m: any) => m.role === 'tool').map((m: any) => m.tool_call_id);
  assert.deepEqual(toolIds, ['a', 'b', 'c']);
  const b = out.find((m: any) => m.tool_call_id === 'b') as any;
  assert.match(b.content, /interrupted/);
  // results directly follow their assistant message
  const idxC = out.findIndex((m: any) => m.tool_call_id === 'c');
  assert.equal((out[idxC - 1] as any).tool_calls[0].id, 'c');
});

test('prompt mode renders calls as XML and results as user <tool_response> blocks', () => {
  const stored = [msg({ role: 'user', content: 'go' }), msg({ role: 'assistant', content: 'Running', toolCalls: [call('a')] }), msg({ role: 'tool', toolCallId: 'a', content: 'passed' })];
  const out = toOpenAIMessages(stored, 'prompt', { vision: false }) as any[];
  assert.match(out[1].content, /<function=run_shell>/);
  assert.equal(out[1].tool_calls, undefined);
  assert.equal(out[2].role, 'user');
  assert.match(out[2].content, /<tool_response>\npassed/);
});

test('compaction keeps whole recent turns within the token budget, never splitting tool results from their call', () => {
  const big = 'y'.repeat(8000); // ~2500 tokens
  const stored = [
    msg({ role: 'user', content: 'read all files' }),
    msg({ role: 'assistant', toolCalls: [call('a', 'read_file')] }),
    msg({ role: 'tool', toolCallId: 'a', content: big }),
    msg({ role: 'assistant', toolCalls: [call('b', 'read_file')] }),
    msg({ role: 'tool', toolCallId: 'b', content: big }),
    msg({ role: 'assistant', toolCalls: [call('c', 'read_file'), call('d', 'read_file')] }),
    msg({ role: 'tool', toolCallId: 'c', content: big }),
    msg({ role: 'tool', toolCallId: 'd', content: big }),
  ];
  // budget fits one big result: only the last turn (which is always kept) survives
  assert.equal(compactionCut(stored, 3000), 5);
  // budget fits three results: the last two turns are kept
  assert.equal(compactionCut(stored, 8000), 3);
  // huge budget: everything kept
  assert.equal(compactionCut(stored, 1e9), 0);
});

test('old tool output is pruned when requested', () => {
  const big = 'x'.repeat(5000);
  const stored = [msg({ role: 'user', content: 'go' }), msg({ role: 'assistant', toolCalls: [call('a')] }), msg({ role: 'tool', toolCallId: 'a', content: big })];
  const pruned = toOpenAIMessages(stored, 'native', { vision: false, pruneBefore: 3 }) as any[];
  assert.ok(pruned[2].content.length < 1000);
  assert.match(pruned[2].content, /pruned/);
  const kept = toOpenAIMessages(stored, 'native', { vision: false, pruneBefore: 2 }) as any[];
  assert.equal(kept[2].content, big);
});
