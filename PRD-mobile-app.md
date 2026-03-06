# PRD — ClaudeDuo Mobile (Expo / React Native) v12

## Mise en contexte complète

### Qu'est-ce que ClaudeDuo ?

ClaudeDuo est une application web locale qui orchestre deux agents Claude AI pour collaborer sur des tâches de développement logiciel. L'application se compose de :

- **Panneau gauche (Chat)** : Un chat interactif avec un agent Claude spécialisé (Expert PRD, Architecture, Code Review, etc.). L'utilisateur discute pour affiner un PRD (Product Requirements Document). L'agent peut explorer le codebase via les outils Read, Glob, Grep.
- **Panneau droit (Implementation)** : Reçoit le PRD validé, lance une analyse du codebase, puis une implémentation complète avec accès aux outils d'édition (Read, Glob, Grep, Edit, Write, Bash).
- **Sidebar** : Liste des "paires" (sessions de travail), chacune liée à un projet/dossier local.

### Architecture technique actuelle

```
Frontend (React 19 + Vite)          Backend (Express + Socket.IO)
port 5174                           port 3001
┌─────────────────────┐             ┌──────────────────────────┐
│ Zustand Store        │◄──WS──────►│ Socket.IO Server          │
│ pairStore.ts         │            │                           │
│                      │──HTTP─────►│ REST API (/api/pairs/...) │
│ Components:          │            │                           │
│ - Sidebar            │            │ claudeService.ts          │
│ - LeftPanel (chat)   │            │ ├─ callClaudeChat()       │
│ - RightPanel (impl)  │            │ ├─ callClaude()           │
│ - PairForm           │            │ ├─ runAnalysis()          │
│ - AttachmentZone     │            │ ├─ runImplementation()    │
│ - ToolEventBlock     │            │ └─ runAutoLoop()          │
│ - InlineToolEvent    │            │                           │
│ - MarkdownRenderer   │            │ storageService.ts         │
│ - TokenGauge         │            │ └─ ~/.claude-duo/sessions/│
│ - ActivityIndicator  │            │                           │
└─────────────────────┘             │ settingsService.ts        │
                                    │ └─ ~/.claude-duo/settings │
                                    └──────────────────────────┘
                                           │
                                           ▼
                                    Claude CLI (spawn)
                                    claude -p --output-format stream-json
                                    --resume SESSION_ID
                                    --model opus/sonnet
                                    --allowedTools Read,Glob,Grep,...
```

### Stack actuelle
- **Frontend** : React 19, TypeScript, Tailwind CSS v4, Zustand, Socket.IO Client, Vite (port 5174)
- **Backend** : Express, TypeScript, Socket.IO, tsx (dev runner), port 3001
- **Stockage** : Fichiers JSON sur disque (`~/.claude-duo/sessions/{pairId}/pair.json`) + settings (`~/.claude-duo/settings.json`)
- **CLI** : Claude Code CLI (`claude` command) — spawn de processus Node.js

### Types clés

```typescript
type PairStatus = 'idle' | 'chatting' | 'prd_done' | 'analyzing' | 'coding' | 'done' | 'error' | 'stopped';
type AgentModel = 'sonnet' | 'opus';

interface AgentConfig {
  name: string;
  systemPrompt: string;
  model: AgentModel;
}

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
  toolEvents?: { type: string; tool?: string; input?: string; content?: string }[];
}

interface Analysis {
  index: number;
  prdVersion: number;
  output: string;
}

interface Attachment {
  id: string;
  filename: string;
  storedName?: string;
  path: string;
  mimeType: string;
}

interface Pair {
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

// Type de streaming interleaved (critique pour l'affichage)
type StreamItem =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; tool: string; input: string }
  | { type: 'tool_result'; content: string };

// Event reçu via Socket.IO
interface StreamEvent {
  type: 'text' | 'tool_use' | 'tool_result';
  text?: string;
  tool?: string;
  input?: string;
  content?: string;
  phase?: 'analysis' | 'implementation';
}

interface AppSettings {
  prdDir: string;
  defaultProjectDir: string;
  anthropicApiKey: string;
}
```

### API REST existante (complète)

| Méthode | Endpoint | Description |
|---------|----------|-------------|
| GET | `/api/pairs` | Liste toutes les paires |
| POST | `/api/pairs` | Créer une paire |
| GET | `/api/pairs/:id` | Détail d'une paire |
| PATCH | `/api/pairs/:id` | Modifier une paire |
| DELETE | `/api/pairs/:id` | Supprimer une paire |
| POST | `/api/pairs/:id/send-message` | Envoyer un message chat |
| POST | `/api/pairs/:id/reset-chat` | Réinitialiser le chat |
| POST | `/api/pairs/:id/stop` | Arrêter le processus en cours |
| POST | `/api/pairs/:id/push-right` | Lancer l'analyse du PRD |
| POST | `/api/pairs/:id/push-left` | Renvoyer l'analyse au chat pour raffinement |
| POST | `/api/pairs/:id/go-code` | Lancer l'implémentation |
| POST | `/api/pairs/:id/auto-loop` | Boucle auto analyse/raffinement (body: `{ rounds: 1-5 }`) |
| POST | `/api/pairs/:id/attachments` | Upload fichier (multipart, panel: left\|right) |
| DELETE | `/api/pairs/:id/attachments/:aid` | Supprimer fichier |
| GET | `/api/presets` | Liste des presets agents |
| GET | `/api/pairs/:id/tokens` | Estimation tokens |
| GET | `/api/settings` | Charger les settings (API key masquée) |
| PUT | `/api/settings` | Modifier les settings |
| GET | `/api/health` | Health check (à ajouter, voir Phase 1.3) |
| POST | `/api/register-push-token` | Enregistrer un push token Expo (à ajouter, voir Phase 4) |

### WebSocket events existants (complets)

| Event | Direction | Payload |
|-------|-----------|---------|
| `stream:left:${pairId}` | Server→Client | `StreamEvent` (type: text/tool_use/tool_result) |
| `stream:right:${pairId}` | Server→Client | `StreamEvent` + `phase: 'analysis' \| 'implementation'` |
| `status:${pairId}` | Server→Client | `{ status: PairStatus }` |
| `error:${pairId}` | Server→Client | `{ message: string, retryable: boolean }` |
| `loop:${pairId}` | Server→Client | `{ round: number, total: number, phase: 'analyzing' \| 'refining' \| 'done' }` |

### Fichiers clés à consulter

| Fichier | Rôle |
|---------|------|
| `backend/src/index.ts` | Serveur Express + Socket.IO, CORS, chargement paires |
| `backend/src/routes/pairRoutes.ts` | Tous les endpoints REST |
| `backend/src/services/claudeService.ts` | Spawn CLI, parsing stream-json, gestion sessions, autoLoop |
| `backend/src/services/storageService.ts` | Persistance JSON sur disque |
| `backend/src/services/settingsService.ts` | Settings (prdDir, defaultProjectDir, apiKey) |
| `backend/src/services/presets.ts` | 5 presets agents prédéfinis |
| `backend/src/types/pair.ts` | Types TypeScript partagés |
| `frontend/src/stores/pairStore.ts` | Store Zustand, Socket.IO, StreamItem[], loop state |
| `frontend/src/components/LeftPanel.tsx` | Chat interactif, streaming interleaved, loop display |
| `frontend/src/components/RightPanel.tsx` | Analyse + implémentation, streaming, phase indicator |
| `frontend/src/components/Sidebar.tsx` | Liste paires, recherche, badges, PRD version |
| `frontend/src/components/ToolEventBlock.tsx` | Affichage tool events (messages complètes) |
| `frontend/src/components/InlineToolEvent.tsx` | Affichage tool events (streaming en cours) |
| `frontend/src/components/MarkdownRenderer.tsx` | Rendu Markdown GFM |
| `frontend/src/components/TokenGauge.tsx` | Barre visuelle tokens |
| `frontend/src/components/ActivityIndicator.tsx` | Timer elapsed mm:ss + indicateur pulsant |
| `frontend/src/types/pair.ts` | Types frontend (miroir backend + StreamEvent) |

### Contraintes d'infrastructure

- **Le backend tourne sur le Mac de l'utilisateur** : Le Claude CLI est installé localement, les projets sont des dossiers locaux.
- **L'app mobile doit se connecter au Mac via réseau local** : WiFi (même réseau) ou tunnel (ngrok/Tailscale).
- **Une seule paire active à la fois** : Le backend bloque si une autre paire est déjà en status `chatting`, `analyzing`, ou `coding`.
- **Le backend écoute sur `localhost`** : Par défaut, il faut modifier pour écouter sur `0.0.0.0` pour accepter les connexions réseau local. Le firewall macOS peut aussi bloquer les connexions entrantes.

---

## Objectif

Créer une **application mobile iOS** (React Native / Expo) qui se connecte au backend ClaudeDuo existant sur le Mac de l'utilisateur, permettant de :

1. Consulter et gérer ses paires depuis son iPhone
2. Chatter avec l'agent PRD (panneau gauche) en temps réel
3. Lancer l'analyse, l'implémentation, et la boucle auto (panneau droit)
4. Renvoyer l'analyse au chat pour raffinement (push-left)
5. Recevoir des **notifications push** quand Claude finit une réponse
6. Voir le streaming en temps réel (texte + outils interleaved)
7. Envoyer des photos depuis la caméra/galerie

---

## Phase 1 — Projet Expo + Connexion au backend

### 1.1 Initialisation du projet

Créer un nouveau projet Expo dans `/Users/thomasleguendekergolan/Documents/claude-duo/mobile/` :

```
mobile/
├── app.json
├── package.json
├── tsconfig.json
├── App.tsx
├── src/
│   ├── stores/
│   │   └── pairStore.ts        (Zustand, fidèle au web)
│   ├── types/
│   │   └── pair.ts             (copie exacte des types web + StreamItem)
│   ├── services/
│   │   └── api.ts              (fetch + socket.io config + reconnexion)
│   ├── screens/
│   │   ├── PairListScreen.tsx   (liste des paires)
│   │   ├── PairDetailScreen.tsx (chat + impl tabs)
│   │   ├── ChatScreen.tsx       (panneau gauche mobile)
│   │   ├── ImplScreen.tsx       (panneau droit mobile)
│   │   ├── CreatePairScreen.tsx (formulaire création)
│   │   └── SettingsScreen.tsx   (URL backend, settings app, notifications)
│   ├── components/
│   │   ├── ChatBubble.tsx       (bulle message user/assistant)
│   │   ├── StreamItemList.tsx   (rendu streaming interleaved)
│   │   ├── MarkdownView.tsx     (rendu markdown RN)
│   │   ├── InlineToolEvent.tsx  (tool_use/tool_result collapsible inline)
│   │   ├── ToolEventCard.tsx    (tool events dans messages complètes)
│   │   ├── StatusBadge.tsx      (badge coloré par status)
│   │   ├── TokenBar.tsx         (gauge tokens)
│   │   ├── ConnectionBanner.tsx (bandeau état connexion)
│   │   ├── ActivityTimer.tsx    (timer elapsed mm:ss)
│   │   ├── LoopProgress.tsx     (affichage round N/M + phase)
│   │   └── FolderPicker.tsx     (navigateur dossiers via API)
│   ├── navigation/
│   │   └── AppNavigator.tsx     (React Navigation bottom tabs + stacks)
│   └── theme/
│       └── colors.ts            (thème sombre identique au web)
```

### 1.2 Configuration réseau et reconnexion

L'app mobile doit pouvoir se connecter au backend Mac et gérer les déconnexions gracieusement.

```typescript
// src/services/api.ts
import AsyncStorage from '@react-native-async-storage/async-storage';
import { io, Socket } from 'socket.io-client';

const DEFAULT_URL = 'http://192.168.1.X:3001';

export async function getBackendUrl(): Promise<string> {
  return (await AsyncStorage.getItem('backendUrl')) || DEFAULT_URL;
}

export async function setBackendUrl(url: string): Promise<void> {
  await AsyncStorage.setItem('backendUrl', url);
}

export async function getAuthToken(): Promise<string | null> {
  return AsyncStorage.getItem('authToken');
}

export async function setAuthToken(token: string): Promise<void> {
  await AsyncStorage.setItem('authToken', token);
}

// Headers pour toutes les requêtes fetch
export async function authHeaders(): Promise<Record<string, string>> {
  const token = await getAuthToken();
  return token ? { 'Authorization': `Bearer ${token}` } : {};
}

// Créer un socket avec stratégie de reconnexion adaptée au mobile
export function createSocket(url: string, token: string | null): Socket {
  return io(url, {
    reconnection: true,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 10000,
    reconnectionAttempts: Infinity,
    timeout: 5000,
    transports: ['websocket'],   // Pas de polling HTTP, direct WebSocket
    auth: token ? { token } : {},
  });
}
```

### 1.3 Modifications backend

#### CORS — Accepter les connexions réseau local

**Fichier** : `backend/src/index.ts`

```typescript
// Remplacer la whitelist stricte par origin: true
// Sécurisé par le token d'authentification (voir Phase 1.4)
app.use(cors({ origin: true }));

const io = new SocketServer(httpServer, {
  cors: { origin: true },
});
```

#### Écouter sur 0.0.0.0 (pas seulement localhost)

```typescript
// Avant
httpServer.listen(PORT, () => { ... });

// Après — écouter sur toutes les interfaces réseau
httpServer.listen(PORT, '0.0.0.0', () => { ... });
```

#### Endpoint health check

```typescript
// Dans pairRoutes.ts — endpoint léger pour tester la connexion
router.get('/health', (_req, res) => {
  res.json({ ok: true, timestamp: Date.now() });
});
```

### 1.4 Authentification par token partagé

Le backend est exposé sur le réseau local (et potentiellement via tunnel ngrok/Tailscale). Une authentification minimale est nécessaire pour empêcher des accès non autorisés.

#### Backend — Middleware d'authentification

**Nouveau fichier** : `backend/src/middleware/auth.ts`

```typescript
import { loadSettings } from '../services/settingsService';

// Le token est stocké dans settings.json (nouveau champ: accessToken)
// Si pas de token configuré, l'auth est désactivée (comportement actuel)
export function authMiddleware(req, res, next) {
  const settings = loadSettings();
  if (!settings.accessToken) return next(); // Pas de token = pas d'auth

  const token = req.headers['authorization']?.replace('Bearer ', '');
  if (token === settings.accessToken) return next();

  res.status(401).json({ error: 'Unauthorized' });
}
```

**Intégration** dans `index.ts` :
```typescript
import { authMiddleware } from './middleware/auth';

// Appliquer à toutes les routes /api sauf /api/health
app.use('/api', (req, res, next) => {
  if (req.path === '/health') return next();
  authMiddleware(req, res, next);
});
```

**Socket.IO** — Authentification à la connexion :
```typescript
io.use((socket, next) => {
  const settings = loadSettings();
  if (!settings.accessToken) return next();

  const token = socket.handshake.auth?.token;
  if (token === settings.accessToken) return next();

  next(new Error('Unauthorized'));
});
```

#### Configuration du token

- **Backend** : Ajout du champ `accessToken` dans `AppSettings`. Configurable via `PUT /api/settings` (depuis le web) ou directement dans `~/.claude-duo/settings.json`.
- **Mobile** : Saisie dans SettingsScreen, stocké dans AsyncStorage.
- **Web** : Le frontend web existant continue de fonctionner sans token (localhost est toujours autorisé, ou le token est optionnel).

---

## Phase 2 — Écrans principaux

### 2.1 PairListScreen (équivalent Sidebar)

Liste scrollable des paires avec :
- Nom de la paire
- Status badge coloré (idle=gris, chatting=bleu pulsé, prd_done=vert, analyzing=violet pulsé, coding=orange pulsé, done=vert plein, error=rouge, stopped=jaune)
- Nombre de messages chat + version PRD (extrait du nombre de réponses assistant)
- Date de dernière mise à jour
- Swipe-to-delete avec confirmation (code de sécurité `1234` comme le web)
- Bouton "+" en haut à droite pour créer
- Pull-to-refresh
- **Barre de recherche** en haut (filtre sur nom + topic, comme le web)

**Navigation** : Tap sur une paire → PairDetailScreen

### 2.2 PairDetailScreen (layout principal)

Deux onglets (Material Top Tabs avec swipe) :
- **Chat** (panneau gauche) — onglet par défaut
- **Implementation** (panneau droit)

Header affiche :
- Nom de la paire
- Status badge
- Bouton Stop (si en cours)
- **Loop progress** : "Round 2/3 - Analyse..." (si boucle auto active)
- ActivityTimer (elapsed mm:ss quand streaming actif)

### 2.3 ChatScreen (panneau gauche mobile)

Interface chat complète :
- **Message list** (FlatList inversé) :
  - Messages user : bulle droite, fond accent/20
  - Messages assistant : bulle gauche, rendu Markdown
  - Tool events collapsibles dans chaque message (comme `ToolEventBlock` web)
  - **Streaming en temps réel** : Composant `StreamItemList` qui rend les `StreamItem[]` de manière interleaved (texte, tool_use, tool_result entrecroisés)
  - Spinner "Réflexion en cours..." quand status `chatting` mais pas encore de stream items
- **Input bar** (bas de l'écran, au-dessus du clavier via `KeyboardAvoidingView`) :
  - TextInput multiligne (max 6 lignes visibles)
  - Bouton Send (ou Stop si en cours)
  - Bouton photo (caméra ou galerie pour attachment)
- **Token gauge** discret en haut
- **Boutons workflow** en haut :
  - "Push PRD →" (lance push-right, grisé si pas en prd_done/idle)
  - "Boucle auto" avec sélecteur rounds 1-5

**`KeyboardAvoidingView`** : Utiliser `behavior="padding"` sur iOS avec `keyboardVerticalOffset` calculé incluant le header de navigation.

### 2.4 ImplScreen (panneau droit mobile)

Affiche :
- **Boutons d'action en haut** :
  - "Analyser" (push-right) — lance l'analyse
  - "GO CODER" (go-code) — lance l'implémentation
  - "← Renvoyer au Chat" (push-left) — renvoie l'analyse au chat pour raffinement
  - "Boucle auto" avec sélecteur rounds 1-5
  - "Stop" (si en cours)
- **Phase indicator** : Badge "Analyse" (violet) ou "Implémentation" (vert) pendant le streaming
- **Streaming en temps réel** : `StreamItemList` identique au chat (interleaved)
- **Liste des analyses passées** (collapsibles, numérotées)
- **Implémentation** (si disponible, rendu Markdown)

### 2.5 CreatePairScreen

Formulaire :
- Nom (TextInput)
- Sujet/Topic (TextInput multiligne)
- Project Dir : **FolderPicker** (voir composant 5.7) — pré-rempli avec `settings.defaultProjectDir`
- Annex Dirs (liste éditable, chaque entrée avec FolderPicker)
- Preset selector (dropdown avec les 5 presets : prd_chat, architecture, code_review, redaction, custom)
- Agent config avancée (section collapsible) : nom, systemPrompt, model (sonnet/opus)

### 2.6 SettingsScreen

Deux sections :

**Connexion :**
- **URL du backend** : TextInput avec bouton "Tester la connexion"
  - Appelle `GET /api/health` et affiche OK/Erreur avec latence
- **Token d'accès** : TextInput sécurisé (masqué) pour le token d'authentification

**Settings backend** (chargés depuis `GET /api/settings`) :
- **Default Project Dir** : TextInput (modifiable)
- **PRD Dir** : TextInput (modifiable)
- **Clé API Anthropic** : TextInput sécurisé (affiche masqué `****XXXX`)
- Bouton "Sauvegarder" → `PUT /api/settings`

**Notifications :**
- Toggle on/off pour les push notifications
- Status actuel (autorisé/refusé/pas demandé)

**Thème** : Toujours sombre pour v1 (comme le web).

---

## Phase 3 — Store Zustand mobile

Le store est fidèle au web, avec le modèle **StreamItem[] interleaved** et le **loop state**.

```typescript
// src/stores/pairStore.ts
import { create } from 'zustand';
import { io, Socket } from 'socket.io-client';
import { getBackendUrl, getAuthToken, createSocket, authHeaders } from '../services/api';

// Fonction de merge des text items consécutifs (identique au web)
function appendStreamItem(items: StreamItem[], newItem: StreamItem): StreamItem[] {
  if (newItem.type === 'text' && items.length > 0) {
    const last = items[items.length - 1];
    if (last.type === 'text') {
      return [...items.slice(0, -1), { type: 'text', text: last.text + newItem.text }];
    }
  }
  return [...items, newItem];
}

interface MobilePairStore {
  // --- Pair state ---
  pairs: Pair[];
  selectedPairId: string | null;
  presets: Preset[];
  searchQuery: string;

  // --- Connection state ---
  socket: Socket | null;
  backendUrl: string;
  isConnected: boolean;
  isReconnecting: boolean;

  // --- Stream state (modèle interleaved, identique au web) ---
  leftStreamItems: StreamItem[];
  rightStreamItems: StreamItem[];
  rightStreamPhase: 'analysis' | 'implementation' | null;
  isStreaming: boolean;

  // --- Loop state (boucle auto) ---
  loopRound: number;
  loopTotal: number;
  loopPhase: 'analyzing' | 'refining' | 'done' | null;

  // --- Error state ---
  errorMessage: string | null;
  errorRetryable: boolean;

  // --- Settings ---
  settings: AppSettings;

  // --- Actions ---
  init: () => Promise<void>;
  fetchPairs: () => Promise<void>;
  fetchPresets: () => Promise<void>;
  fetchSettings: () => Promise<void>;
  updateSettings: (data: Partial<AppSettings>) => Promise<void>;
  setSearchQuery: (query: string) => void;
  selectPair: (id: string | null) => void;
  createPair: (data: CreatePairData) => Promise<Pair>;
  updatePair: (id: string, data: Partial<Pair>) => Promise<void>;
  deletePair: (id: string) => Promise<void>;
  sendMessage: (id: string, text: string) => Promise<void>;
  resetChat: (id: string) => Promise<void>;
  stopPair: (id: string) => Promise<void>;
  pushRight: (id: string) => Promise<void>;
  pushLeft: (id: string) => Promise<void>;
  goCode: (id: string) => Promise<void>;
  autoLoop: (id: string, rounds: number) => Promise<void>;
  uploadAttachment: (id: string, uri: string, fileName: string, mimeType: string, panel: 'left' | 'right') => Promise<void>;
  deleteAttachment: (id: string, attachmentId: string) => Promise<void>;
  clearStreams: () => void;
  clearError: () => void;
  setBackendUrl: (url: string) => Promise<void>;
}
```

### Socket event listeners (fidèles au web)

```typescript
// À l'intérieur de init() après création du socket :

socket.on('connect', () => {
  set({ isConnected: true, isReconnecting: false });
  get().fetchPairs();
  get().clearStreams();
});

socket.on('disconnect', () => {
  set({ isConnected: false });
});

socket.on('reconnect_attempt', () => {
  set({ isReconnecting: true });
});

socket.on('reconnect_failed', () => {
  set({ isReconnecting: false, isConnected: false });
});

// Pour chaque paire sélectionnée, écouter :

// stream:left — interleaved StreamItem
socket.on(`stream:left:${pairId}`, (event: StreamEvent) => {
  const item = streamEventToItem(event);
  if (!item) return;
  set(s => ({ leftStreamItems: appendStreamItem(s.leftStreamItems, item), isStreaming: true }));
});

// stream:right — interleaved StreamItem + phase
socket.on(`stream:right:${pairId}`, (event: StreamEvent) => {
  const item = streamEventToItem(event);
  if (!item) return;
  set(s => ({
    rightStreamItems: appendStreamItem(s.rightStreamItems, item),
    rightStreamPhase: event.phase || s.rightStreamPhase,
    isStreaming: true,
  }));
});

// status — transitions d'état
socket.on(`status:${pairId}`, ({ status }) => {
  if (['chatting', 'analyzing', 'coding'].includes(status)) {
    set({ isStreaming: true });
    get().fetchPairs();
  }
  if (['prd_done', 'idle'].includes(status)) {
    set({ leftStreamItems: [], isStreaming: false });
    get().fetchPairs();
  }
  if (['done', 'error', 'stopped'].includes(status)) {
    set({ isStreaming: false });
    get().fetchPairs();
  }
});

// loop — progression de la boucle auto
socket.on(`loop:${pairId}`, ({ round, total, phase }) => {
  if (phase === 'analyzing') {
    set({ loopRound: round, loopTotal: total, loopPhase: 'analyzing', rightStreamItems: [] });
  } else if (phase === 'refining') {
    set({ loopPhase: 'refining', leftStreamItems: [] });
  } else if (phase === 'done') {
    set({ loopPhase: null, loopRound: 0, loopTotal: 0 });
    get().fetchPairs();
  }
});

// error
socket.on(`error:${pairId}`, ({ message, retryable }) => {
  set({ errorMessage: message, errorRetryable: retryable, isStreaming: false });
});
```

### Gestion de la reconnexion et du background

```typescript
// Quand l'app revient au premier plan (AppState listener dans App.tsx)
import { AppState } from 'react-native';

AppState.addEventListener('change', (nextState) => {
  if (nextState === 'active') {
    const { socket, isConnected } = usePairStore.getState();
    if (socket && !isConnected) {
      socket.connect(); // Force reconnexion
    }
    // Re-synchroniser l'état complet depuis le backend
    usePairStore.getState().fetchPairs();
  }
});
```

### Différences avec le web

| Aspect | Web | Mobile |
|--------|-----|--------|
| `init()` | Synchrone | Async (charge URL + token depuis AsyncStorage) |
| `uploadAttachment()` | `File` object | URI local + fileName + mimeType + panel |
| Socket URL | Relative (même origin) | `backendUrl` depuis AsyncStorage |
| Reconnexion | Implicite (même machine) | Explicite (exponential backoff, UI banner, re-sync au foreground) |
| `isConnected` / `isReconnecting` | Non présent | Ajouté pour le mobile |
| `settings` | Présent | Présent (mêmes actions fetchSettings/updateSettings) |
| `searchQuery` | Présent | Présent |
| `pushLeft` | Présent | Présent |
| `autoLoop` | Présent | Présent |
| `loopRound/loopTotal/loopPhase` | Présent | Présent |
| Auth token | Non nécessaire | Header Authorization + socket.handshake.auth |

---

## Phase 4 — Notifications Push

### 4.1 Backend — Persistance et envoi

**Modification** : `backend/src/services/settingsService.ts`

Ajouter un champ `expoPushTokens: string[]` dans `AppSettings` (liste pour supporter plusieurs devices). Persisté dans `~/.claude-duo/settings.json`.

**Nouveau fichier** : `backend/src/services/pushService.ts`

```typescript
import { loadSettings, saveSettings } from './settingsService';

export function registerPushToken(token: string) {
  const settings = loadSettings();
  const tokens = settings.expoPushTokens || [];
  if (!tokens.includes(token)) {
    tokens.push(token);
    saveSettings({ ...settings, expoPushTokens: tokens });
  }
}

export function unregisterPushToken(token: string) {
  const settings = loadSettings();
  const tokens = (settings.expoPushTokens || []).filter(t => t !== token);
  saveSettings({ ...settings, expoPushTokens: tokens });
}

export async function sendPushNotification(title: string, body: string, data?: Record<string, unknown>) {
  const settings = loadSettings();
  const tokens = settings.expoPushTokens || [];
  if (tokens.length === 0) return;

  const messages = tokens.map(token => ({
    to: token,
    title,
    body,
    sound: 'default' as const,
    data,
  }));

  try {
    await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(messages),
    });
  } catch (err) {
    console.error('Push notification failed:', err);
  }
}
```

**Nouveaux endpoints** dans `pairRoutes.ts` :

```typescript
router.post('/register-push-token', (req, res) => {
  const { token } = req.body;
  if (!token) return res.status(400).json({ error: 'Token required' });
  registerPushToken(token);
  res.json({ ok: true });
});

router.delete('/register-push-token', (req, res) => {
  const { token } = req.body;
  if (token) unregisterPushToken(token);
  res.json({ ok: true });
});
```

### 4.2 Intégration dans les callbacks existants

Dans `pairRoutes.ts`, ajouter des appels `sendPushNotification()` dans les callbacks `onComplete` et `onError` :

```typescript
// send-message onComplete :
sendPushNotification(
  'Chat terminé',
  `${pair.name} — Réponse reçue`,
  { pairId: pair.id, screen: 'chat' }
);

// runAnalysis onComplete :
sendPushNotification(
  'Analyse terminée',
  `${pair.name} — Analyse #${analysisIndex} prête`,
  { pairId: pair.id, screen: 'impl' }
);

// runImplementation onComplete :
sendPushNotification(
  'Implémentation terminée',
  `${pair.name} — Code terminé`,
  { pairId: pair.id, screen: 'impl' }
);

// runAutoLoop onComplete (phase 'done') :
sendPushNotification(
  'Boucle terminée',
  `${pair.name} — ${rounds} rounds terminés`,
  { pairId: pair.id, screen: 'impl' }
);

// Tout onError :
sendPushNotification(
  'Erreur',
  `${pair.name} — ${error.substring(0, 100)}`,
  { pairId: pair.id }
);
```

### 4.3 Mobile — Réception des notifications

```typescript
// Dans App.tsx au démarrage
import * as Notifications from 'expo-notifications';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
});

// Enregistrement du token
async function registerForPush(backendUrl: string) {
  const { status } = await Notifications.requestPermissionsAsync();
  if (status !== 'granted') return;

  const token = (await Notifications.getExpoPushTokenAsync()).data;
  const headers = await authHeaders();
  await fetch(`${backendUrl}/api/register-push-token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify({ token }),
  });
}

// Navigation au tap sur notification
Notifications.addNotificationResponseReceivedListener((response) => {
  const data = response.notification.request.content.data;
  if (data.pairId) {
    navigation.navigate('PairDetail', {
      pairId: data.pairId,
      tab: data.screen || 'chat',
    });
  }
});
```

**Deep linking** dans `app.json` :
```json
{
  "expo": {
    "scheme": "claudeduo",
    "notification": {
      "iosDisplayInForeground": true
    }
  }
}
```

---

## Phase 5 — Composants React Native

### 5.1 Thème sombre

```typescript
// src/theme/colors.ts
export const colors = {
  bgPrimary: '#0d1117',
  bgSecondary: '#161b22',
  bgTertiary: '#21262d',
  accent: '#58a6ff',
  accentHover: '#79c0ff',
  textPrimary: '#e6edf3',
  textSecondary: '#8b949e',
  textMuted: '#484f58',
  border: '#30363d',
  success: '#3fb950',
  warning: '#d29922',
  error: '#f85149',
  purple: '#a371f7',
};
```

### 5.2 ConnectionBanner

Bandeau affiché en haut de l'écran quand la connexion est perdue :

```typescript
// src/components/ConnectionBanner.tsx
// Si isConnected === false && isReconnecting === true :
//   Bandeau jaune : "Reconnexion en cours..."
// Si isConnected === false && isReconnecting === false :
//   Bandeau rouge : "Backend injoignable" + bouton "Réessayer"
// Si isConnected === true : ne rien afficher
```

### 5.3 ChatBubble

```typescript
// Bulle message — user à droite, assistant à gauche
// User : fond accent/20, texte blanc, border-radius 16, max-width 85%
// Assistant : fond bg-secondary, bord accent/30 à gauche, rendu markdown via MarkdownView
// Si message.toolEvents existe : afficher ToolEventCard pour chaque paire tool_use/tool_result
```

### 5.4 StreamItemList (composant critique)

Rendu fidèle au web des `StreamItem[]` interleaved :

```typescript
// src/components/StreamItemList.tsx
// Reçoit : items: StreamItem[]
// Pour chaque item :
//   - type 'text' : MarkdownView avec le texte
//   - type 'tool_use' : InlineToolEvent (expandable, affiche tool name + input)
//   - type 'tool_result' : Rattaché au tool_use précédent (même composant)
// Logique de pairing : un tool_result suit toujours un tool_use
// Le dernier text item peut être en cours de streaming (pas de fin de phrase)
```

### 5.5 MarkdownView

Utiliser `react-native-markdown-display` avec le thème sombre personnalisé. Supporter :
- Titres, listes, code inline/blocks (fond bgTertiary, police monospace)
- Tableaux
- Blockquotes
- Liens (ouvrir dans le navigateur via `Linking.openURL`)

**Performance** : Chaque message est un item FlatList séparé, le markdown est rendu par message (pas de rendu global). Pour les messages très longs (> 5000 chars), tronquer avec un bouton "Voir tout".

### 5.6 StatusBadge

```typescript
// Badge coloré avec animation pulse pour les états actifs
const STATUS_CONFIG = {
  idle: { color: colors.textMuted, label: 'Idle', pulse: false },
  chatting: { color: colors.accent, label: 'Chat...', pulse: true },
  prd_done: { color: colors.success, label: 'PRD OK', pulse: false },
  analyzing: { color: colors.purple, label: 'Analyse...', pulse: true },
  coding: { color: colors.warning, label: 'Code...', pulse: true },
  done: { color: colors.success, label: 'Done', pulse: false },
  error: { color: colors.error, label: 'Erreur', pulse: false },
  stopped: { color: colors.warning, label: 'Stop', pulse: false },
};
```

### 5.7 FolderPicker (navigateur de dossiers)

Pour éviter la saisie manuelle de chemins sur iPhone :

**Backend — Nouvel endpoint** :
```typescript
// GET /api/browse?path=/Users/thomas/Documents
// Retourne la liste des sous-dossiers (pas les fichiers)
router.get('/browse', (req, res) => {
  const dirPath = (req.query.path as string) || os.homedir();
  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true })
      .filter(e => e.isDirectory() && !e.name.startsWith('.'))
      .map(e => ({ name: e.name, path: path.join(dirPath, e.name) }))
      .sort((a, b) => a.name.localeCompare(b.name));
    res.json({ current: dirPath, parent: path.dirname(dirPath), entries });
  } catch {
    res.status(400).json({ error: 'Cannot read directory' });
  }
});
```

**Mobile — Composant FolderPicker** :
```typescript
// Modal avec navigation dans l'arborescence
// - Affiche le chemin courant en haut
// - Bouton ".." pour remonter
// - Liste des sous-dossiers (tap pour naviguer)
// - Bouton "Sélectionner ce dossier" en bas
// - TextInput pour saisie directe (fallback)
```

### 5.8 LoopProgress

```typescript
// src/components/LoopProgress.tsx
// Affiche quand loopPhase !== null :
// "Round {loopRound}/{loopTotal} — {loopPhase === 'analyzing' ? 'Analyse...' : 'Raffinement...'}"
// Avec spinner animé
```

### 5.9 ActivityTimer

```typescript
// Timer elapsed en mm:ss, démarre quand isStreaming passe à true
// S'arrête quand isStreaming repasse à false
// Affiché en mode discret dans le header
```

---

## Phase 6 — Gestion des attachments sur mobile

### 6.1 Capture photo / sélection galerie

Utiliser `expo-image-picker` :

```typescript
import * as ImagePicker from 'expo-image-picker';

// Galerie
const result = await ImagePicker.launchImageLibraryAsync({
  mediaTypes: ImagePicker.MediaTypeOptions.Images,
  quality: 0.8,
});

// Caméra
const result = await ImagePicker.launchCameraAsync({
  quality: 0.8,
});

if (!result.canceled) {
  const asset = result.assets[0];
  await uploadAttachment(
    pairId,
    asset.uri,
    asset.fileName || 'photo.jpg',
    asset.mimeType || 'image/jpeg',
    'left'  // ou 'right' selon le panneau actif
  );
}
```

### 6.2 Upload vers le backend

```typescript
// FormData avec le fichier local
const formData = new FormData();
formData.append('file', {
  uri: localUri,
  name: fileName,
  type: mimeType,
} as any);
formData.append('panel', panel); // 'left' ou 'right'

const headers = await authHeaders();
await fetch(`${backendUrl}/api/pairs/${pairId}/attachments`, {
  method: 'POST',
  headers,
  body: formData,
});
```

---

## Phase 7 — Navigation

### Architecture React Navigation

```
BottomTabs
├── PairsTab (NativeStack)
│   ├── PairList (liste des paires + recherche)
│   ├── PairDetail (Material Top Tabs : Chat | Implementation)
│   └── CreatePair (formulaire création)
└── SettingsTab (NativeStack)
    └── Settings (URL, auth, settings backend, notifications)
```

**Bottom Tabs** :
- Onglet "Paires" : icône liste, badge avec nombre de paires actives
- Onglet "Réglages" : icône engrenage

**Material Top Tabs** (dans PairDetail) :
- Swipe entre Chat et Implementation
- Badge indicateur sur l'onglet inactif si nouveau contenu

---

## Ordre d'implémentation

| Phase | Tâche | Dépend de |
|-------|-------|-----------|
| 1.1 | Init projet Expo + structure | — |
| 1.2 | Service API + config URL + reconnexion | 1.1 |
| 1.3 | Modifier CORS + listen 0.0.0.0 + health check backend | — |
| 1.4 | Auth token (middleware backend + mobile) | 1.3 |
| 2.6 | SettingsScreen (URL, token, settings backend) | 1.2, 1.4 |
| 3 | Store Zustand mobile (StreamItem[], loop, connexion) | 1.2 |
| 5.1 | Thème colors | 1.1 |
| 5.2 | ConnectionBanner | 3 |
| 5.6 | StatusBadge | 5.1 |
| 2.1 | PairListScreen | 3, 5.6 |
| 7 | Navigation (BottomTabs + Stacks) | 2.1, 2.6 |
| 5.3-5.5 | ChatBubble, StreamItemList, MarkdownView | 5.1 |
| 5.7 | FolderPicker + endpoint /api/browse | 1.3 |
| 2.3 | ChatScreen complet | 3, 5.3-5.5 |
| 2.4 | ImplScreen complet (avec push-left, auto-loop) | 3, 5.3-5.5, 5.8 |
| 2.5 | CreatePairScreen | 3, 5.7 |
| 2.2 | PairDetailScreen (top tabs, header) | 2.3, 2.4 |
| 6 | Attachments (photo/galerie) | 2.3 |
| 4.1 | Push service backend (tokens persistés) | 1.3 |
| 4.2 | Push notifications mobile + deep linking | 4.1, 3, 7 |

## Dépendances Expo à installer

```bash
npx create-expo-app mobile --template blank-typescript
cd mobile
npx expo install expo-notifications expo-image-picker expo-haptics
npx expo install @react-navigation/native @react-navigation/bottom-tabs @react-navigation/native-stack @react-navigation/material-top-tabs
npx expo install react-native-screens react-native-safe-area-context react-native-pager-view
npm install zustand socket.io-client
npm install @react-native-async-storage/async-storage
npm install react-native-markdown-display
```

## Configuration app.json

```json
{
  "expo": {
    "name": "ClaudeDuo",
    "slug": "claude-duo-mobile",
    "version": "1.0.0",
    "scheme": "claudeduo",
    "orientation": "portrait",
    "icon": "./assets/icon.png",
    "splash": {
      "image": "./assets/splash.png",
      "resizeMode": "contain",
      "backgroundColor": "#0d1117"
    },
    "ios": {
      "bundleIdentifier": "com.claudeduo.mobile",
      "supportsTablet": false,
      "infoPlist": {
        "NSCameraUsageDescription": "Pour envoyer des photos à Claude",
        "NSPhotoLibraryUsageDescription": "Pour sélectionner des images à envoyer à Claude"
      }
    },
    "notification": {
      "iosDisplayInForeground": true
    },
    "plugins": [
      "expo-notifications",
      "expo-image-picker"
    ]
  }
}
```

## Prérequis réseau

Avant de tester l'app mobile :

1. **Firewall macOS** : S'assurer que le backend (Node.js) est autorisé à recevoir des connexions entrantes. Aller dans Préférences Système > Sécurité > Pare-feu > Options, et autoriser Node.js.
2. **Même réseau WiFi** : Le Mac et l'iPhone doivent être sur le même réseau local.
3. **IP du Mac** : Trouver l'IP locale avec `ipconfig getifaddr en0` (WiFi) et la configurer dans l'app mobile.
4. **Backend sur 0.0.0.0** : Vérifier que le backend écoute sur toutes les interfaces (modification Phase 1.3).

## Vérification

1. **Health check** : Le bouton "Tester" dans Settings appelle `/api/health` et affiche OK + latence
2. **Authentification** : Les requêtes sans token valide sont rejetées (401)
3. **Liste paires** : Affiche les mêmes paires que le web, avec recherche
4. **Chat** : Envoyer un message, voir la réponse streamée en temps réel (texte + outils interleaved)
5. **Multi-tour** : Envoyer un 2e message, Claude se souvient du contexte (sessionId)
6. **Push PRD** : Lancer l'analyse depuis l'onglet Implementation
7. **Push Left** : Renvoyer l'analyse au chat, vérifier qu'elle apparaît
8. **Auto-loop** : Lancer une boucle de 2 rounds, vérifier l'affichage round/phase
9. **GO CODER** : Lancer l'implémentation
10. **Notifications** : Recevoir une notif quand Claude termine, tap navigue vers la bonne paire
11. **Photo** : Prendre une photo, l'envoyer à Claude, il peut la lire
12. **Reconnexion** : Couper le WiFi, le reconnecter → bandeau jaune puis reconnexion auto + re-sync
13. **Background** : Mettre l'app en arrière-plan pendant un streaming, revenir → état synchronisé
14. **FolderPicker** : Naviguer dans l'arborescence du Mac pour choisir un projectDir
15. **Expo Go** : Tout fonctionne dans Expo Go (pas besoin de build natif pour tester)
