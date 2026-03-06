import { useState } from 'react';

interface Props {
  tool: string;
  input: string;
  result?: string;
}

export default function InlineToolEvent({ tool, input, result }: Props) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="text-xs my-1">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-1 text-text-secondary hover:text-text-primary transition-colors w-full text-left"
      >
        <span className="text-accent">{expanded ? '\u25BC' : '\u25B6'}</span>
        <span className="text-purple">{tool}</span>
        <span className="text-text-muted truncate">{input}</span>
      </button>
      {expanded && result && (
        <pre className="bg-bg-tertiary p-2 rounded text-text-secondary overflow-x-auto max-h-40 ml-4 mt-1">
          {result.slice(0, 2000)}
          {result.length > 2000 && '\n... (truncated)'}
        </pre>
      )}
    </div>
  );
}
