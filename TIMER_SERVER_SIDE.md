# ⏰ Timer Géré Côté Serveur - Documentation

## 📋 Vue d'Ensemble

Le timer est maintenant **entièrement géré côté serveur**. Le client (`screen.html`) reçoit uniquement les mises à jour via WebSocket et affiche la progress bar. Quand le timer atteint 0, le bouton Start est cliqué automatiquement.

---

## ⚙️ Configuration

### Variable d'environnement

La durée du timer est configurable via variable d'environnement :

```bash
# Fichier .env ou variable d'environnement système
TIMER_DURATION_SECONDS=10  # Durée en secondes (défaut: 10)
TIMER_UPDATE_INTERVAL_MS=1000  # Intervalle de mise à jour WebSocket (défaut: 1000ms)
```

**Fichier de configuration** : `config/app.config.js`

---

## 🔄 Flux de Fonctionnement

### 1. Fin de Course
```
Course se termine → routes/rounds.js
```

### 2. Démarrage du Timer (Côté Serveur)
```
routes/rounds.js:
  - Définit gameState.nextRoundStartTime = now + TIMER_DURATION_MS
  - Envoie événement "timer_start" via WebSocket
  - Démarre setInterval pour envoyer "timer_update" toutes les secondes
```

### 3. Réception Client (screen.html)
```
screen.html:
  - Reçoit "timer_start" → Affiche progress bar
  - Reçoit "timer_update" → Met à jour progress bar
  - Quand timer.timeLeft = 0 → Clique automatiquement sur Start
```

### 4. Clic Automatique sur Start
```
cliquerSurStart():
  - Trouve le bouton .start
  - Clique automatiquement dessus
  - Le bouton déclenche le démarrage de la course
```

---

## 📡 Événements WebSocket

### `timer_start`
**Source** : `routes/rounds.js` (après fin de course)

```javascript
{
  event: "timer_start",
  timer: {
    timeLeft: 10000,        // Temps restant en ms
    totalDuration: 10000,    // Durée totale en ms
    startTime: 1234567890,  // Timestamp début
    endTime: 1234577890,    // Timestamp fin
    percentage: 0              // Pourcentage écoulé
  },
  roundId: 96908000
}
```

### `timer_update`
**Source** : `routes/rounds.js` (toutes les secondes)

```javascript
{
  event: "timer_update",
  timer: {
    timeLeft: 8500,         // Temps restant en ms (mis à jour)
    totalDuration: 10000,
    startTime: 1234567890,
    endTime: 1234577890,
    percentage: 15           // Pourcentage écoulé (mis à jour)
  },
  roundId: 96908000
}
```

### `timer_end`
**Source** : `routes/rounds.js` (quand timer = 0)

```javascript
{
  event: "timer_end",
  roundId: 96908000
}
```

---

## 💻 Code Serveur

### `config/app.config.js`
```javascript
export const TIMER_DURATION_SECONDS = parseInt(
  process.env.TIMER_DURATION_SECONDS || '10', 10
);
export const TIMER_DURATION_MS = TIMER_DURATION_SECONDS * 1000;
```

### `routes/rounds.js`
- Après `race_end`, démarre le timer
- Envoie `timer_start` immédiatement
- Envoie `timer_update` toutes les secondes via `setInterval`
- Envoie `timer_end` quand timer = 0
- Le timer est stocké dans `gameState.nextRoundStartTime`

### `game.js`
- Ajout de `timerInterval` dans `gameState` pour stocker l'intervalle serveur

---

## 🎨 Code Client (screen.html)

### Fonction `cliquerSurStart()`
```javascript
// Clique automatiquement sur le bouton Start
$('.start').trigger('click');
```

### Fonction `demarrerTimer(timerData)`
- Initialise l'affichage de la progress bar
- Ne gère PAS le timer (géré côté serveur)
- Met à jour uniquement l'affichage visuel

### Fonction `handleWebSocketMessage()`
- `timer_start` : Démarre l'affichage + programme le clic auto après délai
- `timer_update` : Met à jour la progress bar + clic auto si timer = 0
- `timer_end` : Clique immédiatement sur Start

---

## 🎯 Avantages

1. ✅ **Synchronisation parfaite** : Tous les clients voient le même temps
2. ✅ **Pas de décalage** : Le timer est calculé côté serveur
3. ✅ **Configuration centralisée** : Variable d'environnement unique
4. ✅ **Robuste** : Même si le client perd la connexion, le serveur continue
5. ✅ **Scalable** : Plusieurs écrans synchronisés automatiquement

---

## 🔧 Utilisation

### Définir la durée du timer

**Option 1 : Variable d'environnement système**
```bash
export TIMER_DURATION_SECONDS=15
node server.js
```

**Option 2 : Fichier .env** (nécessite dotenv)
```bash
# .env
TIMER_DURATION_SECONDS=15
```

**Option 3 : Ligne de commande**
```bash
TIMER_DURATION_SECONDS=20 node server.js
```

### Vérifier la configuration
Au démarrage du serveur, un message s'affiche :
```
⏰ Configuration timer: 10s (10000ms)
```

---

## 📊 Schéma de Synchronisation

```
Serveur                    Client (screen.html)
  │                           │
  ├─ race_end                 │
  ├─ timer_start ────────────>│ Affiche progress bar
  ├─ timer_update (1s) ──────>│ Met à jour progress bar
  ├─ timer_update (2s) ──────>│ Met à jour progress bar
  ├─ ...                       │
  ├─ timer_update (9s) ──────>│ Met à jour progress bar
  ├─ timer_update (10s) ─────>│ timer.timeLeft = 0
  ├─ timer_end ───────────────>│ Clique sur Start
  │                           │
  └─ startNewRound            │
```

---

**Date :** $(date)
**Statut :** ✅ Fonctionnel

