/** Round an amount to whole cents (half away from zero is fine for positive amounts). */
export function roundCents(amount) {
  return Math.floor(amount * 100) / 100;
}

/** Add tax to an amount. `rate` is a fraction, e.g. 0.08 for 8 %. */
export function applyTax(amount, rate) {
  return roundCents(amount * (1 + rate));
}
