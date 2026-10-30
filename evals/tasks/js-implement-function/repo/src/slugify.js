/**
 * Convert text to a URL slug.
 *
 * Rules:
 * - the result is lowercase;
 * - accents are removed ("é" -> "e", "ñ" -> "n", "ü" -> "u");
 * - every run of characters that are not a-z or 0-9 becomes a single "-";
 * - the result never starts or ends with "-";
 * - if `opts.maxLength` is given, the slug is cut to at most that many characters,
 *   and a "-" left at the end by the cut is removed too;
 * - an input with no letters or digits gives "".
 *
 * Examples:
 *   slugify("Hello, World!")                         -> "hello-world"
 *   slugify("  Crème brûlée  ")                      -> "creme-brulee"
 *   slugify("hello wonderful world", { maxLength: 6 }) -> "hello"
 *
 * @param {string} text
 * @param {{ maxLength?: number }} [opts]
 * @returns {string}
 */
export function slugify(text, opts = {}) {
  throw new Error('not implemented');
}
