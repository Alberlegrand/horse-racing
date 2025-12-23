# 🔍 ANALYSE COMPLÈTE DES INCOHÉRENCES - ROUNDS & IDs

## 📋 Résumé Exécutif

Cette analyse identifie les problèmes critiques liés à la génération et à la persistance des IDs de rounds, ainsi que les incohérences dans le système de gestion des rounds.

---

## 🚨 PROBLÈMES IDENTIFIÉS

### **PROBLÈME #1 : ON CONFLICT DO UPDATE au lieu de DO NOTHING**

**Localisation :** `game.js` ligne 158

**Code problématique :**
```javascript
const insertRes = await pool.query(
    `INSERT INTO rounds (round_id, round_number, status, created_at) 
     VALUES ($1, $2, 'waiting', CURRENT_TIMESTAMP) 
     ON CONFLICT (round_id) DO UPDATE SET updated_at = CURRENT_TIMESTAMP
     RETURNING round_id`,
    [newRoundId, roundNum]
);
```

**Problème :**
- Si un round avec le même `round_id` existe déjà, il sera **mis à jour** au lieu d'être ignoré
- Cela peut écraser des données existantes ou créer des incohérences
- Un round existant pourrait avoir un statut différent (`running`, `finished`) qui serait ignoré

**Impact :** 🔴 **CRITIQUE** - Peut causer des pertes de données et des incohérences

---

### **PROBLÈME #2 : Fallback mémoire non synchronisé**

**Localisation :** `utils/roundNumberManager.js` lignes 75-89

**Code problématique :**
```javascript
export async function getNextRoundId() {
    try {
        const result = await pool.query(
            `SELECT nextval('rounds_round_id_seq'::regclass) as next_id`
        );
        return result.rows[0].next_id;
    } catch (err) {
        // Fallback à la version mémoire en cas d'erreur
        currentRoundId++;
        return currentRoundId;  // ❌ PROBLÈME: Non synchronisé avec la DB
    }
}
```

**Problème :**
- Si la séquence PostgreSQL échoue, le système utilise un compteur mémoire
- Après redémarrage, `currentRoundId` est réinitialisé à `10000000` ou au MAX de la DB
- Mais si la séquence PostgreSQL a continué à s'incrémenter, il y aura un décalage
- Risque de **doublons** si la séquence reprend après le fallback

**Impact :** 🟠 **ÉLEVÉ** - Risque de doublons d'IDs après redémarrage

---

### **PROBLÈME #3 : initRoundIdManager() ne synchronise pas la séquence**

**Localisation :** `utils/roundNumberManager.js` lignes 96-108

**Code problématique :**
```javascript
export async function initRoundIdManager() {
    try {
        const result = await pool.query(
            `SELECT MAX(round_id) as max_id FROM rounds`
        );
        const maxId = result.rows[0].max_id || 10000000;
        currentRoundId = maxId;
        // ❌ PROBLÈME: Ne synchronise PAS la séquence PostgreSQL
    } catch (err) {
        currentRoundId = 10000000;
    }
}
```

**Problème :**
- La fonction récupère le MAX(round_id) mais ne synchronise pas la séquence PostgreSQL
- Si la séquence est en avance (ex: 10000010) mais le MAX en DB est 10000005, il y aura un décalage
- Les prochains IDs générés pourraient être inférieurs au MAX existant → **violation de contrainte**

**Impact :** 🔴 **CRITIQUE** - Risque de violation de contrainte UNIQUE

---

### **PROBLÈME #4 : Race condition entre création de round et tickets**

**Localisation :** `game.js` ligne 149 et `routes/receipts.js` ligne 1084

**Problème :**
1. `createNewRound()` crée le round en mémoire avec un ID (ligne 149)
2. Le round est persisté en DB de manière asynchrone (ligne 155)
3. Un ticket peut être créé **avant** que le round soit persisté (ligne 1084 dans receipts.js)
4. Le ticket essaie de référencer un round qui n'existe pas encore en DB → **FK violation**

**Code problématique dans receipts.js :**
```javascript
const waitForRound = async (roundId, maxRetries = 50, delayMs = 100) => {
    // Attente avec retry - mais pas garanti
};
```

**Impact :** 🟠 **ÉLEVÉ** - Risque d'échec de création de tickets

---

### **PROBLÈME #5 : Deux systèmes d'ID non synchronisés**

**Localisation :** `game.js` lignes 128 et 154

**Problème :**
- `round_id` : Séquence PostgreSQL `rounds_round_id_seq` (8 chiffres, commence à 10000000)
- `round_number` : Séquence PostgreSQL `rounds_round_number_seq` (commence à 1)
- Ces deux systèmes sont **indépendants** et peuvent se désynchroniser
- Si un round est créé mais échoue partiellement, `round_id` et `round_number` peuvent être incohérents

**Impact :** 🟡 **MOYEN** - Confusion et incohérences dans les logs

---

### **PROBLÈME #6 : Pas de transaction atomique pour création de round**

**Localisation :** `game.js` lignes 152-167

**Problème :**
- La création du round en DB n'est pas dans une transaction
- Si l'insertion échoue partiellement, le round peut être en mémoire mais pas en DB
- Le cache Redis peut être initialisé même si la DB échoue

**Impact :** 🟠 **ÉLEVÉ** - État incohérent entre mémoire, DB et Redis

---

## ✅ SOLUTIONS PROPOSÉES

### **SOLUTION #1 : Corriger ON CONFLICT**

**Fichier :** `game.js`

**Changement :**
```javascript
// ❌ AVANT
ON CONFLICT (round_id) DO UPDATE SET updated_at = CURRENT_TIMESTAMP

// ✅ APRÈS
ON CONFLICT (round_id) DO NOTHING
```

**Raison :** Si un round existe déjà, ne pas le modifier. Lever une erreur si nécessaire.

---

### **SOLUTION #2 : Synchroniser la séquence PostgreSQL au démarrage**

**Fichier :** `utils/roundNumberManager.js`

**Changement :**
```javascript
export async function initRoundIdManager() {
    try {
        // 1. Récupérer le MAX(round_id) de la DB
        const result = await pool.query(
            `SELECT MAX(round_id) as max_id FROM rounds`
        );
        const maxId = result.rows[0].max_id || 10000000;
        
        // 2. ✅ NOUVEAU: Synchroniser la séquence PostgreSQL
        // Si maxId = 10000005, la séquence doit être à 10000006
        const nextId = maxId + 1;
        await pool.query(
            `SELECT setval('rounds_round_id_seq', $1, false)`,
            [nextId]
        );
        
        currentRoundId = maxId;
        console.log(`[ROUND-ID] Initialized from DB: ${currentRoundId}, sequence synced to ${nextId}`);
    } catch (err) {
        console.error('[ROUND-ID] Error initializing from DB:', err.message);
        currentRoundId = 10000000;
    }
}
```

**Raison :** Garantit que la séquence PostgreSQL est toujours synchronisée avec le MAX de la DB.

---

### **SOLUTION #3 : Améliorer le fallback mémoire**

**Fichier :** `utils/roundNumberManager.js`

**Changement :**
```javascript
export async function getNextRoundId() {
    try {
        const result = await pool.query(
            `SELECT nextval('rounds_round_id_seq'::regclass) as next_id`
        );
        const nextId = result.rows[0].next_id;
        currentRoundId = nextId; // ✅ Synchroniser le compteur mémoire
        console.log(`[ROUND-ID] Next round ID from DB: ${nextId}`);
        return nextId;
    } catch (err) {
        console.error('[ROUND-ID] Error fetching from DB sequence:', err.message);
        // ✅ AMÉLIORATION: Essayer de récupérer le MAX depuis la DB avant fallback
        try {
            const maxResult = await pool.query(
                `SELECT MAX(round_id) as max_id FROM rounds`
            );
            const maxId = maxResult.rows[0].max_id || 10000000;
            currentRoundId = maxId + 1;
            console.warn(`[ROUND-ID] Fallback avec MAX de DB: ${currentRoundId}`);
            return currentRoundId;
        } catch (fallbackErr) {
            // Dernier recours: incrémenter depuis mémoire
            currentRoundId++;
            console.warn(`[ROUND-ID] Fallback à mémoire: ${currentRoundId}`);
            return currentRoundId;
        }
    }
}
```

**Raison :** Le fallback utilise d'abord le MAX de la DB avant d'utiliser la mémoire.

---

### **SOLUTION #4 : Transaction atomique pour création de round**

**Fichier :** `game.js`

**Changement :**
```javascript
// 4️⃣ PERSISTER EN BASE DE DONNÉES (TRANSACTION ATOMIQUE)
try {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        
        const roundNum = await getNextRoundNumber();
        const insertRes = await client.query(
            `INSERT INTO rounds (round_id, round_number, status, created_at) 
             VALUES ($1, $2, 'waiting', CURRENT_TIMESTAMP) 
             ON CONFLICT (round_id) DO NOTHING
             RETURNING round_id`,
            [newRoundId, roundNum]
        );
        
        if (!insertRes.rows || !insertRes.rows[0]) {
            throw new Error(`Round ${newRoundId} already exists or insertion failed`);
        }
        
        // ✅ Initialiser le cache Redis dans la transaction (si possible)
        // Note: Redis n'est pas transactionnel, donc on le fait après
        
        await client.query('COMMIT');
        gameState.currentRound.persisted = true;
        console.log(`[ROUND-CREATE] ✅ Round #${roundNum} (ID: ${newRoundId}) persisté en DB`);
    } catch (err) {
        await client.query('ROLLBACK');
        throw err;
    } finally {
        client.release();
    }
} catch (err) {
    console.error('[ROUND-CREATE] ❌ Erreur persistence DB:', err.message);
    gameState.currentRound.persisted = false;
    // ✅ CRITIQUE: Ne pas initialiser Redis si la DB échoue
    throw err; // Propager l'erreur pour éviter l'incohérence
}
```

**Raison :** Garantit que le round est créé atomiquement en DB avant d'être utilisé.

---

### **SOLUTION #5 : Vérification de persistance avant création de tickets**

**Fichier :** `routes/receipts.js`

**Changement :**
```javascript
// ✅ AMÉLIORATION: Vérifier que le round est persisté AVANT de créer le ticket
const ensureRoundPersisted = async (roundId, maxRetries = 10, delayMs = 100) => {
    for (let i = 0; i < maxRetries; i++) {
        try {
            const res = await pool.query(
                "SELECT round_id, persisted FROM rounds WHERE round_id = $1 LIMIT 1",
                [roundId]
            );
            if (res.rows && res.rows[0]) {
                console.log(`[DB] ✓ Round ${roundId} trouvé en DB`);
                return true;
            }
        } catch (err) {
            console.error('[DB] Erreur lookup round:', err.message);
        }
        if (i < maxRetries - 1) {
            await new Promise(resolve => setTimeout(resolve, delayMs));
        }
    }
    throw new Error(`Round ${roundId} not found in DB after ${maxRetries * delayMs}ms`);
};

// Utiliser avant de créer le ticket
await ensureRoundPersisted(gameState.currentRound.id);
```

**Raison :** Garantit que le round existe en DB avant de créer un ticket.

---

### **SOLUTION #6 : Logging amélioré pour debugging**

**Fichier :** `game.js` et `utils/roundNumberManager.js`

**Ajout de logs détaillés :**
```javascript
console.log(`[ROUND-CREATE] 📊 État de synchronisation:`);
console.log(`   - Round ID généré: ${newRoundId}`);
console.log(`   - Round Number: ${roundNum}`);
console.log(`   - Séquence round_id_seq: ${await getCurrentSequenceValue('rounds_round_id_seq')}`);
console.log(`   - MAX(round_id) en DB: ${await getMaxRoundId()}`);
console.log(`   - Persisté: ${gameState.currentRound.persisted}`);
```

**Raison :** Facilite le debugging des incohérences.

---

## 📊 CHECKLIST DE VÉRIFICATION

- [ ] ✅ Corriger `ON CONFLICT DO UPDATE` → `DO NOTHING`
- [ ] ✅ Synchroniser la séquence PostgreSQL au démarrage
- [ ] ✅ Améliorer le fallback mémoire avec MAX de DB
- [ ] ✅ Utiliser une transaction atomique pour création de round
- [ ] ✅ Vérifier la persistance avant création de tickets
- [ ] ✅ Ajouter des logs détaillés pour debugging
- [ ] ✅ Tester après redémarrage du serveur
- [ ] ✅ Tester avec création simultanée de rounds
- [ ] ✅ Vérifier l'intégrité des foreign keys

---

## 🎯 PRIORITÉS

1. **🔴 CRITIQUE** : Solution #1 (ON CONFLICT) et #3 (Synchronisation séquence)
2. **🟠 ÉLEVÉ** : Solution #4 (Transaction atomique) et #5 (Vérification persistance)
3. **🟡 MOYEN** : Solution #2 (Fallback amélioré) et #6 (Logging)

---

## 📝 NOTES ADDITIONNELLES

- La séquence PostgreSQL `rounds_round_id_seq` doit être **toujours** synchronisée avec le MAX(round_id)
- En cas d'erreur de persistance, ne pas initialiser Redis pour éviter l'incohérence
- Considérer l'ajout d'un mécanisme de récupération automatique au démarrage pour corriger les incohérences existantes

