# ✅ CORRECTIONS DE TIMING APPLIQUÉES

## 🎯 Problème Identifié
**La movie_screen retourne à game_screen après ~5 secondes au lieu de 30-35 secondes.**

## 🔍 Cause Racine
Le handler `new_round` du client ignorait le flag `isRaceRunning` et retournait immédiatement à `game_screen`, même si une course était en cours. Cela signifie que si un événement `new_round` était reçu prématurément (T=5 au lieu de T=35), la course s'arrêtait prématurément.

## 🛠️ Corrections Appliquées

### 1. ✅ AJOUT DE LOGS DE TIMING DÉTAILLÉS (routes/rounds.js)

**Avant:**
```javascript
console.log(`[RACE-FINISH] 🎙️ Broadcasting race_end (T+${Date.now() - gameState.raceStartTime}ms)`);
```

**Après:**
```javascript
const raceStartTime = gameState.raceStartTime;
const now = Date.now();
const elapsed = now - raceStartTime;
console.log(`[RACE-FINISH] 🎙️ Broadcasting race_end at T=${elapsed}ms (expected: T=${MOVIE_SCREEN_DURATION_MS}ms)`);
if (Math.abs(elapsed - MOVIE_SCREEN_DURATION_MS) > 1000) {
    console.warn(`[RACE-FINISH] ⚠️ WARNING: race_end is ${elapsed - MOVIE_SCREEN_DURATION_MS}ms off schedule!`);
}
```

**Résultat:** Permet de vérifier que `race_end` est broadcasté à T=30s (±1s) comme prévu.

---

### 2. ✅ AJOUT DE LOGS POUR new_round BROADCAST (routes/rounds.js)

**Avant:**
```javascript
console.log(`[RACE-SEQ] 🎙️ Broadcasting new_round (T+${Date.now() - gameState.raceStartTime}ms, roundId=${newRoundId})`);
```

**Après:**
```javascript
const elapsed2 = Date.now() - gameState.raceStartTime;
console.log(`[RACE-SEQ] 🎙️ Broadcasting new_round at T=${elapsed2}ms (expected: T=${TOTAL_RACE_TIME_MS}ms = ${MOVIE_SCREEN_DURATION_MS}ms + ${FINISH_SCREEN_DURATION_MS}ms)`);
if (Math.abs(elapsed2 - TOTAL_RACE_TIME_MS) > 1000) {
    console.warn(`[RACE-SEQ] ⚠️ WARNING: new_round is ${elapsed2 - TOTAL_RACE_TIME_MS}ms off schedule!`);
}
```

**Résultat:** Permet de vérifier que `new_round` est broadcasté à T=35s (±1s) comme prévu.

---

### 3. ✅ CORRECTION CRITIQUE: Ignorer new_round pendant une race en cours (screen.html)

**Avant:**
```javascript
case 'new_round':
    console.log('🆕 Nouveau round reçu (T+' + (Date.now() - window.raceStartTime || 0) + 'ms)');
    // Retour immédiat à game_screen sans vérifier isRaceRunning!
    $('.screen').removeClass('active');
    $('.game_screen').addClass('active');
```

**Après:**
```javascript
case 'new_round':
    const newRoundElapsed = Date.now() - window.raceStartTime || 0;
    console.log('🆕 Nouveau round reçu (T+' + newRoundElapsed + 'ms)');
    console.log('   Données:', { roundId: data.roundId, isRaceRunning: data.isRaceRunning });
    
    // ✅ CRITICAL FIX: Ignorer new_round si une course est EN COURS
    if (data.isRaceRunning === true) {
        console.warn('❌ [TIMING-BUG-FIX] new_round REJETÉ - une course est encore en cours!');
        console.warn(`⚠️ T+${newRoundElapsed}ms: new_round reçu trop tôt (expected T>=${TOTAL_RACE_TIME_MS || 35000}ms)`);
        console.warn(`⚠️ Ignorer cet événement pour éviter de retourner à game_screen pendant la course`);
        break;  // EXIT sans rien faire
    }
    
    // Retour à game_screen UNIQUEMENT si la course est terminée
    console.log(`✅ [OK] Retour à game_screen (course finie, T+${newRoundElapsed}ms)`);
    $('.screen').removeClass('active');
    $('.game_screen').addClass('active');
```

**Résultat:** 
- ✅ Les événements `new_round` reçus pendant une course (isRaceRunning=true) sont IGNORÉS
- ✅ Le client ne retournera à `game_screen` que quand la course est vraiment terminée
- ✅ Empêche le retour prématuré observé (après ~5 secondes)

---

### 4. ✅ SUPPRESSION DU CODE MORT `onPrepareNewRound` (routes/rounds.js)

**Avant:**
```javascript
// T=10s: Préparer le nouveau round
onPrepareNewRound: async () => {
    // ... 140+ lignes de code ...
    broadcast({ event: "new_round", ... });
},
```

**Problèmes:**
- ❌ Défini mais JAMAIS APPELÉ par `startRaceSequence()`
- ❌ Cause de confusion: `new_round` est broadcasté deux fois (jamais dans `onPrepareNewRound`, correctement dans `createNewRoundAfterRace`)
- ❌ Commentaire faux à ligne 735: "onPrepareNewRound sera appelé depuis executeRaceFinish" (FAUX!)

**Après:**
```javascript
// ❌ DELETED: onPrepareNewRound was dead code - never called by startRaceSequence()
// It caused confusion by defining new_round broadcast twice (also in createNewRoundAfterRace)
// The actual new_round broadcast happens in createNewRoundAfterRace() at T=35s (MOVIE + FINISH)
```

**Résultat:** Code plus clair, sans confusion sur les sources de broadcast `new_round`.

---

## 📊 Séquence Corrigée

### Avant (INCORRECT)
```
T=0s:   race_start (movie_screen affiché)
T=5s:   ❌ new_round reçu (isRaceRunning=true mais ignoré maintenant!)
        ❌ Client retourne à game_screen (BUG OBSERVÉ)
T=30s:  race_end (normalement reçu, mais trop tard)
T=35s:  new_round (normalement reçu, mais trop tard)
```

### Après (CORRECT)
```
T=0s:   race_start (movie_screen affiché)
        → Si new_round erroné reçu avant T=30: REJETÉ (grâce à la vérif isRaceRunning)
T=30s:  race_end (finish_screen affiché)
T=35s:  new_round (isRaceRunning=false, ACCEPTÉ)
        → Retour à game_screen ✅
```

---

## 🔍 Comment Valider les Corrections

### Test 1: Vérifier les timings serveur
```bash
# Regardez les logs du serveur pendant une course:
[RACE-FINISH] 🎙️ Broadcasting race_end at T=30XXXms (expected: T=30000ms)
[RACE-SEQ] 🎙️ Broadcasting new_round at T=35XXXms (expected: T=35000ms)
```
Attendez ±1000ms autour de T=30 et T=35. Si les valeurs s'en éloignent, il y a un problème.

### Test 2: Vérifier les rejets côté client
```bash
# Regardez les logs du client pendant une course:
🆕 Nouveau round reçu (T+XXXXX ms)
# Si elle arrive avant T=30s:
❌ [TIMING-BUG-FIX] new_round REJETÉ - une course est encore en cours!
⚠️ T+XXXXXms: new_round reçu trop tôt
```

### Test 3: Complet
1. Lancez une course
2. Observez que `movie_screen` reste active pendant 30 secondes (pas 5!)
3. À T≈30, passez à `finish_screen` avec les résultats
4. À T≈35, retournez à `game_screen`

---

## 💡 Détails Techniques

### Constantes Utilisées (config/app.config.js)
```javascript
MOVIE_SCREEN_DURATION_MS = 30000ms (30 secondes)
FINISH_SCREEN_DURATION_MS = 5000ms (5 secondes)
TOTAL_RACE_TIME_MS = 35000ms
```

### Séquence Temporelle Côté Serveur
1. **T=0**: `onRaceStart()` → broadcast `race_start`
2. **T=30**: `onFinishRace()` → `executeRaceFinish()` → broadcast `race_end`
3. **T=30+5**: `setTimeout(..., FINISH_SCREEN_DURATION_MS)` → `createNewRoundAfterRace()` → broadcast `new_round`
4. **T=35**: `onCleanup()` → nettoyage

### Flag `isRaceRunning`
- `true`: Une course est en cours (affichage movie_screen ou finish_screen)
- `false`: Aucune course, attente du prochain lancement (affichage game_screen)

**Le flag est inclus dans chaque broadcast `new_round` reçu par le client.**

---

## ✅ Checklist Finale

- [x] Logs de timing détaillés ajoutés (race_end à T=30s)
- [x] Logs de timing pour new_round (T=35s)
- [x] Vérification `isRaceRunning` dans handler new_round du client
- [x] Code mort `onPrepareNewRound` supprimé
- [x] Document d'analyse créé
- [ ] **Tester en production pour confirmer la correction**

---

## 📝 Notes pour le Debugging

Si vous voyez encore des problèmes:

1. **race_end n'arrive pas à T=30?**
   - Vérifier que `MOVIE_SCREEN_DURATION_MS` est bien 30000ms (pas surchargé par `.env`)
   - Vérifier que `setTimeout` à ligne 132 utilise `MOVIE_SCREEN_DURATION_MS`

2. **new_round n'arrive pas à T=35?**
   - Vérifier que `TOTAL_RACE_TIME_MS` est bien 35000ms
   - Vérifier que `FINISH_SCREEN_DURATION_MS` est bien 5000ms
   - Vérifier que le `setTimeout` à ligne 395 utilise `FINISH_SCREEN_DURATION_MS`

3. **Client retourne encore à game_screen trop tôt?**
   - Vérifier que le flag `isRaceRunning` est envoyé dans le broadcast `new_round`
   - Vérifier que le handler `new_round` reçoit bien `data.isRaceRunning`
   - Vérifier les logs du client pour confirmer qu'il rejette les `new_round` avec `isRaceRunning=true`

