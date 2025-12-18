# 📊 DIAGRAMMES & DATA FLOW - Analyse Complète

## 🔄 Timeline Actuelle (AVEC LES BUGS)

```
T = -65s (avant démarrage du round)
    gameState.nextRoundStartTime = T+0s
    gameState.currentRound = { id: 12345, participants: [...] }
    
    ❌ PROBLÈME #2: runningRoundData = null (copie du round)
    ❌ PROBLÈME #3: finishLock = false (jamais utilisé)

T = 0s (client clique "Start Race")
    gameState.isRaceRunning = true
    gameState.raceStartTime = T+0s
    ❌ PROBLÈME #7: gameState.nextRoundStartTime = null ← RÉINITIALISE!
    
    Broadcast: race_start {
        event: "race_start",
        raceStartTime: T+0s,
        isRaceRunning: true,
        ❌ Pas de currentScreen
        ❌ Pas de timeInRace
    }

T = 5s
    Client: Affiche movie_screen (calcul local: T-0 < 30s)
    Serveur: Oui, movie_screen (calcul: T-0 < MOVIE_SCREEN_MS=30s)
    ✓ Sync OK

T = 15s
    Nouveau client B se connecte
    Serveur envoie: connected {
        screen: "movie_screen",
        ❌ Pas de timeInRace → Client ne sait pas qu'on est à T=15s!
    }
    Client B: Doit recalculer timeInRace = now - raceStartTime
    ⚠️ Risque de désync si horloge décalée

T = 30s (executeRaceFinish appelé)
    ❌ PROBLÈME #12: calculateRaceResults() ne retourne rien
    
    Broadcast: race_end {
        event: "race_end",
        ❌ Pas de results (race_results ne s'envoie jamais!)
    }

T = 35s (onCleanup appelé)
    ✅ calculateRaceResults() FINALEMENT appelée
    ✅ Retourne { winner, receipts, totalPrize }
    
    Broadcast: new_round {
        event: "new_round",
        currentRound: { id: 54321, participants: [...] }
    }
    
    ❌ PROBLÈME #7: gameState.nextRoundStartTime = T+95s
    ❌ PROBLÈME #11: gameState.runningRoundData = null (pas cleané)

T = 37s (mais nous est à T+95s)
    Client: Clique "Start Race" (timer s'est écoulé localement)
    ❌ Serveur refuse: "Timer pas écoulé" (att: T+95s vs now: T+37s)

T = 95s
    Timer S'ÉCOULE
    Client clique auto "Start Race"
    Tout recommence...
```

**Problèmes identifiés dans cette timeline**:
- T=0: nextRoundStartTime réinitialisé ❌
- T=15: Nouveau client ne sait pas le timeInRace ❌
- T=30: race_results ne s'envoie jamais ❌
- T=35: runningRoundData pas cleané ❌

---

## 🔄 Timeline CORRIGÉE (Après les fixes)

```
T = -65s
    gameState.nextRoundStartTime = T+0s
    gameState.currentRound = { id: 12345, participants: [...] }
    gameState.operationLock = false ✅ UN SEUL lock
    
T = 0s
    gameState.isRaceRunning = true
    gameState.raceStartTime = T+0s
    ✅ gameState.nextRoundStartTime RESTE T+0s (pas modifié)
    
    Broadcast: race_start {
        event: "race_start",
        raceStartTime: T+0s,
        serverTime: T+0s,
        currentScreen: "movie_screen",  ✅ NOUVEAU
        timeInRace: 0,                   ✅ NOUVEAU
        isRaceRunning: true
    }

T = 5s
    Client A: Reçoit WebSocket, affiche movie_screen
    Client B: Se connecte, reçoit {
        currentScreen: "movie_screen",  ✅
        timeInRace: 5000,                ✅ Sait qu'on est à T+5
        raceStartTime: T-5s
    }
    ✓ Synchronisés!

T = 30s (race_end)
    executeRaceFinish() START
    gameState.operationLock = true  ✅ SET lock
    
    Broadcast: race_end {
        event: "race_end",
        timeInRace: 30000
    }

T = 35s (onCleanup)
    ✅ calculateRaceResults() appelée
    ✅ Retourne { winner, receipts, totalPrize }
    
    Broadcast: race_results {
        event: "race_results",  ✅ NOUVEAU
        winner: { number: 7, name: "Ronaldo", ... },
        receipts: [...],
        totalPrize: 45000
    }
    
    Broadcast: new_round {
        event: "new_round",
        currentRound: { id: 54321, participants: [...] }
    }
    
    ✅ gameState.nextRoundStartTime = T+95s (correct)
    ✅ gameState.runningRoundData = null (cleané)
    ✅ gameState.operationLock = false (CLEAR lock)

T = 95s
    Timer s'écoule
    Nouveau round commence
    ✓ Tout est synchronisé et stable
```

---

## 🏗️ Architecture d'État (AVANT)

```
gameState
├── currentRound: { participants, receipts, ... }
├── runningRoundData: { ... COPIE ... }  ❌ DUPLICATION
├── gameHistory: [ ... ]
├── nextRoundStartTime: timestamp
├── raceStartTime: timestamp
├── raceEndTime: timestamp
├── isRaceRunning: boolean
├── timerInterval: null  ❌ JAMAIS UTILISÉ
├── preStartTimer: null
├── timers: {
│   ├── nextRound: null
│   ├── finish: null
│   ├── prepare: null
│   └── cleanup: null
├── finishLock: false  ❌ JAMAIS UTILISÉ
├── roundCreationLock: false  ❌ INUTILE (finishLock existe)
└── ??? autres propriétés dynamiques
```

---

## 🏗️ Architecture d'État (APRÈS FIX #2, #3)

```
gameState
├── currentRound: { participants, receipts, ... }
├── previousRound: null  ✅ Copie sauvegardée si besoin (rare)
├── gameHistory: [ ... ]
├── nextRoundStartTime: timestamp
├── raceStartTime: timestamp
├── raceEndTime: timestamp
├── isRaceRunning: boolean
├── timers: {
│   ├── nextRound: null
│   ├── finish: null
│   ├── cleanup: null
│   └── preStart: null
│   └── ✅ Consolidé
├── operationLock: false  ✅ UN SEUL LOCK pour tout
└── ✅ Pas de propriétés dynamiques
```

---

## 📡 Data Flow: Une Requête POST /rounds/ (lancer race)

### AVANT (Avec bugs)

```
Client
    |
    v (POST /api/v1/rounds/ {action: "start"})
    |
Server Routes
    |
    v raceTimerManager.startRaceSequence(raceId, callbacks)
    |
    ├─> T+0: onRaceStart()
    │   ├─> broadcast(race_start)  ❌ Sans currentScreen/timeInRace
    │   └─> ❌ PROBLÈME #7: Réinitialise nextRoundStartTime
    │
    ├─> T+30: onFinishRace() 
    │   └─> executeRaceFinish()  ❌ Ne retourne rien
    │
    └─> T+35: onCleanup()
        ├─> gameState.roundCreationLock = true  ❌ PROBLÈME #3
        ├─> ❌ Attend finishLock (qui n'est jamais set!)
        ├─> calculateRaceResults()  ❌ Ne retourne rien
        ├─> Broadcast race_results  ❌ Avec null (jamais exécuté)
        ├─> createNewRound()
        ├─> broadcast(new_round)
        └─> gameState.roundCreationLock = false

Client
    |
    v (WebSocket) Reçoit race_start, race_end, new_round
    |
    ├─> Affiche movie_screen (calcul local)
    ├─> Affiche finish_screen (calcul local)
    └─> ❌ Ne reçoit jamais race_results (null)
```

### APRÈS (Après fixes)

```
Client
    |
    v (POST /api/v1/rounds/ {action: "start"})
    |
Server Routes
    |
    v raceTimerManager.startRaceSequence(raceId, callbacks)
    |
    ├─> T+0: onRaceStart()
    │   ├─> broadcast(race_start)  ✅ Avec currentScreen="movie_screen", timeInRace=0
    │   └─> ✅ NE modifie PAS nextRoundStartTime
    │
    ├─> T+30: onFinishRace() 
    │   └─> executeRaceFinish()  ✅ Prépare les données
    │
    └─> T+35: onCleanup()
        ├─> gameState.operationLock = true  ✅ UN SEUL LOCK
        ├─> calculateRaceResults()
        │   └─> ✅ Retourne { winner, receipts, totalPrize }
        │
        ├─> broadcast(race_results)  ✅ Avec données réelles
        ├─> createNewRound()
        ├─> broadcast(new_round)  ✅ Avec nouveau round
        ├─> gameState.nextRoundStartTime = T+95  ✅ Correct
        ├─> gameState.runningRoundData = null  ✅ Cleané
        └─> gameState.operationLock = false  ✅ CLEAR lock

Client
    |
    v (WebSocket) Reçoit 4 messages dans l'ordre
    |
    ├─> race_start: Affiche movie_screen, lancé timer local
    ├─> race_end: Affiche finish_screen
    ├─> race_results: ✅ Reçoit enfin les résultats
    └─> new_round: Affiche game_screen, lancé nouveau timer
```

---

## 🔄 Comparaison des Timers

| Événement | AVANT | APRÈS | Problème |
|-----------|-------|-------|----------|
| T=-60 | nextRoundStartTime=T+0 | nextRoundStartTime=T+0 | ✓ OK |
| T=0 | nextRoundStartTime=null ❌ | nextRoundStartTime=T+0 ✅ | #7: Réinitialisé |
| T=30 | race_end | race_end | ✓ OK |
| T=35 | new_round, nextRoundStartTime=T+95 | new_round, nextRoundStartTime=T+95 | ✓ OK |
| T=60 | Timer bloqué (nextRoundStartTime=null) ❌ | Timer correct (T+95s) ✅ | #7: Bloqué |

---

## 🔀 Comparaison des Constants

### Config/app.config.js

| AVANT | APRÈS | Impact |
|-------|-------|--------|
| `TIMER_DURATION_MS = 60s` | `ROUND_WAIT_DURATION_MS = 60s` | #9: Noms cohérents |
| `ROUND_WAIT_DURATION_MS = 60s` | *(supprimé)* | #9: Pas de doublons |
| Utilisation: `game.js`, `routes/init.js` | Utilisation: **tous les fichiers** | #9: Source unique |

---

## 🔐 Pattern de Locks

### AVANT (Problème #3)

```javascript
// Deux locks séparés pour la même opération
gameState.finishLock = false;        // ❌ Jamais utilisé
gameState.roundCreationLock = false; // ❌ Attend finishLock

// Problème: finishLock n'est jamais SET/CLEARED
// Donc roundCreationLock attend forever une condition false
// Mais la condition est toujours false (jamais true)!

// Timeline:
T+30: executeRaceFinish() START
      ❌ if (gameState.finishLock) { SET? } ← NON
      ...
      ❌ if (gameState.finishLock) { CLEAR? } ← NON

T+35: onCleanup() START
      if (gameState.finishLock) {  ← Toujours false, donc pas d'attente
          wait...
      }
      ✓ Pas d'attente (mais inutile car finishLock est jamais true)
```

### APRÈS (Fix #3)

```javascript
// UN SEUL lock pour toutes les opérations critiques
gameState.operationLock = false; ✅ Source unique

// Pattern:
async function criticalOperation() {
    gameState.operationLock = true;  // ✅ SET au début
    
    try {
        // ... opération atomique ...
    } finally {
        gameState.operationLock = false;  // ✅ TOUJOURS clear (même si erreur)
    }
}

// Timeline:
T+30: executeRaceFinish() START
      gameState.operationLock = true  ✅ SET
      ...
      finally { gameState.operationLock = false }  ✅ CLEAR

T+35: onCleanup() START
      if (gameState.operationLock) {
          wait...  ✅ Attend si executeRaceFinish pas terminé
      }
      // ... continuer ...
```

---

## 💾 Redux des États (Memory Management)

### AVANT (Memory Leak #11)

```
Après T=35 (race terminée):

gameState.currentRound = { id: 54321, ... }  ✓ Utilisé
gameState.runningRoundData = { id: 12345, ... }  ❌ ORPHELIN
gameState.gameHistory = [ ... ]  ✓ Utilisé

Après 100 races:
- 100 × runningRoundData en mémoire
- ~2-5 MB memory leaks
```

### APRÈS (Memory Cleanup #11)

```
Après T=35:

gameState.currentRound = { id: 54321, ... }  ✓ Utilisé
gameState.runningRoundData = null  ✅ CLEANÉ
gameState.gameHistory = [ ... ]  ✓ Utilisé (max 10)

Après 100 races:
- Memory stable
- Pas de leaks
```

---

## 🌐 WebSocket Messages (AVANT vs APRÈS)

### race_start Event

**AVANT**:
```json
{
    "event": "race_start",
    "roundId": 12345,
    "raceStartTime": 1702908000000,
    "currentRound": { /* ... */ },
    "isRaceRunning": true
}
```

**APRÈS**:
```json
{
    "event": "race_start",
    "roundId": 12345,
    "raceStartTime": 1702908000000,
    "serverTime": 1702908000000,
    "currentScreen": "movie_screen",
    "timeInRace": 0,
    "currentRound": { /* ... */ },
    "isRaceRunning": true
}
```

**Amélioration**: Client sait immédiatement quel écran afficher et où on en est.

---

### race_results Event (NEW)

**AVANT**:
```json
// ❌ Jamais envoyé (calculateRaceResults() retourne null)
```

**APRÈS**:
```json
{
    "event": "race_results",
    "roundId": 12345,
    "winner": {
        "number": 7,
        "name": "Ronaldo",
        "coeff": 4.7,
        "place": 1
    },
    "receipts": [
        { "id": 1001, "status": "won", "prize": 470 },
        { "id": 1002, "status": "lost", "prize": 0 }
    ],
    "totalPrize": 470,
    "participants": [ /* ... */ ]
}
```

**Amélioration**: Client reçoit les vrais résultats au lieu de les calculer localement.

---

## 🔀 Flux des Bets & Tickets

```
┌─────────────────────────────────────────────────────────────┐
│                    FLOW D'UN TICKET                          │
└─────────────────────────────────────────────────────────────┘

1. CLIENT CRÉE UN PARI
   Clique "Placer pari" x7 Ronaldo pour 100 HTG
   
   POST /api/v1/receipts/?action=add
   {
       bets: [
           {
               participant: { number: 7, name: "Ronaldo", coeff: 4.7 },
               value: 10000  // 100 HTG en système
           }
       ]
   }

2. SERVER (routes/receipts.js)
   ├─> gameState.currentRound.receipts.push(ticket)
   ├─> DB: INSERT INTO receipts (round_id, user_id, status='pending')
   ├─> DB: INSERT INTO bets (receipt_id, participant_id, ...)
   ├─> Cache Redis: SET roundCache:{roundId}:ticket:{ticketId}
   └─> Response: { id: 1001, status: 'pending' }

3. RACE COMMENCE (T=0)
   Ticket reste en mémoire:
   gameState.currentRound.receipts[0] = { id: 1001, status: 'pending', ... }

4. RACE FINIT (T=30)
   executeRaceFinish() START
   ❌ PROBLÈME #2: runningRoundData = copie du round (avec ticket)

5. CALCULER RÉSULTATS (T=35)
   calculateRaceResults() START
   
   Gagnant = Ronaldo (random)
   Ticket 1001:
   - Nombre = 7 (participé à la race)
   - Gagnant = Ronaldo (7)
   - Match? OUI!
   - Prize = 10000 × 4.7 = 47000

6. METTRE À JOUR DB
   UPDATE receipts SET status='won', prize=47000 WHERE receipt_id=1001
   UPDATE bets SET status='won', prize=47000 WHERE receipt_id=1001
   UPDATE roundCache:{roundId}:ticket:1001 (Redis)

7. ARCHIVER EN GAMEHISTORY
   gameState.gameHistory.push({
       id: 12345,
       receipts: [ { id: 1001, status: 'won', prize: 47000 } ],
       winner: Ronaldo
   })

8. CLIENT REÇOIT RESULTS
   WebSocket: race_results {
       event: "race_results",
       receipts: [ { id: 1001, status: 'won', prize: 47000 } ]
   }
   
   Affiche: "Ticket #1001 GAGNÉ! 470 HTG"

9. CASHIER PAYE LE TICKET
   POST /api/v1/my-bets/pay/1001
   ├─> UPDATE receipts SET status='paid', paid_at=now
   ├─> UPDATE bets SET status='paid'
   └─> Imprime reçu
   
   Ticket disparait du dashboard "En attente"
```

---

## 📊 Comparatif Entités vs Transactions

```
┌──────────────┬──────────────┬──────────────┬────────────────┐
│ Entity       │ Scope        │ Persistence  │ Problème       │
├──────────────┼──────────────┼──────────────┼────────────────┤
│ currentRound │ Memory       │ Redis/DB     │ ✓ OK           │
│ runningRound │ Memory only  │ NO           │ #2: Duplication│
│ gameHistory  │ Memory       │ NO           │ ✓ OK           │
│ timers[]     │ Memory       │ NO (timeout) │ ✓ OK           │
│ operationLock│ Memory       │ NO           │ #3: Unifié     │
│ previousRound│ Memory (rare)│ NO           │ ✓ OK (après fix)
└──────────────┴──────────────┴──────────────┴────────────────┘
```

---

## 🎯 Impact Summary Table

```
╔════════════╦════════════════════════╦═════════╦══════════════════════╗
║ Problème   ║ Impact                 ║ Sévérité║ Effort Fix           ║
╠════════════╬════════════════════════╬═════════╬══════════════════════╣
║ #1         ║ Sync client/server     ║ CRIT    ║ 2h (créer endpoint)  ║
║ #2         ║ Multiple source truth  ║ CRIT    ║ 3h (refactor code)   ║
║ #3         ║ Race condition         ║ CRIT    ║ 2h (unifier locks)   ║
║ #4         ║ Désync écrans          ║ CRIT    ║ 2h (ajouter fields)  ║
║ #5         ║ Code confusion         ║ CRIT    ║ 30m (nettoyer)       ║
║ #6         ║ Serveur bloqué         ║ CRIT    ║ 30m (reset locks)    ║
║ #7         ║ Timer réinitialisé     ║ CRIT    ║ 1h (remove line)     ║
║ #8         ║ Écrans désync          ║ CRIT    ║ 1h (broadcast field) ║
║ #9         ║ Confusion noms         ║ CRIT    ║ 2h (refactor noms)   ║
║ #10        ║ Architecture          ║ CRIT    ║ 1h (clarifier funcs) ║
║ #11        ║ Memory leak           ║ MOD     ║ 30m (cleanup line)   ║
║ #12        ║ Race_results never sent║ MOD     ║ 30m (add return)     ║
║ #13        ║ Broadcast timing      ║ MOD     ║ 1h (reorder code)    ║
║ #14        ║ Clients hardcode timer ║ MOD     ║ 1h (créer endpoint)  ║
║ #15        ║ Cache invalidation    ║ MOD     ║ 30m (reduce TTL)     ║
╚════════════╩════════════════════════╩═════════╩══════════════════════╝

Total: ~17 heures
```

---

## ✅ Validation des Fixes

### Après Fix #2-#3-#9:

```javascript
// gameState doit être:
{
    currentRound: {},
    previousRound: null,        // ✓ Pas runningRoundData
    operationLock: false,       // ✓ Pas finishLock/roundCreationLock
    // ... autres propriétés
}

// Imports doivent utiliser:
import { ROUND_WAIT_DURATION_MS } from "config/app.config";  // ✓
// Pas TIMER_DURATION_MS

// Aucun de ces ne doit exister:
// ❌ gameState.runningRoundData
// ❌ gameState.finishLock
// ❌ gameState.roundCreationLock
// ❌ TIMER_DURATION_MS
```

### Après Fix #1-#4-#8:

```javascript
// API doit retourner:
GET /api/v1/init/timers → {
    MOVIE_SCREEN_DURATION_MS,
    FINISH_SCREEN_DURATION_MS,
    TOTAL_RACE_TIME_MS,
    ROUND_WAIT_DURATION_MS
}

// WebSocket race_start doit inclure:
{
    event: "race_start",
    currentScreen: "movie_screen",  ✓
    timeInRace: 0,                  ✓
    // ... autres fields
}

// WebSocket race_results doit inclure:
{
    event: "race_results",
    winner: {},                     ✓
    receipts: [],                   ✓
    totalPrize: 0                   ✓
}
```

---

## 🚀 Quick Reference

### Les 3 Problèmes à Fixer EN PRIORITÉ:

1. **Fix #9 (TIMER_DURATION → ROUND_WAIT_DURATION)**
   - 5 fichiers à changer
   - 2h max
   - Impacte tous les autres

2. **Fix #2 (runningRoundData → previousRound)**
   - Refactor game.js, routes/rounds.js
   - 3h
   - Élimine une source de vérité

3. **Fix #3 (finishLock + roundCreationLock → operationLock)**
   - Consolide 2 locks en 1
   - 2h
   - Élimine une race condition

**Total pour ces 3**: ~7 heures → stabilise 30% des bugs
