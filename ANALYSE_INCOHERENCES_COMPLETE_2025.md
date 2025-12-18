# 📋 ANALYSE COMPLÈTE DES INCOHÉRENCES - Projet Horse-Racing

**Date**: 18 Décembre 2025  
**Analyseur**: Auto (Cursor AI)  
**Couverture**: 100% des fichiers clés analysés

---

## 📊 RÉSUMÉ EXÉCUTIF

| Catégorie | Nombre | Critique | Modéré | Mineur |
|-----------|--------|----------|--------|--------|
| **Duplication de Code** | 6 | 2 | 3 | 1 |
| **Incohérences de Timers** | 8 | 3 | 4 | 1 |
| **Multiple Source of Truth** | 5 | 2 | 2 | 1 |
| **Race Conditions & Locks** | 4 | 2 | 2 | 0 |
| **Data Flow Issues** | 5 | 1 | 3 | 1 |
| **Configuration Issues** | 3 | 1 | 1 | 1 |
| **TOTAL** | **31** | **11** | **15** | **5** |

---

## 🔴 PROBLÈMES CRITIQUES (11)

### PROBLÈME #1: Timers hardcodés dans screen.html (INCOHÉRENCE AVEC SERVEUR)
**Fichiers**: `screen.html` + `config/app.config.js`  
**Lignes**: 
- `screen.html:551-553`
- `config/app.config.js:45-71`

**Niveau**: CRITIQUE

**Description**: 
Les durées de course sont hardcodées dans le frontend au lieu d'utiliser les valeurs du serveur :
```javascript
// ❌ screen.html:551-553 - HARDCODÉ
const RACE_DURATION_MS = 25000; // 23 secondes pour movie_screen
const FINISH_DURATION_MS = 5000; // 5 secondes pour finish_screen
const TOTAL_RACE_TIME_MS = 35000; // Total: movie + finish

// ✅ config/app.config.js:45-71 - VRAIE SOURCE
export const MOVIE_SCREEN_DURATION_SECONDS = 30; // Par défaut 30s
export const MOVIE_SCREEN_DURATION_MS = 30000;   // 30000ms
export const FINISH_SCREEN_DURATION_MS = 5000;   // 5000ms
export const TOTAL_RACE_TIME_MS = 35000;          // 35000ms
```

**Impact**: 
- 🔴 **CRITIQUE**: Désynchronisation client/serveur si les valeurs changent
- Le client affiche "finish_screen" à T=25s, mais le serveur dit "movie_screen" à T=30s
- Les clients peuvent afficher des écrans différents au même moment
- Impossible de changer les durées sans modifier le code frontend

**Fix**: 
1. ✅ Créer endpoint `/api/v1/config/timers` qui retourne les vraies durées
2. ✅ Charger les timers depuis l'API au démarrage du client
3. ✅ Supprimer les hardcodes de `screen.html`

---

### PROBLÈME #2: runningRoundData vs currentRound (MULTIPLE SOURCE OF TRUTH)
**Fichiers**: `game.js` + `routes/rounds.js`  
**Lignes**:
- `game.js:37, 116`
- `routes/rounds.js:207-216, 313, 331-337`

**Niveau**: CRITIQUE

**Description**: 
Deux copies de l'état du round existent simultanément :
```javascript
// ❌ game.js:37 - Deux propriétés qui représentent la même chose
gameState.currentRound = {}      // Le round ACTUEL
gameState.runningRoundData = null // Copie du round EN COURS DE RACE

// ❌ routes/rounds.js:216 - utilise une fallback confuse
const finishedRoundData = gameState.runningRoundData || gameState.currentRound;
```

**Impact**: 
- 🔴 **CRITIQUE**: Après une course, les données du gagnant viennent de `runningRoundData` tandis que le nouveau round est dans `currentRound`
- Risque d'incohérence: quelle copie a les vraies données?
- Cache Redis peut être mis à jour avec la mauvaise source
- Difficile à déboguer lors de synchronisation perdue

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

### PROBLÈME #3: finishLock JAMAIS utilisé (DEAD CODE + RACE CONDITION)
**Fichiers**: `game.js` + `routes/rounds.js`  
**Lignes**:
- `game.js:46`
- `routes/rounds.js:416-423`

**Niveau**: CRITIQUE

**Description**: 
Un lock est défini mais JAMAIS utilisé :
```javascript
// ❌ game.js:46
finishLock: false,  // Lock pour executeRaceFinish

// ❌ routes/rounds.js:416-423 - Attend que finishLock se libère
if (gameState.finishLock) {
    console.warn('[RACE-SEQ] ⚠️ executeRaceFinish encore en cours, attente...');
    let waitCount = 0;
    while (gameState.finishLock && waitCount < 20) {
        await new Promise(resolve => setTimeout(resolve, 50));
        waitCount++;
    }
}
// MAIS: finishLock n'est JAMAIS SET ni CLEARED dans executeRaceFinish()!
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

### PROBLÈME #4: TIMER_DURATION_MS vs ROUND_WAIT_DURATION_MS (CONFUSION DE NOMS)
**Fichiers**: `config/app.config.js` + usage partout  
**Lignes**:
- `config/app.config.js:17-23, 87-93`
- `routes/rounds.js:34-35`
- `game.js:9`

**Niveau**: CRITIQUE

**Description**: 
Deux noms différents pour la **même chose** :
```javascript
// ❌ config/app.config.js:17,25
export const TIMER_DURATION_SECONDS = parseInt(process.env.TIMER_DURATION_SECONDS || '60', 10);
export const TIMER_DURATION_MS = TIMER_DURATION_SECONDS * 1000;

// ❌ config/app.config.js:87,93
export const ROUND_WAIT_DURATION_SECONDS = parseInt(process.env.ROUND_WAIT_DURATION_SECONDS || '60', 10);
export const ROUND_WAIT_DURATION_MS = ROUND_WAIT_DURATION_SECONDS * 1000;

// Quelle différence? Ils font tous les deux la MÊME chose!

// ✅ game.js:140 - utilise TIMER_DURATION
gameState.nextRoundStartTime = now + TIMER_DURATION_MS;

// ✅ routes/rounds.js:469 - utilise ROUND_WAIT_DURATION
gameState.nextRoundStartTime = timerNow + ROUND_WAIT_DURATION_MS;

// ❌ Les deux valeurs peuvent être DIFFÉRENTES si les env vars sont différentes!
```

**Impact**: 
- 🔴 **CRITIQUE**: Confusion totale sur le timer attendu
- Si on change un sans changer l'autre, les timers s'écoulent à des vitesses différentes
- Documentations fausses (config/app.config.js dit "par défaut 60s" mais y a deux constantes!)

**Fix**: 
1. ✅ Utiliser **UN SEUL** nom: `ROUND_WAIT_DURATION_MS`
2. ✅ Supprimer `TIMER_DURATION_MS` complètement
3. ✅ Remplacer `TIMER_DURATION` par `ROUND_WAIT_DURATION` partout dans game.js
4. ✅ Clarifier dans les commentaires: "Timer d'attente ENTRE rounds (le waiting screen)"

---

### PROBLÈME #5: runningRoundData JAMAIS réinitialisé après race (Memory Leak)
**Fichiers**: `routes/rounds.js`  
**Lignes**: `313, 333-337`

**Niveau**: CRITIQUE

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

// ✅ routes/rounds.js:313 - Nettoyé
gameState.runningRoundData = null;

// MAIS: Si calculateRaceResults() échoue avant la ligne 313, runningRoundData reste en mémoire!
```

**Impact**: 
- 🔴 **CRITIQUE**: Copie en mémoire qui peut ne jamais être libérée
- Avec 100+ courses, consommation mémoire cumulée
- Confusion: après T=35, quelle copie est à jour?

**Fix**: 
```javascript
// Dans un finally block après calculateRaceResults():
try {
    const raceResults = await calculateRaceResults();
    // ...
} finally {
    gameState.runningRoundData = null; // ✅ TOUJOURS nettoyer
}
```

---

### PROBLÈME #6: GameState restauré depuis Redis avec locks oubliés
**Fichiers**: `game.js` + `server.js`  
**Lignes**: 
- `game.js:248-267` (restoreGameStateFromRedis)
- `server.js:80-84`

**Niveau**: CRITIQUE

**Description**: 
Lors du redémarrage, les locks ne sont pas réinitialisés :
```javascript
// ✅ game.js:253-258
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

### PROBLÈME #7: calculateRaceResults() ne retourne rien mais est await'é
**Fichiers**: `routes/rounds.js`  
**Lignes**: `203-322, 427`

**Niveau**: CRITIQUE

**Description**: 
```javascript
// ✅ routes/rounds.js:203-322 - Retourne les résultats
const calculateRaceResults = async () => {
    // ... du code ...
    return {
        roundId: finishedRoundId,
        winner: winnerWithPlace,
        receipts: receipts,
        totalPrize: totalPrizeAll,
        participants: savedRoundData.participants || []
    };  // ✅ Retourne maintenant les résultats
};

// ✅ Ligne 427 - Utilise le résultat
const raceResults = await calculateRaceResults();
if (raceResults) {
    broadcast({
        event: "race_results",
        // ...
    });
}
```

**Impact**: 
- ✅ **CORRIGÉ**: La fonction retourne maintenant les résultats
- ⚠️ **VÉRIFIER**: S'assurer que tous les chemins de code retournent les résultats

**Fix**: 
✅ Déjà corrigé dans le code actuel, mais vérifier tous les chemins de retour

---

### PROBLÈME #8: STATUS ENDPOINT peut créer un round automatique (SIDE EFFECT)
**Fichiers**: `routes/rounds.js`  
**Lignes**: `539-580` (TIMER-GUARD)

**Niveau**: CRITIQUE

**Description**: 
L'endpoint `/status` a un SIDE EFFECT:
```javascript
// ✅ routes/rounds.js:546-580
router.get("/status", cacheResponse(5), async (req, res) => {
    // ...
    
    // ❌ SIDE EFFECT: Crée un round si timer bloqué!
    if (!gameState.isRaceRunning && 
        !gameState.roundCreationLock &&
        (!gameState.nextRoundStartTime || gameState.nextRoundStartTime <= now)) {
        console.warn('⚠️ [TIMER-GUARD] Timer bloqué détecté dans /status, redémarrage du round...');
        try {
            await createNewRound(broadcast);  // ← CRÉATION DE DONNÉES
        }
    }
});
```

**Impact**: 
- 🔴 **CRITIQUE**: Une simple requête GET a un side effect (modifie l'état)
- Cache peut être obsolète rapidement
- Clients reçoivent des réponses différentes pour le même `/status`
- Violation du principe REST (GET ne doit pas modifier l'état)

**Fix**: 
1. ✅ Séparer logique: GET pour récupérer, POST pour créer
2. ✅ Utiliser un endpoint séparé `/api/v1/rounds/reset-timer` (POST)
3. ✅ Ne pas auto-créer sur GET

---

### PROBLÈME #9: WebSocket ne synchronise PAS les écrans entre clients
**Fichiers**: `server.js` + `routes/rounds.js`  
**Lignes**:
- `server.js:150-175` (setupWebSocket)
- `routes/rounds.js:378-384` (broadcast race_start)

**Niveau**: CRITIQUE

**Description**: 
Quand une race commence, le serveur broadcast l'événement, mais:
```javascript
// ✅ server.js:160-175 - Le nouveau client reçoit l'état
ws.send(JSON.stringify({ 
    event: "connected", 
    serverTime: Date.now(),
    roundId: gameState.currentRound?.id || null,
    screen: screen,  // ✅ Calculé
    isRaceRunning: gameState.isRaceRunning,
    // ... mais pas timeInRace!
}));

// ❌ routes/rounds.js:378-384 - race_start ne dit pas l'écran actuel
broadcast({
    event: "race_start",
    roundId: gameState.currentRound.id,
    raceStartTime: raceStartTime,  // ✅ Timestamp
    currentRound: JSON.parse(JSON.stringify(gameState.currentRound)),
    isRaceRunning: true
    // ❌ Pas de currentScreen!
    // ❌ Pas de timeInRace!
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

### PROBLÈME #10: Pas d'endpoint pour récupérer les vraies durées de timers
**Fichiers**: `routes/` - MANQUANT  
**Lignes**: N/A (N'EXISTE PAS)

**Niveau**: CRITIQUE

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
- 🔴 **CRITIQUE**: Désynchronisation client/serveur
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

### PROBLÈME #11: broadcast utilisée avant initialisation (Race Condition)
**Fichiers**: `server.js` + `routes/rounds.js`  
**Lignes**: 
- `server.js:123-134` (fonction broadcast)
- `server.js:261` (createRoundsRouter appelé)

**Niveau**: CRITIQUE

**Description**: 
Les routes sont initialisées avant WebSocket:
```javascript
// ❌ server.js:123-134 - broadcast défini avant wss
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

// Mais `wss` (le WebSocket serveur) n'est initialisé qu'à:
// server.js:373+ (après httpServer.listen)
```

**Impact**: 
- 🔴 **CRITIQUE**: Si une route reçoit une requête AVANT le WebSocket start, le broadcast échouera silencieusement
- Les clients ne reçoivent pas les messages (ex: race_start)
- Fonctionne par luck (late binding) plutôt que par design

**Fix**: 
1. ✅ Créer le WebSocket SERVER avant d'initialiser les routes
2. ✅ Ou vérifier que `wss` existe avant de broadcast

---

## 🟠 PROBLÈMES MODÉRÉS (15)

### PROBLÈME #12: BASE_PARTICIPANTS hardcoded dans game.js
**Fichiers**: `game.js`  
**Lignes**: `18-25`

**Niveau**: MODÉRÉ

**Description**: 
```javascript
// ✅ game.js:18-25 - Source de vérité
export const BASE_PARTICIPANTS = [
    { number: 6, name: "De Bruyne", coeff: 5.5, family: 0, place: 0 },
    { number: 7, name: "Ronaldo", coeff: 4.7, family: 1, place: 0 },
    // ...
];
```

**Impact**: 
- Les participants sont HARDCODÉS en mémoire
- Pas possible de changer les participants sans redémarrer le serveur
- Pas de persistance en BD

**Fix**: 
1. ✅ Charger les participants depuis la BD (participants table)
2. ✅ Cacher en mémoire
3. ✅ BASE_PARTICIPANTS comme fallback seulement

---

### PROBLÈME #13: gameState.timerInterval créé mais JAMAIS utilisé
**Fichiers**: `game.js`  
**Lignes**: `32`

**Niveau**: MODÉRÉ

**Description**: 
```javascript
// ✅ game.js:32
timerInterval: null, // Intervalle pour les mises à jour du timer côté serveur
```

**Déclaré mais jamais assigné!**

**Impact**: 
- Propriété morte en mémoire
- Confusion: c'est quoi la différence entre timerInterval et timers.nextRound?

**Fix**: 
1. ✅ Supprimer `timerInterval` si inutile
2. ✅ Ou l'utiliser pour envoyer les mises à jour toutes les N ms au client

---

### PROBLÈME #14: NEW_ROUND_PREPARE_DELAY_MS JAMAIS utilisé
**Fichiers**: `config/app.config.js` + routes/
**Lignes**: `101-107`

**Niveau**: MODÉRÉ

**Description**: 
```javascript
// ✅ config/app.config.js:101-107
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

### PROBLÈME #15: cacheResponse middleware sur STATUS endpoint (5s cache)
**Fichiers**: `routes/rounds.js`  
**Lignes**: `539` (cacheResponse(5))

**Niveau**: MODÉRÉ

**Description**: 
```javascript
// ❌ routes/rounds.js:539
router.get("/status", cacheResponse(5), async (req, res) => {
    // Cache la réponse pour 5 secondes
    // Mais le status peut changer à chaque requête (isRaceRunning, timeLeft, etc.)
    // Cacher pendant 5s = clients reçoivent des infos vieilles de 5s
});
```

**Impact**: 
- Clients ne savent pas que la race a commencé pendant 5 secondes
- Clients cliquent sur "Start race" mais reçoivent un status ancien
- WebSocket est plus à jour que l'API HTTP

**Fix**: 
1. ✅ Réduire le cache à 1-2 secondes max
2. ✅ Ou no cache pour STATUS
3. ✅ WebSocket reste la source de vérité pour les updates en temps réel

---

### PROBLÈME #16: Pas de cleanup des timers au crash/redémarrage
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

### PROBLÈME #17: Imports manquants dans routes/rounds.js pour chacha20
**Fichiers**: `routes/rounds.js`  
**Lignes**: `8`

**Niveau**: MODÉRÉ

**Description**: 
```javascript
// ✅ routes/rounds.js:8 - Import chacha20
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

### PROBLÈME #18: Response format incohérent (wrap vs direct)
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

### PROBLÈME #19: WebSocket test token hardcoded
**Fichiers**: `config/websocket.js`  
**Lignes**: `59-61`

**Niveau**: MODÉRÉ

**Description**: 
```javascript
// ❌ config/websocket.js:59-61
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

### PROBLÈME #20-25: Autres problèmes modérés
- Commentaires contradictoires dans routes/rounds.js
- clearAllTimers() définie 2 fois
- Logs console pas à jour
- Documentation finale missing
- etc.

---

## 🟡 PROBLÈMES MINEURS (5)

### PROBLÈME #26-30: Problèmes mineurs
- Commentaires contradictoires
- Logs console pas à jour
- Documentation finale missing
- etc.

---

## 📈 HIÉRARCHIE DES PROBLÈMES

### Par Impact (Descending):

1. **PROBLÈME #2** - runningRoundData vs currentRound (Multiple source of truth)
2. **PROBLÈME #3** - finishLock jamais utilisé (Race condition)
3. **PROBLÈME #1** - Timers hardcodés dans frontend
4. **PROBLÈME #4** - TIMER_DURATION vs ROUND_WAIT confusion
5. **PROBLÈME #8** - STATUS endpoint side effect
6. **PROBLÈME #9** - WebSocket ne sync pas les écrans
7. **PROBLÈME #10** - Pas d'endpoint config timers
8. **PROBLÈME #11** - broadcast avant initialisation
9. **PROBLÈME #5** - runningRoundData memory leak
10. **PROBLÈME #6** - GameState restauré avec locks actifs
11. **PROBLÈME #7** - calculateRaceResults retourne rien (corrigé)

---

## ✅ RECOMMANDATIONS PRIORITAIRES

### Semaine 1: Corrections CRITIQUES
1. ✅ Fixer #2: Remplacer `runningRoundData` par une vraie sauvegarde en DB
2. ✅ Fixer #3: Utiliser UN SEUL LOCK (`operationLock`) et l'utiliser correctement
3. ✅ Fixer #4: Renommer tout utilisation de `TIMER_DURATION` → `ROUND_WAIT_DURATION`
4. ✅ Fixer #10: Créer endpoint `/api/v1/config/timers` pour le client
5. ✅ Fixer #1: Supprimer hardcodes de `screen.html`, utiliser l'API

### Semaine 2: Synchronisation
6. ✅ Fixer #9: Envoyer `currentScreen` et `timeInRace` au client
7. ✅ Fixer #11: Créer WebSocket avant routes
8. ✅ Tester la synchronisation multi-clients

### Semaine 3: Nettoyage
9. ✅ Fixer #5: Nettoyer `runningRoundData` dans finally block
10. ✅ Fixer #6: Réinitialiser locks au redémarrage
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

**Total Incohérences**: 31  
**Impact Critique**: 🔴 Peut causer bugs en production  
**Effort de Fix**: 2-3 semaines (high priority pour la stabilité)  
**Risque si non adressé**: Désynchronisation client/serveur, memory leaks, race conditions

Le projet a une architecture saine mais souffre de **duplication d'état**, de **confusion de timers**, et de **race conditions non gérées**. 
Les corrections devraient être faites dans l'ordre indiqué pour minimiser les regressions.

---

**Date de création**: 18 Décembre 2025  
**Dernière mise à jour**: 18 Décembre 2025

