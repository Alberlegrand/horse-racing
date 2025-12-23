# 🔍 Analyse du Problème : Statuts des Receipts Restent "pending"

**Date**: 2025-01-XX  
**Problème**: Après une course, les statuts des tickets restent "pending" au lieu de passer à "won" ou "lost"

---

## 🚨 PROBLÈME IDENTIFIÉ

### Cause Racine

Le problème vient de **3 incohérences** dans le flux de mise à jour des statuts :

1. **Persistance asynchrone non attendue** : Les tickets sont créés en DB de manière asynchrone dans `routes/receipts.js` (ligne 1082-1161) dans une fonction `(async () => { ... })()` qui n'est **pas attendue**. Si la course se termine avant que les tickets soient persistés, `updateReceiptStatus()` ne trouve pas les tickets en DB.

2. **Pas de vérification de succès** : `updateReceiptStatus()` ne retourne pas le nombre de lignes affectées. Si le ticket n'existe pas en DB, l'UPDATE ne fait rien (pas d'erreur, mais aucune ligne mise à jour).

3. **ID potentiellement désynchronisé** : Si un ticket a eu son ID régénéré lors de la création en DB (collision de clé primaire, ligne 1143-1144), alors `receipt.id` dans `gameState.currentRound.receipts` pourrait ne pas correspondre à l'ID réel en DB.

---

## 📊 FLUX ACTUEL (CASSÉ)

```
1. Client crée un ticket
   ↓
2. routes/receipts.js: POST /api/v1/receipts/?action=add
   - Ajoute ticket à gameState.currentRound.receipts (en mémoire)
   - Lance persistance DB en async (NON ATTENDU) ← ❌ PROBLÈME #1
   ↓
3. Course se termine (T=35s)
   ↓
4. routes/rounds.js: calculateRaceResults()
   - Calcule les gains pour chaque ticket
   - Appelle updateReceiptStatus(receipt.id, 'won'/'lost')
   - MAIS: Le ticket n'existe peut-être pas encore en DB ! ← ❌ PROBLÈME #2
   ↓
5. UPDATE ne trouve aucune ligne → Aucune mise à jour
   ↓
6. my-bets.html lit depuis DB → status = 'pending' ← ❌ RÉSULTAT
```

---

## ✅ SOLUTION

### Correction #1 : Vérifier l'existence du ticket avant UPDATE

**Fichier**: `models/receiptModel.js`

```javascript
// Mettre à jour le statut et le gain d'un ticket
export async function updateReceiptStatus(receipt_id, status, prize = null) {
  // ✅ NOUVEAU: Vérifier que le ticket existe d'abord
  const checkRes = await pool.query(
    `SELECT receipt_id FROM receipts WHERE receipt_id = $1`,
    [receipt_id]
  );
  
  if (!checkRes.rows || checkRes.rows.length === 0) {
    console.warn(`[UPDATE-RECEIPT] ⚠️ Ticket #${receipt_id} non trouvé en DB, skip update`);
    return { success: false, rowsAffected: 0, reason: 'not_found' };
  }
  
  const query = prize !== null
    ? `UPDATE receipts SET status = $1, prize = $2, updated_at = CURRENT_TIMESTAMP WHERE receipt_id = $3`
    : `UPDATE receipts SET status = $1, updated_at = CURRENT_TIMESTAMP WHERE receipt_id = $2`;
  const params = prize !== null ? [status, prize, receipt_id] : [status, receipt_id];
  
  const res = await pool.query(query, params);
  
  // ✅ NOUVEAU: Retourner le nombre de lignes affectées
  return { 
    success: true, 
    rowsAffected: res.rowCount || 0,
    receipt_id 
  };
}
```

### Correction #2 : Attendre la persistance avant de mettre à jour les statuts

**Fichier**: `routes/rounds.js` - Fonction `calculateRaceResults()`

```javascript
// ✅ Mettre à jour les statuts des tickets en DB
for (const receipt of receipts) {
    try {
        const newStatus = receipt.prize > 0 ? 'won' : 'lost';
        receipt.status = newStatus;
        
        // ✅ NOUVEAU: Vérifier que le ticket existe en DB avant de mettre à jour
        // Si le ticket n'existe pas encore, attendre un peu et réessayer
        let updateResult = null;
        let retries = 0;
        const MAX_RETRIES = 5;
        const RETRY_DELAY_MS = 200;
        
        while (retries < MAX_RETRIES && !updateResult?.success) {
            updateResult = await updateReceiptStatus(receipt.id, newStatus, receipt.prize || 0);
            
            if (!updateResult.success && updateResult.reason === 'not_found') {
                // Ticket pas encore en DB, attendre un peu
                retries++;
                if (retries < MAX_RETRIES) {
                    console.log(`[RACE-RESULTS] ⏳ Ticket #${receipt.id} pas encore en DB, attente ${RETRY_DELAY_MS}ms (tentative ${retries}/${MAX_RETRIES})`);
                    await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS));
                }
            } else {
                break; // Succès ou autre erreur
            }
        }
        
        if (updateResult?.success && updateResult.rowsAffected > 0) {
            console.log(`[DB] ✓ Ticket #${receipt.id}: status=${newStatus}, prize=${receipt.prize} (${updateResult.rowsAffected} ligne(s) affectée(s))`);
        } else {
            console.error(`[DB] ✗ Ticket #${receipt.id}: Échec mise à jour après ${retries} tentatives`);
        }
        
        // Mettre à jour le cache Redis (même si DB a échoué)
        if (finishedRoundId) {
            await updateTicketInRoundCache(finishedRoundId, receipt.id, newStatus, receipt.prize || 0);
        }
    } catch (err) {
        console.error(`[DB] ✗ Erreur ticket #${receipt.id}:`, err.message);
    }
}
```

### Correction #3 : S'assurer que les tickets sont persistés AVANT la fin de la course

**Fichier**: `routes/receipts.js` - Fonction POST /api/v1/receipts/?action=add

**Option A** : Attendre la persistance (plus sûr mais plus lent)

```javascript
// ❌ AVANT: Persistance async non attendue
(async () => {
  // ... code de persistance ...
})();

// ✅ APRÈS: Attendre la persistance
try {
  const dbReceipt = await persistReceiptToDB(receipt);
  if (dbReceipt) {
    console.log(`[DB] ✓ Receipt ${receipt.id} créé en DB`);
  }
} catch (err) {
  console.error('[DB] Erreur persistance receipt:', err.message);
}
```

**Option B** : Utiliser un système de queue avec retry (recommandé pour performance)

```javascript
// ✅ NOUVEAU: Queue de persistance avec retry automatique
const persistenceQueue = [];
let isProcessingQueue = false;

async function processPersistenceQueue() {
  if (isProcessingQueue || persistenceQueue.length === 0) return;
  
  isProcessingQueue = true;
  while (persistenceQueue.length > 0) {
    const receipt = persistenceQueue.shift();
    try {
      await persistReceiptToDB(receipt);
    } catch (err) {
      // Réinsérer en queue si échec
      persistenceQueue.push(receipt);
      console.error('[QUEUE] Erreur persistance, réinséré en queue:', err.message);
    }
  }
  isProcessingQueue = false;
}

// Ajouter à la queue au lieu de persister immédiatement
persistenceQueue.push(receipt);
processPersistenceQueue(); // Traiter en arrière-plan
```

---

## 🎯 CORRECTION RECOMMANDÉE (PRIORITÉ HAUTE)

**Implémenter la Correction #2** (retry avec vérification) car :
- ✅ Ne nécessite pas de changer la logique de création des tickets
- ✅ Gère les cas où les tickets ne sont pas encore en DB
- ✅ Compatible avec le système actuel
- ✅ Ajoute de la robustesse sans casser l'existant

---

## 📝 FICHIERS À MODIFIER

1. ✅ `models/receiptModel.js` - Modifier `updateReceiptStatus()` pour retourner le résultat
2. ✅ `routes/rounds.js` - Modifier `calculateRaceResults()` pour retry avec vérification

---

## ✅ RÉSULTAT ATTENDU

Après ces corrections :

1. ✅ Les tickets sont vérifiés avant mise à jour
2. ✅ Si un ticket n'existe pas encore en DB, on attend et réessaie
3. ✅ Les statuts sont correctement mis à jour en DB
4. ✅ `my-bets.html` et `dashboard.html` affichent les bons statuts ("won" ou "lost")

---

## 🧪 TESTS À EFFECTUER

1. Créer un ticket pendant un round actif
2. Lancer une course immédiatement (sans attendre la persistance DB)
3. Vérifier que le statut passe bien à "won" ou "lost" après la course
4. Vérifier dans `my-bets.html` que le statut est correct
5. Vérifier dans la DB que le statut est bien mis à jour

