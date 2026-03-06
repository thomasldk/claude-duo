import { useState, useEffect, useRef, useCallback } from 'react';
import { usePairStore } from '../stores/pairStore';
import type { StreamItem } from '../stores/pairStore';
import type { Pair } from '../types/pair';
import MarkdownRenderer from './MarkdownRenderer';
import AttachmentZone from './AttachmentZone';
import TokenGauge from './TokenGauge';
import ToolEventBlock from './ToolEventBlock';
import InlineToolEvent from './InlineToolEvent';
import ActivityIndicator from './ActivityIndicator';

interface Props {
  pair: Pair;
}

export default function LeftPanel({ pair }: Props) {
  const {
    sendMessage, stopPair, resetChat,
    pushRight, autoLoop,
    leftStreamItems,
    uploadAttachment, deleteAttachment,
    errorMessage, errorRetryable, clearError,
    loopRound, loopTotal, loopPhase,
  } = usePairStore();

  const [inputText, setInputText] = useState('');
  const [loopRounds, setLoopRounds] = useState(2);
  const [isDragging, setIsDragging] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const isChatting = pair.status === 'chatting';
  const isAnalyzing = pair.status === 'analyzing';
  const canSend = !isChatting && inputText.trim().length > 0;
  const hasAssistantMsg = pair.left.messages.some(m => m.role === 'assistant');
  const canPushRight = hasAssistantMsg && ['prd_done', 'done', 'error', 'stopped'].includes(pair.status);

  // Check if another pair is active
  const pairs = usePairStore(s => s.pairs);
  const otherActive = pairs.some(p => p.id !== pair.id && ['chatting', 'analyzing', 'coding'].includes(p.status));

  // Auto-scroll on new content
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [pair.left.messages, leftStreamItems]);

  // Drag & drop on entire panel
  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const files = Array.from(e.dataTransfer.files);
    for (const file of files) {
      uploadAttachment(pair.id, file, 'left');
    }
  }, [pair.id, uploadAttachment]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    if (e.currentTarget.contains(e.relatedTarget as Node)) return;
    setIsDragging(false);
  }, []);

  // Paste images from clipboard
  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    const items = Array.from(e.clipboardData.items);
    for (const item of items) {
      if (item.type.startsWith('image/')) {
        const file = item.getAsFile();
        if (file) uploadAttachment(pair.id, file, 'left');
      }
    }
  }, [pair.id, uploadAttachment]);

  // Token estimation
  const tokenText = pair.left.messages.map(m => m.content).join('');
  const estimatedTokens = Math.ceil(tokenText.length / 4);

  const handleSend = useCallback(() => {
    if (!canSend || otherActive) return;
    const text = inputText.trim();
    setInputText('');
    sendMessage(pair.id, text);
  }, [canSend, otherActive, inputText, pair.id, sendMessage]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }, [handleSend]);

  return (
    <div
      className={`flex flex-col h-full relative ${isDragging ? 'ring-2 ring-accent ring-inset' : ''}`}
      onDrop={handleDrop}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onPaste={handlePaste}
    >
      {/* Drop overlay */}
      {isDragging && (
        <div className="absolute inset-0 bg-accent/10 z-10 flex items-center justify-center pointer-events-none">
          <div className="bg-bg-secondary border border-accent rounded-lg px-6 py-4 text-accent text-sm font-semibold">
            Deposer le fichier ici
          </div>
        </div>
      )}
      {/* Header + controls */}
      <div className="flex items-center gap-2 p-2 border-b border-border flex-wrap">
        <h3 className="text-sm font-semibold">{pair.left.agent.name}</h3>
        <ActivityIndicator isActive={isChatting} />
        {pair.left.messages.length > 0 && (
          <button
            onClick={() => resetChat(pair.id)}
            disabled={isChatting}
            className="text-xs text-text-muted hover:text-error disabled:opacity-40 transition-colors"
            title="Nouveau chat"
          >
            Reset
          </button>
        )}
        <div className="flex-1" />
        {canPushRight && (
          <>
            <button
              onClick={() => pushRight(pair.id)}
              disabled={otherActive}
              className="px-3 py-1 bg-accent/20 text-accent text-xs rounded hover:bg-accent/30 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              Analyser {'\u27A4'}
            </button>
            <button
              onClick={() => autoLoop(pair.id, loopRounds)}
              disabled={otherActive}
              className="px-3 py-1 bg-purple/20 text-purple text-xs rounded hover:bg-purple/30 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              {'\u21C4'} Boucle
            </button>
            <select
              value={loopRounds}
              onChange={(e) => setLoopRounds(Number(e.target.value))}
              className="bg-bg-tertiary border border-border text-text-secondary text-xs rounded px-1 py-0.5"
            >
              {[1, 2, 3, 4, 5].map(n => (
                <option key={n} value={n}>{n}x</option>
              ))}
            </select>
          </>
        )}
        {isChatting && (
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

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-3 space-y-3">
        {/* Empty state */}
        {pair.left.messages.length === 0 && !isChatting && (
          <div className="text-center text-text-muted text-sm mt-8">
            <p className="mb-2">Sujet: {pair.topic}</p>
            <p>Ecris un message pour commencer la conversation.</p>
          </div>
        )}

        {/* Message history */}
        {pair.left.messages.map((msg) => (
          <div key={msg.id}>
            {msg.role === 'user' ? (
              <div className="flex justify-end">
                <div className="bg-accent/20 text-text-primary rounded-lg px-3 py-2 max-w-[85%]">
                  <pre className="text-base whitespace-pre-wrap font-sans">{msg.content}</pre>
                </div>
              </div>
            ) : (
              <div className="border-l-2 border-accent/30 pl-3">
                {msg.toolEvents && msg.toolEvents.length > 0 && (
                  <ToolEventBlock events={msg.toolEvents.map(e => ({ ...e, type: e.type as 'tool_use' | 'tool_result' }))} />
                )}
                <MarkdownRenderer content={msg.content} />
              </div>
            )}
          </div>
        ))}

        {/* Streaming response — interleaved */}
        {isChatting && leftStreamItems.length > 0 && (
          <div className="border-l-2 border-accent/30 pl-3">
            <StreamItemList items={leftStreamItems} />
            <div className="flex items-center gap-2 mt-1">
              <span className="spinner spinner-sm" />
              <span className="text-xs text-text-muted">en cours...</span>
            </div>
          </div>
        )}

        {isChatting && leftStreamItems.length === 0 && (
          <div className="flex items-center justify-center gap-2 text-text-muted text-sm mt-8">
            <span className="spinner" />
            <span>Reflexion en cours...</span>
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
                    const lastUser = [...pair.left.messages].reverse().find(m => m.role === 'user');
                    if (lastUser) sendMessage(pair.id, lastUser.content);
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
      </div>

      {/* Bottom area — fixed height, aligned with RightPanel */}
      <div className="h-[200px] flex flex-col flex-shrink-0 border-t border-border">
        {/* Input area */}
        <div className="p-2">
          <div className="flex gap-2">
            <textarea
              value={inputText}
              onChange={e => setInputText(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ecris ton message... (Enter = envoyer)"
              disabled={isChatting || otherActive}
              rows={2}
              className="flex-1 bg-bg-tertiary border border-border rounded px-3 py-2 text-base text-text-primary focus:border-accent focus:outline-none resize-none disabled:opacity-40"
            />
            <div className="flex flex-col gap-1">
              {isChatting ? (
                <button
                  onClick={() => stopPair(pair.id)}
                  className="px-3 py-2 bg-error/20 text-error text-xs rounded hover:bg-error/30 transition-colors"
                >
                  Stop
                </button>
              ) : (
                <button
                  onClick={handleSend}
                  disabled={!canSend || otherActive}
                  className="px-3 py-2 bg-accent/20 text-accent text-xs rounded hover:bg-accent/30 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  Envoyer
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Attachments */}
        <div className="px-2 flex-1 min-h-0">
          <AttachmentZone
            attachments={pair.left.attachments}
            pairId={pair.id}
            panel="left"
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
