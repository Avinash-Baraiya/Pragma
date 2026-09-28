import type { ReactNode } from 'react';

const TOKEN = /("(?:\\.|[^"\\])*")(\s*:)?|\b(true|false|null)\b|(-?\d+(?:\.\d+)?(?:e[+-]?\d+)?)/gi;

/** Small, dependency-free JSON syntax highlighter. */
export function JsonView({ value, className }: { value: unknown; className?: string }): ReactNode {
  const text = JSON.stringify(value, null, 2) ?? 'undefined';
  const parts: ReactNode[] = [];
  let last = 0;
  for (const match of text.matchAll(TOKEN)) {
    const index = match.index;
    if (index > last) parts.push(text.slice(last, index));
    const [whole, str, colon, literal, num] = match;
    const kind =
      str !== undefined
        ? colon
          ? 'key'
          : 'string'
        : literal !== undefined
          ? 'literal'
          : num !== undefined
            ? 'number'
            : 'plain';
    parts.push(
      <span key={index} className={`json-${kind}`}>
        {str !== undefined && colon ? str : whole}
      </span>,
    );
    if (str !== undefined && colon) parts.push(colon);
    last = index + whole.length;
  }
  parts.push(text.slice(last));
  return (
    <pre className={['json-view', className].filter(Boolean).join(' ')}>
      <code>{parts}</code>
    </pre>
  );
}
