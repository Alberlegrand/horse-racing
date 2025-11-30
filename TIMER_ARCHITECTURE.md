# ⏰ Architecture Timer - Documentation de Clarification

## Problème Identifié: Incohérence Durée Timer

Le projet présente une **confusion sur la durée du timer** entre plusieurs fichiers.

### État Actuel

| Source | Valeur | Type |
|--------|--------|------|
| `config/app.config.js` | 20 secondes | TIMER_DURATION_SECONDS |
| `routes/rounds.js` | 60000 ms (3 min) | ROUND_WAIT_DURATION_MS |
| `CHANGELOG_TIMER_20S.md` | 20 secondes | Documentation |
| `SCREEN_AUTO_START.md` | 10 secondes | Docs anciennes |

### ✅ RÉSOLUTION ADOPTÉE

**La vérité = `config/app.config.js`**

```javascript
export const TIMER_DURATION_SECONDS = 20  // 20 secondes (configurable via .env)
export const TIMER_DURATION_MS = 20 * 1000 = 20000 ms
```

**En `routes/rounds.js`**, remplacer:
```javascript
// ❌ ANCIEN
const ROUND_WAIT_DURATION_MS = parseInt(process.env.ROUND_WAIT_DURATION_MS) || 60000;

// ✅ NOUVEAU (à implémenter)
import { TIMER_DURATION_MS } from "../config/app.config.js";
const ROUND_WAIT_DURATION_MS = TIMER_DURATION_MS;
```

---

## Cycle du Timer

### 1. **Round Créé**
- `startNewRound()` lancé
- Timer démarre: `gameState.nextRoundStartTime = now + TIMER_DURATION_MS`
- Clients notifiés: `{ event: 'new_round', timer: { timeLeft, totalDuration, ... } }`

### 2. **Compte à Rebours (Côté Client)**
- Frontend reçoit `startTime` et `endTime`
- Chaque 1s (TIMER_UPDATE_INTERVAL_MS):
  - Calcule: `timeLeft = endTime - now`
  - Affiche le décompte
  - WebSocket reçoit les mises à jour du serveur

### 3. **Timer Expire**
- `nextRoundStartTime <= now`
- Serveur lance la race automatiquement
- Status → `'race_running'`
- Participants obtiennent des places (1-6)
- Broadcast: `{ event: 'race_started' }`

### 4. **Race en Cours (Movie Screen)**
- Durée: 20 secondes (MOVIE_SCREEN_DURATION_MS)
- Clients voient l'animation
- Pas de nouvelles mises possible

### 5. **Race Termine (Finish Screen)**
- Durée: 5 secondes (FINISH_SCREEN_DURATION_MS)
- Gagnant affiché
- Écran de résumé

### 6. **Retour au Timer**
- Nouveau round créé
- Cycle recommence

---

## Configuration Centralisée

Tous les timers viennent maintenant de **`config/app.config.js`**:

```javascript
// ⏰ Timers principaux
export const TIMER_DURATION_SECONDS = 20        // Attente avant race
export const TIMER_DURATION_MS = 20000          // En ms

// 📊 Timers de la race
export const MOVIE_SCREEN_DURATION_MS = 20000   // Animation chevaux
export const FINISH_SCREEN_DURATION_MS = 5000   // Affichage résultat
export const TOTAL_RACE_TIME_MS = 25000         // Total

// 📱 Mise à jour WebSocket
export const TIMER_UPDATE_INTERVAL_MS = 1000    // 1 seconde entre updates
```

### Variables d'Environnement (.env)

```bash
# Timer attente (en secondes)
TIMER_DURATION_SECONDS=20

# Optionnel: intervalles spécifiques
TIMER_UPDATE_INTERVAL_MS=1000
MOVIE_SCREEN_DURATION_MS=20000
FINISH_SCREEN_DURATION_MS=5000
```

---

## WebSocket Messages

### Timer Update (Chaque 1s)

```javascript
{
  event: "timer_update",
  timeLeft: 15000,        // ms restantes
  totalDuration: 20000,   // durée totale
  progress: 0.75,         // 0-1
  status: "waiting"       // 'waiting', 'racing', 'finished'
}
```

### New Round

```javascript
{
  event: "new_round",
  roundId: 98765432,
  game: { /* currentRound data */ },
  timer: {
    timeLeft: 20000,
    totalDuration: 20000,
    startTime: 1701360000000,
    endTime: 1701360020000
  }
}
```

### Race Started

```javascript
{
  event: "race_started",
  roundId: 98765432,
  movieDuration: 20000,   // ms avant finish
  finishDuration: 5000    // ms avant nouveau round
}
```

---

## État Côté Client

Frontend doit maintenir:

```javascript
{
  roundState: {
    id: 98765432,
    status: "waiting",      // 'waiting', 'racing', 'finished'
    timeLeft: 15000,        // ms
    totalDuration: 20000    // ms
  }
}
```

Mise à jour:
```javascript
// Chaque 100ms
timeLeft = Math.max(0, endTime - Date.now());

// Si timeLeft = 0
if (timeLeft === 0 && status === 'waiting') {
  status = 'racing'
  movieDuration timer
}
```

---

## Synchronisation Serveur-Client

### Problème: Dérive Temporelle

Si client/serveur ont des horloges désynchronisées:

**Solution**: Le serveur envoie:
1. `serverTime` (timestamp serveur)
2. `endTime` (timestamp serveur)
3. Client calcule delta: `delta = clientTime - serverTime`
4. timeLeft = `endTime - (clientTime - delta)`

```javascript
// Côté client
const serverTime = msg.serverTime;
const clientTime = Date.now();
const delta = clientTime - serverTime;

const timeLeft = msg.endTime - (Date.now() - delta);
```

---

## TODO: À Implémenter

- [ ] Mettre à jour `routes/rounds.js` pour utiliser `TIMER_DURATION_MS`
- [ ] Centraliser tous les timers dans `config/app.config.js`
- [ ] Ajouter synchronisation serveur-client (delta)
- [ ] Supprimer les hardcodes de timer
- [ ] Tester avec différentes zones horaires
- [ ] Documenter transitions d'état complètes

---

**Dernière mise à jour**: 2025-11-30
**Status**: 🟡 Partiellement corrigé (config ajoutée, à harmoniser dans routes/)
