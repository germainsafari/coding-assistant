// Load Monaco from the local bundle (no CDN), with syntax highlighting for all
// basic languages and the plain editor worker (no heavy language services).
import { loader } from '@monaco-editor/react';
import * as monaco from 'monaco-editor/editor/editor.api';
import 'monaco-editor/basic-languages/monaco.contribution';
import EditorWorker from 'monaco-editor/editor/editor.worker?worker';

(self as unknown as { MonacoEnvironment: unknown }).MonacoEnvironment = { getWorker: () => new EditorWorker() };
loader.config({ monaco });

const EXT: Record<string, string> = {
  ts: 'typescript', tsx: 'typescript', js: 'javascript', jsx: 'javascript', mjs: 'javascript', cjs: 'javascript', json: 'json', md: 'markdown', py: 'python',
  rs: 'rust', go: 'go', java: 'java', kt: 'kotlin', c: 'c', h: 'c', cpp: 'cpp', hpp: 'cpp', cs: 'csharp', rb: 'ruby', php: 'php', html: 'html', htm: 'html',
  css: 'css', scss: 'scss', less: 'less', yml: 'yaml', yaml: 'yaml', toml: 'ini', ini: 'ini', sh: 'shell', bash: 'shell', ps1: 'powershell', sql: 'sql',
  xml: 'xml', svg: 'xml', swift: 'swift', lua: 'lua', r: 'r', dart: 'dart', vue: 'html', svelte: 'html', dockerfile: 'dockerfile', graphql: 'graphql',
};

export function languageFor(path: string): string {
  const base = path.split('/').pop()!.toLowerCase();
  if (base === 'dockerfile') return 'dockerfile';
  return EXT[base.split('.').pop() ?? ''] ?? 'plaintext';
}
