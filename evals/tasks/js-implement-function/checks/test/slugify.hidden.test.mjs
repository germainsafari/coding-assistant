import { test } from 'node:test';
import assert from 'node:assert/strict';
import { slugify } from '../src/slugify.js';

test('hidden: basics', () => {
  assert.equal(slugify('Hello, World!'), 'hello-world');
  assert.equal(slugify('  Crème brûlée  '), 'creme-brulee');
  assert.equal(slugify('Año Nuevo über alles'), 'ano-nuevo-uber-alles');
  assert.equal(slugify('a--b__c   d'), 'a-b-c-d');
  assert.equal(slugify('Version 2.0 is HERE'), 'version-2-0-is-here');
});

test('hidden: empty and symbol-only input', () => {
  assert.equal(slugify(''), '');
  assert.equal(slugify('!!! ???'), '');
});

test('hidden: maxLength', () => {
  assert.equal(slugify('hello wonderful world', { maxLength: 6 }), 'hello');
  assert.equal(slugify('hello wonderful world', { maxLength: 9 }), 'hello-won');
  assert.equal(slugify('short', { maxLength: 50 }), 'short');
});
