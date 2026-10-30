import TurndownService from 'turndown';
import { getSettings } from '../config.ts';
import { truncateMiddle } from '../util.ts';
import { fail, ok, str, type ToolDef } from './types.ts';

const td = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced' });
td.remove(['script', 'style', 'noscript', 'iframe', 'svg', 'nav', 'footer'] as any);

export function htmlToMarkdown(html: string): string {
  const body = html.match(/<body[\s\S]*<\/body>/i)?.[0] ?? html;
  return td
    .turndown(body)
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36 HearthAgent/0.1';

const webFetch: ToolDef = {
  name: 'web_fetch',
  description: 'Fetch a web page or raw URL (docs, GitHub raw files, APIs) and return it as Markdown/text.',
  parameters: {
    type: 'object',
    properties: { url: { type: 'string' }, max_chars: { type: 'integer', description: 'Default 20000' } },
    required: ['url'],
  },
  risk: 'network',
  async execute(a, ctx) {
    const url = str(a.url, 'url');
    if (!/^https?:\/\//i.test(url)) return fail('Only http(s) URLs are supported.');
    const res = await fetch(url, { headers: { 'user-agent': UA, accept: 'text/html,application/json,text/plain,*/*' }, signal: AbortSignal.any([ctx.signal, AbortSignal.timeout(30_000)]), redirect: 'follow' });
    const type = res.headers.get('content-type') ?? '';
    const raw = await res.text();
    const text = type.includes('html') ? htmlToMarkdown(raw) : raw;
    const max = Math.min(60_000, Number(a.max_chars) || 20_000);
    const body = truncateMiddle(text, max).text;
    return (res.ok ? ok : fail)(`URL: ${res.url}\nStatus: ${res.status}\nContent-Type: ${type}\n\n${body}`);
  },
};

const webSearch: ToolDef = {
  name: 'web_search',
  description: 'Search the web (DuckDuckGo HTML, no API key; best-effort). Returns titles, URLs and snippets. Use web_fetch to read a result.',
  parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
  risk: 'network',
  async execute(a, ctx) {
    const q = str(a.query, 'query');
    const res = await fetch('https://html.duckduckgo.com/html/?q=' + encodeURIComponent(q), {
      headers: { 'user-agent': UA },
      signal: AbortSignal.any([ctx.signal, AbortSignal.timeout(20_000)]),
    });
    const html = await res.text();
    const results: string[] = [];
    const re = /<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?(?:<a[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/a>)?/g;
    let m: RegExpExecArray | null;
    const clean = (s: string) => s.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/\s+/g, ' ').trim();
    while ((m = re.exec(html)) && results.length < 8) {
      let href = m[1];
      const uddg = href.match(/uddg=([^&]+)/);
      if (uddg) href = decodeURIComponent(uddg[1]);
      results.push(`${results.length + 1}. ${clean(m[2])}\n   ${href}\n   ${clean(m[3] ?? '')}`);
    }
    return results.length ? ok(results.join('\n')) : fail('No results (the search endpoint may be rate-limiting). Try web_fetch on a known documentation URL.');
  },
};

export async function languageToolCheck(text: string, language = 'auto') {
  const base = getSettings().languageToolUrl.replace(/\/+$/, '');
  const body = new URLSearchParams({ text, language });
  if (language === 'auto') body.set('preferredVariants', 'en-US');
  const res = await fetch(`${base}/v2/check`, { method: 'POST', body, signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`LanguageTool HTTP ${res.status}: ${await res.text()}`);
  const j: any = await res.json();
  return {
    language: j.language?.name as string,
    matches: (j.matches ?? []).map((m: any) => ({
      message: m.message as string,
      offset: m.offset as number,
      length: m.length as number,
      context: m.context?.text as string,
      replacements: (m.replacements ?? []).slice(0, 3).map((r: any) => r.value as string),
      rule: m.rule?.id as string,
      category: m.rule?.category?.name as string,
      categoryId: m.rule?.category?.id as string,
    })),
  };
}

/** Apply the first suggested replacement of every match (from the end, so offsets stay valid). */
export function applyLanguageToolFixes(text: string, matches: { offset: number; length: number; replacements: string[] }[]) {
  let out = text;
  for (const m of [...matches].sort((a, b) => b.offset - a.offset)) {
    if (m.replacements[0] === undefined) continue;
    out = out.slice(0, m.offset) + m.replacements[0] + out.slice(m.offset + m.length);
  }
  return out;
}

const ltTool: ToolDef = {
  name: 'languagetool_check',
  description:
    'Check grammar and spelling of prose (docs, README, commit messages, PR descriptions) with the local LanguageTool server. Returns issues with suggestions. Code blocks in Markdown should be excluded from the text you pass.',
  parameters: {
    type: 'object',
    properties: {
      text: { type: 'string' },
      language: { type: 'string', description: 'e.g. en-US, de-DE, fr; default auto' },
    },
    required: ['text'],
  },
  risk: 'read',
  async execute(a) {
    const text = str(a.text, 'text');
    const r = await languageToolCheck(text.slice(0, 40_000), a.language || 'auto');
    if (!r.matches.length) return ok(`No issues found (language: ${r.language}).`);
    const lines = r.matches
      .slice(0, 60)
      .map((m: any, i: number) => `${i + 1}. "${text.slice(m.offset, m.offset + m.length)}" → ${m.replacements.join(' | ') || '(no suggestion)'} — ${m.message} [${m.category}]`);
    return ok(`Language: ${r.language}. ${r.matches.length} issue(s):\n${lines.join('\n')}`);
  },
};

export const webTools: ToolDef[] = [webFetch, webSearch, ltTool];
