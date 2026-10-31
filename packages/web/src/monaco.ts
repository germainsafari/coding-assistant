// Load Monaco from the local bundle (no CDN), with syntax highlighting for all
// basic languages and the plain editor worker (no heavy language services).
import { loader } from '@monaco-editor/react';
import * as monaco from 'monaco-editor/editor/editor.api';
import 'monaco-editor/basic-languages/monaco.contribution';
import EditorWorker from 'monaco-editor/editor/editor.worker?worker';

(self as unknown as { MonacoEnvironment: unknown }).MonacoEnvironment = { getWorker: () => new EditorWorker() };
loader.config({ monaco });

// Editor themes matching the app's design tokens (index.css).
monaco.editor.defineTheme('hearth-dark', {
  base: 'vs-dark',
  inherit: true,
  rules: [{ token: 'comment', foreground: '8b949e', fontStyle: 'italic' }],
  colors: {
    'editor.background': '#0e0e10',
    'editor.lineHighlightBackground': '#18181b',
    'editor.lineHighlightBorder': '#00000000',
    'editorLineNumber.foreground': '#4a4a52',
    'editorLineNumber.activeForeground': '#a0a0a8',
    'editorGutter.background': '#0e0e10',
    'editor.selectionBackground': '#f26a1b40',
    'editorCursor.foreground': '#f26a1b',
    'editorIndentGuide.background1': '#232328',
    'editorWidget.background': '#1a1a1d',
    'editorWidget.border': '#323238',
    'scrollbarSlider.background': '#34343a80',
  },
});
monaco.editor.defineTheme('hearth-light', {
  base: 'vs',
  inherit: true,
  rules: [{ token: 'comment', foreground: '6e7781', fontStyle: 'italic' }],
  colors: {
    'editor.background': '#fbfbfc',
    'editor.lineHighlightBackground': '#f2f2f4',
    'editor.lineHighlightBorder': '#00000000',
    'editorLineNumber.foreground': '#b4b4bc',
    'editorLineNumber.activeForeground': '#4f4f58',
    'editorGutter.background': '#fbfbfc',
    'editor.selectionBackground': '#ea5a0c30',
    'editorCursor.foreground': '#ea5a0c',
    'editorIndentGuide.background1': '#e7e7eb',
    'scrollbarSlider.background': '#d4d4da80',
  },
});

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
