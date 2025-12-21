# 🧪 GUIDE DE TEST - Synchronisation des Gagnants

## Objectif du Test

Vérifier que **le gagnant affichéé dans le finish_screen est exactement le même que celui affiché dans la liste des gagnants**.

## Prérequis

1. ✅ Serveur démarré: `npm run dev` ou `node server.js`
2. ✅ Browser ouvert sur: `http://localhost:3000/screen.html`
3. ✅ Console browser ouverte (F12 → Console)

## Procédure de Test

### Step 1: Préparer l'Environnement

```bash
# Terminal
cd c:\Users\LAMOTHE\Desktop\horse-racing
node server.js
```

### Step 2: Ouvrir la Page de Contrôle

1. Ouvrir: `http://localhost:3000/screen.html`
2. Ouvrir la console (F12 → Console)
3. Minimiser les sections "Participants" et "Tickets" si nécessaire
4. Laisser visible:
   - **Finish Screen** (au centre)
   - **The Last Winners** (à droite)

### Step 3: Lancer une Course

- Attendre le démarrage automatique d'une course
- OU cliquer sur "Start Race" si disponible

### Step 4: Observer la Fin de la Course

**À T+35 secondes (race_results), vous verrez:**

**Dans la Console:**
```
🎯 [FINISH-SCREEN] Émission du winner au historique:
   Round: 123, Winner: №5 Spirit (Family: 2)

🎯 [WINNERS-SYNC] Événement round_winner reçu du finish_screen:
   Round ID: 123
   Winner: №5 Spirit (Family: 2)

✅ [WINNERS-SYNC] Gagnant préajouté à #winnersList
```

**À l'Écran:**
1. **Finish Screen** affiche le gagnant (ex: "№5 Spirit")
2. **The Last Winners** affiche le même gagnant au-dessus

### Step 5: Vérifier la Cohérence

#### ✅ TEST RÉUSSI Si:

- [ ] Le gagnant du finish_screen = gagnant de la liste
- [ ] Même numéro (number)
- [ ] Même nom (name)  
- [ ] Même famille (family) = même couleur
- [ ] Les logs FINISH-SCREEN et WINNERS-SYNC apparaissent
- [ ] Pas de message d'erreur ❌

#### ❌ TEST ÉCHOUÉ Si:

- [ ] Gagnant différent entre finish_screen et liste
- [ ] Les logs ne contiennent pas "FINISH-SCREEN" ou "WINNERS-SYNC"
- [ ] Erreur dans la console: "Impossible d'ajouter le gagnant"
- [ ] Doublon dans la liste (même round 2 fois)

## Scénarios de Test

### Scénario 1: Cours Normal (BASIQUE)

**Durée:** ~3 minutes  
**Étapes:**
1. Laisser fonctionner 1-2 courses complètes
2. Vérifier que chaque gagnant affiché = liste
3. Vérifier les logs

**Résultat Attendu:** ✅ Cohérence parfaite

---

### Scénario 2: Courses Multiples (AVANCÉ)

**Durée:** ~10 minutes  
**Étapes:**
1. Laisser jouer 6 courses consécutives
2. Après chaque course, comparer winner_screen vs liste
3. Vérifier que la liste garde toujours 6 gagnants max
4. Vérifier qu'aucun doublon n'apparaît

**Résultat Attendu:** ✅ Cohérence maintenue, pas de doublons

---

### Scénario 3: Vérification des Familles (DESIGN)

**Durée:** ~5 minutes  
**Étapes:**
1. Jouer plusieurs courses
2. Comparer les couleurs (family) du finish_screen vs liste
3. Vérifier que la classe CSS "family{N}" est correctement appliquée

**Résultat Attendu:** ✅ Même couleur dans les deux endroits

---

## Exemple Complet de Test

### Avant (❌ PROBLÈME)
```
Finish Screen: № 3 Thunder (Family 1 = Bleu)
Winners List:  № 7 Zephyr (Family 3 = Rouge)  ← DIFFÉRENT!
```

### Après (✅ CORRECTIONN)
```
Finish Screen: № 3 Thunder (Family 1 = Bleu)
Winners List:  № 3 Thunder (Family 1 = Bleu)  ← IDENTIQUE!

Console:
🎯 [FINISH-SCREEN] Émission du winner au historique:
   Round: 50, Winner: №3 Thunder (Family: 1)

🎯 [WINNERS-SYNC] Événement round_winner reçu du finish_screen:
   Round ID: 50
   Winner: №3 Thunder (Family: 1)

✅ [WINNERS-SYNC] Gagnant préajouté à #winnersList
```

## Logs Importants

| Log | Signification | Action |
|-----|---------------|--------|
| `🎯 [FINISH-SCREEN]` | Finish_screen envoie le winner | ✅ Normal |
| `🎯 [WINNERS-SYNC] Événement reçu` | screen.html a reçu l'event | ✅ Normal |
| `✅ [WINNERS-SYNC] Gagnant préajouté` | Winner ajouté à la liste | ✅ Normal |
| `⚠️ déjà présent, doublon évité` | Doublon détecté et ignoré | ✅ Normal (déduplication) |
| `❌ [WINNERS-SYNC] Impossible d'ajouter` | Erreur lors de l'ajout | ❌ À investiguer |
| `⚠️ [WINNERS-SYNC] payload.winner manquant` | Données incomplètes reçues | ❌ À investiguer |

## Déboguer en Cas de Problème

### Problème: Gagnants Différents

1. Ouvrir console (F12)
2. Chercher logs `[FINISH-SCREEN]` et noter le winner
3. Chercher logs `[WINNERS-SYNC]` et comparer
4. Si différents → Bug dans game.getWinner()
5. Si absents → Event round_winner non émis

### Problème: Doublons dans la Liste

1. Vérifier logs pour `déjà présent, doublon évité`
2. Si ce log n'apparaît pas → Bug dans détection de doublons
3. Vérifier que `.data('roundId')` est bien défini

### Problème: Aucun Log

1. Vérifier que finish_screen.html charge `finish.js`
2. Vérifier que screen.html charge le script jQuery
3. Relancer le serveur: `npm run dev`
4. Actualiser le browser: F5

## Résumé de la Correction

- ✅ Source unique: `game.getWinner()`
- ✅ Communication via événement: `round_winner`
- ✅ Traçabilité complète: Logs détaillés
- ✅ Cohérence garantie: Même gagnant partout
- ✅ Pas de régression: Aucune dégradation de performance

---

**🎯 Objectif:** Zéro incohérence entre finish_screen et winners list ✅
