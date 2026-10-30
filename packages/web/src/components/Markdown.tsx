import { memo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

export const Markdown = memo(function Markdown({ text, className = '' }: { text: string; className?: string }) {
  return (
    <div className={`md ${className}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href, children }) => (
            <a href={href} target="_blank" rel="noreferrer">
              {children}
            </a>
          ),
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
});

export function DiffView({ diff, maxHeight = 'max-h-96' }: { diff: string; maxHeight?: string }) {
  const lines = diff.split('\n').filter((l) => !l.startsWith('===') && !l.startsWith('Index:'));
  return (
    <pre className={`overflow-auto rounded-md border border-zinc-800 bg-zinc-950 py-1 font-mono text-[12px] leading-[1.45] ${maxHeight}`}>
      {lines.map((l, i) => {
        const cls = l.startsWith('+++') || l.startsWith('---') ? 'text-zinc-500' : l.startsWith('+') ? 'diff-line-add' : l.startsWith('-') ? 'diff-line-del' : l.startsWith('@@') ? 'diff-line-hunk' : 'text-zinc-400';
        return (
          <div key={i} className={`px-3 whitespace-pre ${cls}`}>
            {l || ' '}
          </div>
        );
      })}
    </pre>
  );
}

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
