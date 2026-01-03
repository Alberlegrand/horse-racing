# Architecture Simplifiée: profit-choice attribue les places 1-6

## 🎯 Objectif

**Avant:** Logique aléatoire complexe + recalcul des places = source de vérité fragmentée  
**Après:** profit-choice est l'UNIQUE source de vérité pour TOUT - gagnant ET places 1-6

## 📊 Timeline de la Course

```
T=0s    🎬 createNewRound()
        └─ Participants créés avec place:0 (EN ATTENTE)
        
T=30s   🎬 race_end event
        └─ Movie screen affiche l'animation (pas de places, car pas encore déterminées)
        
T=35s   🎬 calculateRaceResults() → chooseProfitableWinner()
        └─ profit-choice ATTRIBUE:
           • place:1 au gagnant profitable
           • places:2-6 shufflés aléatoirement aux autres
        └─ retourne allParticipantsWithPlaces avec TOUTES les places
        
T=40s   🎬 finish_screen
        └─ Affiche le gagnant (place:1 assigné par profit-choice)
```

## 🔧 Implémentation Détaillée

### 1️⃣ createNewRound() - Initialisation simple

**Avant:**
```javascript
// ❌ Logique complexe de shuffle aléatoire
const shuffledParticipants = chacha20Shuffle(participantsCopy);
const placesRemaining = [...availablePlaces];
for (let i = 0; i < shuffledParticipants.length; i++) {
    const randomIndex = chacha20RandomInt(placesRemaining.length);
    const selectedPlace = placesRemaining[randomIndex];
    // Attribuer place aléatoire
}
```

**Après:**
```javascript
// ✅ Initialisation simple - participants SANS places
const participantsWithoutPlaces = BASE_PARTICIPANTS.map(p => ({ ...p, place: 0 }));

const newRound = {
    id: newRoundId,
    participants: participantsWithoutPlaces,  // place:0 = EN ATTENTE
    receipts: [],
    lastReceiptId: 3,
    totalPrize: 0,
    persisted: false
};
```

**Avantage:** Pas de place aléatoire au démarrage = pas de confusion possible

---

### 2️⃣ chooseProfitableWinner() - Attribution des places

**Signature mise à jour:**
```javascript
/**
 * @returns {Object} {
 *   winner: {...},                          // Gagnant SANS place
 *   allParticipantsWithPlaces: [...],       // ✅ NOUVEAU: TOUS les participants avec places 1-6
 *   reason: 'viable|min_loss',
 *   totalMises,
 *   margeGlobale,
 *   resteDistribuable,
 *   payoutsByNumber
 * }
 */
```

**Implémentation:**
```javascript
// ✅ ÉTAPE FINALE: Attribuer place:1 au gagnant et places:2-6 aux autres
const otherParticipants = participants.filter(p => Number(p.number) !== Number(chosen?.number));
const shuffledOthers = chacha20Shuffle(otherParticipants);  // ✅ Shuffle UNIQUEMENT les autres

const allParticipantsWithPlaces = [
    { ...chosen, place: 1 },  // Gagnant en place 1
    ...shuffledOthers.map((p, idx) => ({ ...p, place: idx + 2 }))  // Autres en 2-6
];

return {
    winner: (() => {
        const { place, ...winnerWithoutPlace } = chosen;  // Retourner SANS place
        return winnerWithoutPlace;
    })(),
    allParticipantsWithPlaces,  // ✅ NOUVEAU: Tableau complet avec places
    reason,
    totalMises,
    margeGlobale,
    resteDistribuable,
    payoutsByNumber
};
```

**Avantages:**
- profit-choice détermine TOUT (gagnant + places)
- Pas de recalcul ultérieur
- Source unique = pas d'incohérence possible
- Les autres participants sont shufflés aléatoirement (places 2-6 random)

---

### 3️⃣ calculateRaceResults() - Utilisation directe

**Avant:**
```javascript
// ❌ Recalcul de places après profit-choice
const otherParticipants = participants.filter(p => Number(p.number) !== Number(winner.number));
const shuffledOthers = chacha20Shuffle(otherParticipants);
const updatedParticipants = [
    { ...winner, place: 1, coeff: winner.coeff },
    ...shuffledOthers.map((p, index) => ({ ...p, place: index + 2 }))
];
```

**Après:**
```javascript
// ✅ Utilisation DIRECTE des places attribuées par profit-choice
const allParticipantsWithPlaces = profitChoiceResult.allParticipantsWithPlaces;

// Validations
if (!Array.isArray(allParticipantsWithPlaces) || allParticipantsWithPlaces.length === 0) {
    throw new Error('profit-choice must return allParticipantsWithPlaces');
}

const winnerInPlaces = allParticipantsWithPlaces.find(p => p.place === 1);
if (Number(winnerInPlaces.number) !== Number(winner.number)) {
    throw new Error('Winner must be at place 1');
}

// Utiliser directement
const updatedParticipants = allParticipantsWithPlaces;
savedRoundData.participants = updatedParticipants;
```

**Avantages:**
- Pas de recalcul = logique plus simple
- Pas de risque de désynchronisation
- Validations strictes = détection d'erreurs immédiate

---

## ✅ Validations Critiques

```javascript
// ✅ VALIDATION #1: allParticipantsWithPlaces non-vide
if (!Array.isArray(allParticipantsWithPlaces) || allParticipantsWithPlaces.length === 0) {
    throw new Error('profit-choice must return allParticipantsWithPlaces');
}

// ✅ VALIDATION #2: Gagnant en place 1
const winnerAtPlace1 = allParticipantsWithPlaces.find(p => p.place === 1);
if (!winnerAtPlace1 || Number(winnerAtPlace1.number) !== Number(winner.number)) {
    throw new Error('Winner must be at place 1');
}

// ✅ VALIDATION #3: Toutes les places 1-6 présentes
const places = new Set(allParticipantsWithPlaces.map(p => p.place));
if (places.size !== 6 || ![1,2,3,4,5,6].every(p => places.has(p))) {
    throw new Error('Invalid place distribution');
}

// ✅ VALIDATION #4: Pas de places dupliquées
if (new Set(allParticipantsWithPlaces.map(p => p.place)).size !== 6) {
    throw new Error('Duplicate places found');
}
```

---

## 📈 Avantages de cette Architecture

| Aspect | Avant | Après |
|--------|-------|-------|
| **Source de vérité** | Fragmentée (random + profit-choice + recalcul) | Unique (profit-choice) |
| **Logique aléatoire** | createNewRound() + calculateRaceResults() | Seulement after profit-choice (places 2-6) |
| **Places au démarrage** | Aléatoires (confusion possible) | place:0 (EN ATTENTE) |
| **Recalcul des places** | Toujours 2 fois | Zéro (uniquement attriution unique) |
| **Risque d'incohérence** | Très élevé | Éliminé (profit-choice = source unique) |
| **Validations** | Complexes et tardives | Simples et strictes dans calculateRaceResults() |
| **Performance** | Shuffle 2×, random 2× | Shuffle 1× (autres uniquement) |
| **Débogage** | Difficile (logique distribuée) | Facile (tout dans profit-choice) |

---

## 🔍 Flux de Données Complet

```
createNewRound()
  ↓
  participants[i].place = 0  (EN ATTENTE)
  
  ↓
  
calculateRaceResults() @ T=35s
  ↓
  chooseProfitableWinner(roundData)
    ├─ Détermine le gagnant (stratégie 25% marge)
    ├─ Sépare gagnant des autres
    ├─ Shuffle les autres (places aléatoires 2-6)
    └─ Retourne {
         winner: {...},
         allParticipantsWithPlaces: [
           {number:X, place:1},    // Gagnant
           {number:Y, place:2},    // Autre shufflé
           {number:Z, place:3},    // Autre shufflé
           ...
         ]
       }
  ↓
  savedRoundData.participants = allParticipantsWithPlaces
  
  ↓
  finish_screen @ T=40s
  ↓
  Affiche participant avec place:1 (le gagnant)
```

---

## 🎬 Exemple Complet

### Round crée
```
Participants (place:0 = EN ATTENTE):
  №6 De Bruyne (family:0, place:0)
  №7 Ronaldo (family:1, place:0)
  №8 Mbappe (family:2, place:0)
  №9 Halland (family:3, place:0)
  №10 Messi (family:4, place:0)
  №54 Vinicius (family:5, place:0)
```

### Mises reçues
```
Ticket #1:
  - №6 De Bruyne: 1000 centimes × 5.5 = 5500 payout
  - №7 Ronaldo: 500 centimes × 4.7 = 2350 payout

Ticket #2:
  - №8 Mbappe: 2000 centimes × 7.2 = 14400 payout
  - №9 Halland: 800 centimes × 5.8 = 4640 payout

Total mises: 4300 centimes
Marge 25%: 1075 centimes
Reste distribuable: 3225 centimes
```

### Analyse profit-choice
```
VIABLES (payout ≤ 3225):
  ✅ №7 Ronaldo: payout=2350
  ✅ №10 Messi: payout=0
  ✅ №54 Vinicius: payout=0

SÉLECTION ALÉATOIRE: №10 Messi (payout=0, marge=3225)
```

### Attribution des places par profit-choice
```
1. Gagnant → place:1
   №10 Messi → place:1

2. Autres shufflés aléatoirement
   Avant shuffle: №6, №7, №8, №9, №54
   Après shuffle: №9, №54, №7, №6, №8

RÉSULTAT FINAL:
  Place 1: №10 Messi (GAGNANT)
  Place 2: №9 Halland
  Place 3: №54 Vinicius
  Place 4: №7 Ronaldo
  Place 5: №6 De Bruyne
  Place 6: №8 Mbappe
```

### Affichage au finish_screen
```
Le finish_screen cherche p.place === 1
→ Trouve №10 Messi
→ Affiche "GAGNANT: №10 Messi" ✅

Cohérence COMPLÈTE:
  Ce que le joueur voit = Ce que le système a calculé
```

---

## 🚀 Déploiement

1. **Backup de game.js et routes/rounds.js**
2. **Déployer les modifications**
3. **Redémarrer le serveur**
4. **Tester avec `test-profit-choice-places.mjs`** ✅
5. **Monitoring des logs** - chercher:
   - `[PROFIT-CHOICE] 🎲 ATTRIBUTION DES PLACES:`
   - `[RACE-RESULTS] 🏆 CLASSEMENT FINAL (attribué par profit-choice):`

---

## 📝 Résumé des Changements

| Fichier | Changement |
|---------|-----------|
| **game.js** | createNewRound() - enlever shuffle aléatoire, participants with place:0 |
| **game.js** | chooseProfitableWinner() - ajouter allParticipantsWithPlaces retour |
| **routes/rounds.js** | calculateRaceResults() - utiliser allParticipantsWithPlaces directement |
| **test-profit-choice-places.mjs** | Nouveau test - valider la nouvelle architecture |

---

## ✅ Tests de Validation

```bash
node test-profit-choice-places.mjs
```

Output attendu:
```
✅ TEST 1 PASSED: Tous les participants ont place:0
✅ TEST 2 PASSED: chooseProfitableWinner() a attribué les places 1-6
✅ TEST 3 PASSED: Exactement 1 participant en place 1
✅ TEST 4 PASSED: Tous les autres participants ont des places uniques 2-6
✅ TOUS LES TESTS PASSÉS
```

---

## 🎉 Conclusion

**profit-choice est maintenant l'UNIQUE SOURCE DE VÉRITÉ pour:**
- ✅ Déterminer le gagnant
- ✅ Attribuer les places 1-6 à TOUS les participants
- ✅ Garantir la cohérence entre ce que les joueurs voient et ce que le système calcule

**Aucune logique aléatoire à la création du round**  
**Aucun recalcul des places**  
**Aucune possibilité d'incohérence**
