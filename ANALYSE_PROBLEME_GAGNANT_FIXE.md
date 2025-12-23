# 🔍 Analyse - Problème Gagnant Fixe (54) et Affichage Fixe (6)

**Date**: 2025-12-21  
**Problème**: 
- Seulement le participant no.54 gagne à chaque course
- Seulement le participant no.6 s'affiche dans la liste des gagnants

---

## 🚨 PROBLÈMES IDENTIFIÉS

### ❌ PROBLÈME #1: RNG ChaCha20 Non Réinitialisé Entre Courses

**Localisation**: `chacha20.js` - Instance globale singleton

**Problème**:
- `globalRng` est une instance singleton créée une seule fois
- Le compteur et le nonce ne sont pas réinitialisés entre les courses
- Si le RNG est utilisé pour d'autres choses (shuffle des places), il peut être dans un état prévisible
- Le même index pourrait être généré à chaque fois

**Code Actuel**:
```javascript
let globalRng = null;

function getGlobalRng() {
    if (!globalRng) {
        globalRng = new ChaCha20();
    }
    return globalRng;
}
```

**Impact**:
- Si le RNG est utilisé pour shuffle les places au début, puis pour sélectionner le gagnant, il pourrait toujours générer le même index
- Le participant à l'index sélectionné pourrait toujours être le même

---

### ❌ PROBLÈME #2: Participants dans Ordre Fixe

**Localisation**: `game.js` ligne 135-138

**Problème**:
- Les participants sont créés dans l'ordre de `BASE_PARTICIPANTS`
- Seulement les `place` sont mélangées, pas l'ordre des participants
- Si le RNG génère toujours le même index, le même participant gagne

**Code Actuel**:
```javascript
participants: BASE_PARTICIPANTS.map((p, i) => ({
    ...p,
    place: shuffledPlaces[i],
})),
```

**Ordre des Participants**:
```
Index 0: { number: 6, name: "De Bruyne" }
Index 1: { number: 7, name: "Ronaldo" }
Index 2: { number: 8, name: "Mbappe" }
Index 3: { number: 9, name: "Halland" }
Index 4: { number: 10, name: "Messi" }
Index 5: { number: 54, name: "Vinicius" }
```

**Si le RNG génère toujours l'index 5**, alors le participant no.54 gagne toujours.

---

### ❌ PROBLÈME #3: Mapping Incorrect Gagnant → Sauvegarde

**Localisation**: `routes/rounds.js` lignes 325-330

**Problème**:
- Le code cherche le `participant_id` en utilisant `winner.number`
- Si la recherche échoue, `winnerParticipantId` est `null`
- Si `winnerParticipantId` est `null`, `saveWinner()` peut sauvegarder des données incorrectes

**Code Actuel**:
```javascript
const winnerRow = participantsDb.find(p => Number(p.number) === Number(winner.number));
if (winnerRow && winnerRow.participant_id) {
    winnerParticipantId = winnerRow.participant_id;
} else {
    console.error(`[RACE-RESULTS] ❌ Participant gagnant non trouvé en BD`);
}
```

**Impact**:
- Si le mapping échoue, le gagnant peut être sauvegardé avec un `participant_id` incorrect
- Ou le gagnant peut être sauvegardé avec le premier participant trouvé (no.6)

---

### ❌ PROBLÈME #4: Affichage Utilise Données Incorrectes

**Localisation**: `screen.html` lignes 884-893

**Problème**:
- Les données de la BD sont transformées mais peuvent être incorrectes
- Si le `participant_id` est incorrect, le mauvais participant peut être affiché

**Code Actuel**:
```javascript
const winnersFromDB = response.data.map(w => ({
    id: w.id,
    winner: {
        id: w.participant_id,
        number: w.number,
        name: w.name,
        family: w.family
    },
    totalPrize: w.prize
}));
```

**Impact**:
- Si `w.participant_id` pointe vers le participant no.6, alors no.6 sera toujours affiché

---

## ✅ SOLUTIONS PROPOSÉES

### Solution #1: Réinitialiser le RNG Avant Chaque Sélection

**Fichier**: `routes/rounds.js`

**Changement**:
Réinitialiser le RNG avec un nouveau seed avant de sélectionner le gagnant.

**Code à Ajouter**:
```javascript
// Calculer le gagnant (ALÉATOIRE)
// ✅ CORRECTION: Réinitialiser le RNG avec un seed aléatoire pour garantir l'aléatoire
const { initChaCha20 } = await import('../chacha20.js');
initChaCha20(); // Réinitialise avec un nouveau seed aléatoire

const winner = participants[chacha20RandomInt(participants.length)];
console.log(`[RACE-RESULTS] 🎲 Gagnant sélectionné aléatoirement: Index ${chacha20RandomInt(participants.length)}, Participant: №${winner.number} ${winner.name}`);
```

---

### Solution #2: Mélanger l'Ordre des Participants

**Fichier**: `game.js`

**Changement**:
Mélanger l'ordre des participants, pas seulement les places.

**Code à Modifier**:
```javascript
// ✅ CORRECTION: Mélanger l'ordre des participants pour éviter les patterns
const shuffledParticipants = chacha20Shuffle([...BASE_PARTICIPANTS]);

const newRound = {
    id: newRoundId,
    participants: shuffledParticipants.map((p, i) => ({
        ...p,
        place: shuffledPlaces[i],
    })),
    // ...
};
```

---

### Solution #3: Ajouter des Logs Détaillés

**Fichier**: `routes/rounds.js`

**Changement**:
Ajouter des logs pour vérifier quel participant est sélectionné.

**Code à Ajouter**:
```javascript
// Calculer le gagnant (ALÉATOIRE)
console.log(`[RACE-RESULTS] 🎲 Sélection du gagnant parmi ${participants.length} participants:`);
participants.forEach((p, i) => {
    console.log(`   [${i}] №${p.number} ${p.name}`);
});

const winnerIndex = chacha20RandomInt(participants.length);
const winner = participants[winnerIndex];
console.log(`[RACE-RESULTS] ✅ Gagnant sélectionné: Index ${winnerIndex} → №${winner.number} ${winner.name}`);

const winnerWithPlace = { ...winner, place: 1, family: winner.family ?? 0 };
```

---

### Solution #4: Vérifier le Mapping participant_id

**Fichier**: `routes/rounds.js`

**Changement**:
Ajouter des logs et vérifications pour s'assurer que le mapping est correct.

**Code à Améliorer**:
```javascript
// ✅ CORRECTION: Améliorer la recherche avec logs détaillés
let winnerParticipantId = null;
try {
    const participantsDb = await getParticipants();
    console.log(`[RACE-RESULTS] 🔍 Recherche participant_id pour winner: №${winner.number} ${winner.name}`);
    console.log(`[RACE-RESULTS] Participants disponibles en BD:`, participantsDb.map(p => ({ number: p.number, name: p.participant_name, id: p.participant_id })));
    
    if (!participantsDb || participantsDb.length === 0) {
        console.error('[RACE-RESULTS] ❌ Aucun participant trouvé en BD');
    } else {
        const winnerRow = participantsDb.find(p => Number(p.number) === Number(winner.number));
        if (winnerRow && winnerRow.participant_id) {
            winnerParticipantId = winnerRow.participant_id;
            console.log(`[RACE-RESULTS] ✅ Winner trouvé: number=${winner.number}, name=${winner.name} -> participant_id=${winnerParticipantId}`);
        } else {
            console.error(`[RACE-RESULTS] ❌ Participant gagnant non trouvé en BD: number=${winner.number}, name=${winner.name}`);
            console.error(`[RACE-RESULTS] Participants disponibles:`, participantsDb.map(p => ({ number: p.number, name: p.participant_name })));
        }
    }
} catch (lookupErr) {
    console.error('[RACE-RESULTS] ❌ Erreur lookup participant:', lookupErr.message);
}
```

---

## 📊 FLUX ACTUEL (PROBLÉMATIQUE)

```
1. createNewRound() crée participants dans ordre fixe
   ├─ Index 0: De Bruyne (6)
   ├─ Index 1: Ronaldo (7)
   ├─ Index 2: Mbappe (8)
   ├─ Index 3: Halland (9)
   ├─ Index 4: Messi (10)
   └─ Index 5: Vinicius (54)
   ↓
2. calculateRaceResults() sélectionne gagnant
   ├─ chacha20RandomInt(6) → Toujours 5?
   └─ participants[5] → Toujours Vinicius (54)
   ↓
3. saveWinner() sauvegarde
   ├─ Recherche participant_id pour no.54
   ├─ Si échec → participant_id incorrect?
   └─ Sauvegarde avec données incorrectes
   ↓
4. Affichage liste gagnants
   ├─ Récupère depuis BD
   ├─ participant_id incorrect → Affiche no.6?
   └─ Toujours le même participant affiché
```

---

## ✅ FLUX CORRIGÉ (PROPOSÉ)

```
1. createNewRound() crée participants MÉLANGÉS
   ├─ Ordre aléatoire des participants
   └─ Places aussi mélangées
   ↓
2. calculateRaceResults() sélectionne gagnant
   ├─ RNG réinitialisé avec nouveau seed
   ├─ chacha20RandomInt(6) → Index aléatoire
   └─ participants[index] → Participant aléatoire
   ↓
3. saveWinner() sauvegarde
   ├─ Recherche participant_id avec logs détaillés
   ├─ Vérification que le mapping est correct
   └─ Sauvegarde avec données correctes
   ↓
4. Affichage liste gagnants
   ├─ Récupère depuis BD
   ├─ participant_id correct → Affiche le bon gagnant
   └─ Différents gagnants affichés
```

---

## 🧪 TESTS À EFFECTUER

### Test 1: Vérifier l'Aléatoire du RNG

1. Lancer plusieurs courses
2. Vérifier les logs pour voir quel index est sélectionné
3. Vérifier que différents participants gagnent

### Test 2: Vérifier le Mapping participant_id

1. Lancer une course
2. Vérifier les logs de recherche participant_id
3. Vérifier que le participant_id correspond au bon participant

### Test 3: Vérifier l'Affichage

1. Lancer plusieurs courses
2. Vérifier que différents gagnants s'affichent dans la liste
3. Vérifier que les gagnants correspondent aux courses

---

**Prochaines étapes**: Appliquer les corrections proposées





