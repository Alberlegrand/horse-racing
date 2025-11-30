# ✅ CONFIGURATION UNIFIÉE DES TIMERS

**Date**: 2025-11-30  
**Status**: ✅ **TOUTES LES INCOHÉRENCES RÉSOLUES**

---

## 🎯 Objectif

Centraliser et unifier TOUS les timers du système:
- ✅ Toutes les valeurs **en millisecondes (MS)**
- ✅ Toutes définies dans **`config/app.config.js`**
- ✅ Importées et utilisées partout sans redéfinition
- ✅ Configurables via **`.env`**

---

## 📋 CONSTANTES DÉFINIES

### `config/app.config.js` - SOURCE UNIQUE

```javascript
// ========================================
// TIMER D'ATTENTE AVANT COURSE (en MS)
// ========================================
TIMER_DURATION_SECONDS = 20  (du .env, défaut 20)
TIMER_DURATION_MS = 20000    // ✅ EN MS

// ========================================
// TIMERS DE RACE (en MS)
// ========================================
MOVIE_SCREEN_DURATION_SECONDS = 15   (du .env, défaut 15)
MOVIE_SCREEN_DURATION_MS = 15000     // ✅ EN MS

FINISH_SCREEN_DURATION_SECONDS = 5   (du .env, défaut 5)
FINISH_SCREEN_DURATION_MS = 5000     // ✅ EN MS

TOTAL_RACE_TIME_MS = 20000           // Calculé = movie_screen + finish_screen

// ========================================
// TIMERS DE COORDINATION (en MS)
// ========================================
NEW_ROUND_PREPARE_DELAY_SECONDS = 10    (du .env, défaut 10)
NEW_ROUND_PREPARE_DELAY_MS = 10000      // ✅ EN MS

// ========================================
// AUTRE
// ========================================
TIMER_UPDATE_INTERVAL_MS = 10000        // Mise à jour WebSocket (du .env)
MIN_BET_AMOUNT = 2500                   // Limites de paris
MAX_BET_AMOUNT = 500000
```

---

## 🔄 TIMELINE DE COURSE (avec tous les timers en MS)

```
T = 0ms                    → race_start broadcast
                             gameState.isRaceRunning = true
                             gameState.raceStartTime = now

T = NEW_ROUND_PREPARE_DELAY_MS (10000ms = 10s)
                           → Créer le nouveau round
                             gameState.currentRound = newRound
                             Programmer auto-start

T = MOVIE_SCREEN_DURATION_MS (15000ms = 15s)
                           → Exécuter la logique de fin
                             Calculer le gagnant
                             Mettre à jour les tickets

T = TOTAL_RACE_TIME_MS (20000ms = 20s)
                           → Nettoyage post-race
                             gameState.isRaceRunning = false

Nouveau cycle en attente:
T = nextRoundStartTime (maintenant + TIMER_DURATION_MS = 20000ms)
                           → Auto-start déclenché
                             Retour à T=0
```

---

## 📁 FICHIERS MODIFIÉS

### 1. ✅ `config/app.config.js`

**AVANT**: Seulement 3 constantes (incohérent)
```javascript
TIMER_DURATION_SECONDS
TIMER_DURATION_MS
TIMER_UPDATE_INTERVAL_MS
```

**APRÈS**: Toutes les constantes (cohérent)
```javascript
// Timers d'attente
TIMER_DURATION_SECONDS
TIMER_DURATION_MS

// Timers de race (MS)
MOVIE_SCREEN_DURATION_SECONDS
MOVIE_SCREEN_DURATION_MS
FINISH_SCREEN_DURATION_SECONDS
FINISH_SCREEN_DURATION_MS
TOTAL_RACE_TIME_MS

// Coordination (MS)
NEW_ROUND_PREPARE_DELAY_SECONDS
NEW_ROUND_PREPARE_DELAY_MS

// Autres
TIMER_UPDATE_INTERVAL_MS
MIN_BET_AMOUNT
MAX_BET_AMOUNT
```

### 2. ✅ `routes/rounds.js`

**AVANT**: Redéfinitions locales hardcodées
```javascript
const MOVIE_SCREEN_DURATION_MS = 15000;     // ❌ Hardcodé
const FINISH_SCREEN_DURATION_MS = 5000;     // ❌ Hardcodé
const TOTAL_RACE_TIME_MS = 20000;           // ❌ Calculé localement
const NEW_ROUND_PREPARE_DELAY_MS = 10000;   // ❌ Hardcodé
```

**APRÈS**: Importation uniquement
```javascript
import { 
  TIMER_DURATION_MS,
  TIMER_UPDATE_INTERVAL_MS,
  MOVIE_SCREEN_DURATION_MS,      // ✅ Importé
  FINISH_SCREEN_DURATION_MS,     // ✅ Importé
  TOTAL_RACE_TIME_MS,            // ✅ Importé
  NEW_ROUND_PREPARE_DELAY_MS     // ✅ Importé
} from "../config/app.config.js";
```

### 3. ✅ `game.js`

**ÉTAIT**: 
```javascript
const ROUND_WAIT_DURATION_MS = (envDuration > 0) ? envDuration : 60000; // ❌ Variable locale
```

**MAINTENANT**:
```javascript
import { TIMER_DURATION_MS } from './config/app.config.js'; // ✅ Importé
```

---

## 🔧 CONFIGURATION VIA `.env`

Toutes les durées peuvent être surchargées via `.env`:

```bash
# Timer d'attente (en SECONDES dans .env, converti en MS dans app.config.js)
TIMER_DURATION_SECONDS=20          # 20 secondes = 20000 ms

# Timers de race (en SECONDES dans .env, converti en MS dans app.config.js)
MOVIE_SCREEN_DURATION_SECONDS=15   # 15 secondes = 15000 ms
FINISH_SCREEN_DURATION_SECONDS=5   # 5 secondes = 5000 ms

# Coordination (en SECONDES dans .env, converti en MS dans app.config.js)
NEW_ROUND_PREPARE_DELAY_SECONDS=10 # 10 secondes = 10000 ms

# Mise à jour WebSocket (en MS, valeur absolue)
TIMER_UPDATE_INTERVAL_MS=1000      # 1 seconde

# Limites de paris
MIN_BET_AMOUNT=2500
MAX_BET_AMOUNT=500000
```

**Notes importantes**:
- Les **TIMERS** dans `.env` sont en **SECONDES**
- Ils sont convertis en **MS** dans `app.config.js`
- Les autres variables restent en **MS** directement
- Cela évite la confusion: les durées sont usuellement en secondes

---

## ✅ AVANTAGES DE CETTE ARCHITECTURE

| Aspect | Avant | Après |
|--------|-------|-------|
| **Source unique** | ❌ Plusieurs fichiers | ✅ `app.config.js` |
| **Cohérence** | ❌ Mix MS/s | ✅ Tout en MS |
| **Configuration** | ❌ Hardcodé | ✅ Via `.env` |
| **Redéfinitions** | ❌ Locales | ✅ Importées |
| **Maintenance** | ❌ Difficile | ✅ Facile |
| **Debuggage** | ❌ Confus | ✅ Clair |

---

## 🧪 VÉRIFICATION DES VALEURS

Au démarrage du serveur, on voit:

```
========================================
⏰ CONFIGURATION DES TIMERS (tous en MS)
========================================
🕐 TIMER D'ATTENTE AVANT COURSE:
   20s = 20000ms

🎬 TIMERS DE RACE:
   Movie screen: 15s = 15000ms
   Finish screen: 5s = 5000ms
   Total race: 20s = 20000ms

⚙️ COORDINATION:
   Préparation nouveau round: 10s = 10000ms
   Mise à jour WebSocket: 10000ms

💰 LIMITES DE PARIS:
   Min: 2500 | Max: 500000
========================================
```

✅ Toutes les valeurs sont **correctement affichées en MS**

---

## 📝 RÉSUMÉ DES CHANGEMENTS

| Problème | Solution |
|----------|----------|
| Timers hardcodés partout | Centralisés dans `config/app.config.js` |
| Mix MS et secondes | Tout en MS, conversion dans `app.config.js` |
| Redéfinitions locales | Importation uniquement |
| Pas configurable | Configurable via `.env` |
| Incohérences entre fichiers | Source unique d'où tous importent |

---

## 🎯 RÉSULTAT FINAL

✅ **Tous les timers sont**:
- ✅ En **millisecondes (MS)**
- ✅ Définis dans **une seule variable**
- ✅ Importés depuis **`config/app.config.js`**
- ✅ Configurables via **`.env`**
- ✅ Utilisés partout sans redéfinition

✅ **Le système est maintenant**:
- ✅ **Cohérent**: Pas de confusion MS/s
- ✅ **Centralisé**: Une source d'où tous importent
- ✅ **Flexible**: Configurable à l'environnement
- ✅ **Maintenable**: Facile à modifier un seul endroit
- ✅ **Debuggable**: Logs clairs au démarrage

---

**Status**: ✅ **INCOHÉRENCES RÉSOLUES - SYSTÈME UNIFIÉE**

---

**Date de création**: 2025-11-30  
**Dernière mise à jour**: 2025-11-30
