import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getDisplayName } from '../src/users.js';
import { greet } from '../src/greet.js';
import { memberList } from '../src/report.js';

test('hidden: getDisplayName behaves like before', () => {
  assert.equal(getDisplayName({ first: 'Grace', last: 'Hopper', email: 'g@x.org' }), 'Grace Hopper');
  assert.equal(getDisplayName({ first: 'Prince', email: 'p@x.org' }), 'Prince');
  assert.equal(getDisplayName({ email: 'e@x.org' }), 'e@x.org');
  assert.equal(greet({ email: 'e@x.org' }), 'Hello, e@x.org!');
  assert.equal(memberList([{ first: 'B' }, { first: 'A' }]), 'A, B');
});
