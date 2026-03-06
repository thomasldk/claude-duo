import { spawn, ChildProcess } from 'child_process';
import fs from 'fs';
import path from 'path';
import { Server as SocketServer } from 'socket.io';
import { Pair, StreamEvent, AgentModel, ChatMessage } from '../types/pair.js';
import { savePair, saveRoundOutput } from './storageService.js';
import { loadSettings } from './settingsService.js';

// Fallback: ClaudeDuo root directory
const CLAUDE_DUO_ROOT = path.resolve(process.cwd(), '..');

/** Get PRD directory from settings, fallback to claude-duo root */
function getPrdDir(): string {
  const settings = loadSettings();
  return settings.prdDir || CLAUDE_DUO_ROOT;
}

/** Get API key from settings (if set) */
function getApiKey(): string {
  const settings = loadSettings();
  return settings.anthropicApiKey || '';
}

/**
 * Scan conversation messages for referenced .md/.txt files,
 * find them on disk, and return their content for inclusion in prompts.
 */
export function extractReferencedFileContents(messages: ChatMessage[], cwd: string, annexDirs: string[]): string {
  const filePattern = /[\w\-\.\/]+\.(?:md|txt)/gi;
  const seen = new Set<string>();
  const results: string[] = [];

  for (const msg of messages) {
    const matches = msg.content.match(filePattern);
    if (!matches) continue;
    for (const ref of matches) {
      if (seen.has(ref)) continue;
      seen.add(ref);
      // Search in multiple locations
      const searchDirs = [
        cwd,
        ...annexDirs,
        path.dirname(cwd),
        getPrdDir(),
        process.env.HOME || '',
      ];
      console.log(`[extractFiles] Looking for "${ref}" in:`, searchDirs);
      let found = false;
      for (const dir of searchDirs) {
        if (!dir) continue;
        const candidate = path.join(dir, ref);
        try {
          if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
            const content = fs.readFileSync(candidate, 'utf-8');
            results.push(`[CONTENU DU FICHIER REFERENCE: ${ref}]\n${content}`);
            console.log(`[extractFiles] FOUND "${ref}" at ${candidate} (${content.length} chars)`);
            found = true;
            break;
          }
        } catch (err) {
          console.error(`[extractFiles] Error reading ${candidate}:`, err);
        }
      }
      if (!found) console.log(`[extractFiles] NOT FOUND: "${ref}"`);
    }
  }
  console.log(`[extractFiles] Total files found: ${results.length}`);
  return results.join('\n\n---\n\n');
}

const MODEL_MAP: Record<AgentModel, string> = {
  sonnet: 'claude-sonnet-4-20250514',
  opus: 'claude-opus-4-20250514',
};

// Track active processes for kill/stop
const activeProcesses = new Map<string, ChildProcess>();

export function getActiveProcesses() {
  return activeProcesses;
}

interface ClaudeCallOptions {
  cwd: string;
  annexDirs: string[];
  model: AgentModel;
  systemPrompt: string;
  useAppendSystemPrompt: boolean;
  allowedTools: string[];
  prompt: string;
  pairId: string;
  socketEvent: string;
  eventMeta: Record<string, unknown>;
  io: SocketServer;
  onComplete: (fullText: string) => void;
  onError: (error: string) => void;
}

export function callClaude(options: ClaudeCallOptions): ChildProcess {
  const args: string[] = [
    '-p',
    '--output-format', 'stream-json',
    '--verbose',
    '--include-partial-messages',
    '--model', MODEL_MAP[options.model],
  ];

  // Always include claude-duo root (where PRDs live)
  args.push('--add-dir', getPrdDir());

  for (const dir of options.annexDirs) {
    args.push('--add-dir', dir);
  }

  args.push('--allowedTools', options.allowedTools.join(','));

  if (options.useAppendSystemPrompt) {
    args.push('--append-system-prompt', options.systemPrompt);
  } else {
    args.push('--system-prompt', options.systemPrompt);
  }

  // Remove CLAUDECODE to allow nested CLI sessions
  const cleanEnv = { ...process.env };
  delete cleanEnv.CLAUDECODE;
  const apiKey = getApiKey();
  if (apiKey) cleanEnv.ANTHROPIC_API_KEY = apiKey;

  const proc = spawn('claude', args, {
    cwd: options.cwd,
    stdio: ['pipe', 'pipe', 'pipe'],
    env: cleanEnv,
  });

  activeProcesses.set(options.pairId, proc);

  proc.stdin!.write(options.prompt);
  proc.stdin!.end();

  let fullText = '';
  let stderrBuffer = '';
  let lastOutputTime = Date.now();
  let lastSeenText = '';
  let lastMessageId = '';
  let seenToolCount = 0;

  const timeoutInterval = setInterval(() => {
    if (Date.now() - lastOutputTime > 300000) {
      clearInterval(timeoutInterval);
      proc.kill('SIGTERM');
      options.onError('Timeout: aucune reponse depuis 5 minutes');
    }
  }, 10000);

  proc.stdout!.on('data', (chunk: Buffer) => {
    lastOutputTime = Date.now();
    const lines = chunk.toString().split('\n').filter(Boolean);

    for (const line of lines) {
      try {
        const parsed = JSON.parse(line);

        // Extract full text from result event
        if (parsed.type === 'result' && typeof parsed.result === 'string') {
          fullText = parsed.result;
          continue;
        }

        // Handle assistant partial messages (Claude CLI stream-json format)
        if (parsed.type === 'assistant' && parsed.message?.content) {
          const msgId = (parsed.message.id as string) || '';

          // New turn (new message ID) — reset per-turn trackers
          if (msgId && msgId !== lastMessageId) {
            lastMessageId = msgId;
            lastSeenText = '';
            seenToolCount = 0;
          }

          const content = parsed.message.content as Array<Record<string, unknown>>;
          const textBlocks = content
            .filter((b) => b.type === 'text' && typeof b.text === 'string')
            .map((b) => b.text as string);

          if (textBlocks.length > 0) {
            const currentText = textBlocks.join('');
            if (currentText.length > lastSeenText.length) {
              const delta = currentText.slice(lastSeenText.length);
              lastSeenText = currentText;
              fullText += delta; // Append across turns
              options.io.emit(options.socketEvent, {
                type: 'text',
                text: delta,
                ...options.eventMeta,
              });
            }
          }

          // Extract tool blocks (only emit new ones — reset per turn)
          const toolBlocks = content.filter((b) => b.type === 'tool_use' || b.type === 'tool_result');
          for (let i = seenToolCount; i < toolBlocks.length; i++) {
            const block = toolBlocks[i];
            if (block.type === 'tool_use') {
              options.io.emit(options.socketEvent, {
                type: 'tool_use',
                tool: block.name as string,
                input: JSON.stringify(block.input || ''),
                ...options.eventMeta,
              });
            } else if (block.type === 'tool_result') {
              options.io.emit(options.socketEvent, {
                type: 'tool_result',
                content: typeof block.content === 'string' ? block.content : JSON.stringify(block.content || ''),
                ...options.eventMeta,
              });
            }
          }
          seenToolCount = toolBlocks.length;
          continue;
        }

        // Fallback: skip — the assistant handler above already handles text + tools
      } catch {
        // Not valid JSON, skip
      }
    }
  });

  proc.stderr!.on('data', (chunk: Buffer) => {
    stderrBuffer += chunk.toString();
  });

  proc.on('close', (code) => {
    clearInterval(timeoutInterval);
    activeProcesses.delete(options.pairId);

    if (code === 0 || code === null) {
      options.onComplete(fullText);
    } else {
      const isRateLimit = stderrBuffer.includes('rate limit') || stderrBuffer.includes('429');
      options.io.emit(`error:${options.pairId}`, {
        message: stderrBuffer || `Process exited with code ${code}`,
        retryable: isRateLimit,
      });
      options.onError(stderrBuffer || `Exit code ${code}`);
    }
  });

  return proc;
}

// Chat-oriented call with --resume support for multi-turn
interface ClaudeChatOptions {
  cwd: string;
  annexDirs: string[];
  model: AgentModel;
  systemPrompt: string;
  allowedTools: string[];
  prompt: string;
  sessionId: string | null;
  pairId: string;
  socketEvent?: string;
  io: SocketServer;
  onComplete: (fullText: string, sessionId: string) => void;
  onError: (error: string) => void;
}

export function callClaudeChat(options: ClaudeChatOptions): ChildProcess {
  const args: string[] = [
    '-p',
    '--output-format', 'stream-json',
    '--verbose',
    '--include-partial-messages',
    '--model', MODEL_MAP[options.model],
  ];

  // Resume existing session for multi-turn
  if (options.sessionId) {
    args.push('--resume', options.sessionId);
  }

  // Always include claude-duo root (where PRDs live)
  args.push('--add-dir', getPrdDir());

  for (const dir of options.annexDirs) {
    args.push('--add-dir', dir);
  }

  args.push('--allowedTools', options.allowedTools.join(','));

  // Only set system prompt on first message (session remembers it)
  if (!options.sessionId) {
    args.push('--system-prompt', options.systemPrompt);
  }

  // Remove CLAUDECODE to allow nested CLI sessions
  const cleanEnv = { ...process.env };
  delete cleanEnv.CLAUDECODE;
  const apiKey = getApiKey();
  if (apiKey) cleanEnv.ANTHROPIC_API_KEY = apiKey;

  const proc = spawn('claude', args, {
    cwd: options.cwd,
    stdio: ['pipe', 'pipe', 'pipe'],
    env: cleanEnv,
  });

  activeProcesses.set(options.pairId, proc);

  proc.stdin!.write(options.prompt);
  proc.stdin!.end();

  const streamEvent = options.socketEvent || `stream:left:${options.pairId}`;

  let fullText = '';
  let capturedSessionId = options.sessionId || '';
  let stderrBuffer = '';
  let lastOutputTime = Date.now();
  let lastSeenText = ''; // Track cumulative text within current turn
  let lastMessageId = ''; // Track message ID to detect new turns
  let seenToolCount = 0; // Track how many tool blocks we've already emitted
  const toolEvents: { type: string; tool?: string; input?: string; content?: string }[] = [];

  const timeoutInterval = setInterval(() => {
    if (Date.now() - lastOutputTime > 300000) {
      clearInterval(timeoutInterval);
      proc.kill('SIGTERM');
      options.onError('Timeout: aucune reponse depuis 5 minutes');
    }
  }, 10000);

  proc.stdout!.on('data', (chunk: Buffer) => {
    lastOutputTime = Date.now();
    const lines = chunk.toString().split('\n').filter(Boolean);

    for (const line of lines) {
      try {
        const parsed = JSON.parse(line);

        // Capture session_id
        if (parsed.session_id) {
          capturedSessionId = parsed.session_id;
        }

        // Extract full text from result event
        if (parsed.type === 'result' && typeof parsed.result === 'string') {
          fullText = parsed.result;
          continue;
        }

        // Handle assistant partial messages (Claude CLI stream-json format)
        if (parsed.type === 'assistant' && parsed.message?.content) {
          const msgId = (parsed.message.id as string) || '';

          // New turn (new message ID) — reset per-turn trackers
          if (msgId && msgId !== lastMessageId) {
            lastMessageId = msgId;
            lastSeenText = '';
            seenToolCount = 0;
          }

          const content = parsed.message.content as Array<Record<string, unknown>>;

          // Extract text blocks and compute delta
          const textBlocks = content
            .filter((b) => b.type === 'text' && typeof b.text === 'string')
            .map((b) => b.text as string);

          if (textBlocks.length > 0) {
            const currentText = textBlocks.join('');
            if (currentText.length > lastSeenText.length) {
              const delta = currentText.slice(lastSeenText.length);
              lastSeenText = currentText;
              fullText += delta; // Append (not replace) to accumulate across turns
              options.io.emit(streamEvent, { type: 'text', text: delta });
            }
          }

          // Extract tool blocks (only emit new ones — reset per turn)
          const toolBlocks = content.filter((b) => b.type === 'tool_use' || b.type === 'tool_result');
          for (let i = seenToolCount; i < toolBlocks.length; i++) {
            const block = toolBlocks[i];
            if (block.type === 'tool_use') {
              const toolEvent = { type: 'tool_use' as const, tool: block.name as string, input: JSON.stringify(block.input || '') };
              toolEvents.push(toolEvent);
              options.io.emit(streamEvent, toolEvent);
            } else {
              const toolEvent = { type: 'tool_result' as const, content: typeof block.content === 'string' ? block.content : JSON.stringify(block.content || '') };
              toolEvents.push(toolEvent);
              options.io.emit(streamEvent, toolEvent);
            }
          }
          seenToolCount = toolBlocks.length;
          continue;
        }

        // Fallback: skip — the assistant handler above already handles text + tools
      } catch {
        // Not valid JSON, skip
      }
    }
  });

  proc.stderr!.on('data', (chunk: Buffer) => {
    stderrBuffer += chunk.toString();
  });

  proc.on('close', (code) => {
    clearInterval(timeoutInterval);
    activeProcesses.delete(options.pairId);

    console.log(`[callClaudeChat] close code=${code} fullText.length=${fullText.length} sessionId=${capturedSessionId}`);

    if (code === 0 || code === null) {
      options.onComplete(fullText, capturedSessionId);
    } else {
      const isRateLimit = stderrBuffer.includes('rate limit') || stderrBuffer.includes('429');
      options.io.emit(`error:${options.pairId}`, {
        message: stderrBuffer || `Process exited with code ${code}`,
        retryable: isRateLimit,
      });
      options.onError(stderrBuffer || `Exit code ${code}`);
    }
  });

  return proc;
}

function parseStreamEvent(data: unknown): StreamEvent | null {
  if (!data || typeof data !== 'object') return null;
  const d = data as Record<string, unknown>;

  // Handle content_block_delta with text_delta
  if (d.type === 'content_block_delta') {
    const delta = d.delta as Record<string, unknown> | undefined;
    if (delta?.type === 'text_delta' && typeof delta.text === 'string') {
      return { type: 'text', text: delta.text };
    }
  }

  // Handle assistant message with content (partial or complete)
  if (d.type === 'assistant' && d.message) {
    const msg = d.message as Record<string, unknown>;
    const content = msg.content;
    if (typeof content === 'string' && content) {
      return { type: 'text', text: content };
    }
    if (Array.isArray(content)) {
      const textBlocks = content
        .filter((b: unknown) => (b as Record<string, unknown>).type === 'text')
        .map((b: unknown) => (b as Record<string, unknown>).text as string);
      if (textBlocks.length > 0) {
        return { type: 'text', text: textBlocks.join('') };
      }
    }
  }

  // Handle final result/message — skip (already streamed)
  if (d.type === 'message' || d.type === 'result') {
    return null;
  }

  // Handle tool use
  if (d.type === 'content_block_start') {
    const block = d.content_block as Record<string, unknown> | undefined;
    if (block?.type === 'tool_use') {
      return {
        type: 'tool_use',
        tool: block.name as string,
        input: JSON.stringify(block.input || ''),
      };
    }
  }

  // Handle tool result
  if (d.type === 'tool_result' || d.subtype === 'tool_result') {
    return {
      type: 'tool_result',
      content: typeof d.content === 'string' ? d.content : JSON.stringify(d.content || ''),
    };
  }

  return null;
}

export async function runAnalysis(pair: Pair, io: SocketServer): Promise<void> {
  if (pair.left.messages.length === 0) throw new Error('No messages to analyze');

  const conversationText = pair.left.messages.map(m => {
    const label = m.role === 'user' ? 'UTILISATEUR' : 'EXPERT PRD';
    return `[${label}]\n${m.content}`;
  }).join('\n\n---\n\n');

  // Find and include any referenced files (PRD-*.md etc.)
  const referencedFiles = extractReferencedFileContents(pair.left.messages, pair.projectDir, pair.annexDirs);

  let prompt = `[CONVERSATION PRD COMPLETE]\n\n${conversationText}\n\n`;
  if (referencedFiles) {
    prompt += `---\n\n[FICHIERS REFERENCES DANS LA CONVERSATION]\n\n${referencedFiles}\n\n`;
  }
  prompt += `---\n\n[CONSIGNE]\nLa conversation ci-dessus contient les echanges PRD. Les fichiers references y sont inclus.\nAnalyse le PRD en profondeur. Donne tes commentaires structures : ce qui est bon, ce qui pose probleme, ce qui manque.\nTu peux aussi explorer le codebase avec Read/Glob/Grep pour verifier la faisabilite.\nNE CODE PAS. Ne modifie aucun fichier.`;

  pair.status = 'analyzing';
  pair.updatedAt = new Date().toISOString();
  savePair(pair);
  io.emit(`status:${pair.id}`, { status: 'analyzing' });

  const analysisOutput = await new Promise<string>((resolve, reject) => {
    callClaudeChat({
      cwd: pair.projectDir,
      annexDirs: pair.annexDirs,
      model: pair.right.agent.model,
      systemPrompt: 'Tu es un analyste technique senior. Le PRD complet t\'est fourni directement dans le message. Analyse-le en profondeur. Tu peux explorer le codebase pour verifier la faisabilite. NE CODE PAS, ne modifie aucun fichier.',
      allowedTools: ['Read', 'Glob', 'Grep'],
      prompt,
      sessionId: pair.right.sessionId,
      pairId: pair.id,
      socketEvent: `stream:right:${pair.id}`,
      io,
      onComplete: (fullText, sessionId) => {
        pair.right.sessionId = sessionId;
        resolve(fullText);
      },
      onError: reject,
    });
  });

  const analysisIndex = pair.right.analyses.length + 1;
  pair.right.analyses.push({
    index: analysisIndex,
    prdVersion: pair.left.messages.filter(m => m.role === 'assistant').length,
    output: analysisOutput,
  });
  saveRoundOutput(pair.id, 'right', `analysis-${analysisIndex}.md`, analysisOutput);

  pair.status = 'prd_done';
  pair.updatedAt = new Date().toISOString();
  savePair(pair);
  io.emit(`status:${pair.id}`, { status: 'prd_done' });
}

export async function runImplementation(pair: Pair, io: SocketServer): Promise<void> {
  if (pair.left.messages.length === 0) throw new Error('No PRD to implement');

  const lastAnalysis = pair.right.analyses[pair.right.analyses.length - 1];

  // Build full conversation for context
  const conversationText = pair.left.messages.map(m => {
    const label = m.role === 'user' ? 'UTILISATEUR' : 'EXPERT PRD';
    return `[${label}]\n${m.content}`;
  }).join('\n\n---\n\n');

  // Include referenced file contents
  const referencedFiles = extractReferencedFileContents(pair.left.messages, pair.projectDir, pair.annexDirs);

  let prompt = `[CONVERSATION PRD]\n\n${conversationText}\n\n`;
  if (referencedFiles) {
    prompt += `[FICHIERS REFERENCES]\n\n${referencedFiles}\n\n`;
  }
  if (lastAnalysis) {
    prompt += `[ANALYSE TECHNIQUE]\n${lastAnalysis.output}\n\n`;
  }
  prompt += `[CONSIGNE]\nImplemente le PRD decrit ci-dessus en entier. Enchaine toutes les phases sans t'arreter.\nVerifie le build quand tu as fini.`;

  pair.status = 'coding';
  pair.updatedAt = new Date().toISOString();
  savePair(pair);
  io.emit(`status:${pair.id}`, { status: 'coding' });

  const implOutput = await new Promise<string>((resolve, reject) => {
    callClaude({
      cwd: pair.projectDir,
      annexDirs: pair.annexDirs,
      model: pair.right.agent.model,
      systemPrompt: pair.right.agent.systemPrompt,
      useAppendSystemPrompt: true,
      allowedTools: ['Read', 'Glob', 'Grep', 'Edit', 'Write', 'Bash'],
      prompt,
      pairId: pair.id,
      socketEvent: `stream:right:${pair.id}`,
      eventMeta: { phase: 'implementation' },
      io,
      onComplete: resolve,
      onError: reject,
    });
  });

  pair.right.implementation = implOutput;
  saveRoundOutput(pair.id, 'right', 'implementation.md', implOutput);

  pair.status = 'done';
  pair.updatedAt = new Date().toISOString();
  savePair(pair);
  io.emit(`status:${pair.id}`, { status: 'done' });
}

export async function runAutoLoop(pair: Pair, io: SocketServer, rounds: number): Promise<void> {
  if (pair.left.messages.length === 0) throw new Error('No messages to analyze');

  for (let round = 1; round <= rounds; round++) {
    // Emit round info
    io.emit(`loop:${pair.id}`, { round, total: rounds, phase: 'analyzing' });

    // --- RIGHT: Analyze the full conversation (PRD + refinements) ---
    const conversationText = pair.left.messages.map(m => {
      const label = m.role === 'user' ? 'UTILISATEUR' : 'EXPERT PRD';
      return `[${label}]\n${m.content}`;
    }).join('\n\n---\n\n');

    // Include referenced file contents (PRD-*.md etc.)
    const referencedFiles = extractReferencedFileContents(pair.left.messages, pair.projectDir, pair.annexDirs);

    pair.status = 'analyzing';
    pair.updatedAt = new Date().toISOString();
    savePair(pair);
    io.emit(`status:${pair.id}`, { status: 'analyzing' });

    let loopPrompt = `[CONVERSATION PRD — Round ${round}/${rounds}]\n\n${conversationText}\n\n`;
    if (referencedFiles) {
      loopPrompt += `---\n\n[FICHIERS REFERENCES]\n\n${referencedFiles}\n\n`;
    }
    loopPrompt += `---\n\n[CONSIGNE]\nLa conversation et les fichiers references ci-dessus contiennent le PRD complet.\nAnalyse le PRD en profondeur : points forts, points a ameliorer, problemes potentiels, manques.\nTu peux aussi explorer le codebase pour verifier la coherence avec le code existant.\nNE CODE PAS.`;

    const analysisOutput = await new Promise<string>((resolve, reject) => {
      callClaudeChat({
        cwd: pair.projectDir,
        annexDirs: pair.annexDirs,
        model: pair.right.agent.model,
        systemPrompt: 'Tu es un analyste technique senior. Le PRD complet et les fichiers references te sont fournis dans le message. Analyse en profondeur. Tu peux explorer le codebase pour verifier la faisabilite. NE CODE PAS, ne modifie aucun fichier.',
        allowedTools: ['Read', 'Glob', 'Grep'],
        prompt: loopPrompt,
        sessionId: pair.right.sessionId,
        pairId: pair.id,
        socketEvent: `stream:right:${pair.id}`,
        io,
        onComplete: (fullText, sessionId) => {
          pair.right.sessionId = sessionId;
          resolve(fullText);
        },
        onError: reject,
      });
    });

    const analysisIndex = pair.right.analyses.length + 1;
    pair.right.analyses.push({
      index: analysisIndex,
      prdVersion: pair.left.messages.filter(m => m.role === 'assistant').length,
      output: analysisOutput,
    });
    saveRoundOutput(pair.id, 'right', `analysis-${analysisIndex}.md`, analysisOutput);

    // If last round, stop here (don't send back to left)
    if (round === rounds) {
      pair.status = 'prd_done';
      pair.updatedAt = new Date().toISOString();
      savePair(pair);
      io.emit(`status:${pair.id}`, { status: 'prd_done' });
      io.emit(`loop:${pair.id}`, { round, total: rounds, phase: 'done' });
      return;
    }

    // --- LEFT: Send analysis as feedback, get refined PRD ---
    io.emit(`loop:${pair.id}`, { round, total: rounds, phase: 'refining' });

    pair.status = 'chatting';
    pair.updatedAt = new Date().toISOString();
    savePair(pair);
    io.emit(`status:${pair.id}`, { status: 'chatting' });

    // Add the analysis as a "user" message in the left chat
    const feedbackMessage = {
      id: `loop-feedback-${round}-${Date.now()}`,
      role: 'user' as const,
      content: `[COMMENTAIRES DE L'ANALYSTE — Round ${round}/${rounds}]\n\n${analysisOutput}\n\n[CONSIGNE]\nPrend en compte ces commentaires et produis une version amelioree du PRD. Integre les corrections demandees.`,
      timestamp: new Date().toISOString(),
    };
    pair.left.messages.push(feedbackMessage);
    savePair(pair);

    const refinedPrd = await new Promise<string>((resolve, reject) => {
      callClaudeChat({
        cwd: pair.projectDir,
        annexDirs: pair.annexDirs,
        model: pair.left.agent.model,
        allowedTools: ['Read', 'Glob', 'Grep'],
        prompt: feedbackMessage.content,
        sessionId: pair.left.sessionId,
        systemPrompt: pair.left.agent.systemPrompt,
        pairId: pair.id,
        io,
        onComplete: (fullText, sessionId) => {
          pair.left.sessionId = sessionId;
          resolve(fullText);
        },
        onError: reject,
      });
    });

    // Save refined PRD as assistant message
    const assistantMessage = {
      id: `loop-refined-${round}-${Date.now()}`,
      role: 'assistant' as const,
      content: refinedPrd,
      timestamp: new Date().toISOString(),
    };
    pair.left.messages.push(assistantMessage);
    pair.updatedAt = new Date().toISOString();
    savePair(pair);
  }

  pair.status = 'prd_done';
  pair.updatedAt = new Date().toISOString();
  savePair(pair);
  io.emit(`status:${pair.id}`, { status: 'prd_done' });
}

/** Extract a score (X/10) from the critic/analysis output */
export function extractScore(text: string): number | null {
  // Match patterns like "9/10", "8.5/10", "Score : 7/10", "Score: 8,5/10"
  const patterns = [
    /score\s*(?:final|global|:)?\s*[:=]?\s*(\d+(?:[.,]\d+)?)\s*\/\s*10/gi,
    /(\d+(?:[.,]\d+)?)\s*\/\s*10/g,
  ];
  let lastScore: number | null = null;
  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(text)) !== null) {
      const score = parseFloat(match[1].replace(',', '.'));
      if (score >= 0 && score <= 10) {
        lastScore = score;
      }
    }
    if (lastScore !== null) return lastScore;
  }
  return lastScore;
}

const SCORING_MAX_ROUNDS = 10;
const SCORING_THRESHOLD = 9;

export async function runScoringLoop(pair: Pair, io: SocketServer): Promise<void> {
  if (pair.left.messages.length === 0) throw new Error('No messages to analyze');

  for (let round = 1; round <= SCORING_MAX_ROUNDS; round++) {
    const roundStartTime = Date.now();

    // Emit scoring round start
    io.emit(`scoring:${pair.id}`, { round, score: null, elapsed: 0, verdict: 'running' });
    io.emit(`loop:${pair.id}`, { round, total: SCORING_MAX_ROUNDS, phase: 'analyzing' });

    // --- RIGHT: Analyze the full conversation ---
    const conversationText = pair.left.messages.map(m => {
      const label = m.role === 'user' ? 'UTILISATEUR' : 'EXPERT PRD';
      return `[${label}]\n${m.content}`;
    }).join('\n\n---\n\n');

    const referencedFiles = extractReferencedFileContents(pair.left.messages, pair.projectDir, pair.annexDirs);

    pair.status = 'analyzing';
    pair.updatedAt = new Date().toISOString();
    savePair(pair);
    io.emit(`status:${pair.id}`, { status: 'analyzing' });

    let loopPrompt = `[CONVERSATION PRD — Scoring Round ${round}]\n\n${conversationText}\n\n`;
    if (referencedFiles) {
      loopPrompt += `---\n\n[FICHIERS REFERENCES]\n\n${referencedFiles}\n\n`;
    }
    loopPrompt += `---\n\n[CONSIGNE]\nAnalyse le PRD en profondeur : points forts, points a ameliorer, problemes potentiels, manques.\nTu peux explorer le codebase pour verifier la coherence avec le code existant.\nNE CODE PAS.\n\nIMPORTANT: Termine TOUJOURS ton analyse par un score global sur 10 au format exact:\nScore final : X/10\n\nUn score >= 9/10 signifie que le PRD est pret pour l'implementation.`;

    const analysisOutput = await new Promise<string>((resolve, reject) => {
      callClaudeChat({
        cwd: pair.projectDir,
        annexDirs: pair.annexDirs,
        model: pair.right.agent.model,
        systemPrompt: 'Tu es un analyste technique senior. Le PRD complet et les fichiers references te sont fournis dans le message. Analyse en profondeur. Tu peux explorer le codebase pour verifier la faisabilite. NE CODE PAS, ne modifie aucun fichier. Termine TOUJOURS par un score sur 10.',
        allowedTools: ['Read', 'Glob', 'Grep'],
        prompt: loopPrompt,
        sessionId: pair.right.sessionId,
        pairId: pair.id,
        socketEvent: `stream:right:${pair.id}`,
        io,
        onComplete: (fullText, sessionId) => {
          pair.right.sessionId = sessionId;
          resolve(fullText);
        },
        onError: reject,
      });
    });

    const analysisIndex = pair.right.analyses.length + 1;
    pair.right.analyses.push({
      index: analysisIndex,
      prdVersion: pair.left.messages.filter(m => m.role === 'assistant').length,
      output: analysisOutput,
    });
    saveRoundOutput(pair.id, 'right', `analysis-${analysisIndex}.md`, analysisOutput);

    // Parse the score
    const score = extractScore(analysisOutput);
    const roundElapsed = Math.floor((Date.now() - roundStartTime) / 1000);

    // Emit scoring result for this round
    const isReady = score !== null && score >= SCORING_THRESHOLD;
    io.emit(`scoring:${pair.id}`, {
      round,
      score,
      elapsed: roundElapsed,
      verdict: isReady ? 'ready' : (round === SCORING_MAX_ROUNDS ? 'max_rounds' : 'continue'),
    });

    // If score >= threshold, stop
    if (isReady) {
      pair.status = 'prd_done';
      pair.updatedAt = new Date().toISOString();
      savePair(pair);
      io.emit(`status:${pair.id}`, { status: 'prd_done' });
      io.emit(`loop:${pair.id}`, { round, total: round, phase: 'done' });
      return;
    }

    // If max rounds, stop
    if (round === SCORING_MAX_ROUNDS) {
      pair.status = 'prd_done';
      pair.updatedAt = new Date().toISOString();
      savePair(pair);
      io.emit(`status:${pair.id}`, { status: 'prd_done' });
      io.emit(`loop:${pair.id}`, { round, total: round, phase: 'done' });
      return;
    }

    // --- LEFT: Send analysis as feedback, get refined PRD ---
    io.emit(`loop:${pair.id}`, { round, total: SCORING_MAX_ROUNDS, phase: 'refining' });

    pair.status = 'chatting';
    pair.updatedAt = new Date().toISOString();
    savePair(pair);
    io.emit(`status:${pair.id}`, { status: 'chatting' });

    const feedbackMessage = {
      id: `scoring-feedback-${round}-${Date.now()}`,
      role: 'user' as const,
      content: `[COMMENTAIRES DE L'ANALYSTE — Scoring Round ${round}, Score: ${score ?? 'N/A'}/10]\n\n${analysisOutput}\n\n[CONSIGNE]\nPrend en compte ces commentaires et produis une version amelioree du PRD. Integre les corrections demandees. L'objectif est d'atteindre un score >= 9/10.`,
      timestamp: new Date().toISOString(),
    };
    pair.left.messages.push(feedbackMessage);
    savePair(pair);

    const refinedPrd = await new Promise<string>((resolve, reject) => {
      callClaudeChat({
        cwd: pair.projectDir,
        annexDirs: pair.annexDirs,
        model: pair.left.agent.model,
        allowedTools: ['Read', 'Glob', 'Grep'],
        prompt: feedbackMessage.content,
        sessionId: pair.left.sessionId,
        systemPrompt: pair.left.agent.systemPrompt,
        pairId: pair.id,
        io,
        onComplete: (fullText, sessionId) => {
          pair.left.sessionId = sessionId;
          resolve(fullText);
        },
        onError: reject,
      });
    });

    const assistantMessage = {
      id: `scoring-refined-${round}-${Date.now()}`,
      role: 'assistant' as const,
      content: refinedPrd,
      timestamp: new Date().toISOString(),
    };
    pair.left.messages.push(assistantMessage);
    pair.updatedAt = new Date().toISOString();
    savePair(pair);
  }

  pair.status = 'prd_done';
  pair.updatedAt = new Date().toISOString();
  savePair(pair);
  io.emit(`status:${pair.id}`, { status: 'prd_done' });
}

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}
