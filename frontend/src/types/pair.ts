export type PairStatus =
  | 'idle'
  | 'chatting'
  | 'prd_done'
  | 'analyzing'
  | 'coding'
  | 'done'
  | 'error'
  | 'stopped';

export type AgentModel = 'sonnet' | 'opus';

export interface AgentConfig {
  name: string;
  systemPrompt: string;
  model: AgentModel;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
  toolEvents?: { type: string; tool?: string; input?: string; content?: string }[];
}

export interface Analysis {
  index: number;
  prdVersion: number;
  output: string;
}

export interface Attachment {
  id: string;
  filename: string;
  storedName?: string;
  path: string;
  mimeType: string;
}

export interface Pair {
  id: string;
  name: string;
  topic: string;
  createdAt: string;
  updatedAt: string;
  projectDir: string;
  annexDirs: string[];
  status: PairStatus;

  left: {
    agent: AgentConfig;
    messages: ChatMessage[];
    sessionId: string | null;
    attachments: Attachment[];
  };

  right: {
    agent: AgentConfig;
    analyses: Analysis[];
    implementation: string | null;
    attachments: Attachment[];
  };
}

export interface Preset {
  name: string;
  label: string;
  agent: AgentConfig;
}

export interface StreamEvent {
  type: 'text' | 'tool_use' | 'tool_result';
  text?: string;
  tool?: string;
  input?: string;
  content?: string;
  phase?: 'analysis' | 'implementation';
}
