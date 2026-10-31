import { memo, useMemo, type ReactElement, type ReactNode } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { FileDiff } from 'lucide-react';
import { highlight } from '../highlight';
import { CopyButton, cx } from './ui';

const remarkPlugins = [remarkGfm];
const components: Components = {
  a: ({ href, children }) => (
    <a href={href} target="_blank" rel="noreferrer">
      {children}
    </a>
  ),
  pre: ({ children }) => {
    const code = children as ReactElement<{ className?: string; children?: ReactNode }>;
    const lang = /language-([\w+#-]+)/.exec(code?.props?.className ?? '')?.[1];
    return <CodeBlock lang={lang} code={String(code?.props?.children ?? '').replace(/\n$/, '')} />;
  },
};

export const Markdown = memo(function Markdown({ text, className = '' }: { text: string; className?: string }) {
  return (
    <div className={cx('md', className)}>
      <ReactMarkdown remarkPlugins={remarkPlugins} components={components}>
        {text}
      </ReactMarkdown>
    </div>
  );
});

export const CodeBlock = memo(function CodeBlock({ lang, code, maxHeight }: { lang?: string; code: string; maxHeight?: string }) {
  const html = useMemo(() => highlight(code, lang), [code, lang]);
  return (
    <div className="group/code overflow-hidden rounded-lg border border-line bg-code">
      <div className="flex h-8 items-center justify-between border-b border-line pr-1.5 pl-3">
        <span className="font-mono text-[11px] text-fg-subtle">{lang || 'text'}</span>
        <CopyButton text={code} label="Copy code" className="opacity-70 group-hover/code:opacity-100" />
      </div>
      <pre className={cx('overflow-auto px-3.5 py-3 text-[12.5px] leading-[1.6] text-fg', maxHeight)}>
        <code dangerouslySetInnerHTML={{ __html: html }} />
      </pre>
    </div>
  );
});

type DiffRow = { kind: 'add' | 'del' | 'ctx' | 'hunk' | 'file' | 'meta'; text: string; old?: number; new?: number };

function parseDiff(diff: string): DiffRow[] {
  const rows: DiffRow[] = [];
  let o = 0;
  let n = 0;
  const lines = diff.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (l.startsWith('===') || l.startsWith('Index:') || l.startsWith('diff --git') || l.startsWith('index ')) continue;
    if (l.startsWith('--- ') && lines[i + 1]?.startsWith('+++ ')) continue;
    if (l.startsWith('+++ ') && lines[i - 1]?.startsWith('--- ')) {
      rows.push({ kind: 'file', text: l.slice(4).replace(/^b\//, '') });
      continue;
    }
    const h = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)$/.exec(l);
    if (h) {
      o = Number(h[1]);
      n = Number(h[2]);
      rows.push({ kind: 'hunk', text: l });
      continue;
    }
    if (l.startsWith('+')) rows.push({ kind: 'add', text: l.slice(1), new: n++ });
    else if (l.startsWith('-')) rows.push({ kind: 'del', text: l.slice(1), old: o++ });
    else if (l.startsWith('\\') || /^(new|deleted) file mode|^similarity|^rename |^Binary/.test(l)) rows.push({ kind: 'meta', text: l });
    else if (rows.length) rows.push({ kind: 'ctx', text: l.slice(1), old: o++, new: n++ });
  }
  while (rows.length && rows[rows.length - 1].kind === 'ctx' && !rows[rows.length - 1].text) rows.pop();
  return rows;
}

const sign = { add: '+', del: '-', ctx: ' ' } as const;

export const DiffView = memo(function DiffView({ diff, maxHeight = 'max-h-96', className = '' }: { diff: string; maxHeight?: string; className?: string }) {
  const rows = useMemo(() => parseDiff(diff), [diff]);
  return (
    <div className={cx('overflow-auto rounded-lg border border-line bg-code font-mono text-[12px] leading-[1.55]', maxHeight, className)}>
      <div className="inline-block min-w-full py-1">
        {rows.map((r, i) =>
          r.kind === 'file' ? (
            <div key={i} className={cx('sticky left-0 flex items-center gap-1.5 border-line bg-raised px-3 py-1.5 font-sans text-xs font-medium text-fg', i > 0 && 'mt-1 border-t')}>
              <FileDiff className="h-3.5 w-3.5 text-fg-subtle" /> {r.text}
            </div>
          ) : r.kind === 'hunk' ? (
            <div key={i} className="diff-hunk px-3 py-0.5 whitespace-pre">
              {r.text}
            </div>
          ) : r.kind === 'meta' ? (
            <div key={i} className="px-3 whitespace-pre text-fg-subtle italic">
              {r.text}
            </div>
          ) : (
            <div key={i} className={cx('flex whitespace-pre', r.kind === 'add' && 'diff-add', r.kind === 'del' && 'diff-del')}>
              <span className="w-10 shrink-0 pr-2 text-right text-fg-faint select-none">{r.old ?? ''}</span>
              <span className="w-10 shrink-0 pr-2 text-right text-fg-faint select-none">{r.new ?? ''}</span>
              <span className="diff-sign w-4 shrink-0 text-center text-fg-faint select-none">{sign[r.kind]}</span>
              <span className="diff-text pr-4 text-fg-muted">{r.text || ' '}</span>
            </div>
          ),
        )}
      </div>
    </div>
  );
});

export function diffStats(diff?: string | null) {
  if (!diff) return null;
  let add = 0;
  let del = 0;
  for (const l of diff.split('\n')) {
    if (l.startsWith('+') && !l.startsWith('+++')) add++;
    else if (l.startsWith('-') && !l.startsWith('---')) del++;
  }
  return { add, del };
}

export function DiffStat({ add, del }: { add: number; del: number }) {
  return (
    <span className="font-mono text-[11px] tabular-nums">
      <span className="text-ok-ink">+{add}</span> <span className="text-danger-ink">−{del}</span>
    </span>
  );
}
