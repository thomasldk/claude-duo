import { useState, useRef, useEffect } from 'react';
import { usePairStore } from '../stores/pairStore';
import type { Pair, PairStatus } from '../types/pair';
import PairForm from './PairForm';
import SettingsPanel from './SettingsPanel';

const STATUS_BADGES: Record<PairStatus, { color: string; label: string; pulse?: boolean }> = {
  idle: { color: 'bg-text-muted', label: 'Idle' },
  chatting: { color: 'bg-warning', label: 'Chat...', pulse: true },
  prd_done: { color: 'bg-success', label: 'Pret' },
  analyzing: { color: 'bg-warning', label: 'Analyse...', pulse: true },
  coding: { color: 'bg-warning', label: 'Code...', pulse: true },
  done: { color: 'bg-success', label: 'Fini' },
  error: { color: 'bg-error', label: 'Erreur' },
  stopped: { color: 'bg-text-muted', label: 'Stop' },
};

/** Extract first PRD-*.md or *.md filename from user messages */
function extractPrdName(pair: Pair): string | null {
  for (const msg of pair.left.messages) {
    if (msg.role !== 'user') continue;
    const match = msg.content.match(/[\w\-]+\.md/i);
    if (match) return match[0];
  }
  return null;
}

export default function Sidebar() {
  const { pairs, selectedPairId, selectPair, searchQuery, setSearchQuery, deletePair, updatePair } = usePairStore();
  const [showForm, setShowForm] = useState(false);
  const [editPair, setEditPair] = useState<Pair | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [editingTopicId, setEditingTopicId] = useState<string | null>(null);
  const [editingTopicValue, setEditingTopicValue] = useState('');
  const topicInputRef = useRef<HTMLInputElement>(null);

  const filtered = pairs.filter(p =>
    p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    p.topic.toLowerCase().includes(searchQuery.toLowerCase())
  );

  // Focus input when editing starts
  useEffect(() => {
    if (editingTopicId && topicInputRef.current) {
      topicInputRef.current.focus();
      topicInputRef.current.select();
    }
  }, [editingTopicId]);

  const startEditTopic = (e: React.MouseEvent, pair: Pair) => {
    e.stopPropagation();
    setEditingTopicId(pair.id);
    setEditingTopicValue(pair.topic);
  };

  const saveTopic = (pairId: string) => {
    const trimmed = editingTopicValue.trim();
    if (trimmed) {
      updatePair(pairId, { topic: trimmed });
    }
    setEditingTopicId(null);
  };

  return (
    <>
      <div className="w-60 h-screen bg-bg-secondary border-r border-border flex flex-col shrink-0">
        {/* Header */}
        <div className="p-3 border-b border-border">
          <h1 className="text-sm font-bold text-accent mb-0">ClaudeDuo</h1>
          <div className="text-[10px] text-accent/60 mb-2">by TLDK v1.01</div>
          <input
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="Recherche..."
            className="w-full bg-bg-tertiary border border-border rounded px-2 py-1 text-xs text-text-primary focus:border-accent focus:outline-none"
          />
        </div>

        {/* New pair button */}
        <button
          onClick={() => setShowForm(true)}
          className="mx-3 mt-3 px-3 py-2 bg-accent/10 border border-accent/30 rounded text-sm text-accent hover:bg-accent/20 transition-colors"
        >
          + Nouvelle paire
        </button>

        {/* Pairs list */}
        <div className="flex-1 overflow-y-auto mt-2">
          {filtered.map(pair => {
            const badge = STATUS_BADGES[pair.status];
            const isSelected = pair.id === selectedPairId;
            const prdVersion = pair.left.messages.filter(m => m.role === 'assistant').length;
            const prdName = extractPrdName(pair);

            return (
              <div
                key={pair.id}
                onClick={() => selectPair(pair.id)}
                className={`px-3 py-2 cursor-pointer border-l-2 transition-colors group ${
                  isSelected
                    ? 'bg-bg-tertiary border-accent'
                    : 'border-transparent hover:bg-bg-tertiary/50'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="text-sm truncate flex-1">{pair.name}</span>
                  <div className="flex items-center gap-1">
                    <span className={`w-2 h-2 rounded-full ${badge.color} ${badge.pulse ? 'animate-pulse' : ''}`} title={badge.label} />
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setEditPair(pair);
                      }}
                      className="text-text-muted hover:text-accent text-xs transition-colors opacity-0 group-hover:opacity-100"
                      title="Configurer"
                    >
                      {'\u2699'}
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        const code = window.prompt('Code de securite pour supprimer :');
                        if (code === '1234') {
                          deletePair(pair.id);
                        } else if (code !== null) {
                          window.alert('Code incorrect');
                        }
                      }}
                      className="text-text-muted hover:text-error text-xs transition-colors"
                      title="Supprimer"
                    >
                      {'\u2715'}
                    </button>
                  </div>
                </div>
                {/* Editable topic */}
                {editingTopicId === pair.id ? (
                  <input
                    ref={topicInputRef}
                    value={editingTopicValue}
                    onChange={e => setEditingTopicValue(e.target.value)}
                    onBlur={() => saveTopic(pair.id)}
                    onKeyDown={e => {
                      if (e.key === 'Enter') saveTopic(pair.id);
                      if (e.key === 'Escape') setEditingTopicId(null);
                    }}
                    onClick={e => e.stopPropagation()}
                    className="w-full bg-bg-tertiary border border-accent rounded px-1 py-0.5 text-xs text-text-primary focus:outline-none mt-0.5"
                  />
                ) : (
                  <div
                    className="text-xs text-text-secondary truncate mt-0.5 hover:text-accent cursor-text"
                    onClick={e => startEditTopic(e, pair)}
                    title="Cliquer pour modifier"
                  >
                    {pair.topic || 'Sans sujet'}
                  </div>
                )}
                {/* PRD file + version */}
                {prdName && (
                  <div className="text-xs text-purple truncate mt-0.5">
                    {prdName}{prdVersion > 0 && ` v${prdVersion}`}
                  </div>
                )}
                {/* Status + msgs */}
                <div className="text-xs text-text-muted mt-0.5">
                  {badge.label}
                  {!prdName && prdVersion > 0 && ` \u2022 v${prdVersion}`}
                  {pair.left.messages.length > 0 && ` \u2022 ${pair.left.messages.length} msgs`}
                </div>
              </div>
            );
          })}

          {filtered.length === 0 && (
            <p className="text-xs text-text-muted text-center mt-4 px-3">
              {pairs.length === 0 ? 'Aucune paire. Cree-en une !' : 'Aucun resultat.'}
            </p>
          )}
        </div>

        {/* Settings button */}
        <div className="p-3 border-t border-border">
          <button
            onClick={() => setShowSettings(true)}
            className="w-full px-3 py-2 text-xs text-text-secondary hover:text-text-primary hover:bg-bg-tertiary rounded transition-colors flex items-center gap-2"
          >
            <span>{'\u2699'}</span>
            <span>Parametres</span>
          </button>
        </div>
      </div>

      {showForm && <PairForm onClose={() => setShowForm(false)} />}
      {editPair && <PairForm editPair={editPair} onClose={() => setEditPair(null)} />}
      {showSettings && <SettingsPanel onClose={() => setShowSettings(false)} />}
    </>
  );
}
