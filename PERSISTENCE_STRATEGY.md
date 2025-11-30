# 📊 Stratégie de Persistance Unifiée

## Vue d'ensemble

Le projet utilise une **persistance hybride**: Redis pour le cache haute-performance + PostgreSQL pour la pérennité.

### Architecture

```
┌─────────────────────────────────────────────────────┐
│ CLIENT (Frontend)                                   │
└──────────────────────┬──────────────────────────────┘
                       │ WebSocket
                       ▼
┌─────────────────────────────────────────────────────┐
│ SERVER (Express)                                    │
│                                                     │
│ gameState (Mémoire)  ◄── État partagé             │
│   - currentRound                                    │
│   - gameHistory                                     │
└──────────────────────┬──────────────────────────────┘
      ▲        │        ▲        │
      │        │        │        │
   READ    WRITE     READ    WRITE
      │        │        │        │
      ▼        ▼        ▼        ▼
┌──────────┐ ┌──────────────────┐
│  Redis   │ │  PostgreSQL      │
│  (Cache) │ │  (Persistance)   │
└──────────┘ └──────────────────┘
```

## Stratégie par Entité

### 🎯 ROUND (Manche)

**Cycle de vie:**
1. **Initialisation**: `startNewRound()` crée un round en mémoire
2. **Persistance DB**: Round inséré en DB immédiatement avec status `'waiting'`
3. **Attente**: Timer attend avant de démarrer la course
4. **Race Active**: Les tickets se créent dans `gameState.currentRound.receipts` (mémoire)
5. **Race Finie**: Race finit, participants reçoivent leur `place` final
6. **Archive**: Round est archivé dans `gameState.gameHistory`

**Stockage:**
- **Mémoire**: `gameState.currentRound` (données complètes)
- **DB**: Table `rounds` (round_id, round_number, status, created_at)
- **Redis**: Round courant en cache (TTL: 1h)

**⚠️ POINT CRITIQUE**: Le round DOIT être inséré en DB avant que les tickets ne se créent

---

### 🎫 TICKETS (Receipts)

**Cycle de vie:**
1. **Création**: Client crée des paris via `/api/v1/receipts` (POST)
2. **Validations**: 
   - ✅ Round actif existe
   - ✅ Participants valides pour ce round
   - ✅ Montants entre MIN_BET_AMOUNT et MAX_BET_AMOUNT
3. **Stockage Mémoire**: Ticket ajouté à `gameState.currentRound.receipts`
4. **Persistance DB**: Ticket + Paris insérés en DB (2 tables: receipts + bets)
5. **Race Termine**: `prize` calculé basé sur le gagnant
6. **Broadcast**: Clients notifiés via WebSocket de l'état final

**Stockage:**
- **Mémoire**: `gameState.currentRound.receipts` (durant le round)
- **DB**: Tables `receipts` + `bets` (après création)
- **Redis**: Cache utilisateur avec TTL (pour `my_bets`)

**Montants:** TOUJOURS en "système" (×100), convertir en "public" pour l'affichage

---

### 💰 PARIS (Bets)

**Cycle de vie:**
1. **Création**: Associés à un ticket lors de sa création
2. **Status PENDING**: Tant que la course n'est pas terminée
3. **Évaluation**: Après le finish, comparé au gagnant
4. **Status WON/LOST**: Basé sur `participant.number === winner.number`
5. **Prize**: Calculé seulement si WON

**Stockage:**
- **Mémoire**: `gameState.currentRound.receipts[].bets`
- **DB**: Table `bets` (receipt_id, participant_number, value, prize)
- **Redis**: Cache dans `round:<roundId>:receipts` (optionnel)

---

## 🔄 Synchronisation

### Lors d'une CRÉATION de Ticket

```javascript
// 1. Validation (mémoire)
✓ Round actif existe
✓ Participants valides
✓ Montants valides

// 2. Création en mémoire
gameState.currentRound.receipts.push(newTicket)

// 3. Persistance DB (asynce, non-bloquant)
dbCreateReceipt(ticket)    // DB async
dbCreateBet(ticket.bets)   // DB async

// 4. Cache Redis (optionnel)
dbStrategy.addTicketToRoundCache(roundId, ticket)

// 5. Broadcast aux clients
broadcast({ event: 'ticket_created', ticket })
```

### Lors du FINISH de Round

```javascript
// 1. Déterminer le gagnant
const winner = selectRandomWinner(participants)
participants[winner.index].place = 1

// 2. Calculer les prix pour TOUS les tickets
gameState.currentRound.receipts.forEach(receipt => {
  receipt.bets.forEach(bet => {
    if (bet.participant.number === winner.number) {
      receipt.prize = calculatePrize(bet)
    }
  })
})

// 3. Batch update en DB
updateReceiptPrizes(gameState.currentRound.receipts)

// 4. Archive
gameState.gameHistory.push(gameState.currentRound)

// 5. Broadcast résultat
broadcast({ event: 'race_finished', winner, receipts: [...] })

// 6. Démarrer un nouveau round
startNewRound()
```

---

## ✅ Règles de Cohérence

### 1. **Single Source of Truth**
- Mémoire (`gameState`) = source de vérité PENDANT un round
- DB = sauvegarde permanente
- Redis = cache pour améliorer les lectures

### 2. **Validations Strictes**
- ✅ Backend DOIT valider:
  - Round actif + persisted en DB
  - Participants existent dans le round
  - Montants dans les limites
  - Pas de création après finish

### 3. **Asynchronicité**
- DB writes = asynce (non-bloquant)
- WebSocket broadcasts = immédiat
- Client = attend confirmation via WebSocket

### 4. **Intégrité Transactionnelle**
- Chaque ticket = 2 inserts (receipts + bets)
- Utiliser transactions PostgreSQL si possible:
  ```javascript
  BEGIN
    INSERT INTO receipts ...
    INSERT INTO bets ...
  COMMIT
  ```

---

## 🛠️ Configuration

Voir `config/app.config.js`:

```javascript
// Limites de montants (en système = ×100)
MIN_BET_AMOUNT = 1000      // 10.00 HTG
MAX_BET_AMOUNT = 500000    // 5000.00 HTG

// Timer
TIMER_DURATION_SECONDS = 20   // 20 secondes avant race
```

---

## 📝 Checklist d'Implémentation

- [x] Exporter `BASE_PARTICIPANTS` depuis `game.js`
- [x] Importer dans `routes/rounds.js`
- [x] Importer validation montants dans `routes/receipts.js`
- [ ] Implémenter batch persist après finish
- [ ] Centraliser statut tickets logic
- [ ] Ajouter tests de validations
- [ ] Vérifier intégrité transactionnelle
- [ ] Monitorer Redis cache hit rate

---

## 🚨 Problèmes Corrigés

1. ✅ **keepalive.js**: Importait `wrap()` et `PORT` non définis
2. ✅ **Participants dupliqués**: Consolidés dans `game.js::BASE_PARTICIPANTS`
3. ✅ **Validation backend**: Ajoutée pour montants
4. ✅ **Fonctions monnaie**: Déjà implémentées dans `utils.js`

---

**Dernière mise à jour**: 2025-11-30
