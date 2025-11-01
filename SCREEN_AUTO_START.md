# 🎮 Modifications screen.html - Démarrage Automatique

## ✅ Modifications Effectuées

Le fichier `Test_screen/screen.html` a été modifié pour :
1. ✅ Lancer le jeu automatiquement
2. ✅ Utiliser WebSocket pour recevoir les données de démarrage
3. ✅ Utiliser une variable `timer` pour stocker le temps
4. ✅ Afficher une progress bar pendant le temps d'attente

---

## 📋 Changements Principaux

### 1. **Variable Timer Centralisée**

```javascript
var timer = {
    timeLeft: 0,           // Temps restant en millisecondes
    totalDuration: 10000,  // Durée totale du timer (10s par défaut)
    startTime: 0,          // Timestamp du début
    endTime: 0             // Timestamp de la fin
};
```

### 2. **Connexion WebSocket**

- ✅ Connexion automatique au démarrage
- ✅ Reconnexion automatique en cas de déconnexion
- ✅ Écoute des événements : `connected`, `new_round`, `timer_start`, `race_start`, `race_end`

### 3. **Fonction `demarrerTimer()`**

Démarre le timer avec les données reçues via WebSocket :
- Met à jour la variable `timer`
- Affiche le panneau de compte à rebours
- Démarre l'animation de la progress bar (mise à jour toutes les 100ms)

### 4. **Fonction `tenterDeDemarrer()`**

Démarre automatiquement la course via API :
- Envoie `POST /api/v1/rounds/` avec `{ action: 'finish' }`
- Plus fiable que le clic sur le bouton
- Réessaye automatiquement si l'interface n'est pas prête

### 5. **Progress Bar Améliorée**

- ✅ Mise à jour toutes les 100ms pour une animation fluide
- ✅ Changement de couleur dynamique :
  - Vert (0-30%) : Temps confortable
  - Jaune (30-70%) : Temps moyen
  - Rouge (70-100%) : Urgence
- ✅ Affichage du temps restant en secondes (format: "X.Xs")

---

## 🔄 Flux de Fonctionnement

### Scénario 1 : Nouveau Tour
1. Serveur envoie `timer_start` via WebSocket (après fin de course)
2. `screen.html` reçoit l'événement → démarre le timer
3. Progress bar s'affiche et se met à jour
4. Quand timer atteint 0 → démarrage automatique de la course

### Scénario 2 : Tour Déjà Créé
1. `screen.html` se connecte via WebSocket
2. Reçoit `connected` → tente de démarrer immédiatement
3. Si pas prêt, attend et réessaye

### Scénario 3 : Après Fin de Course
1. Serveur envoie `race_end` → `screen.html` surveille
2. Détecte le bouton "New round" → clique automatiquement
3. Attend le prochain `timer_start` pour redémarrer le cycle

---

## 📡 Événements WebSocket Utilisés

| Événement | Source | Action dans screen.html |
|-----------|--------|-------------------------|
| `connected` | Serveur (connexion) | Tente de démarrer immédiatement |
| `new_round` | `game.js` / `rounds.js` | Démarre le timer et programme le démarrage auto |
| `timer_start` | `rounds.js` (post-course) | Démarre le timer avec données précises |
| `race_start` | `rounds.js` | Cache le panneau pendant la course |
| `race_end` | `rounds.js` | Surveille la fin et prépare le relancement |

---

## 🎨 Interface Utilisateur

### Panneau de Compte à Rebours

```html
<div id="countdownPanel" class="p-2 m-2 rounded-lg bg-gray-900 shadow-xl">
    <div class="text-white text-xs font-semibold uppercase mb-1">
        <span>Prochain Départ dans:</span>
        <span id="timeRemainingDisplay">0.0s</span>
    </div>
    <div class="w-full bg-gray-700 rounded-full h-2.5">
        <div id="progressBar" class="bg-green-500 h-2.5 rounded-full">
        </div>
    </div>
</div>
```

- **Affichage** : Se montre automatiquement quand un timer est actif
- **Masquage** : Se cache pendant la course et quand timer = 0

---

## 🔧 Modifications Serveur

### `routes/rounds.js`

Ajout de l'événement `timer_start` après la fin de course :
```javascript
broadcast({
    event: "timer_start",
    timer: {
        timeLeft: ROUND_WAIT_DURATION_MS,
        totalDuration: ROUND_WAIT_DURATION_MS,
        startTime: now,
        endTime: gameState.nextRoundStartTime
    },
    roundId: gameState.currentRound.id
});
```

### `game.js`

Mise à jour de `new_round` pour inclure le timer si disponible :
```javascript
timer: gameState.nextRoundStartTime ? {
    timeLeft: timeUntilStart,
    totalDuration: 10000,
    startTime: now,
    endTime: gameState.nextRoundStartTime
} : null
```

---

## ⚙️ Configuration

- **Durée du timer** : `ROUND_WAIT_DURATION_MS = 10000` (10 secondes)
- **Mise à jour progress bar** : Toutes les 100ms
- **Réessai démarrage** : Toutes les 2 secondes si interface non prête
- **Délai après fin course** : 5 secondes avant nettoyage

---

## 🚀 Avantages

1. ✅ **Démarrage 100% automatique** : Aucune intervention manuelle
2. ✅ **Synchronisation précise** : Utilise les timestamps du serveur
3. ✅ **Feedback visuel** : Progress bar avec couleurs dynamiques
4. ✅ **Robustesse** : Reconnexion automatique WebSocket + réessais
5. ✅ **Temps réel** : Réception instantanée des événements via WebSocket

---

## 📝 Notes

- Le timer est basé sur les timestamps serveur pour éviter les décalages
- La progress bar utilise une transition CSS pour une animation fluide
- Le démarrage automatique utilise l'API plutôt que le clic sur le bouton (plus fiable)

---

**Date :** $(date)
**Statut :** ✅ Fonctionnel

