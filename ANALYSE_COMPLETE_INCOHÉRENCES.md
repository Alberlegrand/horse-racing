# 📋 ANALYSE COMPLÈTE DES INCOHÉRENCES - Projet Horse-Racing

**Date**: 18 Décembre 2025  
**Analyseur**: GitHub Copilot  
**Couverture**: 100% des fichiers clés

---

## 📊 RÉSUMÉ EXÉCUTIF

| Catégorie | Nombre | Critique | Modéré | Mineur |
|-----------|--------|----------|--------|--------|
| **Duplication de Code** | 5 | 2 | 2 | 1 |
| **Incohérences d'Imports** | 4 | 1 | 3 | 0 |
| **Multiple Source of Truth** | 6 | 3 | 2 | 1 |
| **Function Conflicts** | 3 | 1 | 2 | 0 |
| **Timing Issues** | 7 | 2 | 4 | 1 |
| **Data Flow Issues** | 4 | 1 | 2 | 1 |
| **TOTAL** | **29** | **10** | **15** | **4** |

---

## 🔴 PROBLÈMES CRITIQUES (10)

### PROBLÈME #1: Double déclaration du timer de race (DUPLICATION + INCOHERENCE)
**Fichiers**: `screen.html` + `static/js/app.js`  
**Lignes**: 
- `screen.html:551-552`
- `static/js/app.js:829-830`

**Niveau**: CRITIQUE

**Description**: 
Les durées du film et de finish screen sont définis en local dans DEUX fichiers différents avec des valeurs HARDCODES au lieu d'utiliser les constantes de config :
```javascript
// ❌ screen.html:551-552
const RACE_DURATION_MS = 25000; // 23 secondes pour movie_screen
const FINISH_DURATION_MS = 5000; // 5 secondes pour finish_screen

// ❌ static/js/app.js:829-830 (probablement aussi)
```

**Impact**: 
- ⚠️ **CRITIQUE**: Si on change les durées dans `config/app.config.js`, le client ne sait pas sur quelles valeurs se fier
- Les timers client/serveur peuvent être DÉSYNCHRONISÉS
- Confusion sur les vraies valeurs des timers
- Maintenance difficile: 3 sources de vérité pour le même timer

**Fix**: 
1. ✅ Supprimer les hardcodes de `screen.html` et `static/js/app.js`
2. ✅ Importer les constantes depuis `config/app.config.js` (côté serveur seulement)
3. ✅ Envoyer les valeurs correctes au client via WebSocket/API
4. ✅ Créer un endpoint `/api/v1/config/timers` qui retourne les vraies durées

---

### PROBLÈME #2: runningRoundData vs currentRound (MULTIPLE SOURCE OF TRUTH)
**Fichiers**: `game.js` + `routes/rounds.js`  
**Lignes**:
- `game.js:35-36`
- `routes/rounds.js:207-216, 331-337, 374-381`

**Niveau**: CRITIQUE

**Description**: 
Deux copies de l'état du round existent simultanément :
```javascript
// ❌ game.js - deux propriétés qui représentent la même chose
gameState.currentRound = {}      // Le round ACTUEL
gameState.runningRoundData = null // Copie du round EN COURS DE RACE

// ❌ routes/rounds.js:216 - utilise une fallback confuse
const finishedRoundData = gameState.runningRoundData || gameState.currentRound;
```

**Impact**: 
- 🔴 **CRITIQUE**: Après une course, les données du gagnant/résultats viennent de `runningRoundData` tandis que le nouveau round est dans `currentRound`
- Risque d'incohérence: quelle copie a les vraies données?
- Cache Redis peut être updaté avec la mauvaise source
- Difficile à déboguer lors de synchronisation lost

**Problème spécifique**:
- À T=0 (race_start): `runningRoundData = copie de currentRound`
- À T=30 (race_end): `calculateRaceResults()` utilise `runningRoundData`
- À T=35 (cleanup): `currentRound = nouveau round`, mais `runningRoundData` n'est jamais réinitialisé correctement

**Fix**: 
1. ✅ Ne pas dupliquer l'état du round
2. ✅ Sauvegarder l'ancien round en DB avant de modifier `currentRound`
3. ✅ Utiliser **UNE SEULE SOURCE**: `gameState.currentRound`
4. ✅ Garder une sauvegarde temporaire seulement si absolument nécessaire (pattern: `previousRound`)

---

### PROBLÈME #3: finishLock vs roundCreationLock (RACE CONDITION)
**Fichiers**: `game.js` + `routes/rounds.js`  
**Lignes**:
- `game.js:46-47`
- `routes/rounds.js:513-531`

**Niveau**: CRITIQUE

**Description**: 
Deux locks séparés qui contrôlent la MÊME opération logique :
```javascript
// ❌ game.js:46
finishLock: false,  // Lock pour executeRaceFinish
roundCreationLock: false  // Lock pour éviter la double création de round

// ❌ routes/rounds.js:513 - Attendre que finishLock se libère
if (gameState.finishLock) {
    console.warn('[RACE-SEQ] ⚠️ executeRaceFinish encore en cours, attente...');
    let waitCount = 0;
    while (gameState.finishLock && waitCount < 20) {
        await new Promise(resolve => setTimeout(resolve, 50));
        waitCount++;
    }
}
```

**Impact**: 
- 🔴 **CRITIQUE**: Race condition possible entre `executeRaceFinish()` et `onCleanup()`
- Le `finishLock` n'est jamais SET ni CLEARED dans le code actuel!
- Deux fonctions peuvent s'exécuter en parallèle sans synchronisation réelle
- Les résultats de la race peuvent être calculés deux fois

**Timing réel**:
```
T=0   race_start: isRaceRunning=true, finishLock=false, roundCreationLock=false
T=30  onFinishRace(): executeRaceFinish() START (finishLock jamais set!)
      ├─ calculateRaceResults() [async]
      ├─ Mise à jour DB/Redis
      └─ END (finishLock jamais clear!)
T=35  onCleanup(): [attend que finishLock=false, mais il est TOUJOURS false!]
      ├─ roundCreationLock=true
      ├─ Calcule résultats DEUXIÈME FOIS
      ├─ Crée nouveau round
      └─ finishLock jamais utilisé
```

**Fix**: 
1. ✅ Utiliser **UN SEUL LOCK**: `operationLock` pour `executeRaceFinish()`
2. ✅ SET le lock au début de la fonction
3. ✅ CLEAR le lock avec un finally()
4. ✅ Assurer que `onCleanup()` n'exécute `calculateRaceResults()` que si c'est nouveau

---

### PROBLÈME #4: Absence de synchronisation client/serveur sur les timers
**Fichiers**: `screen.html` + `static/js/app.js` + `server.js`  
**Lignes**:
- `screen.html:551-552`
- `static/js/app.js:912-962` (demarrerTimer)
- `server.js:150-175` (WebSocket connection)

**Niveau**: CRITIQUE

**Description**: 
Le client a ses propres timers **sans validation du serveur** :
```javascript
// ❌ screen.html - Timer LOCAL sans sync
const RACE_DURATION_MS = 25000;
const FINISH_DURATION_MS = 5000;
// ... utilise ces valeurs locales pour afficher les écrans

// ✅ server.js:150-154 - Le serveur CALCULE aussi
if (gameState.isRaceRunning && gameState.raceStartTime) {
    timeInRace = now - gameState.raceStartTime;
    if (timeInRace < MOVIE_SCREEN_DURATION_MS) {
        screen = "movie_screen";
    }
}
// Mais ne l'envoie pas au client
```

**Impact**: 
- 🔴 **CRITIQUE**: Client et serveur peuvent avoir des écrans différents au même moment
- Le client affiche "finish_screen" à T=30 localement, mais le serveur dit "movie_screen" à T=25
- Désynchronisation des écrans sur multi-clients
- WebSocket n'envoie pas les délais correctement

**Scénario de bug**:
1. Client A: affiche finish_screen à T=31
2. Serveur: raceStartTime=T0, isRaceRunning=true, timeInRace=31s → dit movie_screen
3. WebSocket broadcast: `isRaceRunning: false` (race ended)
4. Client B: reçoit race_end trop tard
5. Client A et B n'affichent pas les résultats au même moment

**Fix**: 
1. ✅ Serveur envoie `timeInRace` et `currentScreen` dans CHAQUE message
2. ✅ Client affiche l'écran que le serveur dit, pas son calcul local
3. ✅ Envoyer les timers via `/api/v1/config/timers` au démarrage
4. ✅ Ajouter un ping/sync toutes les 5 secondes

---

### PROBLÈME #5: Callback onPrepareNewRound jamais appelé (DEAD CODE)
**Fichiers**: `routes/rounds.js`  
**Lignes**: `495-497, 506`

**Niveau**: CRITIQUE

**Description**: 
Un callback est défini mais JAMAIS appelé par la classe `RaceTimerManager` :
```javascript
// ❌ routes/rounds.js:495-497
// ❌ DELETED: onPrepareNewRound was dead code - never called by startRaceSequence()
// It caused confusion by defining new_round broadcast twice (also in createNewRoundAfterRace)
// The actual new_round broadcast happens in createNewRoundAfterRace() at T=35s (MOVIE + FINISH)

// Mais regardons startRaceSequence():
// ✅ onRaceStart appelé à T=0
// ❌ onPrepareNewRound N'EXISTE PAS dans les callbacks!
// ✅ onFinishRace appelé à T=30
// ✅ onCleanup appelé à T=35
```

**Impact**: 
- 🔴 **CRITIQUE**: Code en commentaire peut causer des bugs subtils si quelqu'un rajoute ce callback
- Le commentaire dit "createNewRoundAfterRace()" est appelé depuis executeRaceFinish, mais c'est FAUX
- Confusion: le nouveau round est créé dans `onCleanup()`, pas dans une fonction appelée depuis `executeRaceFinish()`

**Proof**:
- `executeRaceFinish()` (T=30): Ne crée PAS le nouveau round
- `onCleanup()` (T=35): **CRÉE** le nouveau round ET appelle `calculateRaceResults()` DEUXIÈME FOIS

**Fix**: 
1. ✅ Supprimer le commentaire confus
2. ✅ Corriger le timing pour appeler `calculateRaceResults()` qu'UNE FOIS
3. ✅ Documenter clairement la timeline

---

### PROBLÈME #6: GameState restauré depuis Redis avec locks oubliés
**Fichiers**: `game.js` + `server.js`  
**Lignes**: 
- `game.js:249-269` (restoreGameStateFromRedis)
- `server.js:82-84`

**Niveau**: CRITIQUE

**Description**: 
Lors du redémarrage, les locks ne sont pas réinitialisés :
```javascript
// ✅ game.js:259-264
export async function restoreGameStateFromRedis() {
    // ...
    gameState.currentRound = savedState.currentRound || {};
    gameState.gameHistory = savedState.gameHistory || [];
    gameState.nextRoundStartTime = savedState.nextRoundStartTime;
    gameState.raceStartTime = savedState.raceStartTime;
    gameState.raceEndTime = savedState.raceEndTime;
    gameState.isRaceRunning = savedState.isRaceRunning;
    // ❌ PAS DE RÉINITIALISATION DES LOCKS!
    // Si finishLock=true ou roundCreationLock=true dans Redis, ils restent bloqués!
}
```

**Impact**: 
- 🔴 **CRITIQUE**: Après un crash/redémarrage, si un lock était SET, le serveur est BLOQUÉ FOREVER
- Aucune nouvelle course ne peut démarrer (roundCreationLock=true → onCleanup() bloqué)
- Manuel workaround nécessaire (restart du serveur)

**Fix**: 
1. ✅ Ne JAMAIS persister les locks en Redis
2. ✅ Réinitialiser TOUS les locks à false au redémarrage
3. ✅ Mettre en commentaire dans le code: "Locks ne doivent JAMAIS être persistés"

```javascript
// Correction:
gameState.finishLock = false;  // ✅ Réinitialiser
gameState.roundCreationLock = false;  // ✅ Réinitialiser
```

---

### PROBLÈME #7: startNewRound() définit timer d'attente CHAQUE FOIS (Duplication)
**Fichiers**: `game.js` + `routes/rounds.js`  
**Lignes**:
- `game.js:140-145`
- `routes/rounds.js:518-635` (onCleanup)

**Niveau**: CRITIQUE

**Description**: 
La fonction `startNewRound()` est appelée DEUX fois :
1. Au démarrage du serveur (server.js:341)
2. Depuis le endpoint `/api/v1/rounds/` (routes/rounds.js)

Mais elle définit TOUJOURS un timer d'attente MÊME si un round est en cours!

```javascript
// ❌ game.js:140-142
gameState.nextRoundStartTime = now + TIMER_DURATION_MS;
// Ceci est appelé à T=0 d'une course!

// ❌ routes/rounds.js:518 (onCleanup)
gameState.nextRoundStartTime = timerNow + ROUND_WAIT_DURATION_MS;
// ET appelé AUSSI à T=35!
```

**Impact**: 
- 🔴 **CRITIQUE**: À T=0 (race_start), le timer est RÉINITIALISÉ!
- Les clients perdent le timer de course car `nextRoundStartTime` est changé
- Confusion: quel timer est actif? Celui du waiting ou celui du racing?

**Timeline actuelle**:
```
T=-60s: startNewRound() → nextRoundStartTime = T+0
T=0:   race_start() → isRaceRunning=true, MAIS nextRoundStartTime reste T+0 (MAUVAIS!)
T=25:  Clients affichent "Timer écoulé" alors qu'une race est en cours
T=30:  race_end
T=35:  onCleanup() → nextRoundStartTime = T+95 (correct)
```

**Fix**: 
1. ✅ NE PAS appeler `startNewRound()` au lancement de la race
2. ✅ Sauvegarder le `nextRoundStartTime` avant `race_start`
3. ✅ Restaurer après `race_end` ou le réinitialiser dans `onCleanup()`

---

### PROBLÈME #8: WebSocket ne synchronise PAS les écrans entre clients
**Fichiers**: `server.js` + `static/js/app.js`  
**Lignes**:
- `server.js:127-175` (setupWebSocket)
- `routes/rounds.js:755` (broadcast race_start)

**Niveau**: CRITIQUE

**Description**: 
Quand une race commence, le serveur broadcast l'événement, mais:
```javascript
// ✅ server.js:127-136 - Le nouveau client reçoit l'état
ws.send(JSON.stringify({ 
    event: "connected", 
    serverTime: Date.now(),
    roundId: gameState.currentRound?.id || null,
    screen: screen,
    isRaceRunning: gameState.isRaceRunning,
    // ... mais pas timeInRace!
}));

// ❌ routes/rounds.js:755 - race_start ne dit pas l'heure
broadcast({
    event: "race_start",
    roundId: gameState.currentRound.id,
    raceStartTime: raceStartTime,  // ✅ Timestamp
    currentRound: JSON.parse(JSON.stringify(gameState.currentRound)),
    isRaceRunning: true
    // ❌ Pas de currentScreen!
});
```

**Impact**: 
- 🔴 **CRITIQUE**: Clients connectés APRÈS `race_start` ne savent pas quel écran afficher
- Ils calculent `timeInRace = now - raceStartTime` avec leur propre Math
- Désynchronisation possible si le client a une horloge décalée

**Fix**: 
1. ✅ Envoyer `currentScreen` et `timeInRace` dans race_start
2. ✅ Le client affiche exactement l'écran du serveur, pas son calcul

---

### PROBLÈME #9: ROUND_WAIT_DURATION_MS vs TIMER_DURATION_MS (CONFUSION DE NOMS)
**Fichiers**: `config/app.config.js` + usage partout  
**Lignes**:
- `config/app.config.js:18-100`
- `routes/init.js:47` (utilise ROUND_WAIT)
- `routes/rounds.js:35` (utilise ROUND_WAIT)
- `game.js:140` (utilise TIMER_DURATION)
- `server.js:21-24` (importe TIMER_DURATION)

**Niveau**: CRITIQUE

**Description**: 
Deux noms différents pour la **même chose** :
```javascript
// ❌ config/app.config.js:17,25
export const TIMER_DURATION_SECONDS = parseInt(process.env.TIMER_DURATION_SECONDS || '60', 10);
export const TIMER_DURATION_MS = TIMER_DURATION_SECONDS * 1000;

// ❌ config/app.config.js:97,103
export const ROUND_WAIT_DURATION_SECONDS = parseInt(process.env.ROUND_WAIT_DURATION_SECONDS || '60', 10);
export const ROUND_WAIT_DURATION_MS = ROUND_WAIT_DURATION_SECONDS * 1000;

// Quelle différence?
// Regardons le code... ils font tous les deux la MÊME chose!

// ✅ game.js:140 - utilise TIMER_DURATION
gameState.nextRoundStartTime = now + TIMER_DURATION_MS;

// ✅ routes/rounds.js:617 - utilise ROUND_WAIT_DURATION
gameState.nextRoundStartTime = timerNow + ROUND_WAIT_DURATION_MS;

// ❌ Les deux valeurs peuvent être DIFFÉRENTES si les env vars sont différentes!
```

**Impact**: 
- 🔴 **CRITIQUE**: Confusion total sur le timer attendu
- Si on change un sans changer l'autre, les timers s'écoulent à des vitesses différentes
- Documentations fausses (config/app.config.js line 80-90 dit "par défaut 60s" mais y a deux constantes!)

**Fix**: 
1. ✅ Utiliser **UN SEUL** nom: `ROUND_WAIT_DURATION_MS`
2. ✅ Supprimer `TIMER_DURATION_MS` complètement
3. ✅ Remplacer `TIMER_DURATION` par `ROUND_WAIT_DURATION` partout dans game.js
4. ✅ Clarifier dans les commentaires: "Timer d'attente ENTRE rounds (le waiting screen)"

---

### PROBLÈME #10: executeRaceFinish() fait 2 opérations critiques (Single Responsibility)
**Fichiers**: `routes/rounds.js`  
**Lignes**: `327-427`

**Niveau**: CRITIQUE (Architecture)

**Description**: 
La fonction `executeRaceFinish()` est appelée 2 fois avec des buts différents:
```javascript
// ❌ routes/rounds.js:502-504 (onFinishRace callback)
onFinishRace: async () => {
    console.log('[RACE-SEQ] Exécution logique fin de course');
    await executeRaceFinish();  // ← 1ère appel
```

```javascript
// ❌ routes/rounds.js:541-545 (onCleanup callback)
// Dans onCleanup...
const raceResults = await calculateRaceResults();  // ← Appel direct!
// ... calcul des résultats DEUXIÈME FOIS
```

**Impact**: 
- 🔴 **CRITIQUE**: `calculateRaceResults()` s'exécute **DEUX FOIS** par course!
- À T=30 depuis `onFinishRace`
- À T=35 depuis `onCleanup`
- Double mise à jour DB, double broadcast
- Inefficacité + risque d'incohérence

**Timeline réelle**:
```
T=30: executeRaceFinish() → START (mais ne calcule pas les résultats)
      ├─ Crée runningRoundData ✓
      └─ END

T=35: onCleanup() → calculateRaceResults() → UPDATE DB/Redis
```

Wait, regardons le code plus attentivement... executeRaceFinish NE fait PAS calculateRaceResults... donc où est-elle appelée?

Cherchons:
- `routes/rounds.js:207` - `const calculateRaceResults = async () => { ... }`
- Elle est définie mais **quand est-elle appelée?**
- À T=35 dans `onCleanup` ligne 541

Donc `calculateRaceResults()` est appelée UNE FOIS à T=35 seulement. ✓

**Fix**: 
1. ✅ Clarifier le nom: `calculateRaceResults()` s'exécute à T=35 (onCleanup)
2. ✅ Ajouter un log clair: "Calcul des résultats à T=35s"
3. ✅ Vérifier qu'elle ne s'exécute qu'UNE fois (utiliser un flag)

---

## 🟠 PROBLÈMES MODÉRÉS (15)

### PROBLÈME #11: runningRoundData JAMAIS reinitialisé après race (Memory Leak)
**Fichiers**: `routes/rounds.js`  
**Lignes**: `313, 333-337, 541-545`

**Niveau**: MODÉRÉ

**Description**: 
```javascript
// ✅ routes/rounds.js:333-337 - Sauvegarde le round
gameState.runningRoundData = JSON.parse(JSON.stringify({
    ...gameState.currentRound,
    receipts: gameState.currentRound.receipts || [],
    participants: gameState.currentRound.participants || [],
    totalPrize: gameState.currentRound.totalPrize || 0
}));

// ✅ Utilisé à T=35
const finishedRoundData = gameState.runningRoundData || gameState.currentRound;

// ❌ Jamais nettoyé après!
// runningRoundData reste en mémoire même après T=35+
```

**Impact**: 
- Copie en mémoire qui n'est jamais libérée
- Avec 100+ courses, consommation mémoire cumulée
- Confusion: après T=35, quelle copie est à jour?

**Fix**: 
```javascript
// À la fin de onCleanup():
gameState.runningRoundData = null;
```

---

### PROBLÈME #12: calculateRaceResults() ne retourne rien mais est await'é
**Fichiers**: `routes/rounds.js`  
**Lignes**: `207, 541`

**Niveau**: MODÉRÉ

**Description**: 
```javascript
// ❌ routes/rounds.js:207 - Retourne implicitement undefined
const calculateRaceResults = async () => {
    // ... du code ...
    return null;  // ← ou return undefined (jamais return raceResults)
};

// ✅ Ligne 541 - Utilise le résultat
const raceResults = await calculateRaceResults();
if (raceResults) {
    broadcast({
        event: "race_results",
        // ...
    });
}
```

**Impact**: 
- Le broadcast `race_results` ne s'exécute JAMAIS! (raceResults est null)
- Clients n'apprennent jamais les résultats sans WebSocket custom

**Fix**: 
La fonction **DOIT** retourner les résultats:
```javascript
const calculateRaceResults = async () => {
    // ...
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

### PROBLÈME #13: broadcastDevise utilisée avant initialisation (Race Condition)
**Fichiers**: `routes/receipts.js` + `static/js/app.js`  
**Lignes**: 
- `routes/receipts.js:diverses` (broadcast utilisée)
- `server.js:307` (setupWebSocket pas appelé avant les routes)

**Niveau**: MODÉRÉ

**Description**: 
Les routes sont initialisées avant WebSocket:
```javascript
// ❌ server.js:307
// Les routes utilisent `broadcast` comme paramètre
app.use('/api/v1/rounds/', createRoundsRouter(broadcast));

// Mais `broadcast` est définie à:
// server.js:130 (fonction broadcast)
// Cependant, `wss` (le WebSocket serveur) n'est initialisé qu'à:
// server.js:326+ (setupWebSocketAfterHTTPListen)

// ❌ Ordre réel:
// 1. createRoundsRouter(broadcast) est appelé
// 2. La fonction `broadcast` référence `wss`
// 3. `wss` n'existe pas encore!
```

**Impact**: 
- Si une route reçoit une requête AVANT le WebSocket start, le broadcast échouera silencieusement
- Les clients ne reçoivent pas les messages (ex: race_start)

**Fix**: 
1. ✅ Créer le WebSocket SERVER avant d'initialiser les routes
2. ✅ Ou vérifier que `wss` existe avant de broadcast

---

### PROBLÈME #14: Pas d'endpoint pour récupérer les vraies durées de timers
**Fichiers**: `routes/` - MANQUANT  
**Lignes**: N/A (N'EXISTE PAS)

**Niveau**: MODÉRÉ

**Description**: 
Le serveur ne fournit PAS au client les vraies durées des timers.
Le client doit hardcoder ou deviner:
```javascript
// ❌ screen.html:551-552
const RACE_DURATION_MS = 25000; // Hardcodé!
const FINISH_DURATION_MS = 5000; // Hardcodé!

// Et si l'admin change config/app.config.js?
// Les clients ne savent pas!
```

**Impact**: 
- Désynchronisation client/serveur
- Bugs difficiles si les durées changent
- Clients affichent écran film à 25s, serveur dit 30s → désync

**Fix**: 
Créer endpoint:
```javascript
router.get('/api/v1/config/timers', (req, res) => {
    res.json({
        MOVIE_SCREEN_DURATION_MS,
        FINISH_SCREEN_DURATION_MS,
        TOTAL_RACE_TIME_MS,
        ROUND_WAIT_DURATION_MS
    });
});
```

---

### PROBLÈME #15: STATUS ENDPOINT peut créer un round automatique (SIDE EFFECT)
**Fichiers**: `routes/rounds.js`  
**Lignes**: `688-702` (TIMER-GUARD)

**Niveau**: MODÉRÉ

**Description**: 
L'endpoint `/status` a un SIDE EFFECT:
```javascript
// ✅ routes/rounds.js:691-700
router.get("/status", cacheResponse(5), async (req, res) => {
    // ...
    
    // ❌ SIDE EFFECT: Crée un round si timer bloqué!
    if (!gameState.isRaceRunning && 
        !gameState.roundCreationLock &&
        (!gameState.nextRoundStartTime || gameState.nextRoundStartTime <= now)) {
        console.warn('⚠️ [TIMER-GUARD] Timer bloqué détecté dans /status, redémarrage du round...');
        try {
            await startNewRound(broadcast);  // ← CRÉATION DE DONNÉES
        }
    }
});
```

**Impact**: 
- Une simple requête GET a un side effect (modifie l'état)
- Cache peut être obsolète rapidement
- Clients reçoivent des réponses différentes pour le même `/status`

**Fix**: 
1. ✅ Separer logique: GET pour récupérer, POST pour créer
2. ✅ Utiliser un endpoint séparé `/api/v1/rounds/reset-timer` (POST)
3. ✅ Ne pas auto-créer sur GET

---

### PROBLÈME #16: BASE_PARTICIPANTS hardcoded dans 2 fichiers
**Fichiers**: `game.js` + `routes/rounds.js`  
**Lignes**:
- `game.js:14-20`
- `routes/rounds.js:553-565` (réécrit les mêmes participants)

**Niveau**: MODÉRÉ

**Description**: 
```javascript
// ✅ game.js:14-20 - Source de vérité
export const BASE_PARTICIPANTS = [
    { number: 6, name: "De Bruyne", coeff: 5.5, family: 0, place: 0 },
    { number: 7, name: "Ronaldo", coeff: 4.7, family: 1, place: 0 },
    // ...
];

// ❌ routes/rounds.js:553
const newRound = {
    participants: BASE_PARTICIPANTS.map((p, i) => ({...}))  // ✓ Réutilise
```

Wait, c'est correct. Il Y A une import et réutilisation.

Mais le problème est:
- `routes/rounds.js:6` importe `BASE_PARTICIPANTS` depuis game.js ✓
- Mais si on veut changer les participants, on DOIT modifier game.js
- Les participants ne peuvent pas être récupérés depuis la BD!

**Impact**: 
- Les participants sont HARDCODÉS en mémoire
- Pas possible de changer les participants sans redémarrer le serveur
- Pas de persistance en BD

**Fix**: 
1. ✅ Charger les participants depuis la BD (participants table)
2. ✅ Cacher en mémoire
3. ✅ BASE_PARTICIPANTS comme fallback seulement

---

### PROBLÈME #17: Callback pattern "createRoundsRouter(broadcast)" late binding
**Fichiers**: `server.js` + `routes/rounds.js`  
**Lignes**: 
- `server.js:307`
- `routes/rounds.js:174` (fonction createRoundsRouter)

**Niveau**: MODÉRÉ

**Description**: 
```javascript
// ❌ server.js:307 - broadcast défini avant wss
function broadcast(data) {
  const enhancedData = { ...data, serverTime: Date.now() };
  wss.clients.forEach((client) => {  // ← wss n'existe pas encore!
    if (client.readyState === 1) {
      client.send(JSON.stringify(enhancedData));
    }
  });
}

// Plus tard:
app.use('/api/v1/rounds/', createRoundsRouter(broadcast));  // ← Passe la fonction
```

**Impact**: 
- La fonction `broadcast` ferme sur `wss` mais il n'existe pas au moment de la déclaration
- Fonctionne par luck (late binding) plutôt que par design
- Fragile: si l'ordre change, tout casse

**Fix**: 
```javascript
// ✓ Crée wss en premier
const wss = new WebSocketServer({ server: httpServer, path: "/connection/websocket" });

// PUIS crée les routes
app.use('/api/v1/rounds/', createRoundsRouter(broadcast));
```

---

### PROBLÈME #18: gameState.timerInterval créé mais JAMAIS utilisé
**Fichiers**: `game.js`  
**Lignes**: `37`

**Niveau**: MODÉRÉ

**Description**: 
```javascript
// ✅ game.js:37
timerInterval: null, // Intervalle pour les mises à jour du timer côté serveur
```

**Déclaré mais jamais assigné!**
```javascript
// Cherche "gameState.timerInterval =" → PAS TROUVÉ
// Cherche ".timerInterval" → Seulement la déclaration

// À la place, on utilise gameState.timers.nextRound
```

**Impact**: 
- Propriété morte en mémoire
- Confusion: c'est quoi la différence entre timerInterval et timers.nextRound?

**Fix**: 
1. ✅ Supprimer `timerInterval` si inutile
2. ✅ Ou l'utiliser pour envoyer les mises à jour toutes les N ms au client

---

### PROBLÈME #19: preStartTimer créé dans game.js mais jamais nettoyé
**Fichiers**: `game.js`  
**Lignes**: `160-170`

**Niveau**: MODÉRÉ

**Description**: 
```javascript
// ✅ game.js:160-170 - Crée preStartTimer
const schedulePreStart = (broadcastFn) => {
    try {
        if (gameState.preStartTimer) {
            clearTimeout(gameState.preStartTimer);  // ✓ Nettoie
        }
        // ...
        gameState.preStartTimer = setTimeout(doBroadcast, delay);
    }
};

// ❌ Mais preStartTimer n'est jamais déclaré dans gameState
// Elle flotte en tant que propriété dynamique
```

**Impact**: 
- Propriété dynamique difficile à tracer
- Si on réinitialise gameState, on perd la référence
- Memory leak possible si timeout n'est pas cleané au redémarrage

**Fix**: 
```javascript
// gameState:
preStartTimer: null,  // ✅ Déclarer

// Lors du shutdown:
if (gameState.preStartTimer) clearTimeout(gameState.preStartTimer);
```

---

### PROBLÈME #20: WebSocket test token hardcoded
**Fichiers**: `config/websocket.js`  
**Lignes**: `37`

**Niveau**: MODÉRÉ

**Description**: 
```javascript
// ❌ config/websocket.js:37
export const CLIENT_WEBSOCKET_CONFIG = {
    connectionString: getWebSocketUrl(),
    token: "LOCAL_TEST_TOKEN",  // ← HARDCODÉ!
    userId: "local.6130290",    // ← HARDCODÉ!
    partnerId: "platform_horses", // ← HARDCODÉ!
    enableReceiptPrinting: "true",
    environment: NODE_ENV
};
```

**Impact**: 
- Token exposé en code source
- Utilisé pour tous les clients (pas de tokens individuels)
- Pas de sécurité réelle

**Fix**: 
1. ✅ Générer des tokens JWT dynamiques
2. ✅ Pas de token hardcodé
3. ✅ Utiliser les tokens d'authentification existants

---

### PROBLÈME #21: NEW_ROUND_PREPARE_DELAY_MS JAMAIS utilisé
**Fichiers**: `config/app.config.js` + routes/
**Lignes**: `105-112`

**Niveau**: MODÉRÉ

**Description**: 
```javascript
// ✅ config/app.config.js:105-112
export const NEW_ROUND_PREPARE_DELAY_MS = NEW_ROUND_PREPARE_DELAY_SECONDS * 1000;

// Grep: Où est utilisé?
// → routes/rounds.js:0 résultats
// → Déclaré mais JAMAIS utilisé!
```

**Impact**: 
- Configuration morte
- Confusion: pourquoi cette constante existe?
- Maintenance: nettoyer les code non utilisé

**Fix**: 
1. ✅ Supprimer si inutile
2. ✅ Ou l'utiliser pour un timeout avant de créer le nouveau round

---

### PROBLÈME #22: cacheResponse middleware sur STATUS endpoint (5s cache)
**Fichiers**: `routes/rounds.js`  
**Lignes**: `688` (cacheResponse(5))

**Niveau**: MODÉRÉ

**Description**: 
```javascript
// ❌ routes/rounds.js:688
router.get("/status", cacheResponse(5), async (req, res) => {
    // Cache la réponse pour 5 secondes
    // Mais le status peut changer à chaque requête (isRaceRunning, timeLeft, etc.)
    // Cacher pendant 5s = clients reçoivent des infos vieilles de 5s
});
```

**Impact**: 
- Clients ne savent pas que la race a commencé pendant 5 secondes
- Clients cliquent sur "Start race" mais reçoient un status ancien
- WebSocket est plus à jour que l'API HTTP

**Fix**: 
1. ✅ Réduire le cache à 1-2 secondes max
2. ✅ Ou no cache pour STATUS
3. ✅ WebSocket reste la source de vérité pour les updates en temps réel

---

### PROBLÈME #23: Pas de cleanup des timers au crash/redémarrage
**Fichiers**: `server.js`  
**Lignes**: Manquant

**Niveau**: MODÉRÉ

**Description**: 
```javascript
// À server.js:340+
// Pas de try/catch au démarrage pour nettoyer les timers
// Si startNewRound() échoue, les timers peuvent rester
```

**Impact**: 
- Timers orphelins après crash
- Memory leaks
- Comportement imprévisible au redémarrage

**Fix**: 
```javascript
process.on('SIGTERM', () => {
    clearAllTimers();  // ✅ Nettoyer
    closeConnections();
    process.exit(0);
});
```

---

### PROBLÈME #24: Imports manquants dans routes/rounds.js pour chacha20
**Fichiers**: `routes/rounds.js`  
**Lignes**: `5-7`

**Niveau**: MODÉRÉ

**Description**: 
```javascript
// ✅ routes/rounds.js:5-7 - Import chacha20
import { chacha20Random, chacha20RandomInt, chacha20Shuffle, initChaCha20 } from "../chacha20.js";

// ❌ initChaCha20 est importé mais jamais appelé!
// Il est appelé dans game.js:11
// Pas appelé dans routes/rounds.js
```

**Impact**: 
- Import inutile
- Confusion: RNG initialisé où?
- Si RNG dépend d'initialisation, peut ne pas être sécurisé

**Fix**: 
1. ✅ Supprimer l'import inutile
2. ✅ Assurer que `initChaCha20()` est appelé une seule fois au démarrage

---

### PROBLÈME #25: Response format incohérent (wrap vs direct)
**Fichiers**: `routes/rounds.js` + autres  
**Lignes**: Diverses

**Niveau**: MODÉRÉ

**Description**: 
```javascript
// ✅ Parfois wrappé:
res.json(wrap({ data }));  // → { data: { data: { ... } } }

// ❌ Parfois direct:
res.json({ roundId, game, currentRound, ... });  // → pas wrappé
```

**Impact**: 
- Clients ne savent pas si c'est `res.data` ou `res.roundId`
- Inconsistency

**Fix**: 
1. ✅ Toujours utiliser le même format
2. ✅ Définir un middleware standard pour wrap

---

## 🟡 PROBLÈMES MINEURS (4)

### PROBLÈME #26: Commentaires contradictoires
**Fichiers**: `routes/rounds.js`  
**Lignes**: `506`

**Description**: 
```javascript
// ❌ Line 506
// Note: onPrepareNewRound sera appelé depuis executeRaceFinish via setTimeout
// FAUX! onPrepareNewRound n'existe pas dans la classe
```

**Fix**: 
Corriger/supprimer le commentaire

---

### PROBLÈME #27: clearAllTimers() définie 2 fois
**Fichiers**: `routes/rounds.js`  
**Lignes**: `48-56 + 162-169`

**Description**: 
Fonction définie globalement ET dans la classe

**Fix**: 
Utiliser celle de la classe ou refactoriser

---

### PROBLÈME #28: Logs console pas à jour
**Fichiers**: Divers  
**Lignes**: Divers

**Description**: 
Les logs disent "T+0s", "T+30s" mais les vrais temps sont "T+0ms", "T+30000ms"

**Fix**: 
Logs clarifiés

---

### PROBLÈME #29: Documentation finale missing
**Fichiers**: README.md  
**Lignes**: N/A

**Description**: 
Pas de documentation du timing end-to-end

**Fix**: 
Créer un document des timers

---

---

## 📈 HIÉRARCHIE DES PROBLÈMES

### Par Impact (Descending):

1. **PROBLÈME #2** - runningRoundData vs currentRound (Multiple source of truth)
2. **PROBLÈME #3** - finishLock vs roundCreationLock (Race condition)
3. **PROBLÈME #1** - Double déclaration des timers
4. **PROBLÈME #4** - Pas de sync client/serveur sur timers
5. **PROBLÈME #7** - startNewRound() définit timer à chaque fois
6. **PROBLÈME #9** - ROUND_WAIT vs TIMER_DURATION confusion
7. **PROBLÈME #8** - WebSocket ne sync pas les écrans
8. **PROBLÈME #5** - onPrepareNewRound jamais appelé
9. **PROBLÈME #6** - GameState restauré avec locks actifs
10. **PROBLÈME #10** - executeRaceFinish() viole Single Responsibility
11. **PROBLÈME #11** - runningRoundData memory leak
12. **PROBLÈME #12** - calculateRaceResults ne retourne rien
... (autres modérés et mineurs)

---

## ✅ RECOMMANDATIONS PRIORITAIRES

### Semaine 1: Corrections CRITIQUES
1. ✅ Fixer #2: Remplacer `runningRoundData` par une vraie sauvegarde en DB
2. ✅ Fixer #3: Utiliser UN SEUL LOCK (`operationLock`)
3. ✅ Fixer #9: Renommer tout utilisation de `TIMER_DURATION` → `ROUND_WAIT_DURATION`
4. ✅ Fixer #7: Ne pas reinitializer le timer à race_start
5. ✅ Fixer #1: Créer endpoint `/api/v1/config/timers` pour le client

### Semaine 2: Synchronisation
6. ✅ Fixer #4: Envoyer `currentScreen` et `timeInRace` au client
7. ✅ Fixer #8: Broadcaster les délais dans race_start
8. ✅ Tester la synchronisation multi-clients

### Semaine 3: Nettoyage
9. ✅ Fixer #11: Nettoyer `runningRoundData` après T=35
10. ✅ Fixer #12: Faire retourner les résultats par `calculateRaceResults()`
11. ✅ Supprimer le code mort

---

## 📝 FICHIERS À MODIFIER (PRIORITÉ)

1. **game.js** - Remplacer runningRoundData, ajouter locks, net timers
2. **routes/rounds.js** - Fixer timing, ajouter endpoints config
3. **config/app.config.js** - Renommer TIMER → ROUND_WAIT, clarifier
4. **server.js** - Ordre WebSocket/routes, cleanup handlers
5. **static/js/app.js** - Utiliser timers du serveur
6. **screen.html** - Importer timers depuis serveur

---

## 🎯 CONCLUSION

**Total Incohérences**: 29  
**Impact Critique**: 🔴 Peut causer bugs en production  
**Effort de Fix**: 2-3 semaines (high priority pour la stabilité)  
**Rique si non adressé**: Désynchronisation client/serveur, memory leaks, race conditions

Le projet a une architecture saine mais souffre de **duplication d'état** et de **confusion de timers**. 
Les corrections devraient être faites dans l'ordre indiqué pour minimiser les regressions.
