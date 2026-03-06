import { useState, useEffect } from 'react';
import { usePairStore } from '../stores/pairStore';

interface Props {
  onClose: () => void;
}

export default function SettingsPanel({ onClose }: Props) {
  const { settings, updateSettings } = usePairStore();

  const [prdDir, setPrdDir] = useState(settings.prdDir);
  const [defaultProjectDir, setDefaultProjectDir] = useState(settings.defaultProjectDir);
  const [anthropicApiKey, setAnthropicApiKey] = useState(settings.anthropicApiKey);

  useEffect(() => {
    setPrdDir(settings.prdDir);
    setDefaultProjectDir(settings.defaultProjectDir);
    setAnthropicApiKey(settings.anthropicApiKey);
  }, [settings]);

  const handleSave = async () => {
    await updateSettings({ prdDir, defaultProjectDir, anthropicApiKey });
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-black/60 z-40 flex items-center justify-center">
      <div className="bg-bg-secondary border border-border rounded-lg p-6 w-[550px] max-h-[90vh] overflow-y-auto">
        <h2 className="text-lg font-semibold mb-4">{'\u2699'} Parametres</h2>

        <div className="space-y-4">
          <div>
            <label className="block text-sm text-text-secondary mb-1">Dossier des PRDs</label>
            <p className="text-xs text-text-muted mb-1">
              Le dossier ou vivent vos fichiers PRD-*.md. Injecte automatiquement dans chaque session Claude.
            </p>
            <input
              value={prdDir}
              onChange={e => setPrdDir(e.target.value)}
              placeholder="/Users/.../mes-prds"
              autoComplete="off"
              className="w-full bg-bg-tertiary border border-border rounded px-3 py-2 text-sm text-text-primary font-mono focus:border-accent focus:outline-none"
            />
          </div>

          <div>
            <label className="block text-sm text-text-secondary mb-1">Dossier projet par defaut</label>
            <p className="text-xs text-text-muted mb-1">
              Pre-rempli dans le formulaire de creation de paire.
            </p>
            <input
              value={defaultProjectDir}
              onChange={e => setDefaultProjectDir(e.target.value)}
              placeholder="/Users/.../mon-projet"
              autoComplete="off"
              className="w-full bg-bg-tertiary border border-border rounded px-3 py-2 text-sm text-text-primary font-mono focus:border-accent focus:outline-none"
            />
          </div>

          <div>
            <label className="block text-sm text-text-secondary mb-1">Cle API Claude (ANTHROPIC_API_KEY)</label>
            <p className="text-xs text-text-muted mb-1">
              Si vide, utilise la variable d'environnement du systeme.
            </p>
            <input
              type="text"
              value={anthropicApiKey}
              onChange={e => setAnthropicApiKey(e.target.value)}
              placeholder="sk-ant-..."
              autoComplete="off"
              className="w-full bg-bg-tertiary border border-border rounded px-3 py-2 text-sm text-text-primary font-mono focus:border-accent focus:outline-none"
            />
          </div>
        </div>

        <div className="flex items-center justify-end gap-3 mt-6">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm text-text-secondary hover:text-text-primary"
          >
            Fermer
          </button>
          <button
            onClick={handleSave}
            className="px-4 py-2 bg-accent text-white text-sm rounded hover:bg-accent-hover transition-colors"
          >
            Enregistrer
          </button>
        </div>
      </div>
    </div>
  );
}
