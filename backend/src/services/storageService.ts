import fs from 'fs';
import path from 'path';
import { Pair } from '../types/pair.js';

const BASE_DIR = path.join(process.env.HOME || '~', '.claude-duo');
const SESSIONS_DIR = path.join(BASE_DIR, 'sessions');

function ensureDir(dir: string) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

export function getSessionDir(pairId: string): string {
  return path.join(SESSIONS_DIR, pairId);
}

export function getAttachmentsDir(pairId: string): string {
  return path.join(getSessionDir(pairId), 'attachments');
}

export function savePair(pair: Pair): void {
  const dir = getSessionDir(pair.id);
  ensureDir(dir);
  ensureDir(path.join(dir, 'left'));
  ensureDir(path.join(dir, 'right'));
  ensureDir(path.join(dir, 'attachments'));
  fs.writeFileSync(path.join(dir, 'pair.json'), JSON.stringify(pair, null, 2));
}

export function loadAllPairs(): Pair[] {
  ensureDir(SESSIONS_DIR);
  const pairs: Pair[] = [];
  const entries = fs.readdirSync(SESSIONS_DIR, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const pairFile = path.join(SESSIONS_DIR, entry.name, 'pair.json');
    if (fs.existsSync(pairFile)) {
      try {
        const data = JSON.parse(fs.readFileSync(pairFile, 'utf-8'));
        pairs.push(data);
      } catch {
        console.error(`Failed to load pair from ${pairFile}`);
      }
    }
  }
  return pairs.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
}

export function deletePairFromDisk(pairId: string): void {
  const dir = getSessionDir(pairId);
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

export function saveRoundOutput(pairId: string, side: 'left' | 'right', filename: string, content: string): void {
  const dir = path.join(getSessionDir(pairId), side);
  ensureDir(dir);
  fs.writeFileSync(path.join(dir, filename), content);
}
