# 🔴 ANALYSE DES PROBLÈMES - Tickets et My Bets

**Date**: Analyse complète du projet  
**Sévérité**: CRITIQUE ⚠️

---

## 📋 RÉSUMÉ DES PROBLÈMES CRITIQUES

| # | Problème | Fichier | Impact | Sévérité |
|---|----------|---------|--------|----------|
| 1 | Tickets ne s'affichent pas dans "my bets" | `routes/my_bets.js` | Les utilisateurs ne voient pas leurs tickets | 🔴 CRITIQUE |
| 2 | Annulation des tickets ne met pas à jour le cache Redis | `routes/receipts.js` | Incohérences entre DB, mémoire et cache | 🔴 CRITIQUE |
| 3 | user_id non extrait automatiquement du JWT | `routes/my_bets.js` | Filtrage par utilisateur ne fonctionne pas | 🔴 CRITIQUE |
| 4 | Statut "cancelled" non géré dans formatTicket | `routes/my_bets.js` | Tickets annulés affichés avec mauvais statut | ⚠️ MOYEN |

---

## 🔍 DÉTAIL DES PROBLÈMES

### ❌ PROBLÈME #1 : Tickets ne s'affichent pas dans "my bets"

**Fichier**: `routes/my_bets.js` ligne 156-389

**Symptôme**: 
- La page "my-bets" ne montre aucun ticket même si l'utilisateur en a créé
- Le frontend envoie `user_id` dans la query string, mais seulement si `getUserId()` retourne une valeur
- `getUserId()` cherche dans `window.__USER_ID` ou `document.body.dataset.userId` qui ne sont jamais définis

**Cause racine**:
```javascript
// routes/my_bets.js ligne 156-230
router.get("/", cacheResponse(30), async (req, res) => {
  // ...
  
  // ❌ PROBLÈME: Ne filtre par user_id que si req.query.user_id est fourni
  if (req.query.user_id) {
    // Code pour récupérer les tickets de l'utilisateur
  }
  
  // ❌ Sinon, récupère TOUS les tickets de TOUS les utilisateurs
  // Ce qui ne devrait jamais arriver pour une route "my-bets"
});
```

**Le middleware `verifyToken` met déjà `req.user.userId` disponible**, mais le code ne l'utilise jamais!

**Correction nécessaire**:
```javascript
// ✅ CORRECTION: Extraire user_id depuis req.user (JWT token)
const userId = req.user?.userId || req.query.user_id;
if (userId) {
  // Filtrer par user_id
}
```

---

### ❌ PROBLÈME #2 : Annulation des tickets ne met pas à jour le cache Redis

**Fichier**: `routes/receipts.js` ligne 876-1020

**Symptôme**:
- L'annulation supprime le ticket en DB et en mémoire (`gameState`)
- Mais le cache Redis n'est pas mis à jour
- Cela cause des incohérences: le ticket peut réapparaître après un refresh

**Cause racine**:
```javascript
// routes/receipts.js ligne 991-1004
// Supprimer le ticket du round actuel en mémoire
gameState.currentRound.receipts = (gameState.currentRound.receipts || []).filter(r => r.id !== id);

// Supprimer également en base
await pool.query("DELETE FROM bets WHERE receipt_id = $1", [id]);
await pool.query("DELETE FROM receipts WHERE receipt_id = $1", [id]);

// ❌ PROBLÈME: Pas d'appel à deleteTicketFromRoundCache()
// La fonction existe dans config/db-strategy.js mais n'est jamais utilisée!
```

**Correction nécessaire**:
```javascript
// ✅ CORRECTION: Mettre à jour le cache Redis
import { deleteTicketFromRoundCache } from "../config/db-strategy.js";

// Après suppression en DB
await deleteTicketFromRoundCache(gameState.currentRound.id, id);
```

---

### ❌ PROBLÈME #3 : user_id non extrait automatiquement du JWT

**Fichier**: `routes/my_bets.js`

**Symptôme**:
- La route `/api/v1/my-bets/` est protégée par `verifyToken` qui met `req.user` avec `userId`
- Mais le code ne récupère jamais `req.user.userId`
- Il attend que `req.query.user_id` soit fourni manuellement

**Preuve**:
```javascript
// server.js ligne 271
app.use("/api/v1/my-bets/", verifyToken, createMyBetsRouter(broadcast));
// ✅ verifyToken est appliqué, donc req.user est disponible

// routes/my_bets.js ligne 171
if (req.query.user_id) {  // ❌ Ne vérifie que req.query.user_id
  const userId = parseInt(req.query.user_id, 10);
  // ...
}
// ❌ Ne vérifie jamais req.user.userId qui est pourtant disponible!
```

**Correction nécessaire**:
```javascript
// ✅ CORRECTION: Extraire user_id depuis req.user en priorité
const userId = req.user?.userId || (req.query.user_id ? parseInt(req.query.user_id, 10) : null);
```

---

### ❌ PROBLÈME #4 : Statut "cancelled" non géré dans formatTicket

**Fichier**: `routes/my_bets.js` ligne 24-85

**Symptôme**:
- La fonction `formatTicket` ne gère pas le statut "cancelled"
- Les tickets annulés peuvent être affichés avec un statut incorrect

**Code actuel**:
```javascript
// routes/my_bets.js ligne 46-64
let status = defaultStatus;

if (defaultStatus === 'pending' && isRoundFinished) {
  status = (prizePublic > 0) ? 'won' : 'lost';
} else if (defaultStatus !== 'pending') {
  status = (prizePublic > 0) ? 'won' : 'lost';
}

if (receipt.isPaid === true) {
  status = 'paid';
}

// ❌ PROBLÈME: Pas de gestion du statut "cancelled"
// Si receipt.status === 'cancelled', il sera ignoré
```

**Correction nécessaire**:
```javascript
// ✅ CORRECTION: Vérifier le statut depuis la DB en priorité
if (receipt.status === 'cancelled') {
  status = 'cancelled';
} else if (receipt.isPaid === true) {
  status = 'paid';
} else if (defaultStatus === 'pending' && isRoundFinished) {
  status = (prizePublic > 0) ? 'won' : 'lost';
}
```

---

## 🛠️ CORRECTIONS À APPLIQUER

### Correction #1 : Extraire user_id depuis JWT dans my_bets.js

**Fichier**: `routes/my_bets.js`

```javascript
// Ligne 156-170
router.get("/", cacheResponse(30), async (req, res) => {
  try {
    // ✅ CORRECTION: Extraire user_id depuis req.user (JWT) en priorité
    const userId = req.user?.userId || (req.query.user_id ? parseInt(req.query.user_id, 10) : null);
    
    const {
      page = 1,
      limit = 10,
      date,
      status,
      searchId
    } = req.query;

    const pageNum = parseInt(page, 10);
    const limitNum = parseInt(limit, 10);

    // ✅ Si user_id disponible, filtrer par utilisateur
    if (userId) {
      // ... code existant pour récupérer les tickets de l'utilisateur
    }
    
    // ❌ SUPPRIMER: Le code qui récupère TOUS les tickets sans filtre user_id
    // (lignes 232-315 environ)
  }
});
```

### Correction #2 : Mettre à jour le cache Redis lors de l'annulation

**Fichier**: `routes/receipts.js`

```javascript
// Ligne 1-16: Ajouter l'import
import { deleteTicketFromRoundCache } from "../config/db-strategy.js";

// Ligne 993-1004: Après suppression en DB
try {
  // Supprimer les bets associés au ticket (cascade)
  await pool.query("DELETE FROM bets WHERE receipt_id = $1", [id]);
  console.log(`[DB] Bets associés au ticket ${id} supprimés en base`);
  
  // Puis supprimer le ticket lui-même
  await pool.query("DELETE FROM receipts WHERE receipt_id = $1", [id]);
  console.log(`[DB] Receipt ${id} supprimé en base (memo->db) + bets associés`);
  
  // ✅ CORRECTION: Mettre à jour le cache Redis
  await deleteTicketFromRoundCache(gameState.currentRound.id, id);
} catch (e) {
  console.warn('[DB] Échec suppression receipt en base (memo->db) pour id', id, e && e.message);
}
```

### Correction #3 : Gérer le statut "cancelled" dans formatTicket

**Fichier**: `routes/my_bets.js`

```javascript
// Ligne 45-64: Modifier la logique de détermination du statut
// Détermine le statut final
let status = defaultStatus;

// ✅ CORRECTION: Vérifier le statut depuis la DB en priorité
if (receipt.status === 'cancelled') {
  status = 'cancelled';
} else if (receipt.isPaid === true) {
  status = 'paid';
} else if (defaultStatus === 'pending' && isRoundFinished) {
  // Le round est terminé, on peut déterminer le statut basé sur le prize
  const prizePublic = systemToPublic(receipt.prize || 0);
  status = (prizePublic > 0) ? 'won' : 'lost';
} else if (defaultStatus !== 'pending') {
  // Pour les tickets de l'historique, le 'prize' est déjà calculé
  const prizePublic = systemToPublic(receipt.prize || 0);
  status = (prizePublic > 0) ? 'won' : 'lost';
}
// Sinon, le statut reste 'pending' (round actuel non terminé)
```

---

## ✅ IMPACT DES CORRECTIONS

### Avant (Actuellement - CASSÉ)
```
1. Utilisateur se connecte → JWT contient userId
2. Utilisateur va sur "my-bets" → Frontend ne trouve pas userId
3. Requête API sans user_id → Backend retourne TOUS les tickets
4. Ou: Frontend trouve userId → Backend filtre correctement
5. Annulation ticket → DB + mémoire OK, mais cache Redis pas mis à jour
6. Refresh → Ticket peut réapparaître depuis le cache
```

### Après (Correction)
```
1. Utilisateur se connecte → JWT contient userId
2. Utilisateur va sur "my-bets" → Backend extrait userId depuis req.user
3. Requête API → Backend filtre automatiquement par userId
4. Annulation ticket → DB + mémoire + cache Redis tous mis à jour
5. Refresh → Ticket reste supprimé partout
```

---

## 🚨 RÉSUMÉ CRITIQUE

**Les 3 plus gros problèmes**:

1. **Tickets ne s'affichent pas dans "my bets"** 
   - `req.user.userId` disponible mais jamais utilisé
   - Filtrage par utilisateur ne fonctionne que si `user_id` fourni manuellement
   - **Impact**: Les utilisateurs ne voient pas leurs propres tickets

2. **Annulation ne met pas à jour le cache Redis**
   - Fonction `deleteTicketFromRoundCache` existe mais jamais appelée
   - Cache Redis devient obsolète après annulation
   - **Impact**: Tickets annulés peuvent réapparaître

3. **Statut "cancelled" non géré**
   - Tickets annulés affichés avec mauvais statut
   - **Impact**: Confusion pour les utilisateurs

**Verdict**: ⚠️ **Le système fonctionne partiellement, mais avec des bugs critiques qui empêchent l'utilisation normale**

---

**Prêt pour appliquer les corrections?** 🔧

