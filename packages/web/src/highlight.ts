// Syntax highlighting for chat code blocks: highlight.js core with a curated set of
// languages (keeps the bundle small). Colors come from the .hljs-* rules in index.css.
import hljs from 'highlight.js/lib/core';
import bash from 'highlight.js/lib/languages/bash';
import c from 'highlight.js/lib/languages/c';
import cpp from 'highlight.js/lib/languages/cpp';
import csharp from 'highlight.js/lib/languages/csharp';
import css from 'highlight.js/lib/languages/css';
import diff from 'highlight.js/lib/languages/diff';
import dockerfile from 'highlight.js/lib/languages/dockerfile';
import go from 'highlight.js/lib/languages/go';
import ini from 'highlight.js/lib/languages/ini';
import java from 'highlight.js/lib/languages/java';
import javascript from 'highlight.js/lib/languages/javascript';
import json from 'highlight.js/lib/languages/json';
import markdown from 'highlight.js/lib/languages/markdown';
import powershell from 'highlight.js/lib/languages/powershell';
import python from 'highlight.js/lib/languages/python';
import rust from 'highlight.js/lib/languages/rust';
import sql from 'highlight.js/lib/languages/sql';
import typescript from 'highlight.js/lib/languages/typescript';
import xml from 'highlight.js/lib/languages/xml';
import yaml from 'highlight.js/lib/languages/yaml';

const langs = { bash, c, cpp, csharp, css, diff, dockerfile, go, ini, java, javascript, json, markdown, powershell, python, rust, sql, typescript, xml, yaml };
for (const [name, def] of Object.entries(langs)) hljs.registerLanguage(name, def);
hljs.registerAliases(['sh', 'shell', 'console', 'zsh'], { languageName: 'bash' });
hljs.registerAliases(['toml'], { languageName: 'ini' });
hljs.registerAliases(['pwsh', 'ps1'], { languageName: 'powershell' });
hljs.registerAliases(['jsonc'], { languageName: 'json' });

const escape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Returns safe HTML for `code`. Unknown or missing languages are rendered as plain text. */
export function highlight(code: string, lang?: string) {
  if (!lang || !hljs.getLanguage(lang)) return escape(code);
  try {
    return hljs.highlight(code, { language: lang, ignoreIllegals: true }).value;
  } catch {
    return escape(code);
  }
}

const extLang: Record<string, string> = { ts: 'typescript', tsx: 'typescript', js: 'javascript', jsx: 'javascript', mjs: 'javascript', cjs: 'javascript', py: 'python', json: 'json', md: 'markdown', css: 'css', html: 'xml', xml: 'xml', yml: 'yaml', yaml: 'yaml', sh: 'bash', ps1: 'powershell', rs: 'rust', go: 'go', java: 'java', c: 'c', h: 'c', cpp: 'cpp', cs: 'csharp', sql: 'sql', toml: 'ini' };
export const langForPath = (p: string) => extLang[p.split('.').pop()?.toLowerCase() ?? ''];
