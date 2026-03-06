import fs from 'fs';
import path from 'path';

export interface AppSettings {
  prdDir: string;         // Dossier ou vivent les PRDs
  defaultProjectDir: string; // Path pre-rempli dans PairForm
  anthropicApiKey: string;   // Cle API Claude
}

const SETTINGS_DIR = path.join(process.env.HOME || '', '.claude-duo');
const SETTINGS_FILE = path.join(SETTINGS_DIR, 'settings.json');

const DEFAULTS: AppSettings = {
  prdDir: '',
  defaultProjectDir: '',
  anthropicApiKey: '',
};

export function loadSettings(): AppSettings {
  try {
    if (fs.existsSync(SETTINGS_FILE)) {
      const raw = fs.readFileSync(SETTINGS_FILE, 'utf-8');
      return { ...DEFAULTS, ...JSON.parse(raw) };
    }
  } catch (err) {
    console.error('[settings] Error loading settings:', err);
  }
  return { ...DEFAULTS };
}

export function saveSettings(settings: AppSettings): void {
  try {
    if (!fs.existsSync(SETTINGS_DIR)) {
      fs.mkdirSync(SETTINGS_DIR, { recursive: true });
    }
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2));
    console.log('[settings] Saved to', SETTINGS_FILE);
  } catch (err) {
    console.error('[settings] Error saving settings:', err);
    throw err;
  }
}
