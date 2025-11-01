# 🔄 Changement Timer : 10s → 20s

## ✅ Modifications Effectuées

Le timer a été configuré pour durer **20 secondes** au lieu de 10 secondes.

---

## 📋 Fichiers Modifiés

### 1. **`config/app.config.js`** ✅

**Changement :**
```javascript
// Avant
export const TIMER_DURATION_SECONDS = parseInt(process.env.TIMER_DURATION_SECONDS || '10', 10);

// Après
export const TIMER_DURATION_SECONDS = parseInt(process.env.TIMER_DURATION_SECONDS || '20', 10);
```

**Résultat :**
- Durée par défaut : **20 secondes** (20000ms)
- Peut toujours être surchargée via `TIMER_DURATION_SECONDS`

### 2. **`Test_screen/screen.html`** ✅

**Changements :**
- Variable `timer.totalDuration` : `10000` → `20000`
- Valeurs par défaut dans `demarrerTimer()` : `10000` → `20000`
- Valeurs par défaut dans `timer_update` : `10000` → `20000`

**Résultat :**
- Interface prête pour afficher un timer de 20 secondes
- La valeur réelle vient toujours du serveur via WebSocket

---

## 🔄 Cycle Complet Maintenant

1. **Course se termine** → 7 secondes de simulation
2. **Timer démarre** → **20 secondes** d'attente
3. **Bouton Start clique automatiquement** → Nouvelle course démarre
4. **Nouvelle course** → Répète le cycle

**Durée totale d'un cycle** : ~27 secondes (7s course + 20s timer)

---

## ⚙️ Configuration

Pour changer la durée (si nécessaire) :

```bash
# 30 secondes par exemple
TIMER_DURATION_SECONDS=30 node server.js
```

Ou modifier directement dans `config/app.config.js` :
```javascript
export const TIMER_DURATION_SECONDS = parseInt(process.env.TIMER_DURATION_SECONDS || '20', 10);
```

---

## 📊 Impact

- ✅ **Plus de temps pour placer des paris** : 20 secondes au lieu de 10
- ✅ **Meilleure expérience utilisateur** : Moins de précipitation
- ✅ **Synchronisation serveur** : Tous les clients voient le même timer de 20s
- ✅ **Clic automatique** : Le bouton Start clique toujours automatiquement à la fin du timer

---

**Date :** $(date)
**Statut :** ✅ Configuré à 20 secondes

