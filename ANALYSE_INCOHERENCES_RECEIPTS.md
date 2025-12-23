# 🔍 Analyse : Incohérences des Receipts dans le Dashboard

**Date**: Analyse effectuée  
**Problème identifié**: Tickets avec statut "En attente" alors qu'ils appartiennent à un round terminé

---

## 📊 PROBLÈME OBSERVÉ

D'après les données de l'interface cashier :

```
Round actif: #10000016
Tickets affichés:
- #5001358501 : Round #10000286, 350.00 HTG, x8.10, **En attente**
- #5001227029 : Round #10000286, 2500.00 HTG, x5.80, **En attente**
```

**Incohérences identifiées** :
1. ❌ **Round ID mismatch** : Le round actif est #10000016, mais les tickets appartiennent au round #10000286
2. ❌ **Statuts non mis à jour** : Les tickets sont toujours "En attente" alors que le round #10000286 devrait être terminé
3. ⚠️ **Solde à zéro** : Le solde de la caisse est à 0,00 HTG

---

## 🔍 CAUSES POSSIBLES

### 1. **Matching échoué entre gameState et DB**

Le code dans `routes/rounds.js` fait le matching entre les tickets de `gameState` et ceux de la DB par :
- `user_id` (doit correspondre)
- `total_amount` (doit correspondre avec tolérance 0.01)

**Problème potentiel** :
- Si le `user_id` est `null` dans gameState mais pas en DB (ou vice versa), le matching échoue
- Si le `total_amount` diffère légèrement (arrondis), le matching échoue
- Si le ticket n'existe pas en DB avec le bon `round_id`, il n'est pas mis à jour

### 2. **Tickets non sauvegardés avec le bon round_id**

Les tickets peuvent être créés avec `round_id = null` si le round n'existe pas encore en DB au moment de la création.

**Code problématique** (`routes/receipts.js` ligne 1125) :
```javascript
const dbRoundId = roundExists ? gameState.currentRound.id : null;
```

Si `roundExists` est `false`, le ticket est créé avec `round_id = null`, et il ne sera jamais mis à jour lors de `calculateRaceResults()` car la requête filtre par `round_id`.

### 3. **Round terminé mais statuts non mis à jour**

Si `calculateRaceResults()` n'a pas été appelé ou a échoué pour le round #10000286, les statuts restent en "pending".

---

## ✅ SOLUTIONS PROPOSÉES

### Solution 1 : Améliorer le matching dans `calculateRaceResults()`

**Fichier**: `routes/rounds.js` lignes 300-319

**Problème actuel** : Le matching échoue si `user_id` ou `total_amount` ne correspondent pas exactement.

**Solution** : Ajouter un fallback pour chercher par `receipt_id` si le matching par `user_id + total_amount` échoue.

```javascript
// ✅ AMÉLIORATION: Ajouter un fallback pour matching par receipt_id
const receiptsToUpdate = receipts.map(receipt => {
    const receiptTotalAmount = (receipt.bets || []).reduce((sum, b) => sum + (Number(b.value) || 0), 0);
    
    // Tentative 1: Match par user_id + total_amount
    let dbReceipt = receiptsFromDb.find(db => {
        const userMatch = (db.user_id === receipt.user_id) || (!db.user_id && !receipt.user_id);
        const amountMatch = Math.abs(Number(db.total_amount) - receiptTotalAmount) < 0.01;
        return userMatch && amountMatch;
    });
    
    // Tentative 2: Fallback par receipt_id si disponible
    if (!dbReceipt && receipt.id) {
        dbReceipt = receiptsFromDb.find(db => Number(db.receipt_id) === Number(receipt.id));
    }
    
    return {
        receipt: receipt,
        dbReceipt: dbReceipt,
        dbId: dbReceipt ? dbReceipt.receipt_id : receipt.id
    };
});
```

### Solution 2 : Mettre à jour les tickets avec `round_id = null`

**Fichier**: `routes/rounds.js` lignes 285-298

**Problème actuel** : La requête ne récupère que les tickets avec `round_id = finishedRoundId`, donc les tickets avec `round_id = null` ne sont pas mis à jour.

**Solution** : Ajouter une requête pour mettre à jour les tickets avec `round_id = null` qui correspondent au round terminé.

```javascript
// ✅ NOUVEAU: Mettre à jour les tickets avec round_id = null qui appartiennent à ce round
// Ces tickets ont été créés avant que le round soit persisté en DB
try {
    const nullRoundReceipts = await pool.query(
        `SELECT receipt_id, user_id, total_amount, status, prize, created_at
         FROM receipts 
         WHERE round_id IS NULL
         AND created_at >= (
             SELECT started_at FROM rounds WHERE round_id = $1
         )
         AND created_at <= (
             SELECT finished_at FROM rounds WHERE round_id = $1
         )`,
        [finishedRoundId]
    );
    
    if (nullRoundReceipts.rows.length > 0) {
        console.log(`[RACE-RESULTS] 📊 ${nullRoundReceipts.rows.length} ticket(s) avec round_id=NULL trouvé(s), mise à jour...`);
        
        // Mettre à jour le round_id et les statuts pour ces tickets
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
} catch (nullRoundErr) {
    console.error(`[RACE-RESULTS] ❌ Erreur mise à jour tickets round_id=NULL:`, nullRoundErr.message);
}
```

### Solution 3 : Script de diagnostic et correction manuelle

**Fichier**: `routes/diagnostic.js` (créé)

Un endpoint de diagnostic a été créé pour identifier les incohérences :

```
GET /api/v1/diagnostic/receipts/:roundId
```

Cet endpoint retourne :
- Les tickets en DB pour le round
- Les tickets dans gameState pour le round
- Les incohérences identifiées
- Le statut du round (terminé ou non)

**Utilisation** :
```bash
# Vérifier les tickets du round #10000286
curl http://localhost:8080/api/v1/diagnostic/receipts/10000286
```

### Solution 4 : Forcer la mise à jour des statuts pour les rounds terminés

**Fichier**: `routes/rounds.js` (nouvelle route)

Ajouter une route pour forcer la mise à jour des statuts d'un round terminé :

```javascript
// POST /api/v1/rounds/:roundId/update-receipts-status
router.post("/:roundId/update-receipts-status", async (req, res) => {
    const roundId = parseInt(req.params.roundId, 10);
    
    // Vérifier que le round est terminé
    const roundResult = await pool.query(
        `SELECT round_id, finished_at, winner_id FROM rounds WHERE round_id = $1`,
        [roundId]
    );
    
    if (!roundResult.rows[0] || !roundResult.rows[0].finished_at) {
        return res.status(400).json({ error: "Round non terminé ou introuvable" });
    }
    
    // Récupérer le gagnant
    const winnerId = roundResult.rows[0].winner_id;
    // ... (logique de mise à jour des statuts)
});
```

---

## 🎯 PLAN D'ACTION IMMÉDIAT

1. ✅ **Créer le script de diagnostic** (`routes/diagnostic.js`) - FAIT
2. ⏳ **Ajouter la route de diagnostic dans server.js** - À FAIRE
3. ⏳ **Améliorer le matching dans calculateRaceResults()** - À FAIRE
4. ⏳ **Ajouter la mise à jour des tickets avec round_id = null** - À FAIRE
5. ⏳ **Tester avec le round #10000286** - À FAIRE

---

## 📝 NOTES IMPORTANTES

1. **Les tickets avec `round_id = null`** ne seront jamais mis à jour par le code actuel
2. **Le matching par `user_id + total_amount`** peut échouer si les valeurs diffèrent légèrement
3. **Les tickets doivent être sauvegardés avec le bon `round_id`** dès la création pour éviter les problèmes

---

## 🔧 COMMANDES DE TEST

```bash
# 1. Vérifier les tickets du round #10000286
curl -H "Authorization: Bearer YOUR_TOKEN" \
  http://localhost:8080/api/v1/diagnostic/receipts/10000286

# 2. Vérifier les tickets en DB directement
psql -d your_database -c "SELECT receipt_id, round_id, status, prize FROM receipts WHERE round_id = 10000286;"

# 3. Vérifier si le round est terminé
psql -d your_database -c "SELECT round_id, finished_at, winner_id FROM rounds WHERE round_id = 10000286;"
```

---

**Statut**: 🔍 ANALYSE EN COURS - Solutions proposées, en attente d'implémentation

