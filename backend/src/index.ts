import express from 'express';
import { createServer } from 'http';
import { Server as SocketServer } from 'socket.io';
import cors from 'cors';
import path from 'path';
import { execSync } from 'child_process';
import { Pair } from './types/pair.js';
import { loadAllPairs } from './services/storageService.js';
import { createPairRoutes } from './routes/pairRoutes.js';

const PORT = process.env.PORT || 3001;
const app = express();
const httpServer = createServer(app);
const ALLOWED_ORIGINS = ['http://localhost:5174', 'http://localhost:3001', 'http://127.0.0.1:5174'];
const io = new SocketServer(httpServer, {
  cors: { origin: ALLOWED_ORIGINS },
});

app.use(cors({ origin: ALLOWED_ORIGINS }));
app.use(express.json({ limit: '10mb' }));

// Serve attachment files
const homeDir = process.env.HOME || '~';
app.use('/attachments', express.static(path.join(homeDir, '.claude-duo', 'sessions')));

// Check claude CLI is available
try {
  execSync('which claude', { stdio: 'pipe' });
  console.log('Claude CLI found');
} catch {
  console.error('WARNING: claude CLI not found. Install Claude Code CLI to use this app.');
}

// Load existing pairs
const pairs = new Map<string, Pair>();
const loaded = loadAllPairs();
for (const pair of loaded) {
  // Reset any running status from previous session
  if (['chatting', 'analyzing', 'coding'].includes(pair.status)) {
    pair.status = 'stopped';
  }
  pairs.set(pair.id, pair);
}
console.log(`Loaded ${pairs.size} pairs from disk`);

// Routes
app.use('/api', createPairRoutes(pairs, io));

// WebSocket
io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);
  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
  });
});

httpServer.listen(PORT, () => {
  console.log(`ClaudeDuo backend running on http://localhost:${PORT}`);
});
