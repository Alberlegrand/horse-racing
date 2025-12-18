# 🔧 GUIDE DES FIXES AVEC PRIORITÉS

## 📋 RÉSUMÉ DES ACTIONS

| ID | Problème | Fichier | Ligne | Sévérité | Temps | Status |
|----|-----------|---------|----|----------|-------|--------|
| #1 | Double timer declaration | screen.html, app.js | 551-552, var | CRIT | 2h | ⏳ TODO |
| #2 | runningRoundData chaos | game.js, rounds.js | 35, 207+ | CRIT | 3h | ⏳ TODO |
| #3 | Lock race condition | game.js, rounds.js | 46-47, 513+ | CRIT | 2h | ⏳ TODO |
| #4 | No client/server sync | server.js, app.js | 150+, 900+ | CRIT | 2h | ⏳ TODO |
| #5 | Dead callback | rounds.js | 495-497 | CRIT | 30m | ⏳ TODO |
| #6 | Locks not reset | game.js | 260 | CRIT | 30m | ⏳ TODO |
| #7 | Timer reset at race | game.js | 140 | CRIT | 1h | ⏳ TODO |
| #8 | No screen sync | server.js | 755 | CRIT | 1h | ⏳ TODO |
| #9 | TIMER vs WAIT naming | config/ | 18,97 | CRIT | 2h | ⏳ TODO |
| #10 | Single responsibility | rounds.js | 327+ | CRIT | 1h | ⏳ TODO |
| #11 | runningRoundData leak | rounds.js | 313 | MOD | 30m | ⏳ TODO |
| #12 | No return value | rounds.js | 207 | MOD | 30m | ⏳ TODO |
| #13 | broadcast timing | server.js | 307 | MOD | 1h | ⏳ TODO |
| #14 | No timer endpoint | routes/ | N/A | MOD | 1h | ⏳ TODO |
| #15 | Status side effect | rounds.js | 688 | MOD | 30m | ⏳ TODO |

---

## 🔴 PHASE 1: FIXES CRITIQUES (Semaine 1)

### Fix #2: Supprimer runningRoundData

**Fichier**: `game.js`

**Avant**:
```javascript
export const gameState = {
    currentRound: {},
    runningRoundData: null,  // ❌ À supprimer
    // ...
};
```

**Après**:
```javascript
export const gameState = {
    currentRound: {},
    previousRound: null,  // ✅ Renommer pour clarté
    // ...
};
```

**Impact**: Simplifie la logique, utilise UNE seule source de vérité

---

### Fix #3: Unifier les locks

**Fichier**: `game.js`

**Avant**:
```javascript
finishLock: false,
roundCreationLock: false  // ❌ Deux locks pour la même opération
```

**Après**:
```javascript
operationLock: false,  // ✅ UN SEUL lock
```

**Changements dans routes/rounds.js**:
```javascript
// ✅ SET le lock au début
gameState.operationLock = true;

try {
    // ... opération critique ...
} finally {
    // ✅ TOUJOURS clear
    gameState.operationLock = false;
}
```

---

### Fix #6: Réinitialiser les locks après restore

**Fichier**: `game.js:249-269`

**Avant**:
```javascript
export async function restoreGameStateFromRedis() {
    try {
        const savedState = await cacheGet('game:state:current');
        if (savedState) {
            gameState.currentRound = savedState.currentRound || {};
            // ... pas de réinitialisation des locks!
        }
    }
}
```

**Après**:
```javascript
export async function restoreGameStateFromRedis() {
    try {
        const savedState = await cacheGet('game:state:current');
        if (savedState) {
            gameState.currentRound = savedState.currentRound || {};
            gameState.gameHistory = savedState.gameHistory || [];
            gameState.nextRoundStartTime = savedState.nextRoundStartTime;
            gameState.raceStartTime = savedState.raceStartTime;
            gameState.raceEndTime = savedState.raceEndTime;
            gameState.isRaceRunning = savedState.isRaceRunning;
            
            // ✅ RÉINITIALISER les locks toujours à false!
            gameState.operationLock = false;
            gameState.preStartTimer = null;
            
            console.log(`✅ [CACHE] GameState restauré depuis Redis (locks réinitialisés)`);
            return true;
        }
        return false;
    } catch (err) {
        console.error(`⚠️ [CACHE] Erreur restauration gameState:`, err.message);
        return false;
    }
}
```

---

### Fix #9: Renommer tous les TIMER_DURATION

**Fichier**: `config/app.config.js`

**Avant**:
```javascript
export const TIMER_DURATION_SECONDS = parseInt(process.env.TIMER_DURATION_SECONDS || '60', 10);
export const TIMER_DURATION_MS = TIMER_DURATION_SECONDS * 1000;

export const ROUND_WAIT_DURATION_SECONDS = parseInt(process.env.ROUND_WAIT_DURATION_SECONDS || '60', 10);
export const ROUND_WAIT_DURATION_MS = ROUND_WAIT_DURATION_SECONDS * 1000;
// ❌ Deux constantes pour la même chose!
```

**Après**:
```javascript
// ✅ UN SEUL nom pour le timer d'attente entre rounds
export const ROUND_WAIT_DURATION_SECONDS = parseInt(
    process.env.ROUND_WAIT_DURATION_SECONDS || 
    process.env.TIMER_DURATION_SECONDS ||  // Fallback pour compatibilité
    '60', 
    10
);
export const ROUND_WAIT_DURATION_MS = ROUND_WAIT_DURATION_SECONDS * 1000;

// ⚠️ Supprimer TIMER_DURATION complètement
```

**Ensuite dans game.js**:
```javascript
// ✅ Changer
import { ROUND_WAIT_DURATION_MS } from './config/app.config.js';  // ← Au lieu de TIMER_DURATION_MS

// Et à la ligne 140:
gameState.nextRoundStartTime = now + ROUND_WAIT_DURATION_MS;  // ← Pas d'initialisation à race_start
```

---

### Fix #7: NE PAS réinitialiser le timer à race_start

**Fichier**: `routes/rounds.js:484-490`

**Avant**:
```javascript
onRaceStart: () => {
    const raceStartTime = Date.now();
    gameState.isRaceRunning = true;
    gameState.raceStartTime = raceStartTime;
    gameState.raceEndTime = null;
    // ✅ RESET LE TIMER POUR ÉVITER LE PETIT TIMER PENDANT LE FINISH SCREEN
    gameState.nextRoundStartTime = null;  // ❌ MAUVAIS! Réinitialise le timer d'attente
    // ...
},
```

**Après**:
```javascript
onRaceStart: () => {
    const raceStartTime = Date.now();
    gameState.isRaceRunning = true;
    gameState.raceStartTime = raceStartTime;
    gameState.raceEndTime = null;
    // ✅ NE PAS changer nextRoundStartTime
    // Le timer d'attente a déjà été set à T=-60, on le laisse intact
    
    broadcast({
        event: "race_start",
        roundId: gameState.currentRound.id,
        raceStartTime: raceStartTime,
        currentRound: JSON.parse(JSON.stringify(gameState.currentRound)),
        isRaceRunning: true
    });
},
```

**Note**: Le commentaire sur "RESET LE TIMER POUR ÉVITER LE PETIT TIMER" n'a pas de sens. Le client ne voit pas `nextRoundStartTime` pendant la race (il affiche le race timer, pas le wait timer).

---

### Fix #1: Créer endpoint config/timers

**Fichier**: `routes/init.js` (ajouter)

**Code à ajouter**:
```javascript
// Ajouter à createInitRouter()
router.get("/timers", (req, res) => {
    res.json({
        data: {
            MOVIE_SCREEN_DURATION_MS,
            FINISH_SCREEN_DURATION_MS,
            TOTAL_RACE_TIME_MS,
            ROUND_WAIT_DURATION_MS,
            TIMER_UPDATE_INTERVAL_MS,
            // Aussi en secondes pour facilité de lecture
            MOVIE_SCREEN_DURATION_SECONDS: MOVIE_SCREEN_DURATION_SECONDS,
            FINISH_SCREEN_DURATION_SECONDS: FINISH_SCREEN_DURATION_SECONDS,
            ROUND_WAIT_DURATION_SECONDS: ROUND_WAIT_DURATION_SECONDS
        }
    });
});
```

**Importer dans init.js**:
```javascript
import {
    MOVIE_SCREEN_DURATION_SECONDS,
    MOVIE_SCREEN_DURATION_MS,
    FINISH_SCREEN_DURATION_SECONDS,
    FINISH_SCREEN_DURATION_MS,
    TOTAL_RACE_TIME_MS,
    ROUND_WAIT_DURATION_MS,
    ROUND_WAIT_DURATION_SECONDS,
    TIMER_UPDATE_INTERVAL_MS
} from "../config/app.config.js";
```

**Utilisation client**:
```javascript
// ✅ screen.html et app.js
const timersRes = await fetch('/api/v1/init/timers');
const timers = await timersRes.json();

const RACE_DURATION_MS = timers.data.TOTAL_RACE_TIME_MS;  // ← Depuis le serveur!
const FINISH_DURATION_MS = timers.data.FINISH_SCREEN_DURATION_MS;
```

---

### Fix #4: Envoyer timeInRace et currentScreen

**Fichier**: `server.js:setupWebSocket()`

**Avant**:
```javascript
ws.send(JSON.stringify({ 
    event: "connected", 
    serverTime: Date.now(),
    roundId: gameState.currentRound?.id || null,
    screen: screen,  // ✓ Correct
    isRaceRunning: gameState.isRaceRunning,
    raceStartTime: gameState.raceStartTime,
    // ❌ Pas de timeInRace
    // ...
}));
```

**Après**:
```javascript
const now = Date.now();
let screen = "game_screen";
let timeInRace = 0;

if (gameState.isRaceRunning && gameState.raceStartTime) {
    timeInRace = now - gameState.raceStartTime;  // ✅ Calcule
    if (timeInRace < MOVIE_SCREEN_DURATION_MS) {
        screen = "movie_screen";
    } else if (timeInRace < TOTAL_RACE_TIME_MS) {
        screen = "finish_screen";
    }
}

ws.send(JSON.stringify({ 
    event: "connected", 
    serverTime: now,  // ✓
    roundId: gameState.currentRound?.id || null,
    screen: screen,  // ✓
    currentScreen: screen,  // ✓ Redondant mais clarté
    timeInRace: timeInRace,  // ✅ NOUVEAU
    isRaceRunning: gameState.isRaceRunning,
    raceStartTime: gameState.raceStartTime,
    raceEndTime: gameState.raceEndTime,
    currentRound: JSON.parse(JSON.stringify(gameState.currentRound || {})),
    totalReceipts: (gameState.currentRound?.receipts || []).length,
    totalPrize: gameState.currentRound?.totalPrize || 0
}));
```

---

### Fix #8: Broadcaster currentScreen dans race_start

**Fichier**: `routes/rounds.js:484-495`

**Avant**:
```javascript
onRaceStart: () => {
    const raceStartTime = Date.now();
    gameState.isRaceRunning = true;
    gameState.raceStartTime = raceStartTime;
    // ...
    broadcast({
        event: "race_start",
        roundId: gameState.currentRound.id,
        raceStartTime: raceStartTime,
        currentRound: JSON.parse(JSON.stringify(gameState.currentRound)),
        isRaceRunning: true
        // ❌ Pas de currentScreen, timeInRace
    });
},
```

**Après**:
```javascript
onRaceStart: () => {
    const raceStartTime = Date.now();
    gameState.isRaceRunning = true;
    gameState.raceStartTime = raceStartTime;
    gameState.raceEndTime = null;
    
    broadcast({
        event: "race_start",
        roundId: gameState.currentRound.id,
        raceStartTime: raceStartTime,
        serverTime: raceStartTime,  // ✅ NOUVEAU
        currentScreen: "movie_screen",  // ✅ NOUVEAU - la race affiche film d'abord
        timeInRace: 0,  // ✅ NOUVEAU - vient de commencer
        currentRound: JSON.parse(JSON.stringify(gameState.currentRound)),
        isRaceRunning: true
    });
},
```

---

### Fix #5: Nettoyer les commentaires morts

**Fichier**: `routes/rounds.js:495-510`

**Avant**:
```javascript
// ❌ DELETED: onPrepareNewRound was dead code - never called by startRaceSequence()
// It caused confusion by defining new_round broadcast twice (also in createNewRoundAfterRace)
// The actual new_round broadcast happens in createNewRoundAfterRace() at T=35s (MOVIE + FINISH)

// T=30s: Exécuter la logique de fin
onFinishRace: async () => {
    // ...
    // Note: onPrepareNewRound sera appelé depuis executeRaceFinish via setTimeout
},
```

**Après**:
```javascript
// T=30s: Exécuter la logique de fin
// Note: calculateRaceResults() sera appelé depuis onCleanup() à T=35s
onFinishRace: async () => {
    console.log('[RACE-SEQ] Exécution logique fin de course');
    await executeRaceFinish();
    console.log('[RACE-SEQ] Fin de course terminée, nouveau round sera créé après finish_screen');
},
```

---

### Fix #10: Clarifier la responsabilité

**Fichier**: `routes/rounds.js`

**Avant**: executeRaceFinish()  fait beaucoup de choses

**Après**: Diviser en fonctions plus petites:
- `executeRaceFinish()` → Prepare la race
- `calculateRaceResults()` → Calcule les gagnants (appelé à T=35)
- `createNewRound()` → Crée le round (appelé à T=35)

---

## 🟠 PHASE 2: MODÉRÉS (Semaine 2)

### Fix #11: Nettoyer runningRoundData

**Fichier**: `routes/rounds.js:onCleanup()` - Ajouter à la fin

```javascript
// À la FIN de onCleanup(), après tout est terminé:
finally {
    gameState.roundCreationLock = false;
    gameState.runningRoundData = null;  // ✅ Libérer mémoire
}
```

---

### Fix #12: Faire retourner les résultats

**Fichier**: `routes/rounds.js:207`

**Avant**:
```javascript
const calculateRaceResults = async () => {
    // ... du code ...
    return null;  // ❌ Pas de valeur de retour!
};
```

**Après**:
```javascript
const calculateRaceResults = async () => {
    // ... du code ...
    
    return {
        roundId: finishedRoundId,
        winner: winnerWithPlace,
        receipts: savedRoundData.receipts || [],
        totalPrize: totalPrizeAll,
        participants: savedRoundData.participants || []
    };
};
```

---

### Fix #14: Créer config/timers endpoint

Voir Fix #1 ci-dessus

---

### Fix #15: Supprimer side effect du status

**Fichier**: `routes/rounds.js:688`

**Option 1**: Réduire le cache
```javascript
router.get("/status", cacheResponse(1), async (req, res) => {
    // Cache réduit à 1s au lieu de 5s
```

**Option 2**: Pas de cache
```javascript
router.get("/status", async (req, res) => {
    // Pas de cache - status est trop dynamique
```

**Option 3**: Créer endpoint séparé pour reset
```javascript
router.post("/reset-timer", async (req, res) => {
    // POST only - a un side effect visible
    if (!gameState.isRaceRunning && !gameState.roundCreationLock) {
        await startNewRound(broadcast);
    }
    res.json(wrap({ success: true }));
});
```

---

## 🟡 PHASE 3: MINEURS (Semaine 3)

### Fix #26-29: Documentation et cleanup

1. ✅ Corriger/supprimer les commentaires faux
2. ✅ Consolider les fonctions doublons
3. ✅ Clarifier les logs
4. ✅ Créer README des timers

---

## 📋 CHECKLIST DE VALIDATION

Après chaque fix, valider:

### Fix #2,#3,#6,#9,#7:
- [ ] Pas de compilation errors
- [ ] Pas de "undefined" logs
- [ ] `npm test` passe (si tests existent)

### Fix #1,#4,#8:
- [ ] Client reçoit `/api/v1/init/timers`
- [ ] Screen.html affiche le bon écran
- [ ] WebSocket envoie `timeInRace` et `currentScreen`
- [ ] Multi-clients affichent le même écran au même moment

### Fix #5,#10:
- [ ] Pas de dead code
- [ ] Logs sont clairs
- [ ] Timing est documenté

### Fix #11,#12:
- [ ] runningRoundData est null après race
- [ ] calculateRaceResults() retourne un objet
- [ ] race_results event est broadcasté

### Fix #14,#15:
- [ ] Endpoint /api/v1/init/timers existe
- [ ] /api/v1/rounds/status a le bon cache
- [ ] Pas de side effects inattendus

---

## ⚡ ORDRE D'EXÉCUTION RECOMMANDÉ

1. **Fix #6** (30m) - Locks reset
2. **Fix #3** (1h) - Unifier locks
3. **Fix #9** (2h) - Renommer TIMER_DURATION
4. **Fix #7** (1h) - NE PAS reset timer
5. **Fix #2** (2h) - Simplifier runningRoundData
6. **Fix #1** (1h) - Créer endpoint timers
7. **Fix #4** (1h) - Envoyer timeInRace
8. **Fix #8** (1h) - Broadcaster currentScreen
9. **Fix #5** (30m) - Nettoyer commentaires
10. **Fix #12** (30m) - Return des résultats
11. **Fix #11** (30m) - Nettoyer runningRoundData
12. **Fix #10** (1h) - Clarifier responsabilités
13. **Tests** (2h) - Valider tout
14. **Documentation** (1h) - Documenter

**Total**: ~17 heures de développement

---

## 🚨 TESTS CRITIQUES À FAIRE

### Test 1: Single race normal
```
1. Démarrer le serveur
2. Client A: attendre timer
3. Timer s'écoule → race_start
4. Vérifier: isRaceRunning=true, screen=movie_screen
5. Attendre 30s → race_end
6. Vérifier: screen=finish_screen
7. Attendre 5s → nouveau round
8. Vérifier: isRaceRunning=false, screen=game_screen, nouveau timer
```

### Test 2: Multi-clients sync
```
1. Démarrer le serveur
2. Client A: connecter, attendre timer
3. Client B: connecter APRÈS race_start (T=15s)
4. Vérifier: Client A et B affichent MÊME écran
5. Vérifier: Les deux reçoivent race_end au même moment
```

### Test 3: Crash recovery
```
1. Démarrer serveur, lancer une race
2. Kill serveur à T=20s (pendant movie_screen)
3. Redémarrer serveur
4. Vérifier: Pas de timers bloqués
5. Vérifier: Nouveau round démarre correctement
```

### Test 4: Timer values from API
```
1. GET /api/v1/init/timers
2. Vérifier les valeurs retournées
3. Comparer avec config/app.config.js
4. Changer env vars et redémarrer
5. Vérifier les nouvelles valeurs dans l'API
```

---

## 📚 DOCUMENTS À CRÉER

1. **TIMING_SPEC.md** - Spécification complète du timing
2. **LOCK_STRATEGY.md** - Explication du lock pattern
3. **WEBSOCKET_PROTOCOL.md** - Messages et formats
4. **TESTING_GUIDE.md** - Guide des tests

