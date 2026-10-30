import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TodoList } from '../src/todos.js';

const make = () => {
  const l = new TodoList();
  l.add('a');
  l.add('b');
  l.add('c');
  l.complete(2);
  return l;
};

test('hidden: remove returns the todo and deletes it', () => {
  const l = make();
  const r = l.remove(1);
  assert.equal(r.id, 1);
  assert.equal(r.title, 'a');
  assert.deepEqual(
    l.list().map((t) => t.id),
    [2, 3],
  );
});

test('hidden: remove unknown id throws with the id', () => {
  assert.throws(() => make().remove(42), /42/);
});

test('hidden: removed ids are not reused', () => {
  const l = make();
  l.remove(3);
  assert.equal(l.add('d').id, 4);
});

test('hidden: list filter', () => {
  const l = make();
  assert.deepEqual(
    l.list({ done: true }).map((t) => t.id),
    [2],
  );
  assert.deepEqual(
    l.list({ done: false }).map((t) => t.id),
    [1, 3],
  );
  assert.equal(l.list().length, 3);
  assert.equal(l.list({}).length, 3);
});
