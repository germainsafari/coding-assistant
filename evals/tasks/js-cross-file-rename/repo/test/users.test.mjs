import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getUserName } from '../src/users.js';
import { greet } from '../src/greet.js';
import { memberList } from '../src/report.js';

const ada = { first: 'Ada', last: 'Lovelace', email: 'ada@example.com' };
const anon = { email: 'anon@example.com' };

test('getUserName', () => {
  assert.equal(getUserName(ada), 'Ada Lovelace');
  assert.equal(getUserName(anon), 'anon@example.com');
});

test('greet', () => {
  assert.equal(greet(ada), 'Hello, Ada Lovelace!');
});

test('memberList', () => {
  assert.equal(memberList([anon, ada]), 'Ada Lovelace, anon@example.com');
});
