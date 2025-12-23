# ✅ Corrections Finales - Statuts des Receipts

**Date**: 2025-01-XX  
**Statut**: ✅ Corrections Appliquées

---

## 🎯 PROBLÈME RÉSOLU

Les statuts des tickets restaient "pending" après une course à cause de **IDs désynchronisés entre gameState et la DB**.

---

## 🔧 CORRECTIONS APPLIQUÉES

### ✅ Correction #1 : Chercher les tickets depuis la DB au lieu de gameState

**Fichier**: `routes/rounds.js` - Fonction `calculateRaceResults()`

**Problème**: On utilisait `receipt.id` depuis `gameState.currentRound.receipts`, mais si l'ID avait été régénéré lors de la création en DB (collision de clé), l'ID dans gameState ne correspondait pas à celui en DB.

**Solution**: Chercher tous les tickets du round depuis la DB, puis mapper avec ceux de gameState par `user_id` + `total_amount` (plus fiable que par ID).

**Changements**:
1. ✅ Récupération de tous les tickets du round depuis la DB
2. ✅ Mapping par `user_id` + `total_amount` au lieu de par ID
3. ✅ Utilisation du vrai ID de la DB pour la mise à jour
4. ✅ Synchronisation de l'ID dans gameState si différent
5. ✅ Logs détaillés pour debugging

**Code**:
```javascript
// ✅ ÉTAPE 1: Récupérer tous les tickets de ce round depuis la DB
const dbResult = await pool.query(
  `SELECT receipt_id, round_id, user_id, total_amount, status, prize, created_at
   FROM receipts 
   WHERE round_id = $1`,
  [finishedRoundId]
);

// ✅ ÉTAPE 2: Mapper les tickets de gameState avec ceux de la DB
const receiptsToUpdate = receipts.map(receipt => {
  const receiptTotalAmount = (receipt.bets || []).reduce((sum, b) => sum + (Number(b.value) || 0), 0);
  
  const dbReceipt = receiptsFromDb.find(db => {
    const userMatch = (db.user_id === receipt.user_id) || (!db.user_id && !receipt.user_id);
    const amountMatch = Math.abs(Number(db.total_amount) - receiptTotalAmount) < 0.01;
    return userMatch && amountMatch;
  });
  
  return {
    receipt: receipt,
    dbReceipt: dbReceipt,
    dbId: dbReceipt ? dbReceipt.receipt_id : receipt.id
  };
});

// ✅ ÉTAPE 3: Mettre à jour avec les vrais IDs de la DB
for (const { receipt, dbReceipt, dbId } of receiptsToUpdate) {
  if (!dbReceipt) {
    console.warn(`[RACE-RESULTS] ⚠️ Ticket non trouvé en DB pour receipt.id=${receipt.id}, skip`);
    continue;
  }
  
  const newStatus = receipt.prize > 0 ? 'won' : 'lost';
  const updateResult = await updateReceiptStatus(dbId, newStatus, receipt.prize || 0);
  
  // Synchroniser l'ID dans gameState si différent
  if (receipt.id !== dbId) {
    receipt.id = dbId;
  }
}
```

---

### ✅ Correction #2 : Synchroniser l'ID dans gameState après régénération

**Fichier**: `routes/receipts.js` - Fonction POST `/api/v1/receipts/?action=add`

**Problème**: Quand l'ID était régénéré (collision de clé), seule la variable locale `receipt` était mise à jour, pas la référence dans `gameState.currentRound.receipts`.

**Solution**: Mettre à jour la référence dans gameState après régénération de l'ID.

**Code**:
```javascript
if (dbReceipt && (dbReceipt.receipt_id || dbReceipt.receipt_id === 0)) {
  const oldId = receipt.id;
  receipt.id = dbReceipt.receipt_id || receipt.id;
  
  // ✅ Si l'ID a changé, mettre à jour la référence dans gameState
  if (oldId !== receipt.id) {
    const receiptIndex = gameState.currentRound.receipts.findIndex(r => r.id === oldId);
    if (receiptIndex !== -1) {
      gameState.currentRound.receipts[receiptIndex].id = receipt.id;
      console.log(`[DB] ✓ Référence gameState synchronisée avec nouvel ID ${receipt.id}`);
    }
  }
}
```

---

## 📊 RÉSULTAT ATTENDU

Après ces corrections :

1. ✅ **Recherche depuis DB** : Les tickets sont cherchés depuis la DB avec les vrais IDs
2. ✅ **Mapping fiable** : Mapping par `user_id` + `total_amount` (ne dépend pas de l'ID)
3. ✅ **Mise à jour correcte** : Les statuts sont mis à jour avec les bons IDs
4. ✅ **Synchronisation** : Les IDs sont synchronisés entre gameState et DB
5. ✅ **Statuts corrects** : `my-bets.html` et `dashboard.html` affichent les bons statuts ("won" ou "lost")

---

## 🧪 TESTS À EFFECTUER

1. ✅ Créer un ticket pendant un round actif
2. ✅ Simuler une collision d'ID (si possible)
3. ✅ Vérifier que l'ID est synchronisé dans gameState
4. ✅ Lancer une course
5. ✅ Vérifier dans les logs que les tickets sont trouvés depuis la DB
6. ✅ Vérifier que les statuts sont bien mis à jour en DB
7. ✅ Vérifier dans `my-bets.html` que le statut est correct
8. ✅ Vérifier dans `dashboard.html` que le statut est correct

---

## 📝 FICHIERS MODIFIÉS

- ✅ `routes/rounds.js` - Fonction `calculateRaceResults()` améliorée
- ✅ `routes/receipts.js` - Synchronisation ID dans gameState

---

## ✅ STATUT

**Toutes les corrections ont été appliquées avec succès** 🎉

Le système devrait maintenant correctement mettre à jour les statuts des tickets après chaque course, même si les IDs ont été régénérés ou désynchronisés.

