import { applyTax } from './money.js';

/**
 * Total price of a cart.
 * @param {{ name: string, price: number, qty: number }[]} items
 * @param {{ taxRate?: number, discountPct?: number }} [opts] discountPct is a percentage, e.g. 10 for 10 %
 */
export function cartTotal(items, { taxRate = 0, discountPct = 0 } = {}) {
  const subtotal = items.reduce((sum, item) => sum + item.price, 0);
  const discounted = subtotal * (1 - discountPct / 100);
  return applyTax(discounted, taxRate);
}

export function itemCount(items) {
  return items.reduce((n, item) => n + item.qty, 0);
}
