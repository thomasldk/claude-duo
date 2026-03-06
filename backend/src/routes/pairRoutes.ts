import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import fs from 'fs';
import path from 'path';
import multer from 'multer';
import { Server as SocketServer } from 'socket.io';
import { Pair, PairStatus, ChatMessage } from '../types/pair.js';
import { savePair, deletePairFromDisk, getAttachmentsDir } from '../services/storageService.js';
import { callClaudeChat, runAnalysis, runImplementation, runAutoLoop, runScoringLoop, getActiveProcesses, estimateTokens, extractReferencedFileContents } from '../services/claudeService.js';
import { PRESETS } from '../services/presets.js';
import { loadSettings, saveSettings } from '../services/settingsService.js';

const EDITABLE_STATUSES: PairStatus[] = ['idle', 'prd_done', 'done', 'error', 'stopped'];

function paramId(req: Request): string {
  return req.params.id as string;
}

export function createPairRoutes(pairs: Map<string, Pair>, io: SocketServer): Router {
  const router = Router();

  // Upload config
  const storage = multer.diskStorage({
    destination: (req, _file, cb) => {
      const pairId = paramId(req);
      const dir = getAttachmentsDir(pairId);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      cb(null, dir);
    },
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname);
      cb(null, `${uuidv4()}${ext}`);
    },
  });
  const upload = multer({ storage, limits: { fileSize: 10 * 1024 * 1024 } });

  // GET /api/presets
  router.get('/presets', (_req: Request, res: Response) => {
    res.json(PRESETS);
  });

  // GET /api/pairs
  router.get('/pairs', (_req: Request, res: Response) => {
    const list = Array.from(pairs.values())
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
    res.json(list);
  });

  // GET /api/pairs/:id
  router.get('/pairs/:id', (req: Request, res: Response) => {
    const pair = pairs.get(paramId(req));
    if (!pair) { res.status(404).json({ error: 'Pair not found' }); return; }
    res.json(pair);
  });

  // POST /api/pairs
  router.post('/pairs', (req: Request, res: Response) => {
    const { name, topic, projectDir, annexDirs, leftAgent } = req.body;

    if (!name || !topic || !projectDir) {
      res.status(400).json({ error: 'name, topic, projectDir required' });
      return;
    }

    if (!fs.existsSync(projectDir)) {
      res.status(400).json({ error: `projectDir does not exist: ${projectDir}` });
      return;
    }

    const now = new Date().toISOString();
    const pair: Pair = {
      id: uuidv4(),
      name,
      topic,
      createdAt: now,
      updatedAt: now,
      projectDir,
      annexDirs: annexDirs || [],
      status: 'idle',
      left: {
        agent: leftAgent || { name: 'Expert PRD', systemPrompt: '', model: 'opus' },
        messages: [],
        sessionId: null,
        attachments: [],
      },
      right: {
        agent: {
          name: 'Codeur',
          systemPrompt: 'Tu es un developpeur senior. Implemente le PRD fourni de maniere complete et rigoureuse.',
          model: 'opus',
        },
        analyses: [],
        implementation: null,
        sessionId: null,
        attachments: [],
      },
    };

    pairs.set(pair.id, pair);
    savePair(pair);
    res.status(201).json(pair);
  });

  // PATCH /api/pairs/:id
  router.patch('/pairs/:id', (req: Request, res: Response) => {
    const pair = pairs.get(paramId(req));
    if (!pair) { res.status(404).json({ error: 'Pair not found' }); return; }

    if (!EDITABLE_STATUSES.includes(pair.status)) {
      res.status(409).json({ error: `Cannot edit pair in status: ${pair.status}` });
      return;
    }

    const { name, topic, projectDir, annexDirs, leftAgent, rightAgent } = req.body;
    if (name !== undefined) pair.name = name;
    if (topic !== undefined) pair.topic = topic;
    if (projectDir !== undefined) pair.projectDir = projectDir;
    if (annexDirs !== undefined) pair.annexDirs = annexDirs;
    if (leftAgent !== undefined) pair.left.agent = leftAgent;
    if (rightAgent !== undefined) pair.right.agent = rightAgent;

    pair.updatedAt = new Date().toISOString();
    savePair(pair);
    res.json(pair);
  });

  // DELETE /api/pairs/:id
  router.delete('/pairs/:id', (req: Request, res: Response) => {
    const pair = pairs.get(paramId(req));
    if (!pair) { res.status(404).json({ error: 'Pair not found' }); return; }

    // Remove from active processes first, then kill (so callbacks see pair is gone)
    const proc = getActiveProcesses().get(pair.id);
    getActiveProcesses().delete(pair.id);
    if (proc) proc.kill('SIGTERM');

    pairs.delete(pair.id);
    deletePairFromDisk(pair.id);
    res.status(204).send();
  });

  // POST /api/pairs/:id/send-message
  router.post('/pairs/:id/send-message', (req: Request, res: Response) => {
    const pair = pairs.get(paramId(req));
    if (!pair) { res.status(404).json({ error: 'Pair not found' }); return; }

    const { text } = req.body;
    if (!text) { res.status(400).json({ error: 'text required' }); return; }

    if (pair.status === 'chatting') {
      res.status(409).json({ error: 'Already processing a message' });
      return;
    }

    // Check no other pair is active
    for (const [, p] of pairs) {
      if (p.id !== pair.id && ['chatting', 'analyzing', 'coding'].includes(p.status)) {
        res.status(409).json({ error: 'Another pair is already active' });
        return;
      }
    }

    const userMessage: ChatMessage = {
      id: uuidv4(),
      role: 'user',
      content: text,
      timestamp: new Date().toISOString(),
    };
    pair.left.messages.push(userMessage);

    pair.status = 'chatting';
    pair.updatedAt = new Date().toISOString();
    savePair(pair);
    io.emit(`status:${pair.id}`, { status: 'chatting' });

    // Build prompt — inject referenced file contents + new image attachments
    let fullPrompt = text;

    // Find and include referenced .md/.txt files from this message
    const referencedFiles = extractReferencedFileContents([userMessage], pair.projectDir, pair.annexDirs);
    if (referencedFiles) {
      fullPrompt += '\n\n---\n\n[FICHIERS REFERENCES]\n\n' + referencedFiles;
    }

    // Only include NEW image attachments (not already mentioned in previous messages)
    const allPriorText = pair.left.messages.slice(0, -1).map(m => m.content).join(' ');
    const newImageAttachments = pair.left.attachments.filter(a =>
      a.mimeType.startsWith('image/') && !allPriorText.includes(a.path)
    );
    if (newImageAttachments.length > 0) {
      const imagePaths = newImageAttachments.map(a => a.path);
      fullPrompt += '\n\n[Images jointes — lis-les avec l\'outil Read pour les voir]\n' +
        imagePaths.map(p => `- ${p}`).join('\n');
    }

    callClaudeChat({
      cwd: pair.projectDir,
      annexDirs: pair.annexDirs,
      model: pair.left.agent.model,
      systemPrompt: pair.left.agent.systemPrompt,
      allowedTools: ['Read', 'Glob', 'Grep', 'Write', 'Edit'],
      prompt: fullPrompt,
      sessionId: pair.left.sessionId,
      pairId: pair.id,
      io,
      onComplete: (fullText, sessionId) => {
        if (!pairs.has(pair.id)) return;
        const assistantMessage: ChatMessage = {
          id: uuidv4(),
          role: 'assistant',
          content: fullText,
          timestamp: new Date().toISOString(),
        };
        pair.left.messages.push(assistantMessage);
        pair.left.sessionId = sessionId;
        pair.status = 'prd_done';
        pair.updatedAt = new Date().toISOString();
        savePair(pair);
        io.emit(`status:${pair.id}`, { status: 'prd_done' });
      },
      onError: (error) => {
        if (!pairs.has(pair.id)) return;
        pair.status = 'error';
        pair.updatedAt = new Date().toISOString();
        savePair(pair);
        io.emit(`status:${pair.id}`, { status: 'error' });
        io.emit(`error:${pair.id}`, { message: error, retryable: true });
      },
    });

    res.json({ status: 'chatting', messageId: userMessage.id });
  });

  // POST /api/pairs/:id/reset-chat
  router.post('/pairs/:id/reset-chat', (req: Request, res: Response) => {
    const pair = pairs.get(paramId(req));
    if (!pair) { res.status(404).json({ error: 'Pair not found' }); return; }

    const proc = getActiveProcesses().get(pair.id);
    if (proc) proc.kill('SIGTERM');

    pair.left.messages = [];
    pair.left.sessionId = null;
    pair.right.sessionId = null;
    pair.right.analyses = [];
    pair.status = 'idle';
    pair.updatedAt = new Date().toISOString();
    savePair(pair);
    io.emit(`status:${pair.id}`, { status: 'idle' });
    res.json({ status: 'reset' });
  });

  // POST /api/pairs/:id/stop
  router.post('/pairs/:id/stop', (req: Request, res: Response) => {
    const pair = pairs.get(paramId(req));
    if (!pair) { res.status(404).json({ error: 'Pair not found' }); return; }

    const proc = getActiveProcesses().get(pair.id);
    if (proc) proc.kill('SIGTERM');

    pair.status = 'stopped';
    pair.updatedAt = new Date().toISOString();
    savePair(pair);
    io.emit(`status:${pair.id}`, { status: 'stopped' });
    res.json({ status: 'stopped' });
  });

  // POST /api/pairs/:id/push-right
  router.post('/pairs/:id/push-right', (req: Request, res: Response) => {
    const pair = pairs.get(paramId(req));
    if (!pair) { res.status(404).json({ error: 'Pair not found' }); return; }

    if (!['prd_done', 'done', 'error', 'stopped'].includes(pair.status)) {
      res.status(409).json({ error: `Cannot push PRD in status: ${pair.status}` });
      return;
    }

    const hasAssistant = pair.left.messages.some(m => m.role === 'assistant');
    if (!hasAssistant) {
      res.status(409).json({ error: 'No assistant response to push' });
      return;
    }

    for (const [, p] of pairs) {
      if (p.id !== pair.id && ['chatting', 'analyzing', 'coding'].includes(p.status)) {
        res.status(409).json({ error: 'Another pair is already active' });
        return;
      }
    }

    runAnalysis(pair, io).catch((err) => {
      if (!pairs.has(pair.id)) return;
      pair.status = 'error';
      pair.updatedAt = new Date().toISOString();
      savePair(pair);
      io.emit(`status:${pair.id}`, { status: 'error' });
      io.emit(`error:${pair.id}`, { message: String(err), retryable: true });
    });

    res.json({ status: 'analyzing' });
  });

  // POST /api/pairs/:id/go-code
  router.post('/pairs/:id/go-code', (req: Request, res: Response) => {
    const pair = pairs.get(paramId(req));
    if (!pair) { res.status(404).json({ error: 'Pair not found' }); return; }

    if (pair.right.analyses.length === 0) {
      res.status(409).json({ error: 'No analysis available. Push PRD first.' });
      return;
    }

    for (const [, p] of pairs) {
      if (p.id !== pair.id && ['chatting', 'analyzing', 'coding'].includes(p.status)) {
        res.status(409).json({ error: 'Another pair is already active' });
        return;
      }
    }

    runImplementation(pair, io).catch((err) => {
      if (!pairs.has(pair.id)) return;
      pair.status = 'error';
      pair.updatedAt = new Date().toISOString();
      savePair(pair);
      io.emit(`status:${pair.id}`, { status: 'error' });
      io.emit(`error:${pair.id}`, { message: String(err), retryable: true });
    });

    res.json({ status: 'coding' });
  });

  // POST /api/pairs/:id/auto-loop
  router.post('/pairs/:id/auto-loop', (req: Request, res: Response) => {
    const pair = pairs.get(paramId(req));
    if (!pair) { res.status(404).json({ error: 'Pair not found' }); return; }

    const rounds = Math.min(Math.max(req.body.rounds || 2, 1), 5);

    if (!['prd_done', 'done', 'error', 'stopped'].includes(pair.status)) {
      res.status(409).json({ error: `Cannot start loop in status: ${pair.status}` });
      return;
    }

    const hasAssistant = pair.left.messages.some(m => m.role === 'assistant');
    if (!hasAssistant) {
      res.status(409).json({ error: 'No assistant response to loop on' });
      return;
    }

    for (const [, p] of pairs) {
      if (p.id !== pair.id && ['chatting', 'analyzing', 'coding'].includes(p.status)) {
        res.status(409).json({ error: 'Another pair is already active' });
        return;
      }
    }

    runAutoLoop(pair, io, rounds).catch((err) => {
      pair.status = 'error';
      pair.updatedAt = new Date().toISOString();
      savePair(pair);
      io.emit(`status:${pair.id}`, { status: 'error' });
      io.emit(`error:${pair.id}`, { message: String(err), retryable: true });
    });

    res.json({ status: 'looping', rounds });
  });

  // POST /api/pairs/:id/scoring — auto-loop with score-based stop (>= 9/10)
  router.post('/pairs/:id/scoring', (req: Request, res: Response) => {
    const pair = pairs.get(paramId(req));
    if (!pair) { res.status(404).json({ error: 'Pair not found' }); return; }

    if (!['prd_done', 'done', 'error', 'stopped'].includes(pair.status)) {
      res.status(409).json({ error: `Cannot start scoring in status: ${pair.status}` });
      return;
    }

    const hasAssistant = pair.left.messages.some(m => m.role === 'assistant');
    if (!hasAssistant) {
      res.status(409).json({ error: 'No assistant response to score' });
      return;
    }

    for (const [, p] of pairs) {
      if (p.id !== pair.id && ['chatting', 'analyzing', 'coding'].includes(p.status)) {
        res.status(409).json({ error: 'Another pair is already active' });
        return;
      }
    }

    runScoringLoop(pair, io).catch((err) => {
      pair.status = 'error';
      pair.updatedAt = new Date().toISOString();
      savePair(pair);
      io.emit(`status:${pair.id}`, { status: 'error' });
      io.emit(`error:${pair.id}`, { message: String(err), retryable: true });
    });

    res.json({ status: 'scoring' });
  });

  // POST /api/pairs/:id/push-left — send latest analysis back to left chat
  router.post('/pairs/:id/push-left', (req: Request, res: Response) => {
    const pair = pairs.get(paramId(req));
    if (!pair) { res.status(404).json({ error: 'Pair not found' }); return; }

    if (!['prd_done', 'done', 'error', 'stopped'].includes(pair.status)) {
      res.status(409).json({ error: `Cannot push left in status: ${pair.status}` });
      return;
    }

    const lastAnalysis = pair.right.analyses[pair.right.analyses.length - 1];
    if (!lastAnalysis) {
      res.status(409).json({ error: 'No analysis to send back' });
      return;
    }

    for (const [, p] of pairs) {
      if (p.id !== pair.id && ['chatting', 'analyzing', 'coding'].includes(p.status)) {
        res.status(409).json({ error: 'Another pair is already active' });
        return;
      }
    }

    // Add analysis as user message in left chat
    const feedbackMessage: ChatMessage = {
      id: uuidv4(),
      role: 'user',
      content: `[COMMENTAIRES DE L'ANALYSTE]\n\n${lastAnalysis.output}\n\n[CONSIGNE]\nPrend en compte ces commentaires et produis une version amelioree du PRD. Integre les corrections demandees.`,
      timestamp: new Date().toISOString(),
    };
    pair.left.messages.push(feedbackMessage);

    pair.status = 'chatting';
    pair.updatedAt = new Date().toISOString();
    savePair(pair);
    io.emit(`status:${pair.id}`, { status: 'chatting' });

    callClaudeChat({
      cwd: pair.projectDir,
      annexDirs: pair.annexDirs,
      model: pair.left.agent.model,
      systemPrompt: pair.left.agent.systemPrompt,
      allowedTools: ['Read', 'Glob', 'Grep', 'Write', 'Edit'],
      prompt: feedbackMessage.content,
      sessionId: pair.left.sessionId,
      pairId: pair.id,
      io,
      onComplete: (fullText, sessionId) => {
        if (!pairs.has(pair.id)) return;
        const assistantMessage: ChatMessage = {
          id: uuidv4(),
          role: 'assistant',
          content: fullText,
          timestamp: new Date().toISOString(),
        };
        pair.left.messages.push(assistantMessage);
        pair.left.sessionId = sessionId;
        pair.status = 'prd_done';
        pair.updatedAt = new Date().toISOString();
        savePair(pair);
        io.emit(`status:${pair.id}`, { status: 'prd_done' });
      },
      onError: (error) => {
        if (!pairs.has(pair.id)) return;
        pair.status = 'error';
        pair.updatedAt = new Date().toISOString();
        savePair(pair);
        io.emit(`status:${pair.id}`, { status: 'error' });
        io.emit(`error:${pair.id}`, { message: error, retryable: true });
      },
    });

    res.json({ status: 'chatting' });
  });

  // POST /api/pairs/:id/attachments
  router.post('/pairs/:id/attachments', upload.single('file'), (req: Request, res: Response) => {
    const pair = pairs.get(paramId(req));
    if (!pair) { res.status(404).json({ error: 'Pair not found' }); return; }

    const file = req.file;
    if (!file) { res.status(400).json({ error: 'No file uploaded' }); return; }

    const panel = (req.body.panel || 'left') as 'left' | 'right';
    const storedName = path.basename(file.path);
    const attachment = {
      id: uuidv4(),
      filename: file.originalname,
      storedName,
      path: file.path,
      mimeType: file.mimetype,
    };

    if (panel === 'right') {
      pair.right.attachments.push(attachment);
    } else {
      pair.left.attachments.push(attachment);
    }

    pair.updatedAt = new Date().toISOString();
    savePair(pair);
    res.status(201).json(attachment);
  });

  // DELETE /api/pairs/:id/attachments/:aid
  router.delete('/pairs/:id/attachments/:aid', (req: Request, res: Response) => {
    const pair = pairs.get(paramId(req));
    if (!pair) { res.status(404).json({ error: 'Pair not found' }); return; }

    const aid = req.params.aid as string;
    let found = false;

    for (const side of ['left', 'right'] as const) {
      const idx = pair[side].attachments.findIndex(a => a.id === aid);
      if (idx !== -1) {
        const att = pair[side].attachments[idx];
        if (fs.existsSync(att.path)) fs.unlinkSync(att.path);
        pair[side].attachments.splice(idx, 1);
        found = true;
        break;
      }
    }

    if (!found) { res.status(404).json({ error: 'Attachment not found' }); return; }

    pair.updatedAt = new Date().toISOString();
    savePair(pair);
    res.status(204).send();
  });

  // GET /api/pairs/:id/tokens
  router.get('/pairs/:id/tokens', (req: Request, res: Response) => {
    const pair = pairs.get(paramId(req));
    if (!pair) { res.status(404).json({ error: 'Pair not found' }); return; }

    const leftText = pair.left.messages.map(m => m.content).join('');
    const lastAssistant = [...pair.left.messages].reverse().find(m => m.role === 'assistant');
    const lastAnalysis = pair.right.analyses[pair.right.analyses.length - 1];
    const rightText = (lastAssistant?.content || '') + (lastAnalysis?.output || '');

    res.json({
      left: { estimated: estimateTokens(leftText), limit: 100000 },
      right: { estimated: estimateTokens(rightText), limit: 100000 },
    });
  });

  // GET /api/settings
  router.get('/settings', (_req: Request, res: Response) => {
    const settings = loadSettings();
    // Never expose full API key to frontend
    res.json({
      ...settings,
      anthropicApiKey: settings.anthropicApiKey ? '****' + settings.anthropicApiKey.slice(-4) : '',
    });
  });

  // PUT /api/settings
  router.put('/settings', (req: Request, res: Response) => {
    const current = loadSettings();
    const { prdDir, defaultProjectDir, anthropicApiKey } = req.body;

    if (prdDir !== undefined) current.prdDir = prdDir;
    if (defaultProjectDir !== undefined) current.defaultProjectDir = defaultProjectDir;
    // Only update API key if not masked
    if (anthropicApiKey !== undefined && !anthropicApiKey.startsWith('****')) {
      current.anthropicApiKey = anthropicApiKey;
    }

    saveSettings(current);
    res.json({
      ...current,
      anthropicApiKey: current.anthropicApiKey ? '****' + current.anthropicApiKey.slice(-4) : '',
    });
  });

  return router;
}
