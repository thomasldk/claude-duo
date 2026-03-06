# PRD — ClaudeDuo Mobile (Expo / React Native)

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
│ - AttachmentZone     │            │ └─ runImplementation()    │
│ - ToolEventBlock     │            │                           │
│ - MarkdownRenderer   │            │ storageService.ts         │
│ - TokenGauge         │            │ └─ ~/.claude-duo/sessions/│
└─────────────────────┘             └──────────────────────────┘
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
- **Stockage** : Fichiers JSON sur disque (`~/.claude-duo/sessions/{pairId}/pair.json`)
- **CLI** : Claude Code CLI (`claude` command) — spawn de processus Node.js

### Types clés

```typescript
type PairStatus = 'idle' | 'chatting' | 'prd_done' | 'analyzing' | 'coding' | 'done' | 'error' | 'stopped';
type AgentModel = 'sonnet' | 'opus';

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
    agent: AgentConfig;       // { name, systemPrompt, model }
    messages: ChatMessage[];  // { id, role, content, timestamp, toolEvents? }
    sessionId: string | null;
    attachments: Attachment[]; // { id, filename, storedName, path, mimeType }
  };
  right: {
    agent: AgentConfig;
    analyses: Analysis[];     // { index, prdVersion, output }
    implementation: string | null;
    attachments: Attachment[];
  };
}
```

### API REST existante

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
| POST | `/api/pairs/:id/go-code` | Lancer l'implémentation |
| POST | `/api/pairs/:id/attachments` | Upload fichier |
| DELETE | `/api/pairs/:id/attachments/:aid` | Supprimer fichier |
| GET | `/api/presets` | Liste des presets agents |
| GET | `/api/pairs/:id/tokens` | Estimation tokens |

### WebSocket events existants

| Event | Direction | Payload |
|-------|-----------|---------|
| `stream:left:${pairId}` | Server→Client | `{ type: 'text', text }` ou `{ type: 'tool_use', tool, input }` |
| `stream:right:${pairId}` | Server→Client | Idem + `{ phase: 'analysis' \| 'implementation' }` |
| `status:${pairId}` | Server→Client | `{ status: PairStatus }` |
| `error:${pairId}` | Server→Client | `{ message, retryable }` |

### Fichiers clés à consulter

| Fichier | Rôle |
|---------|------|
| `backend/src/index.ts` | Serveur Express + Socket.IO, CORS, chargement paires |
| `backend/src/routes/pairRoutes.ts` | Tous les endpoints REST (383 lignes) |
| `backend/src/services/claudeService.ts` | Spawn CLI, parsing stream-json, gestion sessions |
| `backend/src/services/storageService.ts` | Persistance JSON sur disque |
| `backend/src/services/presets.ts` | 5 presets agents prédéfinis |
| `backend/src/types/pair.ts` | Types TypeScript partagés |
| `frontend/src/stores/pairStore.ts` | Store Zustand, connexion Socket.IO, toutes les actions |
| `frontend/src/components/LeftPanel.tsx` | Chat interactif, streaming, drag-drop |
| `frontend/src/components/RightPanel.tsx` | Analyse + implémentation, streaming |
| `frontend/src/components/Sidebar.tsx` | Liste paires, recherche, badges status |
| `frontend/src/components/PairForm.tsx` | Formulaire création paire avec presets |
| `frontend/src/components/AttachmentZone.tsx` | Upload/preview fichiers |
| `frontend/src/components/ToolEventBlock.tsx` | Affichage tool_use/tool_result collapsible |
| `frontend/src/components/MarkdownRenderer.tsx` | Rendu Markdown GFM |
| `frontend/src/components/TokenGauge.tsx` | Barre visuelle tokens |
| `frontend/src/types/pair.ts` | Types frontend (miroir backend) |
| `frontend/src/index.css` | Thème sombre GitHub-like, spinner, scrollbar |

### Contraintes d'infrastructure

- **Le backend tourne sur le Mac de l'utilisateur** : Le Claude CLI est installé localement, les projets sont des dossiers locaux. Le backend ne peut pas tourner sur Railway/cloud facilement.
- **L'app mobile doit se connecter au Mac via réseau local** : WiFi (même réseau) ou tunnel (ngrok/Tailscale).
- **Une seule paire active à la fois** : Le backend bloque si une autre paire est déjà en status `chatting`, `analyzing`, ou `coding`.

---

## Objectif

Créer une **application mobile iOS** (React Native / Expo) qui se connecte au backend ClaudeDuo existant sur le Mac de l'utilisateur, permettant de :

1. Consulter et gérer ses paires depuis son iPhone
2. Chatter avec l'agent PRD (panneau gauche) en temps réel
3. Lancer l'analyse et l'implémentation (panneau droit)
4. Recevoir des **notifications push** quand Claude finit une réponse
5. Voir le streaming en temps réel (texte + outils)

---

## Phase 1 — Projet Expo + Connexion au backend

### 1.1 Initialisation du projet

Créer un nouveau projet Expo dans `/Users/thomasleguendekergolan/Documents/claude-duo/mobile/` :

```
mobile/
├── app.json                    (config Expo)
├── package.json
├── tsconfig.json
├── App.tsx                     (entry point)
├── src/
│   ├── stores/
│   │   └── pairStore.ts       (Zustand, miroir du web)
│   ├── types/
│   │   └── pair.ts            (copie exacte des types web)
│   ├── services/
│   │   └── api.ts             (fetch + socket.io config)
│   ├── screens/
│   │   ├── PairListScreen.tsx  (liste des paires)
│   │   ├── PairDetailScreen.tsx(chat + impl tabs)
│   │   ├── ChatScreen.tsx      (panneau gauche mobile)
│   │   ├── ImplScreen.tsx      (panneau droit mobile)
│   │   ├── CreatePairScreen.tsx(formulaire création)
│   │   └── SettingsScreen.tsx  (URL backend, notifications)
│   ├── components/
│   │   ├── ChatBubble.tsx      (bulle message user/assistant)
│   │   ├── MarkdownView.tsx    (rendu markdown RN)
│   │   ├── ToolEventCard.tsx   (affichage tools)
│   │   ├── StatusBadge.tsx     (badge coloré par status)
│   │   ├── TokenBar.tsx        (gauge tokens)
│   │   └── Spinner.tsx         (indicateur chargement)
│   ├── navigation/
│   │   └── AppNavigator.tsx    (React Navigation stack)
│   └── theme/
│       └── colors.ts           (thème sombre identique au web)
```

### 1.2 Configuration réseau

L'app mobile doit pouvoir se connecter au backend Mac. L'utilisateur configure l'URL dans un écran Settings :

```typescript
// src/services/api.ts
import AsyncStorage from '@react-native-async-storage/async-storage';

const DEFAULT_URL = 'http://192.168.1.X:3001'; // IP locale du Mac

export async function getBackendUrl(): Promise<string> {
  return (await AsyncStorage.getItem('backendUrl')) || DEFAULT_URL;
}

export async function setBackendUrl(url: string): Promise<void> {
  await AsyncStorage.setItem('backendUrl', url);
}
```

### 1.3 Modification backend — CORS mobile

Ajouter l'origine mobile dans le backend :

**Fichier** : `backend/src/index.ts`

```typescript
// Avant
const ALLOWED_ORIGINS = ['http://localhost:5174', 'http://localhost:3001', 'http://127.0.0.1:5174'];

// Après — accepter toutes les origines en dev (l'app mobile n'a pas d'origin header fixe)
const ALLOWED_ORIGINS = ['http://localhost:5174', 'http://localhost:3001', 'http://127.0.0.1:5174'];
// Pour le mobile, on utilise un wildcard ou on accepte les IPs locales
app.use(cors({ origin: true })); // Accepte toute origine (sécurité OK car réseau local)
```

Et pour Socket.IO :
```typescript
const io = new SocketServer(httpServer, {
  cors: { origin: '*' }, // Accepter le mobile
});
```

---

## Phase 2 — Écrans principaux

### 2.1 PairListScreen (équivalent Sidebar)

Liste scrollable des paires avec :
- Nom de la paire
- Status badge coloré (idle=gris, chatting=bleu animé, prd_done=vert, analyzing=violet, coding=orange, done=vert plein, error=rouge, stopped=jaune)
- Nombre de messages chat
- Date de dernière mise à jour
- Swipe-to-delete avec confirmation
- Bouton "+" en haut à droite pour créer
- Pull-to-refresh

**Navigation** : Tap sur une paire → PairDetailScreen

### 2.2 PairDetailScreen (layout principal)

Deux onglets (tabs) en haut :
- **Chat** (panneau gauche) — onglet par défaut
- **Implementation** (panneau droit)

Header affiche :
- Nom de la paire
- Status badge
- Bouton Stop (si en cours)
- Bouton Settings (modifier agent, sujet)

### 2.3 ChatScreen (panneau gauche mobile)

Interface chat complète :
- **Message list** (FlatList inversé) :
  - Messages user : bulle droite, fond accent/20
  - Messages assistant : bulle gauche, rendu Markdown
  - Tool events collapsibles (comme le web)
  - Streaming en temps réel (texte qui arrive + spinner)
- **Input bar** (bas de l'écran, au-dessus du clavier) :
  - TextInput multiligne
  - Bouton Send (ou Stop si en cours)
  - Bouton photo (ouvrir caméra ou galerie pour attachment)
- **Spinner** animé quand Claude réfléchit (pas encore de texte)
- **Token gauge** discret en haut

### 2.4 ImplScreen (panneau droit mobile)

Affiche :
- Boutons d'action en haut : "Push PRD", "GO CODER", "Stop"
- Liste des analyses passées (collapsibles)
- Implémentation (si disponible)
- Streaming en temps réel (texte + outils)
- Rendu Markdown pour tout le contenu

### 2.5 CreatePairScreen

Formulaire :
- Nom (TextInput)
- Sujet/Topic (TextInput multiligne)
- Project Dir (TextInput — l'utilisateur tape le chemin, ou on propose un file browser basique via une route API dédiée)
- Annex Dirs (liste éditable)
- Preset selector (dropdown avec les 5 presets)
- Agent config avancée (collapsible) : nom, systemPrompt, model (sonnet/opus)

### 2.6 SettingsScreen

- **URL du backend** : TextInput avec bouton "Tester la connexion"
  - Appelle `GET /api/pairs` et affiche OK/Erreur
- **Notifications** : Toggle on/off
- **Thème** : Pour l'instant toujours sombre (comme le web)

---

## Phase 3 — Store Zustand mobile

Le store est quasi-identique au web, mais adapté pour React Native :

```typescript
// src/stores/pairStore.ts
import { create } from 'zustand';
import { io, Socket } from 'socket.io-client';
import { getBackendUrl } from '../services/api';

interface MobilePairStore {
  // Même state que le web
  pairs: Pair[];
  selectedPairId: string | null;
  presets: Preset[];
  socket: Socket | null;
  backendUrl: string;

  // Stream state
  leftStreamText: string;
  leftToolEvents: ToolEvent[];
  rightStreamText: string;
  rightStreamPhase: 'analysis' | 'implementation' | null;
  rightToolEvents: ToolEvent[];
  isStreaming: boolean;

  // Error state
  errorMessage: string | null;
  errorRetryable: boolean;

  // Actions (identiques au web)
  init: () => Promise<void>;
  fetchPairs: () => Promise<void>;
  fetchPresets: () => Promise<void>;
  selectPair: (id: string | null) => void;
  createPair: (data: Record<string, unknown>) => Promise<Pair>;
  updatePair: (id: string, data: Record<string, unknown>) => Promise<void>;
  deletePair: (id: string) => Promise<void>;
  sendMessage: (id: string, text: string) => Promise<void>;
  resetChat: (id: string) => Promise<void>;
  stopPair: (id: string) => Promise<void>;
  pushRight: (id: string) => Promise<void>;
  goCode: (id: string) => Promise<void>;
  uploadAttachment: (id: string, uri: string, fileName: string, mimeType: string) => Promise<void>;
  deleteAttachment: (id: string, attachmentId: string) => Promise<void>;
  clearStreams: () => void;
  clearError: () => void;
  setBackendUrl: (url: string) => Promise<void>;
}
```

**Différences avec le web** :
- `init()` est async (charge l'URL depuis AsyncStorage)
- `uploadAttachment()` prend un URI local (depuis la galerie/caméra) au lieu d'un File
- Le socket se connecte à `backendUrl` au lieu de l'URL relative
- `setBackendUrl()` persiste dans AsyncStorage et reconnecte le socket

---

## Phase 4 — Notifications Push

### 4.1 Backend — Envoi de notifications

Quand une réponse se termine (status change vers `prd_done`, `done`, `error`, `stopped`), le backend envoie une push notification via **Expo Push API**.

**Nouveau fichier** : `backend/src/services/pushService.ts`

```typescript
import fetch from 'node-fetch';

let expoPushToken: string | null = null;

export function setExpoPushToken(token: string) {
  expoPushToken = token;
}

export async function sendPushNotification(title: string, body: string, data?: Record<string, unknown>) {
  if (!expoPushToken) return;

  await fetch('https://exp.host/--/api/v2/push/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      to: expoPushToken,
      title,
      body,
      sound: 'default',
      data,
    }),
  });
}
```

**Nouveau endpoint** : `POST /api/register-push-token`

```typescript
router.post('/register-push-token', (req, res) => {
  const { token } = req.body;
  setExpoPushToken(token);
  res.json({ ok: true });
});
```

**Intégration dans les callbacks existants** :

Dans `pairRoutes.ts`, ajouter des appels `sendPushNotification()` dans les callbacks `onComplete` et `onError` de `callClaudeChat`, `runAnalysis`, et `runImplementation` :

```typescript
// Dans send-message onComplete :
sendPushNotification(
  'Chat terminé',
  `${pair.name} — Réponse reçue`,
  { pairId: pair.id, screen: 'chat' }
);

// Dans runAnalysis onComplete :
sendPushNotification(
  'Analyse terminée',
  `${pair.name} — Analyse #${analysisIndex} prête`,
  { pairId: pair.id, screen: 'impl' }
);

// Dans runImplementation onComplete :
sendPushNotification(
  'Implémentation terminée',
  `${pair.name} — Code terminé`,
  { pairId: pair.id, screen: 'impl' }
);

// Dans onError :
sendPushNotification(
  'Erreur',
  `${pair.name} — ${error.substring(0, 100)}`,
  { pairId: pair.id }
);
```

### 4.2 Mobile — Réception des notifications

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
const { status } = await Notifications.requestPermissionsAsync();
if (status === 'granted') {
  const token = (await Notifications.getExpoPushTokenAsync()).data;
  await fetch(`${backendUrl}/api/register-push-token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token }),
  });
}

// Navigation au tap sur notification
Notifications.addNotificationResponseReceivedListener((response) => {
  const data = response.notification.request.content.data;
  if (data.pairId) {
    // Navigate to the pair
    navigation.navigate('PairDetail', { pairId: data.pairId, tab: data.screen });
  }
});
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

### 5.2 ChatBubble

```typescript
// Bulle message — user à droite, assistant à gauche
// User: fond accent/20, texte blanc, border-radius
// Assistant: fond bg-secondary, bord accent/30 à gauche, rendu markdown
// Affiche toolEvents si présents (collapsible)
```

### 5.3 MarkdownView

Utiliser `react-native-markdown-display` avec le thème sombre personnalisé. Supporter :
- Titres, listes, code inline/blocks
- Tableaux
- Blockquotes
- Liens (ouvrir dans le navigateur)

### 5.4 Spinner

```typescript
// ActivityIndicator natif iOS avec couleur accent
import { ActivityIndicator } from 'react-native';
<ActivityIndicator size="small" color={colors.accent} />
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
  await uploadAttachment(pairId, asset.uri, asset.fileName || 'photo.jpg', asset.mimeType || 'image/jpeg');
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
formData.append('panel', 'left');

await fetch(`${backendUrl}/api/pairs/${pairId}/attachments`, {
  method: 'POST',
  body: formData,
});
```

---

## Ordre d'implémentation

| Phase | Tâche | Dépend de |
|-------|-------|-----------|
| 1.1 | Init projet Expo + structure | — |
| 1.2 | Service API + config URL | 1.1 |
| 1.3 | Modifier CORS backend | — |
| 2.6 | SettingsScreen (URL backend) | 1.2 |
| 3 | Store Zustand mobile | 1.2 |
| 2.1 | PairListScreen | 3 |
| 2.2 | PairDetailScreen (tabs) | 2.1 |
| 5 | Composants (ChatBubble, MarkdownView, StatusBadge, etc.) | 1.1 |
| 2.3 | ChatScreen (chat complet) | 3, 5 |
| 2.4 | ImplScreen | 3, 5 |
| 2.5 | CreatePairScreen | 3 |
| 6 | Attachments (photo/galerie) | 2.3 |
| 4.1 | Push service backend | 1.3 |
| 4.2 | Push notifications mobile | 4.1, 3 |

## Dépendances Expo à installer

```bash
npx create-expo-app mobile --template blank-typescript
cd mobile
npx expo install expo-notifications expo-image-picker expo-font
npx expo install @react-navigation/native @react-navigation/bottom-tabs @react-navigation/native-stack
npx expo install react-native-screens react-native-safe-area-context
npm install zustand socket.io-client
npm install @react-native-async-storage/async-storage
npm install react-native-markdown-display
```

## Vérification

1. **Connexion** : L'app mobile se connecte au backend Mac (tester avec le bouton "Tester" dans Settings)
2. **Liste paires** : Affiche les mêmes paires que le web
3. **Chat** : Envoyer un message, voir la réponse streamée en temps réel
4. **Multi-tour** : Envoyer un 2e message, Claude se souvient du contexte
5. **Push PRD** : Lancer l'analyse depuis l'onglet Implementation
6. **GO CODER** : Lancer l'implémentation
7. **Notifications** : Recevoir une notif quand Claude termine
8. **Photo** : Prendre une photo, l'envoyer à Claude, il peut la lire
9. **Offline** : L'app affiche un message clair si le backend n'est pas joignable
10. **Expo Go** : Tout fonctionne dans Expo Go (pas besoin de build natif pour tester)
