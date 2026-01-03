# Architecture Intégrée: profit-choice détermine TOUTES les places dès T=0s

## 🎯 Concept Clé

**profit-choice est l'UNIQUE SOURCE DE VÉRITÉ pour les places 1-6**

- ✅ Appelé à T=0s (lors du démarrage de la course)
- ✅ Détermine le gagnant ET attribue les places finales
- ✅ Tous les participants reçoivent leurs places finales AVANT race_start
- ✅ Aucune modification ultérieure des places

---

## 📊 Timeline Simplifiée

```
PHASE 1: PRE-RACE
├─ Participants créés avec place:0 (createNewRound)
├─ Les paris arrivent (POST /api/bets)
└─ Participants restent avec place:0

PHASE 2: RACE START (T=0s)
├─ Appel à profit-choice()
│  ├─ Analyse les mises des participants
│  ├─ Sélectionne le gagnant (25% marge)
│  ├─ Attribue place:1 au gagnant
│  └─ Attribue places:2-6 aux autres (shufflés)
├─ gameState.currentRound.participants mis à jour avec places 1-6 ✅
└─ race_start broadcast avec PLACES FINALES

PHASE 3: RACE (T=0s à T=30s)
├─ Movie screen animation utilise les places finales
├─ Les chevaux bougent avec leur place définie
└─ race_end event

PHASE 4: FINISH (T=35s à T=40s)
├─ finish_screen affiche le gagnant (place:1)
└─ Game terminé
```

---

## 🔄 Flux Technique Détaillé

### 1️⃣ Création du Round (createNewRound)

```javascript
// game.js
const participantsWithoutPlaces = BASE_PARTICIPANTS.map(p => ({ ...p, place: 0 }));

const newRound = {
    id: newRoundId,
    participants: participantsWithoutPlaces,  // ✅ place:0 = EN ATTENTE
    receipts: [],
    // ...
};
```

**État:** Participants en attente, place:0

---

### 2️⃣ Les Paris Arrivent

```javascript
// POST /api/bets
gameState.currentRound.receipts.push(newReceipt);
```

**État:** Participants toujours place:0, receipts remplis

---

### 3️⃣ Démarrage de la Course (onRaceStart - T=0s)

```javascript
// routes/rounds.js - onRaceStart callback
onRaceStart: () => {
    // ✅ ÉTAPE CRITIQUE: Appeler profit-choice
    const profitChoiceResult = chooseProfitableWinner(gameState.currentRound, 0.25);
    
    // ✅ Mettre à jour les participants avec les places finales
    gameState.currentRound.participants = profitChoiceResult.allParticipantsWithPlaces;
    
    // ✅ Broadcaster race_start avec places finales
    broadcast({
        event: "race_start",
        currentRound: JSON.parse(JSON.stringify(gameState.currentRound)),  // Contient places 1-6!
        // ...
    });
}
```

**État:** Participants avec places 1-6, prêts pour l'animation

---

### 4️⃣ Animation de la Course (T=0s à T=30s)

```javascript
// Client (frontend) reçoit race_start avec places finales
// Movie screen animation utilise ces places
// Les chevaux se déplacent avec leur place définie
```

**État:** Places visibles dans l'animation

---

### 5️⃣ Fin de la Course (T=35s)

```javascript
// routes/rounds.js - executeRaceFinish
// ✅ SIMPLIFIÉ: Les places sont déjà définies!
const winner = currentParticipants.find(p => p.place === 1);
console.log(`Gagnant confirmé: №${winner.number}`);

// Pas de recalcul, pas d'appel à profit-choice
// Les places restent telles que définies à T=0s
```

**État:** Places confirmées, gagnant identifié

---

### 6️⃣ Affichage du Gagnant (T=40s)

```javascript
// finish_screen affiche le participant avec place:1
// C'est le gagnant choisi par profit-choice à T=0s
```

**État:** Gagnant affiché et confirmé

---

## 🎲 Fonction chooseProfitableWinner() - Détail

```javascript
export function chooseProfitableWinner(roundData, marginPercent = 0.25) {
    // 1. Analyser les mises
    const totalMises = receipts.reduce(...);
    const margeGlobale = totalMises × 25%;
    const resteDistribuable = totalMises - margeGlobale;
    
    // 2. Calculer payout pour chaque participant
    const payoutsByNumber = {};
    receipts.forEach(receipt => {
        receipt.bets.forEach(bet => {
            payoutsByNumber[bet.number] += bet.value × coeff;
        });
    });
    
    // 3. Sélectionner le gagnant (viable ou moindre coût)
    const viable = participants.filter(p => payoutsByNumber[p.number] <= resteDistribuable);
    const chosen = viable.length > 0 
        ? viable[random(viable.length)]
        : findMinPayoutParticipant(participants);
    
    // 4. ✅ ATTRIBUER LES PLACES À TOUS LES PARTICIPANTS
    const otherParticipants = participants.filter(p => p.number !== chosen.number);
    const shuffledOthers = chacha20Shuffle(otherParticipants);
    
    const allParticipantsWithPlaces = [
        { ...chosen, place: 1 },  // Gagnant en place 1
        ...shuffledOthers.map((p, idx) => ({ ...p, place: idx + 2 }))  // Autres en 2-6
    ];
    
    return {
        winner: chosen,
        allParticipantsWithPlaces,  // ✅ TOUT LE MONDE A UNE PLACE
        reason: 'viable|min_loss',
        totalMises,
        margeGlobale,
        resteDistribuable,
        payoutsByNumber
    };
}
```

---

## ✅ Points Clés de l'Architecture

### 1. Pas de Logique Aléatoire Intermédiaire
- ❌ ~~Places aléatoires au démarrage du round~~
- ❌ ~~Recalcul des places à T=35s~~
- ✅ Places déterminées UNE FOIS par profit-choice à T=0s

### 2. Source Unique de Vérité
- `profit-choice` est appelé UNE FOIS
- Retourne `allParticipantsWithPlaces` avec places 1-6
- Ces places sont définitives et immuables

### 3. Cohérence Garantie
- Ce que le joueur VOIT = Ce que le système CALCULE
- Le gagnant affiché = place:1 = gagnant choisi par profit-choice

### 4. Performance
- Moins d'appels à random (shuffle 1× au lieu de 2×)
- Moins de logique (pas de recalcul)
- Plus transparent (flux linéaire)

---

## 🔍 Vérifications Intégrées

### À T=0s (onRaceStart)
```javascript
if (!profitChoiceResult.winner || !profitChoiceResult.allParticipantsWithPlaces) {
    console.error('❌ profit-choice a échoué');
    return;
}

// Mettre à jour gameState.currentRound
gameState.currentRound.participants = profitChoiceResult.allParticipantsWithPlaces;
```

### À T=35s (executeRaceFinish)
```javascript
const winner = currentParticipants.find(p => p.place === 1);
if (!winner) {
    console.error('❌ Aucun participant avec place:1');
    return;
}

console.log(`✅ Gagnant confirmé: №${winner.number}`);
```

---

## 📈 Avantages vs Anciennes Approches

| Aspect | Avant (Random) | Avant (Recalcul) | **Après (Intégré)** |
|--------|---|---|---|
| **Appels profit-choice** | 0× | 1× | **1×** |
| **Recalculs places** | 1× | 1× | **0×** |
| **Shuffles aléatoires** | 1× | 2× | **1×** |
| **Logique distribuée** | ✅ | ✅ | **❌** |
| **Source unique** | ❌ | ❌ | **✅** |
| **Cohérence** | ❌ | ✅ | **✅** |
| **Transparence** | ❌ | ✅ | **✅** |
| **Maintenabilité** | ❌ | ✅ | **✅✅** |

---

## 🚀 Déploiement

```bash
# 1. Vérifier la syntaxe
node -c game.js
node -c routes/rounds.js

# 2. Redémarrer le serveur
npm start

# 3. Tester le flux complet
# - Créer un round
# - Ajouter des paris
# - Démarrer la course
# - Vérifier que les places sont assignées à race_start
```

---

## 📝 Code Reference

### Modification game.js
- `createNewRound()` - Participants créés avec `place:0`
- `chooseProfitableWinner()` - Retourne `allParticipantsWithPlaces`

### Modification routes/rounds.js
- `onRaceStart()` - Appelle profit-choice et met à jour gameState
- `executeRaceFinish()` - Confirme simplement les places existantes

---

## 🎉 Résumé

**profit-choice attribue maintenant TOUTES les places à T=0s:**

1. ✅ Participants créés avec place:0
2. ✅ Les paris arrivent
3. ✅ **À T=0s: profit-choice attribue place:1-6 à TOUS**
4. ✅ race_start broadcast avec places finales
5. ✅ Animation utilise ces places
6. ✅ À T=40s: gagnant affiché avec place:1

**Aucune ambiguïté, aucun recalcul, aucune incoherence** ✅
