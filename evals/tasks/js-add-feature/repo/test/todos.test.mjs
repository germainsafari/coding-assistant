import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TodoList } from '../src/todos.js';

test('add and list', () => {
  const l = new TodoList();
  l.add('  buy milk ');
  l.add('call mum');
  assert.deepEqual(l.list(), [
    { id: 1, title: 'buy milk', done: false },
    { id: 2, title: 'call mum', done: false },
  ]);
});

test('add requires a title', () => {
  assert.throws(() => new TodoList().add('   '), /title/);
});

test('complete', () => {
  const l = new TodoList();
  const t = l.add('x');
  assert.equal(l.complete(t.id).done, true);
  assert.throws(() => l.complete(99), /99/);
});

test('list returns copies', () => {
  const l = new TodoList();
  l.add('x');
  l.list()[0].done = true;
  assert.equal(l.list()[0].done, false);
});
