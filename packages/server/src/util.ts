import crypto from 'node:crypto';

export const newId = (prefix = '') => prefix + crypto.randomUUID().replace(/-/g, '').slice(0, 16);
export const now = () => Date.now();

/** Keep the head and tail of a long string, eliding the middle. */
export function truncateMiddle(text: string, maxChars: number): { text: string; truncated: boolean } {
  if (text.length <= maxChars) return { text, truncated: false };
  const head = Math.floor(maxChars * 0.6);
  const tail = maxChars - head;
  const omitted = text.length - head - tail;
  const omittedLines = text.slice(head, text.length - tail).split('\n').length;
  return {
    text: `${text.slice(0, head)}\n\n… [${omitted} characters / ~${omittedLines} lines omitted to save context] …\n\n${text.slice(text.length - tail)}`,
    truncated: true,
  };
}

export function safeJson(v: unknown, max = 20000): string {
  let s: string;
  try {
    s = typeof v === 'string' ? v : JSON.stringify(v);
  } catch {
    s = String(v);
  }
  return s.length > max ? s.slice(0, max) + `…[+${s.length - max}]` : s;
}

export function errMsg(e: unknown): string {
  if (e instanceof Error) return e.message;
  return String(e);
}

export const isWindows = process.platform === 'win32';
