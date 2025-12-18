# Corrections : Mise à jour des statuts des tickets après la fin de la course

## Problème identifié

Les statuts des tickets ne changeaient pas après la fin de la course pour les raisons suivantes :

1. **Mise à jour asynchrone non attendue** : La mise à jour des statuts était faite dans une fonction asynchrone non attendue (`(async () => { ... })()`), ce qui signifiait que la fonction `executeRaceFinish` ne garantissait pas que les statuts soient mis à jour avant de continuer.

2. **Statut non mis à jour dans gameState** : Le statut n'était pas mis à jour dans `gameState.receipts[].status`, seulement en DB. Donc si on lisait depuis `gameState`, le statut ne serait pas à jour.

3. **Cache Redis non mis à jour** : Le cache Redis n'était pas mis à jour avec les nouveaux statuts après la fin de la course, ce qui pouvait causer des incohérences.

## Corrections appliquées

### ✅ CORRECTION #1 : Fonction pour mettre à jour un ticket dans le cache Redis

**Fichier**: `config/db-strategy.js` ligne 421-461

**Ajout** : Nouvelle fonction `updateTicketInRoundCache` pour mettre à jour le statut et le prize d'un ticket dans le cache Redis.

```javascript
export async function updateTicketInRoundCache(roundId, ticketId, status, prize = null) {
  try {
    const roundKey = `round:${roundId}:data`;
    const roundCache = await cacheGet(roundKey);
    
    if (!roundCache) {
      console.warn(`[CACHE] Round ${roundId} pas en cache pour mise à jour ticket ${ticketId}`);
      return false;
    }

    // Trouver le ticket
    const ticketIndex = roundCache.receipts.findIndex(r => r.id === ticketId);
    if (ticketIndex === -1) {
      console.warn(`[CACHE] Ticket ${ticketId} non trouvé dans le cache`);
      return false;
    }

    // Mettre à jour le ticket
    roundCache.receipts[ticketIndex].status = status;
    if (prize !== null) {
      roundCache.receipts[ticketIndex].prize = prize;
    }

    await cacheSet(roundKey, roundCache, 3600);
    console.log(`✅ [CACHE] Ticket ${ticketId} mis à jour: status=${status}, prize=${prize || 'N/A'}`);
    return true;
  } catch (err) {
    console.error('[CACHE] Erreur updateTicketInRoundCache:', err.message);
    return false;
  }
}
```

**Impact** : Permet de mettre à jour le cache Redis avec les nouveaux statuts après la fin de la course.

---

### ✅ CORRECTION #2 : Import de la fonction de mise à jour du cache

**Fichier**: `routes/rounds.js` ligne 19-20

**Ajout** : Import de `updateTicketInRoundCache` depuis `db-strategy.js`.

```javascript
// Import pour mettre à jour le cache Redis
import { updateTicketInRoundCache } from "../config/db-strategy.js";
```

---

### ✅ CORRECTION #3 : Mise à jour synchrone des statuts dans executeRaceFinish

**Fichier**: `routes/rounds.js` ligne 256-304

**Avant** :
```javascript
// Mettre à jour les statuts des tickets en DB
(async () => {
    for (const receipt of receipts) {
        try {
            const newStatus = receipt.prize > 0 ? 'won' : 'lost';
            await updateReceiptStatus(receipt.id, newStatus, receipt.prize || 0);
            console.log(`[DB] ✓ Ticket #${receipt.id} mis à jour: status=${newStatus}, prize=${receipt.prize}`);
        } catch (err) {
            console.error(`[DB] ✗ Erreur mise à jour ticket #${receipt.id}:`, err.message);
        }
    }
})();
```

**Après** :
```javascript
// Récupérer l'ID du round avant de mettre à jour les statuts
const finishedRoundId = finishedRoundData.id;

// ... calcul des gains ...

// ✅ CORRECTION: Mettre à jour les statuts des tickets en DB, gameState et cache Redis
// ATTENDRE la mise à jour pour garantir la cohérence
for (const receipt of receipts) {
    try {
        const newStatus = receipt.prize > 0 ? 'won' : 'lost';
        
        // 1. Mettre à jour le statut dans gameState
        receipt.status = newStatus;
        
        // 2. Mettre à jour en DB
        await updateReceiptStatus(receipt.id, newStatus, receipt.prize || 0);
        console.log(`[DB] ✓ Ticket #${receipt.id} mis à jour: status=${newStatus}, prize=${receipt.prize}`);
        
        // 3. Mettre à jour le cache Redis
        if (finishedRoundId) {
            await updateTicketInRoundCache(finishedRoundId, receipt.id, newStatus, receipt.prize || 0);
        }
    } catch (err) {
        console.error(`[DB] ✗ Erreur mise à jour ticket #${receipt.id}:`, err.message);
    }
}
```

**Changements clés** :
1. ✅ La boucle est maintenant **awaitée** (pas de fonction async non attendue)
2. ✅ Le statut est mis à jour dans **gameState** (`receipt.status = newStatus`)
3. ✅ Le statut est mis à jour en **DB** (`updateReceiptStatus`)
4. ✅ Le statut est mis à jour dans le **cache Redis** (`updateTicketInRoundCache`)
5. ✅ `finishedRoundId` est récupéré avant la boucle pour être disponible

**Impact** : 
- Les statuts sont maintenant garantis d'être mis à jour dans les trois sources (gameState, DB, Redis) avant que la fonction ne continue
- La cohérence des données est assurée entre les différentes sources
- Les tickets affichés dans `my-bets.html`, `dashboard.html` et `account.html` montreront le bon statut après la fin de la course

---

## Résultat attendu

Après ces corrections, lorsque la course se termine :

1. ✅ Les statuts des tickets sont mis à jour en **DB** (`won` ou `lost`)
2. ✅ Les statuts des tickets sont mis à jour dans **gameState** (pour les lectures en mémoire)
3. ✅ Les statuts des tickets sont mis à jour dans le **cache Redis** (pour les lectures depuis le cache)
4. ✅ Les tickets affichés dans l'interface utilisateur montrent le bon statut (`won` ou `lost`) au lieu de rester en `pending`

---

## Tests recommandés

1. Créer plusieurs tickets avec différents participants
2. Attendre la fin de la course
3. Vérifier dans la DB que les statuts sont `won` ou `lost` selon les gains
4. Vérifier dans `my-bets.html` que les tickets affichent le bon statut
5. Vérifier dans `dashboard.html` que les tickets affichent le bon statut
6. Vérifier dans `account.html` que les tickets affichent le bon statut

---

## Fichiers modifiés

- `config/db-strategy.js` : Ajout de la fonction `updateTicketInRoundCache`
- `routes/rounds.js` : Modification de `executeRaceFinish` pour mettre à jour les statuts de manière synchrone dans gameState, DB et Redis













