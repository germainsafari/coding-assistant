import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cartTotal, itemCount } from '../src/cart.js';

test('single item without tax', () => {
  assert.equal(cartTotal([{ name: 'pen', price: 2.5, qty: 1 }]), 2.5);
});

test('quantities are multiplied', () => {
  assert.equal(cartTotal([{ name: 'pen', price: 2.5, qty: 4 }]), 10);
});

test('tax is rounded to the nearest cent', () => {
  // 19.99 * 3 = 59.97; * 1.08 = 64.7676 -> 64.77
  assert.equal(cartTotal([{ name: 'mug', price: 19.99, qty: 3 }], { taxRate: 0.08 }), 64.77);
});

test('discount then tax', () => {
  // (10 * 2 + 5) = 25; -20 % = 20; +10 % tax = 22
  assert.equal(
    cartTotal(
      [
        { name: 'a', price: 10, qty: 2 },
        { name: 'b', price: 5, qty: 1 },
      ],
      { discountPct: 20, taxRate: 0.1 },
    ),
    22,
  );
});

test('item count', () => {
  assert.equal(itemCount([{ name: 'a', price: 1, qty: 2 }, { name: 'b', price: 1, qty: 3 }]), 5);
});
