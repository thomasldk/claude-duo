# PRD — ClaudeDuo

## Objectif

Application web locale (Mac) qui orchestre 2 instances Claude Code CLI en tandem :
- **Panneau gauche** : fabrique de PRD (Writer ↔ Critic, ne code jamais)
- **Panneau droit** : implémentation (analyse le PRD, puis code sur "Go")

Communication entre les deux via un bouton `➤`. L'utilisateur supervise et arbitre.

---

## Contexte et problème

Aujourd'hui, le workflow PRD → Code se fait manuellement dans un seul terminal Claude Code :
1. L'utilisateur écrit ou dicte un PRD
2. Claude analyse, commente, ne code pas
3. Boucle de corrections
4. Sur "go", Claude implémente

**Problèmes :**
- Le PRD n'est pas challengé par un second regard automatique (Writer ↔ Critic)
- Le contexte s'accumule dans une seule conversation (risque de compaction)
- Pas de vue côte à côte PRD vs implémentation
- Pas de drag & drop d'images/fichiers pour enrichir le contexte

---

## Concepts clés

### Paire

Une **paire** est l'unité de travail. Elle lie une discussion gauche (PRD) et une discussion droite (Code).

```
Paire {
  id: string
  name: string                    // ex: "Auth 2FA TOTP"
  topic: string                   // ex: "Ajouter l'authentification 2FA TOTP au ERP"
  createdAt: string               // ISO 8601
  updatedAt: string               // ISO 8601 — mis à jour à chaque changement, utilisé pour le tri sidebar (desc)
  projectDir: string              // ex: /Users/.../erp-unified
  annexDirs: string[]             // ex: [/Users/.../import-cptdrc]
  status: idle | prd_running | paused | prd_done | analyzing | coding | done | error | stopped

  left: {                         // PRD Factory
    agentA: { name, systemPrompt, model }  // Writer — model: "sonnet" | "opus"
    agentB: { name, systemPrompt, model }  // Critic
    rounds: number
    currentRound: number
    iterations: Iteration[]
    attachments: Attachment[]
    userInterjections: { afterRound: number, text: string }[]
  }

  right: {                        // Implémentation
    agent: { name, systemPrompt, model }
    analyses: Analysis[]             // commentaires pré-code
    implementation: string | null    // output du codage
    attachments: Attachment[]
  }
}

Iteration {
  round: number
  writerOutput: string
  criticOutput: string
}

Analysis {
  index: number                   // 1, 2, 3... (chaque push ➤ = nouvelle analyse)
  prdVersion: number              // round du PRD envoyé
  output: string
}

Attachment {
  id: string
  filename: string
  path: string                    // chemin sur disque (~/.claude-duo/sessions/...)
  mimeType: string                // image/png, application/pdf, etc.
}
```

### Presets de rôles (gauche)

| Preset | Agent A (Writer) | Agent B (Critic) | Modèle suggéré |
|--------|------------------|-------------------|----------------|
| PRD classique | Rédacteur PRD | Critique produit | Sonnet / Opus |
| Architecture | Architecte | Expert sécurité | Opus / Opus |
| Code Review | Codeur | Reviewer | Sonnet / Opus |
| Rédaction | Rédacteur | Éditeur | Sonnet / Sonnet |
| Custom | libre | libre | configurable |

---

## Spécifications fonctionnelles

### F1 — Sidebar (liste des paires)

- Liste toutes les paires, triées par `updatedAt` desc (les paires actives remontent en haut)
- Chaque paire affiche : nom, statut (badge couleur), round actuel
- Bouton `[+ Nouvelle paire]` en haut
- Clic sur une paire → affiche ses panneaux gauche/droite
- Les paires persistent entre les sessions (stockage JSON local)

### F2 — Création d'une paire

Formulaire :
- **Nom** : texte libre (ex: "Auth 2FA")
- **Sujet / Topic** : description du travail à faire
- **Dossier projet** : champ texte où l'utilisateur colle/tape le path absolu (pas de file picker browser, trop limité)
- **Dossiers annexes** : liste de paths supplémentaires, bouton `[+ Ajouter]` (optionnel)
- **Preset** : dropdown qui pré-remplit les rôles, prompts et modèles
- **Rounds** : nombre d'itérations Writer↔Critic (défaut: 3)
- **Rôle Agent A** : nom + system prompt + modèle (pré-rempli par preset, éditable)
- **Rôle Agent B** : nom + system prompt + modèle (pré-rempli par preset, éditable)

Le backend vérifie que `projectDir` existe et est accessible avant de créer la paire.

### F3 — Panneau gauche (PRD Factory)

- Affiche la sortie du Writer et du Critic en alternance
- **Markdown rendu en live** pendant que Claude écrit (streaming)
- **Les deux agents (Writer ET Critic) ont accès au codebase** via le dossier projet — le Critic peut vérifier la faisabilité en lisant le code
- Navigation par round : onglets `[Round 1] [Round 2] [●Round 3]`
- Zone de drag & drop pour images et fichiers → attachés comme contexte
- Indicateur de tokens utilisés (barre de jauge)
- Bouton `[▶ Lancer]` pour démarrer la boucle Writer↔Critic
- Bouton `[⏸ Pause]` : **finit le round en cours** (Writer ou Critic), puis s'arrête avant de lancer le round suivant. Statut → `paused`. Le bouton devient `[▶ Reprendre]` pour continuer la boucle. Différent de `[⏹ Stop]` (F9) qui kill le process immédiatement.
- Si le statut est `prd_done` et l'utilisateur clique `[▶ Lancer]` à nouveau : un dialog demande le nombre de rounds supplémentaires. La boucle reprend à partir du dernier PRD/critique existant (pas de remise à zéro).
- **Zone de texte d'intervention manuelle** : visible entre les rounds, le texte saisi est injecté dans le prompt du **Writer** au round suivant (ex: "Ajoute une section sur les migrations DB"). L'injection est préfixée par `[INSTRUCTION UTILISATEUR]` pour que le Writer la distingue du contexte.
- **Règle absolue** : les agents gauche ne reçoivent JAMAIS d'outils d'écriture (Edit, Write, Bash). Seuls Read, Glob, Grep sont autorisés.

### F4 — Bouton `➤` (Push vers la droite)

- Apparaît quand le PRD gauche est terminé (status: prd_done)
- Au clic : envoie le PRD final au panneau droit
- Le panneau droit reçoit le PRD avec l'instruction : *"Analyse ce PRD en profondeur. Donne tes commentaires structurés. NE CODE PAS."*
- Si l'analyse révèle des problèmes → l'utilisateur corrige à gauche et re-push
- Peut être cliqué plusieurs fois (chaque push = nouvelle analyse)

### F5 — Panneau droit (Implémentation)

- **Phase 1 — Analyse** : reçoit le PRD, l'analyse sans coder, affiche ses commentaires. Outils limités à Read, Glob, Grep (pas d'écriture).
- **Phase 2 — Go** : bouton `[🟢 GO CODER]` apparaît. L'utilisateur le clique quand l'analyse est satisfaisante.
- **Phase 3 — Implémentation** : sur "Go", l'agent code tout d'une traite. L'agent reçoit dans son prompt : le PRD complet + le contenu de son analyse précédente (pour ne pas perdre le contexte de ce qu'il a identifié).
- Markdown rendu en live (streaming)
- L'agent droit a accès à **tous les outils** : Read, Glob, Grep, Edit, Write, Bash
- Zone de drag & drop pour images/fichiers supplémentaires
- Le process est lancé depuis `projectDir` (cwd), avec `--add-dir` pour chaque dossier annexe

### F6 — Attachments (images et fichiers)

- Drag & drop d'images (PNG, JPG, PDF) sur chaque panneau
- Copier-coller d'images depuis le presse-papier (Cmd+V)
- Les images sont stockées dans `~/.claude-duo/sessions/<pair_id>/attachments/`
- Miniatures visibles sous chaque panneau
- Clic sur une miniature → prévisualisation
- Bouton ✕ pour retirer un attachment
- **Limitation connue** : le passage d'images au CLI en mode `--print` n'est pas documenté. Fallback : les images sont décrites textuellement dans le prompt ou passées via stdin si le CLI le supporte.

### F7 — Streaming live

- La sortie de Claude apparaît **mot par mot** en temps réel
- Le backend pipe stdout de `claude -p --output-format stream-json --verbose --include-partial-messages` vers le frontend via WebSocket
- **Filtrage côté backend** : le backend parse chaque ligne JSON et ne transmet au frontend que les events utiles (texte + tool_use). Les events de debug/metadata sont loggués mais pas transmis.
- **Types d'events transmis au frontend :**
  - `text_delta` → texte markdown, concaténé et rendu en live
  - `tool_use` → affiché comme bloc collapsible (ex: "📂 Read backend/prisma/schema.prisma") pour que l'utilisateur voie ce que l'agent explore
  - `tool_result` → contenu collapsible sous le tool_use correspondant
  - Tous les autres events sont ignorés côté frontend
- Auto-scroll vers le bas pendant le streaming
- Indicateur visuel "Agent en train d'écrire..." pendant le streaming

### F8 — Persistance

- Toutes les paires et leurs données sauvegardées dans `~/.claude-duo/`
- Structure :
  ```
  ~/.claude-duo/
    sessions/
      <pair_id>/
        pair.json          // métadonnées de la paire
        left/
          round-1-writer.md
          round-1-critic.md
          round-2-writer.md
          ...
        right/
          analysis-1.md
          analysis-2.md
          implementation.md
        attachments/
          img1.png
          schema.pdf
  ```
- Au lancement de l'app, toutes les sessions sont rechargées

### F9 — Gestion d'erreurs

- **Exit code ≠ 0** : le message d'erreur stderr est affiché dans le panneau concerné avec un badge rouge "Erreur". Le statut de la paire passe à `error`. Bouton `[🔄 Réessayer]` pour relancer le dernier appel.
- **Timeout** : si un appel Claude ne produit aucun output pendant 120 secondes, il est tué (SIGTERM). Message "Timeout — aucune réponse" affiché. Bouton réessayer.
- **Rate limit** : si stderr contient "rate limit" ou "429", afficher un countdown de 60s avant retry automatique (max 3 retries).
- **Process kill** : si l'utilisateur clique `[⏹ Stop]`, le process claude reçoit SIGTERM. Statut → `stopped`.

### F10 — Concurrence

- **Maximum 1 paire active à la fois** (v1 — simplification). Le bouton `[▶ Lancer]` est grisé si une autre paire tourne.
- Au sein d'une paire : gauche et droite ne tournent jamais en même temps (le flux est séquentiel : gauche d'abord, push, puis droite).
- File d'attente pour v2 si besoin.

---

## Spécifications techniques

### Stack

| Couche | Techno |
|--------|--------|
| Frontend | Vite + React 18 + TypeScript |
| Styling | Tailwind CSS |
| Markdown | react-markdown + remark-gfm + rehype-highlight |
| État | Zustand (léger, simple) |
| Backend | Node.js + Express |
| WebSocket | socket.io |
| Storage | JSON fichiers (pas de base de données) |
| Monorepo dev | `concurrently` — lance backend + frontend en parallèle |
| CLI | `claude` (Claude Code CLI, déjà installé) |

**Script racine `package.json` :**
```json
{
  "scripts": {
    "dev": "concurrently \"cd backend && npm run dev\" \"cd frontend && npm run dev\"",
    "build": "cd frontend && npm run build"
  }
}
```

### API Backend

```
POST   /api/pairs                     // Créer une paire
GET    /api/pairs                     // Lister les paires
GET    /api/pairs/:id                 // Détails d'une paire
DELETE /api/pairs/:id                 // Supprimer une paire
PATCH  /api/pairs/:id                 // Modifier une paire (nom, topic, prompts, modèles). Interdit si status ≠ idle|prd_done|done|error|stopped.
POST   /api/pairs/:id/start-prd      // Lancer la boucle Writer↔Critic
POST   /api/pairs/:id/stop           // Arrêter le process en cours
POST   /api/pairs/:id/interject      // Ajouter une intervention manuelle
POST   /api/pairs/:id/push-right     // Envoyer le PRD au panneau droit
POST   /api/pairs/:id/go-code        // Lancer l'implémentation
POST   /api/pairs/:id/attachments    // Upload d'un attachment (multipart)
DELETE /api/pairs/:id/attachments/:aid // Supprimer un attachment

WebSocket events (serveur → client) :
  stream:left:<pairId>     // {type: "text", text: "...", agent: "writer"|"critic", round: N}
                           // {type: "tool_use", tool: "Read", input: "backend/prisma/schema.prisma", agent: "writer"|"critic", round: N}
                           // {type: "tool_result", content: "...", agent: "writer"|"critic", round: N}
  stream:right:<pairId>    // {type: "text", text: "...", phase: "analysis"|"implementation"}
                           // {type: "tool_use", tool: "Edit", input: "...", phase: "analysis"|"implementation"}
                           // {type: "tool_result", content: "...", phase: "analysis"|"implementation"}
  status:<pairId>          // {status: "idle"|"prd_running"|"paused"|"prd_done"|"analyzing"|"coding"|"done"|"error"|"stopped"}
  tokens:<pairId>          // {estimated: 45000, limit: 100000, panel: "left"|"right"}
  error:<pairId>           // {message: "...", retryable: true|false}
```

### Appel Claude CLI — Flags vérifiés

> **Vérifié** : `--print` (`-p`), `--allowedTools` / `--allowed-tools` (les deux formes acceptées), `--output-format stream-json`, `--model`, `--system-prompt`, `--append-system-prompt`, `--add-dir`, `--verbose`, `--include-partial-messages` sont tous des flags valides de `claude` CLI.
>
> **Inexistant** : `--cwd` n'existe pas. On lance le process avec `cwd: projectDir` via `child_process.spawn()` côté Node.js. `--systemPrompt` (camelCase) n'existe pas, c'est `--system-prompt` (kebab-case).

> **Prompt via stdin** : les prompts sont passés via stdin (pipe), pas comme argument CLI. Cela élimine la limite ARG_MAX (~256 Ko sur macOS) qui serait atteinte avec des PRDs longs. En Node.js : `spawn()` puis `process.stdin.write(prompt)` + `process.stdin.end()`.
>
> **`--system-prompt` vs `--append-system-prompt`** : les agents gauche (Writer, Critic) et l'agent droit en phase analyse utilisent `--system-prompt` (remplacement complet) car ils n'ont pas besoin des instructions par défaut de Claude Code. L'agent droit en phase implémentation utilise `--append-system-prompt` (ajout) pour conserver les instructions d'outils de Claude Code.
>
> **Risque identifié** : avec `--system-prompt`, les agents perdent les instructions internes sur l'utilisation des outils (Read, Glob, Grep). Le modèle connaît ces outils nativement, donc ça devrait fonctionner. Si au test Phase 2 les agents n'arrivent pas à lire les fichiers, fallback : passer tous les agents en `--append-system-prompt`.

**Gauche (PRD) — Writer :**
```bash
# Lancé avec cwd = projectDir, prompt via stdin
echo "<prompt>" | claude -p \
  --output-format stream-json \
  --verbose \
  --include-partial-messages \
  --model <agentA.model> \
  --add-dir <annexDir1> --add-dir <annexDir2> \
  --allowedTools "Read,Glob,Grep" \
  --system-prompt "<system_prompt_writer>"
```

**Gauche (PRD) — Critic :**
```bash
# Lancé avec cwd = projectDir, prompt via stdin
echo "<prompt>" | claude -p \
  --output-format stream-json \
  --verbose \
  --include-partial-messages \
  --model <agentB.model> \
  --add-dir <annexDir1> --add-dir <annexDir2> \
  --allowedTools "Read,Glob,Grep" \
  --system-prompt "<system_prompt_critic>"
```

**Droite — Analyse (pas de code) :**
```bash
# Lancé avec cwd = projectDir, prompt via stdin
echo "<prompt>" | claude -p \
  --output-format stream-json \
  --verbose \
  --include-partial-messages \
  --model <right.agent.model> \
  --add-dir <annexDir1> --add-dir <annexDir2> \
  --allowedTools "Read,Glob,Grep" \
  --system-prompt "Tu es un analyste technique. Analyse le PRD fourni en profondeur. NE CODE PAS."
```

**Droite — Implémentation (tous les outils) :**
```bash
# Lancé avec cwd = projectDir, prompt via stdin
echo "<prompt>" | claude -p \
  --output-format stream-json \
  --verbose \
  --include-partial-messages \
  --model <right.agent.model> \
  --add-dir <annexDir1> --add-dir <annexDir2> \
  --allowedTools "Read,Glob,Grep,Edit,Write,Bash" \
  --append-system-prompt "<system_prompt_codeur>"
```

### Gestion des tokens / anti-compaction

- Chaque appel Claude est **stateless** (`-p`) : pas de conversation, pas de compaction
- Le backend estime le nb de tokens par prompt (approximation : 1 token ≈ 4 chars)
- **Jauge affichée pour les DEUX panneaux** (gauche ET droite) — le panneau droit peut avoir un prompt très lourd (PRD + analyse + instructions)
- Jauge : vert < 50k, jaune < 80k, rouge > 80k
- Si le prompt dépasse 80k tokens :
  - Warning dans l'UI
  - Option de résumer les rounds précédents avant de continuer
- Seul le **dernier PRD + dernière critique** sont envoyés à chaque round (pas l'historique complet)

### Templates de prompts

Les prompts envoyés aux agents suivent des templates précis :

**Writer — Round 1 (création initiale) :**
```
[SUJET]
{pair.topic}

[CONSIGNE]
Crée un PRD complet et structuré pour ce sujet. Explore le codebase pour comprendre l'existant.
```

**Writer — Round N+1 (amélioration) :**
```
[SUJET]
{pair.topic}

[PRD ACTUEL]
{output du Writer au round N}

[CRITIQUE REÇUE]
{output du Critic au round N}

{si interjection présente:}
[INSTRUCTION UTILISATEUR]
{texte de l'interjection}

[CONSIGNE]
Réécris le PRD complet en intégrant la critique. N'inclus pas la critique dans le PRD final.
Round {N+1}/{total} — {si dernier round: "C'est le dernier round, fais un PRD final de haute qualité." sinon: "Concentre-toi sur les points critiques."}
```

**Critic — Tous les rounds :**
```
[SUJET ORIGINAL]
{pair.topic}

[PRD À CRITIQUER]
{output du Writer au round courant}

[CONSIGNE]
Analyse ce PRD et fournis une critique structurée :
1. Points forts
2. Lacunes — ce qui manque ou est incomplet
3. Incohérences — contradictions ou ambiguïtés
4. Suggestions concrètes avec exemples
5. Score sur 10 avec justification

Tu as accès au codebase. Vérifie la faisabilité technique en lisant les fichiers existants.
```

**Droite — Analyse :**
```
[PRD À ANALYSER]
{dernier PRD du panneau gauche}

[CONSIGNE]
Analyse ce PRD en profondeur. Explore le codebase pour vérifier la faisabilité.
Donne tes commentaires structurés : ce qui est bon, ce qui pose problème, ce qui manque.
NE CODE PAS. Ne modifie aucun fichier.
```

**Droite — Implémentation :**
```
[PRD]
{dernier PRD du panneau gauche}

[ANALYSE PRÉCÉDENTE]
{output de la phase analyse}

[CONSIGNE]
Implémente ce PRD en entier. Enchaîne toutes les phases sans t'arrêter.
Vérifie le build quand tu as fini.
```

---

## UI / UX

### Layout principal

```
┌─ Sidebar (240px) ─────┬─ Main ──────────────────────────────────────┐
│                        │                                             │
│  🔍 Recherche          │  ┌─ Gauche (50%) ──┬─ Droite (50%) ──────┐ │
│                        │  │                  │                      │ │
│  [+ Nouvelle paire]    │  │  Agent A/B       │  Agent Codeur        │ │
│                        │  │  PRD live        │  Analyse / Code      │ │
│  ● Auth 2FA      🟢   │  │                  │                      │ │
│  ● Import PDF    🔵   │  │                  │       [ ➤ ]          │ │
│  ● Optim DB      ⚪   │  │                  │                      │ │
│                        │  │  📎 imgs         │  📎 imgs             │ │
│                        │  │                  │                      │ │
│                        │  │  Rounds [1][2][3]│  [🟢 GO CODER]      │ │
│                        │  └──────────────────┴──────────────────────┘ │
│                        │                                             │
│                        │  Tokens: ████████░░░░ 52k/100k             │
└────────────────────────┴─────────────────────────────────────────────┘
```

### Thème

- Dark mode par défaut (thème sombre type terminal)
- Couleurs : fond `#0d1117`, panneaux `#161b22`, accents bleu `#58a6ff`
- Police monospace pour les outputs Claude
- Police sans-serif pour l'UI (labels, boutons)

### Responsive

- Minimum 1200px de large
- En dessous : les panneaux passent en onglets (Gauche | Droite) au lieu de côte à côte

---

## Plan d'implémentation

### Phase 1 — Squelette (backend + frontend + WebSocket)

- Init projet : monorepo avec `frontend/` et `backend/`
- Backend Express + socket.io basique
- Frontend Vite + React + Tailwind
- Layout principal : sidebar + 2 panneaux vides
- WebSocket connecté entre front et back
- Modèle Pair en mémoire (pas encore persisté)

### Phase 2 — PRD Factory (panneau gauche)

- Formulaire de création de paire (F2)
- Appel Claude CLI pour le Writer (round 1 — indexation 1-based partout, UI et interne)
- Streaming de la réponse via WebSocket → affichage live (F7)
- Appel Critic → affichage
- Boucle Writer↔Critic sur N rounds
- Navigation par round (onglets)
- Sauvegarde des outputs en fichiers (F8)
- Intervention manuelle entre rounds (zone de texte)

### Phase 3 — Push et panneau droit

- Bouton `➤` envoie le PRD au panneau droit (F4)
- Appel Claude CLI en mode analyse (sans outils d'écriture)
- Affichage de l'analyse en streaming
- Bouton `[🟢 GO CODER]`
- Sur Go : appel Claude CLI avec tous les outils, prompt inclut PRD + analyse précédente
- Streaming de l'implémentation

### Phase 4 — Attachments et polish

- Drag & drop d'images sur les panneaux (F6)
- Copier-coller d'images (Cmd+V)
- Stockage des attachments
- Miniatures et prévisualisation
- Jauge de tokens
- Persistance JSON des sessions (F8)
- Presets de rôles
- Gestion d'erreurs (F9)

### Phase 5 — UX et finitions

- Dark mode
- Recherche dans la sidebar
- Suppression de paires (supprime aussi `~/.claude-duo/sessions/<pair_id>/` sur disque)
- Bouton pause/reprise
- Export du PRD final en fichier .md (exporte le dernier output du Writer uniquement, pas les critiques)
- Sélection du modèle par agent

---

## Critères d'acceptation

1. Lancer l'app avec `npm run dev`, ouvrir dans le browser
2. Créer une paire avec un nom, sujet, dossier projet (path collé)
3. Lancer la boucle Writer↔Critic et voir le markdown apparaître en live
4. Les deux agents (Writer + Critic) explorent le codebase
5. Naviguer entre les rounds
6. Intervenir entre les rounds avec du texte libre
7. Pousser le PRD vers la droite avec `➤`
8. L'agent droit analyse sans coder
9. Cliquer "Go" et voir l'implémentation en streaming (avec contexte de l'analyse)
10. Drag & drop d'images sur les panneaux
11. Les sessions persistent après fermeture/réouverture
12. La jauge de tokens reflète l'usage estimé
13. Les erreurs CLI sont affichées proprement avec option retry

---

## Risques et mitigations

| Risque | Impact | Mitigation |
|--------|--------|------------|
| `claude` CLI pas installé | App inutilisable | Check au démarrage + message d'erreur clair |
| Prompts trop longs (> 100k tokens) | Échec de l'appel CLI | Jauge + warning + option résumé |
| Images non supportées en `--print` | Perte de contexte visuel | Fallback : description textuelle de l'image dans le prompt |
| Dossier projet inaccessible | Agents aveugles | Vérification du path à la création de la paire |
| Exit code CLI ≠ 0 | Process planté | Affichage erreur + bouton retry (F9) |
| Rate limit API | Blocage temporaire | Countdown + retry auto (max 3) (F9) |
| Timeout (agent bloqué) | Process zombie | Kill après 120s sans output + message (F9) |
| L'agent droit code en phase analyse | Code non désiré | `--allowedTools` restreint (pas d'Edit/Write/Bash) |
| Perte de contexte entre analyse et implémentation (droite) | Agent codeur sans mémoire | Analyse précédente incluse dans le prompt d'implémentation |

---

## Fichiers clés à créer

```
claude-duo/
  package.json
  frontend/
    src/
      App.tsx
      components/
        Sidebar.tsx
        PairForm.tsx
        LeftPanel.tsx
        RightPanel.tsx
        MarkdownRenderer.tsx
        AttachmentZone.tsx
        TokenGauge.tsx
        RoundTabs.tsx
      stores/
        pairStore.ts
      types/
        pair.ts
  backend/
    src/
      index.ts
      routes/
        pairRoutes.ts
      services/
        claudeService.ts
        storageService.ts
      types/
        pair.ts
```
