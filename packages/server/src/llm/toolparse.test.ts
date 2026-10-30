import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseToolCalls, StreamSplitter } from './toolparse.ts';

const schemas: Record<string, any> = {
  read_file: { properties: { path: { type: 'string' }, offset: { type: 'integer' } } },
  edit_file: { properties: { path: { type: 'string' }, old_string: { type: 'string' }, new_string: { type: 'string' }, replace_all: { type: 'boolean' } } },
  update_plan: { properties: { todos: { type: 'array' } } },
};
const lookup = (n: string) => schemas[n];

test('parses Qwen3-Coder XML tool calls with typed parameters', () => {
  const r = parseToolCalls(
    'Let me look.\n<tool_call>\n<function=read_file>\n<parameter=path>\nsrc/a.ts\n</parameter>\n<parameter=offset>\n10\n</parameter>\n</function>\n</tool_call>',
    lookup,
  );
  assert.equal(r.text, 'Let me look.');
  assert.deepEqual(r.calls, [{ name: 'read_file', arguments: { path: 'src/a.ts', offset: 10 } }]);
  assert.deepEqual(r.errors, []);
});

test('keeps multi-line string values verbatim (only one surrounding newline is stripped)', () => {
  const code = '  if (x) {\n    return 1;\n  }\n';
  const r = parseToolCalls(`<tool_call><function=edit_file><parameter=path>a.js</parameter><parameter=old_string>\n${code}\n</parameter><parameter=new_string>\n</parameter><parameter=replace_all>true</parameter></function></tool_call>`, lookup);
  assert.equal(r.calls[0].arguments.old_string, code);
  assert.equal(r.calls[0].arguments.new_string, '');
  assert.equal(r.calls[0].arguments.replace_all, true);
});

test('parses JSON arrays for array parameters', () => {
  const r = parseToolCalls('<tool_call><function=update_plan><parameter=todos>[{"id":"1","content":"x","status":"pending"}]</parameter></function></tool_call>', lookup);
  assert.deepEqual(r.calls[0].arguments.todos, [{ id: '1', content: 'x', status: 'pending' }]);
});

test('parses Hermes JSON tool calls and multiple calls', () => {
  const r = parseToolCalls('<tool_call>{"name": "read_file", "arguments": {"path": "a"}}</tool_call>\n<tool_call>{"name":"read_file","arguments":"{\\"path\\":\\"b\\"}"}</tool_call>');
  assert.deepEqual(
    r.calls.map((c) => c.arguments.path),
    ['a', 'b'],
  );
});

test('tolerates a missing closing tag and bare <function=> blocks', () => {
  assert.equal(parseToolCalls('<tool_call>\n<function=read_file>\n<parameter=path>\nx.py\n', lookup).calls[0].arguments.path, 'x.py');
  const bare = parseToolCalls('<function=read_file><parameter=path>a</parameter></function>\n<function=read_file><parameter=path>b</parameter></function>', lookup);
  assert.equal(bare.calls.length, 2);
});

test('reports unparseable calls instead of throwing', () => {
  const r = parseToolCalls('<tool_call>{"name": oops</tool_call>');
  assert.equal(r.calls.length, 0);
  assert.equal(r.errors.length, 1);
});

test('plain text has no calls', () => {
  assert.deepEqual(parseToolCalls('All done, tests pass.'), { text: 'All done, tests pass.', calls: [], errors: [] });
});

test('StreamSplitter separates inline reasoning, visible text and hidden tool markup across chunk boundaries', () => {
  const s = new StreamSplitter(true);
  const chunks = ['<thi', 'nk>plan', 'ning</th', 'ink>Hello ', 'wor', 'ld <tool', '_call><function=read_file><parameter=path>a</parameter></function></tool_call>'];
  let text = '';
  let reasoning = '';
  let toolName: string | undefined;
  for (const c of chunks) {
    const r = s.push(c);
    text += r.text;
    reasoning += r.reasoning;
    toolName ??= r.toolName;
  }
  text += s.flush();
  assert.equal(reasoning, 'planning');
  assert.equal(text, 'Hello world ');
  assert.equal(toolName, 'read_file');
  assert.equal(parseToolCalls(s.body(), lookup).calls[0].arguments.path, 'a');
});

test('StreamSplitter in native mode passes everything through as text', () => {
  const s = new StreamSplitter(false);
  assert.equal(s.push('Use <tool_call> literally').text, 'Use <tool_call> literally');
});
