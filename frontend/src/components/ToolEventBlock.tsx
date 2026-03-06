import { useState } from 'react';

interface ToolEvent {
  type: 'tool_use' | 'tool_result';
  tool?: string;
  input?: string;
  content?: string;
}

interface Props {
  events: ToolEvent[];
}

export default function ToolEventBlock({ events }: Props) {
  const [expanded, setExpanded] = useState<Set<number>>(new Set());

  if (events.length === 0) return null;

  const toggle = (idx: number) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx); else next.add(idx);
      return next;
    });
  };

  // Pair tool_use with the next tool_result
  const pairedEvents: { useIdx: number; use: ToolEvent; result?: ToolEvent }[] = [];
  for (let i = 0; i < events.length; i++) {
    if (events[i].type === 'tool_use') {
      const nextResult = events[i + 1]?.type === 'tool_result' ? events[i + 1] : undefined;
      pairedEvents.push({ useIdx: i, use: events[i], result: nextResult });
      if (nextResult) i++; // skip the result since we paired it
    }
  }

  return (
    <div className="space-y-1 my-2">
      {pairedEvents.map(({ useIdx, use, result }) => (
        <div key={useIdx} className="text-xs">
          <button
            onClick={() => toggle(useIdx)}
            className="flex items-center gap-1 text-text-secondary hover:text-text-primary transition-colors w-full text-left"
          >
            <span className="text-accent">{expanded.has(useIdx) ? '\u25BC' : '\u25B6'}</span>
            <span className="text-purple">{use.tool}</span>
            <span className="text-text-muted truncate">{use.input}</span>
          </button>
          {result && expanded.has(useIdx) && (
            <pre className="bg-bg-tertiary p-2 rounded text-text-secondary overflow-x-auto max-h-40 ml-4">
              {result.content?.slice(0, 2000)}
              {result.content && result.content.length > 2000 && '\n... (truncated)'}
            </pre>
          )}
        </div>
      ))}
    </div>
  );
}
