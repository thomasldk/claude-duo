import { useState, useEffect } from 'react';
import { usePairStore } from '../stores/pairStore';
import type { AgentConfig, Pair } from '../types/pair';

interface Props {
  onClose: () => void;
  editPair?: Pair; // If provided, edit mode
}

export default function PairForm({ onClose, editPair }: Props) {
  const { presets, createPair, updatePair, settings } = usePairStore();

  const [name, setName] = useState(editPair?.name || '');
  const [topic, setTopic] = useState(editPair?.topic || '');
  const [projectDir, setProjectDir] = useState(editPair?.projectDir || settings.defaultProjectDir || '');
  const [annexDirs, setAnnexDirs] = useState<string[]>(editPair?.annexDirs || []);
  const [newAnnexDir, setNewAnnexDir] = useState('');
  const [selectedPreset, setSelectedPreset] = useState('prd_chat');
  const [agent, setAgent] = useState<AgentConfig>(editPair?.left.agent || { name: '', systemPrompt: '', model: 'opus' });
  const [error, setError] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(!!editPair);

  useEffect(() => {
    if (editPair) return; // Don't override agent from preset in edit mode
    const preset = presets.find(p => p.name === selectedPreset);
    if (preset) {
      setAgent(preset.agent);
    }
  }, [selectedPreset, presets, editPair]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    try {
      if (editPair) {
        await updatePair(editPair.id, {
          name,
          topic,
          projectDir,
          annexDirs,
          leftAgent: agent,
        });
      } else {
        const pair = await createPair({
          name,
          topic,
          projectDir,
          annexDirs,
          leftAgent: agent,
        });
        usePairStore.getState().selectPair(pair.id);
      }
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to save pair');
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 z-40 flex items-center justify-center">
      <form
        onSubmit={handleSubmit}
        className="bg-bg-secondary border border-border rounded-lg p-6 w-[600px] max-h-[90vh] overflow-y-auto"
      >
        <h2 className="text-lg font-semibold mb-4">{editPair ? 'Modifier la paire' : 'Nouvelle paire'}</h2>

        {error && <div className="bg-error/20 text-error text-sm p-2 rounded mb-3">{error}</div>}

        <div className="space-y-3">
          <div>
            <label className="block text-sm text-text-secondary mb-1">Nom</label>
            <input
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="Ex: Auth 2FA"
              required
              className="w-full bg-bg-tertiary border border-border rounded px-3 py-2 text-sm text-text-primary focus:border-accent focus:outline-none"
            />
          </div>

          <div>
            <label className="block text-sm text-text-secondary mb-1">Sujet / Topic</label>
            <textarea
              value={topic}
              onChange={e => setTopic(e.target.value)}
              placeholder="Description du travail a faire..."
              required
              rows={3}
              className="w-full bg-bg-tertiary border border-border rounded px-3 py-2 text-sm text-text-primary focus:border-accent focus:outline-none resize-y"
            />
          </div>

          <div>
            <label className="block text-sm text-text-secondary mb-1">Dossier projet (path absolu)</label>
            <input
              value={projectDir}
              onChange={e => setProjectDir(e.target.value)}
              placeholder="/Users/.../mon-projet"
              required
              className="w-full bg-bg-tertiary border border-border rounded px-3 py-2 text-sm text-text-primary font-mono focus:border-accent focus:outline-none"
            />
          </div>

          <div>
            <label className="block text-sm text-text-secondary mb-1">Dossiers annexes (optionnel)</label>
            <div className="flex gap-2 mb-1">
              <input
                value={newAnnexDir}
                onChange={e => setNewAnnexDir(e.target.value)}
                placeholder="/Users/.../autre-repo"
                className="flex-1 bg-bg-tertiary border border-border rounded px-3 py-2 text-sm text-text-primary font-mono focus:border-accent focus:outline-none"
              />
              <button
                type="button"
                onClick={() => {
                  if (newAnnexDir.trim()) {
                    setAnnexDirs([...annexDirs, newAnnexDir.trim()]);
                    setNewAnnexDir('');
                  }
                }}
                className="px-3 py-2 bg-bg-tertiary border border-border rounded text-sm text-text-secondary hover:text-text-primary"
              >
                + Ajouter
              </button>
            </div>
            {annexDirs.map((dir, i) => (
              <div key={i} className="flex items-center gap-2 text-xs text-text-secondary font-mono">
                <span>{dir}</span>
                <button
                  type="button"
                  onClick={() => setAnnexDirs(annexDirs.filter((_, j) => j !== i))}
                  className="text-error hover:text-error/80"
                >
                  x
                </button>
              </div>
            ))}
          </div>

          {!editPair && (
            <div>
              <label className="block text-sm text-text-secondary mb-1">Preset</label>
              <select
                value={selectedPreset}
                onChange={e => setSelectedPreset(e.target.value)}
                className="w-full bg-bg-tertiary border border-border rounded px-3 py-2 text-sm text-text-primary focus:border-accent focus:outline-none"
              >
                {presets.map(p => (
                  <option key={p.name} value={p.name}>{p.label}</option>
                ))}
              </select>
            </div>
          )}

          <button
            type="button"
            onClick={() => setShowAdvanced(!showAdvanced)}
            className="text-xs text-text-secondary hover:text-accent"
          >
            {showAdvanced ? '\u25BC' : '\u25B6'} Configuration avancee de l'agent
          </button>

          {showAdvanced && (
            <div className="space-y-3 border-t border-border pt-3">
              <div>
                <label className="block text-sm text-text-secondary mb-1">Nom de l'agent</label>
                <input
                  value={agent.name}
                  onChange={e => setAgent({ ...agent, name: e.target.value })}
                  className="w-full bg-bg-tertiary border border-border rounded px-3 py-1 text-sm text-text-primary mb-1 focus:border-accent focus:outline-none"
                  placeholder="Nom"
                />
              </div>
              <div>
                <label className="block text-sm text-text-secondary mb-1">System prompt</label>
                <textarea
                  value={agent.systemPrompt}
                  onChange={e => setAgent({ ...agent, systemPrompt: e.target.value })}
                  rows={4}
                  className="w-full bg-bg-tertiary border border-border rounded px-3 py-1 text-xs text-text-primary font-mono mb-1 focus:border-accent focus:outline-none resize-y"
                  placeholder="System prompt..."
                />
              </div>
              <div>
                <label className="block text-sm text-text-secondary mb-1">Modele</label>
                <select
                  value={agent.model}
                  onChange={e => setAgent({ ...agent, model: e.target.value as 'sonnet' | 'opus' })}
                  className="bg-bg-tertiary border border-border rounded px-2 py-1 text-xs text-text-primary focus:border-accent focus:outline-none"
                >
                  <option value="sonnet">Sonnet</option>
                  <option value="opus">Opus</option>
                </select>
              </div>
            </div>
          )}
        </div>

        <div className="flex justify-end gap-3 mt-6">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-sm text-text-secondary hover:text-text-primary"
          >
            Annuler
          </button>
          <button
            type="submit"
            className="px-4 py-2 bg-accent text-white text-sm rounded hover:bg-accent-hover transition-colors"
          >
            {editPair ? 'Enregistrer' : 'Creer la paire'}
          </button>
        </div>
      </form>
    </div>
  );
}
