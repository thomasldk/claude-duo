import { useEffect, useRef } from 'react';
import { usePairStore } from '../stores/pairStore';
import type { StreamItem } from '../stores/pairStore';
import type { Pair } from '../types/pair';
import MarkdownRenderer from './MarkdownRenderer';
import AttachmentZone from './AttachmentZone';
import TokenGauge from './TokenGauge';
import InlineToolEvent from './InlineToolEvent';
import ActivityIndicator from './ActivityIndicator';

interface Props {
  pair: Pair;
}

export default function RightPanel({ pair }: Props) {
  const {
    pushLeft, goCode, stopPair,
    rightStreamItems, rightStreamPhase,
    isStreaming, uploadAttachment, deleteAttachment,
    errorMessage, errorRetryable, clearError,
    loopRound, loopTotal, loopPhase,
  } = usePairStore();

  const scrollRef = useRef<HTMLDivElement>(null);
  const isAnalyzing = pair.status === 'analyzing';
  const isChatting = pair.status === 'chatting';
  const isCoding = pair.status === 'coding';
  const isDone = ['prd_done', 'done'].includes(pair.status);
  const hasAnalysis = pair.right.analyses.length > 0;
  const canPushLeft = hasAnalysis && ['prd_done', 'done', 'error', 'stopped'].includes(pair.status);
  const canGoCode = hasAnalysis && !pair.right.implementation && ['prd_done', 'done', 'error', 'stopped'].includes(pair.status);

  // Check if another pair is active
  const pairs = usePairStore(s => s.pairs);
  const otherActive = pairs.some(p => p.id !== pair.id && ['chatting', 'analyzing', 'coding'].includes(p.status));

  // Auto-scroll on any new stream item
  useEffect(() => {
    if (isStreaming && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [rightStreamItems, isStreaming]);

  // Token estimation
  const lastAssistant = [...pair.left.messages].reverse().find(m => m.role === 'assistant');
  const lastAnalysis = pair.right.analyses[pair.right.analyses.length - 1];
  const rightTokenText = (lastAssistant?.content || '') + (lastAnalysis?.output || '');
  const estimatedTokens = Math.ceil(rightTokenText.length / 4);

  return (
    <div className="flex flex-col h-full">
      {/* Header + controls */}
      <div className="flex items-center gap-2 p-2 border-b border-border flex-wrap">
        <h3 className="text-sm font-semibold">{pair.right.agent.name}</h3>
        <ActivityIndicator isActive={isAnalyzing || isCoding} />
        <div className="flex-1" />
        {canPushLeft && (
          <button
            onClick={() => pushLeft(pair.id)}
            disabled={otherActive}
            className="px-3 py-1 bg-accent/20 text-accent text-xs rounded hover:bg-accent/30 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {'\u2B05'} Renvoyer au Chat
          </button>
        )}
        {canGoCode && (
          <button
            onClick={() => goCode(pair.id)}
            disabled={otherActive}
            className="px-3 py-1 bg-success/20 text-success text-xs rounded hover:bg-success/30 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            GO CODER
          </button>
        )}
        {(isAnalyzing || isCoding) && (
          <button
            onClick={() => stopPair(pair.id)}
            className="px-3 py-1 bg-error/20 text-error text-xs rounded hover:bg-error/30 transition-colors"
          >
            {'\u23F9'} Stop
          </button>
        )}
        {loopPhase && loopPhase !== 'done' && (
          <span className="inline-flex items-center gap-1 text-xs text-purple">
            <span className="spinner spinner-sm" />
            Round {loopRound}/{loopTotal}
          </span>
        )}
      </div>

      {/* Content */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-3 space-y-4">
        {/* Empty state */}
        {!hasAnalysis && !isAnalyzing && !isCoding && rightStreamItems.length === 0 && (
          <div className="text-center text-text-muted text-sm mt-8">
            <p>Lancez "Analyser" depuis le panneau Chat pour voir l'analyse ici.</p>
          </div>
        )}

        {/* Error display */}
        {errorMessage && (
          <div className="bg-error/20 border border-error/30 rounded p-3">
            <div className="text-sm text-error font-semibold mb-1">Erreur</div>
            <pre className="text-xs text-text-secondary whitespace-pre-wrap">{errorMessage}</pre>
            <div className="flex gap-2 mt-2">
              {errorRetryable && (
                <button
                  onClick={() => {
                    clearError();
                    if (pair.right.implementation !== null || pair.status === 'coding') {
                      goCode(pair.id);
                    } else {
                      pushLeft(pair.id);
                    }
                  }}
                  className="px-2 py-1 bg-error/20 text-error text-xs rounded hover:bg-error/30"
                >
                  Reessayer
                </button>
              )}
              <button onClick={clearError} className="px-2 py-1 text-xs text-text-secondary hover:text-text-primary">
                Fermer
              </button>
            </div>
          </div>
        )}

        {/* Completed analyses */}
        {pair.right.analyses.map((analysis, idx) => (
          <div key={idx} className="border-b border-border pb-3">
            <div className="text-xs text-purple font-semibold mb-1">
              Analyse #{analysis.index} (PRD round {analysis.prdVersion})
            </div>
            <MarkdownRenderer content={analysis.output} />
          </div>
        ))}

        {/* Implementation output */}
        {pair.right.implementation && (
          <div className="border-t border-border pt-3">
            <div className="text-xs text-success font-semibold mb-1">Implementation</div>
            <MarkdownRenderer content={pair.right.implementation} />
          </div>
        )}

        {/* Waiting spinner — active but no stream yet */}
        {(isAnalyzing || isCoding) && rightStreamItems.length === 0 && (
          <div className="flex items-center justify-center gap-2 text-text-muted text-sm mt-8">
            <span className="spinner" />
            <span>Demarrage...</span>
          </div>
        )}

        {/* Streaming content — interleaved */}
        {(isAnalyzing || isCoding) && rightStreamItems.length > 0 && (
          <div>
            <div className="text-xs font-semibold mb-1">
              <span className={rightStreamPhase === 'implementation' ? 'text-success' : 'text-purple'}>
                {rightStreamPhase === 'implementation' ? 'Implementation' : 'Analyse'}
              </span>
              <span className="ml-2 inline-flex items-center gap-1 text-text-muted"><span className="spinner spinner-sm" /> en cours...</span>
            </div>
            <StreamItemList items={rightStreamItems} />
          </div>
        )}

        {/* Done badge */}
        {isDone && !isAnalyzing && !isCoding && rightStreamItems.length === 0 && hasAnalysis && (
          <div className="flex items-center gap-2 text-success text-xs mt-2">
            <span>{'\u2714'}</span>
            <span className="font-semibold">Done</span>
          </div>
        )}
      </div>

      {/* Bottom area — fixed height, aligned with LeftPanel */}
      <div className="h-[200px] flex flex-col flex-shrink-0 border-t border-border">
        {/* Attachments — fills space above tokens */}
        <div className="px-2 pt-2 flex-1 min-h-0">
          <AttachmentZone
            attachments={pair.right.attachments}
            pairId={pair.id}
            panel="right"
            onUpload={uploadAttachment}
            onDelete={deleteAttachment}
          />
        </div>

        {/* Token gauge */}
        <div className="p-2 border-t border-border">
          <TokenGauge estimated={estimatedTokens} limit={100000} />
        </div>
      </div>
    </div>
  );
}

/** Renders interleaved stream items (text + tools) in chronological order */
function StreamItemList({ items }: { items: StreamItem[] }) {
  return (
    <div className="space-y-1">
      {items.map((item, idx) => {
        if (item.type === 'text') {
          return <MarkdownRenderer key={idx} content={item.text} />;
        }
        if (item.type === 'tool_use') {
          const nextItem = items[idx + 1];
          const result = nextItem?.type === 'tool_result' ? nextItem.content : undefined;
          return <InlineToolEvent key={idx} tool={item.tool} input={item.input} result={result} />;
        }
        if (item.type === 'tool_result') {
          const prevItem = items[idx - 1];
          if (prevItem?.type === 'tool_use') return null;
          return <InlineToolEvent key={idx} tool="result" input="" result={item.content} />;
        }
        return null;
      })}
    </div>
  );
}
