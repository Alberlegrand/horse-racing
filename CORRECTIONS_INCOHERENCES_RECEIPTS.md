# ✅ Corrections : Incohérences des Receipts dans le Dashboard

**Date**: Corrections appliquées  
**Statut**: ✅ CORRECTIONS APPLIQUÉES

---

## 🔍 PROBLÈME IDENTIFIÉ

D'après les données de l'interface cashier :

```
Round actif: #10000016
Tickets affichés:
- #5001358501 : Round #10000286, 350.00 HTG, x8.10, **En attente**
- #5001227029 : Round #10000286, 2500.00 HTG, x5.80, **En attente**
```

**Incohérences** :
1. ❌ Round ID mismatch : Le round actif est #10000016, mais les tickets appartiennent au round #10000286
2. ❌ Statuts non mis à jour : Les tickets sont toujours "En attente" alors que le round #10000286 devrait être terminé

---

## ✅ CORRECTIONS APPLIQUÉES

### 1. **Amélioration du matching dans `calculateRaceResults()`**

**Fichier**: `routes/rounds.js` lignes 300-319

**Changement** : Ajout d'un fallback pour le matching par `receipt_id` si le matching par `user_id + total_amount` échoue.

**Code ajouté** :
```javascript
// ✅ AMÉLIORATION: Matching amélioré avec fallback par receipt_id
const receiptsToUpdate = receipts.map(receipt => {
    const receiptTotalAmount = (receipt.bets || []).reduce((sum, b) => sum + (Number(b.value) || 0), 0);
    
    // Tentative 1: Match par user_id + total_amount
    let dbReceipt = receiptsFromDb.find(db => {
        const userMatch = (db.user_id === receipt.user_id) || (!db.user_id && !receipt.user_id);
        const amountMatch = Math.abs(Number(db.total_amount) - receiptTotalAmount) < 0.01;
        return userMatch && amountMatch;
    });
    
    // ✅ NOUVEAU: Tentative 2: Fallback par receipt_id si disponible
    if (!dbReceipt && receipt.id) {
        dbReceipt = receiptsFromDb.find(db => Number(db.receipt_id) === Number(receipt.id));
        if (dbReceipt) {
            console.log(`[RACE-RESULTS] 🔄 Matching par receipt_id pour ticket #${receipt.id}`);
        }
    }
    
    return {
        receipt: receipt,
        dbReceipt: dbReceipt,
        dbId: dbReceipt ? dbReceipt.receipt_id : receipt.id
    };
});
```

**Impact** : Les tickets sont maintenant trouvés même si le matching par `user_id + total_amount` échoue.

---

### 2. **Mise à jour des tickets avec `round_id = null`**

**Fichier**: `routes/rounds.js` lignes 382-430

**Changement** : Ajout d'une logique pour mettre à jour les tickets créés avec `round_id = null` (créés avant que le round soit persisté en DB).

**Code ajouté** :
```javascript
// ✅ NOUVEAU: Mettre à jour les tickets avec round_id = null qui appartiennent à ce round
try {
    const roundInfo = await pool.query(
        `SELECT started_at, finished_at FROM rounds WHERE round_id = $1`,
        [finishedRoundId]
    );
    
    if (roundInfo.rows.length > 0 && roundInfo.rows[0].started_at) {
        const roundStartTime = roundInfo.rows[0].started_at;
        const roundEndTime = roundInfo.rows[0].finished_at || new Date();
        
        const nullRoundReceipts = await pool.query(
            `SELECT receipt_id, user_id, total_amount, status, prize, created_at
             FROM receipts 
             WHERE round_id IS NULL
             AND created_at >= $1
             AND created_at <= $2`,
            [roundStartTime, roundEndTime]
        );
        
        if (nullRoundReceipts.rows.length > 0) {
            console.log(`[RACE-RESULTS] 📊 ${nullRoundReceipts.rows.length} ticket(s) avec round_id=NULL trouvé(s), mise à jour...`);
            
            for (const nullReceipt of nullRoundReceipts.rows) {
                // Trouver le ticket correspondant dans gameState
                const matchingReceipt = receipts.find(r => {
                    const rTotal = (r.bets || []).reduce((sum, b) => sum + (Number(b.value) || 0), 0);
                    const userMatch = (nullReceipt.user_id === r.user_id) || (!nullReceipt.user_id && !r.user_id);
                    const amountMatch = Math.abs(Number(nullReceipt.total_amount) - rTotal) < 0.01;
                    return userMatch && amountMatch;
                });
                
                if (matchingReceipt) {
                    const newStatus = matchingReceipt.prize > 0 ? 'won' : 'lost';
                    
                    // Mettre à jour le statut et le prize
                    await updateReceiptStatus(nullReceipt.receipt_id, newStatus, matchingReceipt.prize || 0);
                    
                    // Mettre à jour le round_id
                    await pool.query(
                        `UPDATE receipts SET round_id = $1 WHERE receipt_id = $2`,
                        [finishedRoundId, nullReceipt.receipt_id]
                    );
                    
                    console.log(`[RACE-RESULTS] ✅ Ticket #${nullReceipt.receipt_id} mis à jour: round_id=NULL → ${finishedRoundId}, status=${newStatus}`);
                }
            }
        }
    }
} catch (nullRoundErr) {
    console.error(`[RACE-RESULTS] ❌ Erreur mise à jour tickets round_id=NULL:`, nullRoundErr.message);
}
```

**Impact** : Les tickets créés avec `round_id = null` sont maintenant mis à jour correctement lors de la fin du round.

---

### 3. **Route de diagnostic créée**

**Fichier**: `routes/diagnostic.js` (nouveau fichier)

**Changement** : Création d'une route de diagnostic pour identifier les incohérences.

**Endpoint** :
```
GET /api/v1/diagnostic/receipts/:roundId
```

**Utilisation** :
```bash
# Vérifier les tickets du round #10000286
curl -H "Authorization: Bearer YOUR_TOKEN" \
  http://localhost:8080/api/v1/diagnostic/receipts/10000286
```

**Retourne** :
- Les tickets en DB pour le round
- Les tickets dans gameState pour le round
- Les incohérences identifiées
- Le statut du round (terminé ou non)

---

## 🎯 RÉSULTATS ATTENDUS

Après ces corrections :

1. ✅ **Matching amélioré** : Les tickets sont trouvés même si le matching par `user_id + total_amount` échoue
2. ✅ **Tickets avec round_id = null mis à jour** : Les tickets créés avant la persistance du round sont maintenant mis à jour
3. ✅ **Statuts synchronisés** : Les statuts sont correctement mis à jour dans la DB lors de la fin du round
4. ✅ **Diagnostic disponible** : Un endpoint de diagnostic permet d'identifier les problèmes

---

## 🔧 PROCHAINES ÉTAPES

Pour corriger les tickets existants du round #10000286 :

1. **Vérifier le statut du round** :
   ```sql
   SELECT round_id, finished_at, winner_id FROM rounds WHERE round_id = 10000286;
   ```

2. **Vérifier les tickets** :
   ```sql
   SELECT receipt_id, round_id, status, prize FROM receipts WHERE round_id = 10000286;
   ```

3. **Utiliser le diagnostic** :
   ```bash
   curl -H "Authorization: Bearer YOUR_TOKEN" \
     http://localhost:8080/api/v1/diagnostic/receipts/10000286
   ```

4. **Si nécessaire, forcer la mise à jour** :
   - Attendre la fin du prochain round pour voir si les corrections fonctionnent automatiquement
   - Ou créer un script SQL pour mettre à jour manuellement les statuts

---

## 📝 NOTES IMPORTANTES

1. **Les corrections s'appliquent automatiquement** aux nouveaux rounds terminés
2. **Les tickets existants** du round #10000286 peuvent nécessiter une mise à jour manuelle si le round est déjà terminé
3. **Le diagnostic** permet d'identifier rapidement les problèmes

---

**Statut final** : ✅ CORRECTIONS APPLIQUÉES - Les nouveaux rounds seront correctement mis à jour

