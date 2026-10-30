import { test } from 'node:test';
import assert from 'node:assert/strict';
import { roundCents, applyTax } from '../src/money.js';
import { cartTotal } from '../src/cart.js';

test('hidden: roundCents rounds to nearest', () => {
  assert.equal(roundCents(3.14159), 3.14);
  assert.equal(roundCents(10.006), 10.01);
  assert.equal(roundCents(7.499), 7.5);
});

test('hidden: applyTax', () => {
  assert.equal(applyTax(9.99, 0.2), 11.99); // 11.988
});

test('hidden: mixed cart', () => {
  // 3.33*3 + 1.25*2 = 12.49; +7 % = 13.3643 -> 13.36
  assert.equal(cartTotal([{ name: 'x', price: 3.33, qty: 3 }, { name: 'y', price: 1.25, qty: 2 }], { taxRate: 0.07 }), 13.36);
});
