# 📋 CHECKLIST - Prochaines Étapes

## ✅ Fixes Appliqués (Complétés)

### Phase 1: Architecture
- [x] Exporter BASE_PARTICIPANTS depuis game.js
- [x] Importer BASE_PARTICIPANTS dans routes/rounds.js
- [x] Supprimer duplications dans routes/rounds.js
- [x] Centraliser configuration timer
- [x] Importer timer config dans routes/rounds.js
- [x] Corriger keepalive.js (imports + PORT)

### Phase 2: Validation
- [x] Ajouter MIN_BET_AMOUNT dans config
- [x] Ajouter MAX_BET_AMOUNT dans config
- [x] Importer limites dans routes/receipts.js
- [x] Implémenter validation montants

### Phase 3: Documentation
- [x] Créer PERSISTENCE_STRATEGY.md
- [x] Créer TIMER_ARCHITECTURE.md
- [x] Créer FIXES_APPLIED.md
- [x] Créer REPORT.md

### Phase 4: Tests
- [x] Tester serveur démarre sans erreurs
- [x] Vérifier configuration affichée
- [x] Vérifier participants chargés
- [x] Vérifier imports résolus

---

## ⏳ TODO - Prochaines Phases

### Phase 5: Batch Persist (CRITIQUE) 🔴

**Fichier**: `routes/rounds.js`  
**Fonction**: Ajouter après `finishRound()`

```javascript
// TODO: Implémenter après finish
const batchPersistResults = async (roundId, receipts, winner) => {
  try {
    // 1. Calculer les prizes pour TOUS les tickets
    receipts.forEach(receipt => {
      receipt.bets.forEach(bet => {
        if (bet.participant.number === winner.number) {
          receipt.prize = calculatePrize(bet, winner.coeff);
        }
      });
    });

    // 2. Batch update en DB
    await dbStrategy.batchUpdateReceiptPrizes(roundId, receipts);

    // 3. Broadcast résultats
    broadcast({ event: 'results_persisted', roundId, receiptsCount: receipts.length });

    console.log(`✅ [BATCH-PERSIST] ${receipts.length} tickets sauvegardés pour round ${roundId}`);
  } catch (err) {
    console.error(`❌ [BATCH-PERSIST] Erreur:`, err);
    // Fallback: persister individuellement
  }
};
```

**Tests**:
- [ ] Créer 5 tickets
- [ ] Finir race
- [ ] Vérifier receipts.prize en DB
- [ ] Vérifier pas de tickets perdus

---

### Phase 6: Status Tickets Logic (HAUTE) 🟠

**Fichier**: `routes/my_bets.js`  
**Fonction**: Centraliser `formatTicket()`

```javascript
// TODO: Unifier la logique de statut
const determineTicketStatus = (receipt, roundId, isRoundFinished, winner) => {
  // Règles:
  // 1. Si round pas fini → "pending"
  // 2. Si round fini et prize > 0 → "won"
  // 3. Si round fini et prize = 0 → "lost"
  
  if (!isRoundFinished) return "pending";
  
  const prizeSystem = parseFloat(receipt.prize || 0);
  if (prizeSystem > 0) return "won";
  return "lost";
};
```

**Tests**:
- [ ] Ticket durant le round → "pending"
- [ ] Ticket après race (gagnant) → "won"
- [ ] Ticket après race (perdant) → "lost"

---

### Phase 7: Redis Fallback (HAUTE) 🟠

**Fichier**: `config/redis.js`  
**Fonction**: Ajouter fallback gracieux

```javascript
// TODO: Implémenter fallback si Redis down
const cacheSet = async (key, value, ttl) => {
  try {
    return await redisClient.setex(key, ttl, JSON.stringify(value));
  } catch (err) {
    // Fallback: in-memory cache
    console.warn(`⚠️ Redis unavailable, using in-memory cache for ${key}`);
    globalCache.set(key, { value, expireAt: Date.now() + ttl * 1000 });
  }
};
```

**Tests**:
- [ ] Redis disponible → utilise Redis
- [ ] Redis down → fallback mémoire
- [ ] Pas de crashs

---

### Phase 8: Tests Validations (MOYENNE) 🟡

**Fichier**: `tests/validations.test.js` (nouveau)

```bash
# Montants invalides
npm test -- --grep "invalid amount"

# Participants invalides
npm test -- --grep "invalid participant"

# Round non actif
npm test -- --grep "no active round"
```

**Tests**:
- [ ] Montant < MIN → 400
- [ ] Montant > MAX → 400
- [ ] Participant inexistant → 400
- [ ] Round pas prêt → 409

---

### Phase 9: Intégrité Transactionnelle (MOYENNE) 🟡

**Fichier**: `routes/receipts.js`  
**Quoi**: Utiliser transactions PostgreSQL

```javascript
// TODO: Wrapper dans transaction
const createReceiptWithTransaction = async (receipt) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    
    // 1. Créer receipt
    const receiptRes = await client.query(
      'INSERT INTO receipts (...) VALUES (...) RETURNING id',
      [...]
    );
    
    // 2. Créer bets
    for (const bet of receipt.bets) {
      await client.query(
        'INSERT INTO bets (...) VALUES (...)',
        [receiptRes.rows[0].id, ...]
      );
    }
    
    await client.query('COMMIT');
    return receiptRes.rows[0];
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};
```

**Tests**:
- [ ] Créer receipt + bets réussit
- [ ] Si erreur bet → rollback receipt
- [ ] Pas de data orpheline

---

## 📊 Timeline Recommandée

| Phase | Priorité | Durée | Date Estimée |
|-------|----------|-------|--------------|
| 5: Batch Persist | 🔴 Critique | 2-4h | Dec 2 |
| 6: Status Logic | 🟠 Haute | 1-2h | Dec 2 |
| 7: Redis Fallback | 🟠 Haute | 2-3h | Dec 3 |
| 8: Tests Valid | 🟡 Moyenne | 3-4h | Dec 3-4 |
| 9: Transactions | 🟡 Moyenne | 2-3h | Dec 4 |

---

## 🔍 Métriques de Suivi

### Code Quality
- [ ] ESLint warnings = 0
- [ ] Duplicate code = 0
- [ ] TODO comments = (tracking)

### Test Coverage
- [ ] Validations backend = 100%
- [ ] Database operations = >90%
- [ ] WebSocket events = >80%

### Performance
- [ ] DB query time avg < 100ms
- [ ] WebSocket message latency < 50ms
- [ ] Redis cache hit rate > 80%

### Stability
- [ ] Server uptime > 99%
- [ ] Error rate < 0.1%
- [ ] No memory leaks (check weekly)

---

## 🚨 Risques Identifiés

| Risque | Probabilité | Impact | Mitigation |
|--------|-------------|--------|-----------|
| Data loss race finish | Moyen | Critique | Batch persist + transactions |
| Status ticket inconsistent | Haut | Majeur | Centraliser logic |
| Redis cache stale | Moyen | Majeur | TTL + invalidation |
| DB connection pool exhausted | Faible | Critique | Monitor + increase pool |

---

## 📞 Notes de Fin

- **Tous les timers** sont maintenant dans `config/app.config.js`
- **Validation backend** est stricte et sécurisée
- **Documentation** clarifie l'architecture
- **Serveur** démarre sans erreurs
- **Tests** sont prêts à écrire

### Pour le Développeur Suivant

1. Lire **REPORT.md** pour vue d'ensemble
2. Lire **PERSISTENCE_STRATEGY.md** pour comprendre la persistance
3. Lire **TIMER_ARCHITECTURE.md** pour timing
4. Commencer par Phase 5 (Batch Persist)

---

**Crée**: 2025-11-30  
**Prêt pour**: Phase 5  
**Status**: ✅ Préparé
