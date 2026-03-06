import { create } from 'zustand';
import { io, Socket } from 'socket.io-client';
import type { Pair, PairStatus, StreamEvent, Preset } from '../types/pair';

export type StreamItem =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; tool: string; input: string }
  | { type: 'tool_result'; content: string };

interface PairStore {
  pairs: Pair[];
  selectedPairId: string | null;
  presets: Preset[];
  socket: Socket | null;
  searchQuery: string;

  // Stream state — interleaved items
  leftStreamItems: StreamItem[];
  rightStreamItems: StreamItem[];
  rightStreamPhase: 'analysis' | 'implementation' | null;
  isStreaming: boolean;

  // Loop state
  loopRound: number;
  loopTotal: number;
  loopPhase: 'analyzing' | 'refining' | 'done' | null;

  // Error state
  errorMessage: string | null;
  errorRetryable: boolean;

  // Settings
  settings: { prdDir: string; defaultProjectDir: string; anthropicApiKey: string };

  // Actions
  init: () => void;
  fetchPairs: () => Promise<void>;
  fetchPresets: () => Promise<void>;
  fetchSettings: () => Promise<void>;
  updateSettings: (data: Record<string, string>) => Promise<void>;
  selectPair: (id: string | null) => void;
  createPair: (data: Record<string, unknown>) => Promise<Pair>;
  updatePair: (id: string, data: Record<string, unknown>) => Promise<void>;
  deletePair: (id: string) => Promise<void>;
  sendMessage: (id: string, text: string) => Promise<void>;
  resetChat: (id: string) => Promise<void>;
  stopPair: (id: string) => Promise<void>;
  pushRight: (id: string) => Promise<void>;
  pushLeft: (id: string) => Promise<void>;
  goCode: (id: string) => Promise<void>;
  autoLoop: (id: string, rounds: number) => Promise<void>;
  uploadAttachment: (id: string, file: File, panel: 'left' | 'right') => Promise<void>;
  deleteAttachment: (id: string, attachmentId: string) => Promise<void>;
  setSearchQuery: (query: string) => void;
  clearStreams: () => void;
  clearError: () => void;
}

/** Append a stream event to an items array, merging consecutive text items */
function appendStreamItem(items: StreamItem[], event: StreamEvent): StreamItem[] {
  const next = [...items];
  if (event.type === 'text' && event.text) {
    const last = next[next.length - 1];
    if (last && last.type === 'text') {
      // Merge into last text item
      next[next.length - 1] = { type: 'text', text: last.text + event.text };
    } else {
      next.push({ type: 'text', text: event.text });
    }
  } else if (event.type === 'tool_use') {
    next.push({ type: 'tool_use', tool: event.tool || '', input: event.input || '' });
  } else if (event.type === 'tool_result') {
    next.push({ type: 'tool_result', content: event.content || '' });
  }
  return next;
}

const API = '/api';

export const usePairStore = create<PairStore>((set, get) => ({
  pairs: [],
  selectedPairId: null,
  presets: [],
  socket: null,
  searchQuery: '',
  leftStreamItems: [],
  rightStreamItems: [],
  rightStreamPhase: null,
  isStreaming: false,
  loopRound: 0,
  loopTotal: 0,
  loopPhase: null,
  errorMessage: null,
  errorRetryable: false,
  settings: { prdDir: '', defaultProjectDir: '', anthropicApiKey: '' },

  init: () => {
    // Request notification permission
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission();
    }

    const socket = io({ transports: ['websocket'] });
    set({ socket });

    // Re-fetch pairs on reconnect (backend resets active→stopped on restart)
    socket.on('connect', () => {
      get().fetchPairs();
      set({ leftStreamItems: [], rightStreamItems: [], isStreaming: false });
    });

    socket.onAny((event: string, data: StreamEvent & { status?: PairStatus; message?: string; retryable?: boolean; phase?: string }) => {
      const selectedId = get().selectedPairId;
      if (!selectedId) return;

      if (event === `stream:left:${selectedId}`) {
        set(s => ({
          leftStreamItems: appendStreamItem(s.leftStreamItems, data),
          isStreaming: true,
        }));
      }

      if (event === `stream:right:${selectedId}`) {
        set(s => ({
          rightStreamItems: appendStreamItem(s.rightStreamItems, data),
          rightStreamPhase: (data.phase as 'analysis' | 'implementation') || s.rightStreamPhase,
          isStreaming: true,
        }));
      }

      if (event === `status:${selectedId}`) {
        const newStatus = data.status!;
        set(s => ({
          pairs: s.pairs.map(p => p.id === selectedId ? { ...p, status: newStatus } : p),
          isStreaming: ['chatting', 'analyzing', 'coding'].includes(newStatus),
        }));
        // Fetch on chatting too so the user message appears immediately
        if (newStatus === 'chatting' || newStatus === 'analyzing' || newStatus === 'coding') {
          get().fetchPairs();
        }
        if (['prd_done', 'done', 'error', 'stopped', 'idle'].includes(newStatus)) {
          get().fetchPairs();
          if (newStatus === 'prd_done' || newStatus === 'idle') {
            set({ leftStreamItems: [] });
          }
          // macOS notification when a panel finishes
          if ('Notification' in window && Notification.permission === 'granted') {
            const pair = get().pairs.find(p => p.id === selectedId);
            const leftName = pair?.left.agent.name || 'Expert PRD';
            const rightName = pair?.right.agent.name || 'Codeur';
            if (newStatus === 'prd_done') {
              new Notification(`${leftName} a termine`, { body: `Paire "${pair?.name}"` });
            } else if (newStatus === 'done') {
              new Notification(`${rightName} a termine`, { body: `Paire "${pair?.name}"` });
            } else if (newStatus === 'error') {
              new Notification('ClaudeDuo — Erreur', { body: `Paire "${pair?.name}"` });
            }
          }
        }
      }

      if (event === `loop:${selectedId}`) {
        const loopData = data as unknown as { round: number; total: number; phase: string };
        set({
          loopRound: loopData.round,
          loopTotal: loopData.total,
          loopPhase: loopData.phase as 'analyzing' | 'refining' | 'done',
        });
        if (loopData.phase === 'analyzing') {
          set({ rightStreamItems: [] });
        } else if (loopData.phase === 'refining') {
          set({ leftStreamItems: [] });
        } else if (loopData.phase === 'done') {
          set({ loopPhase: null, loopRound: 0, loopTotal: 0 });
          get().fetchPairs();
          if ('Notification' in window && Notification.permission === 'granted') {
            const pair = get().pairs.find(p => p.id === selectedId);
            new Notification('ClaudeDuo - Boucle terminee', {
              body: `${pair?.name || 'Paire'}: ${loopData.total} rounds termines.`,
            });
          }
        }
      }

      if (event === `error:${selectedId}`) {
        set({ errorMessage: data.message || 'Unknown error', errorRetryable: data.retryable || false });
      }
    });

    get().fetchPairs();
    get().fetchPresets();
    get().fetchSettings();
  },

  fetchPairs: async () => {
    const res = await fetch(`${API}/pairs`);
    const pairs: Pair[] = await res.json();
    pairs.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
    set({ pairs });
  },

  fetchPresets: async () => {
    const res = await fetch(`${API}/presets`);
    const presets = await res.json();
    set({ presets });
  },

  selectPair: (id) => {
    set({
      selectedPairId: id,
      leftStreamItems: [],
      rightStreamItems: [],
      rightStreamPhase: null,
      isStreaming: false,
      loopRound: 0,
      loopTotal: 0,
      loopPhase: null,
      errorMessage: null,
    });
  },

  createPair: async (data) => {
    const res = await fetch(`${API}/pairs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    const pair = await res.json();
    if (!res.ok) throw new Error(pair.error);
    await get().fetchPairs();
    return pair;
  },

  updatePair: async (id, data) => {
    const res = await fetch(`${API}/pairs/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error);
    }
    await get().fetchPairs();
  },

  deletePair: async (id) => {
    await fetch(`${API}/pairs/${id}`, { method: 'DELETE' });
    set(s => ({
      pairs: s.pairs.filter(p => p.id !== id),
      selectedPairId: s.selectedPairId === id ? null : s.selectedPairId,
    }));
  },

  sendMessage: async (id, text) => {
    set({ leftStreamItems: [], errorMessage: null });
    await fetch(`${API}/pairs/${id}/send-message`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });
  },

  resetChat: async (id) => {
    set({ leftStreamItems: [], errorMessage: null });
    await fetch(`${API}/pairs/${id}/reset-chat`, { method: 'POST' });
    await get().fetchPairs();
  },

  stopPair: async (id) => {
    await fetch(`${API}/pairs/${id}/stop`, { method: 'POST' });
  },

  pushRight: async (id) => {
    set({ rightStreamItems: [], rightStreamPhase: 'analysis', errorMessage: null });
    await fetch(`${API}/pairs/${id}/push-right`, { method: 'POST' });
  },

  pushLeft: async (id) => {
    set({ leftStreamItems: [], errorMessage: null });
    await fetch(`${API}/pairs/${id}/push-left`, { method: 'POST' });
  },

  goCode: async (id) => {
    set({ rightStreamItems: [], rightStreamPhase: 'implementation' });
    await fetch(`${API}/pairs/${id}/go-code`, { method: 'POST' });
  },

  autoLoop: async (id, rounds) => {
    set({
      leftStreamItems: [],
      rightStreamItems: [], rightStreamPhase: 'analysis',
      loopRound: 1, loopTotal: rounds, loopPhase: 'analyzing',
      errorMessage: null,
    });
    await fetch(`${API}/pairs/${id}/auto-loop`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rounds }),
    });
  },

  uploadAttachment: async (id, file, panel) => {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('panel', panel);
    await fetch(`${API}/pairs/${id}/attachments`, {
      method: 'POST',
      body: formData,
    });
    await get().fetchPairs();
  },

  deleteAttachment: async (id, attachmentId) => {
    await fetch(`${API}/pairs/${id}/attachments/${attachmentId}`, { method: 'DELETE' });
    await get().fetchPairs();
  },

  setSearchQuery: (query) => set({ searchQuery: query }),

  clearStreams: () => set({
    leftStreamItems: [],
    rightStreamItems: [],
    rightStreamPhase: null,
    errorMessage: null,
  }),

  clearError: () => set({ errorMessage: null, errorRetryable: false }),

  fetchSettings: async () => {
    const res = await fetch(`${API}/settings`);
    const settings = await res.json();
    set({ settings });
  },

  updateSettings: async (data) => {
    const res = await fetch(`${API}/settings`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    const settings = await res.json();
    set({ settings });
  },
}));
