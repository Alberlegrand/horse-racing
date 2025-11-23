# 🗄️ Architecture PostgreSQL + Redis Optimisée

## 📋 Vue d'Ensemble

Ce système sépare clairement les responsabilités entre PostgreSQL et Redis pour optimiser la performance et la persistance:

```
┌─────────────────────┬──────────────────────────────┐
│   PostgreSQL        │         Redis                │
├─────────────────────┼──────────────────────────────┤
│ Données permanentes │ Cache + Sessions haute vitesse│
│ • Logs d'audit      │ • Sessions utilisateur (24h)  │
│ • Statistiques      │ • Stats en cache (30s)        │
│ • Rounds            │ • État du jeu (1h)            │
│ • Tickets & Paris   │ • Cache requêtes (30s)        │
│ • Participants      │                              │
│ • Historique        │ Si indisponible:             │
│                     │ • Fallback automatique à PG  │
│ Source de vérité    │ • Mode dégradé activé        │
└─────────────────────┴──────────────────────────────┘
```

---

## 📊 PostgreSQL - Persistance Permanente

### Tables principales:

#### 1. `rounds` - Tours de jeu
```sql
CREATE TABLE rounds (
  round_id BIGINT PRIMARY KEY,
  round_number INT UNIQUE,
  status TEXT, -- 'waiting', 'running', 'finished'
  winner_id INT,
  total_prize DECIMAL,
  started_at TIMESTAMP,
  finished_at TIMESTAMP,
  next_start_time TIMESTAMP,
  created_at TIMESTAMP,
  updated_at TIMESTAMP
);
```

#### 2. `receipts` - Tickets de pari
```sql
CREATE TABLE receipts (
  receipt_id BIGINT PRIMARY KEY,
  round_id BIGINT REFERENCES rounds,
  created_at TIMESTAMP,
  total_amount DECIMAL
);
```

#### 3. `bets` - Paris individuels
```sql
CREATE TABLE bets (
  id SERIAL PRIMARY KEY,
  receipt_id BIGINT REFERENCES receipts,
  participant_id INT REFERENCES participants,
  participant_number INT,
  value DECIMAL,
  prize DECIMAL,
  created_at TIMESTAMP
);
```

#### 4. `game_statistics` - Statistiques par round
```sql
CREATE TABLE game_statistics (
  id SERIAL PRIMARY KEY,
  round_id BIGINT REFERENCES rounds,
  total_receipts INT,
  total_bets INT,
  total_stakes DECIMAL,
  total_prize_pool DECIMAL,
  total_paid DECIMAL,
  house_balance DECIMAL,
  created_at TIMESTAMP
);
```

#### 5. `transaction_logs` - Audit d'audit
```sql
CREATE TABLE transaction_logs (
  id SERIAL PRIMARY KEY,
  user_id TEXT,
  action TEXT, -- 'TICKET_CREATED', 'TICKET_DELETED', etc.
  entity_type TEXT, -- 'RECEIPT', 'ROUND', 'BET'
  entity_id BIGINT,
  old_value TEXT,
  new_value TEXT,
  ip_address TEXT,
  created_at TIMESTAMP
);
```

### Utilisation:

```javascript
// Sauvegarder une statistique de round
import { saveRoundStatistics } from './config/db-strategy.js';

await saveRoundStatistics(roundId, {
  total_receipts: 42,
  total_stakes: 500000,
  total_paid: 850000,
  house_balance: -350000
});
// Sauvegarde en PostgreSQL + cache Redis (30s)
```

---

## ⚡ Redis - Performance & Sessions

### Clés Redis utilisées:

```javascript
// Sessions utilisateur (24h)
session:USER_ID = { 
  userId, 
  role, 
  loginTime, 
  email,
  permissions: [...]
}

// Statistiques en cache (30s)
stats:round:ROUND_ID = { statistiques du round }
stats:global:last_20 = [ dernières 20 stats ]

// État du jeu (1h)
game:state:current = { 
  currentRound,
  gameHistory,
  nextRoundStartTime,
  isRaceRunning
}

// Cache de requêtes fréquentes (30s)
query:sales_stats = { received, payouts, balance }
query:participants = [ participants ]
```

### Utilisation:

```javascript
// Récupérer les stats d'un round (avec cache Redis)
import { getRoundStatistics } from './config/db-strategy.js';

const stats = await getRoundStatistics(roundId);
// 1. Vérifie Redis (30s)
// 2. Si miss: interroge PostgreSQL
// 3. Remet en cache Redis
```

---

## 📝 Logs d'Audit - PostgreSQL uniquement

Chaque action utilisateur est enregistrée automatiquement:

```javascript
import { logAction } from './config/db-strategy.js';

// Enregistrer une action
await logAction(
  userId,           // ID utilisateur
  'TICKET_CREATED', // Type d'action
  'RECEIPT',        // Type d'entité
  5001014968,       // ID du ticket
  {},               // Détails additionnels
  req.ip            // Adresse IP
);

// Récupérer l'historique
import { getAuditLog } from './config/db-strategy.js';

const history = await getAuditLog('RECEIPT', 5001014968, 50);
// Retourne les 50 dernières actions sur ce ticket
```

### Actions enregistrées:
- `TICKET_CREATED` - Nouveau ticket créé
- `TICKET_DELETED` - Ticket supprimé
- `TICKET_MODIFIED` - Ticket modifié
- `ROUND_STARTED` - Course démarrée
- `ROUND_FINISHED` - Course terminée
- `LOGIN` - Connexion utilisateur
- `LOGOUT` - Déconnexion

---

## 🔄 Flux de Synchronisation

### Quand un ticket est créé:

```
1. [Client] Clique "Ajouter ticket"
   ↓
2. [Server] POST /api/v1/receipts
   ↓
3. [PostgreSQL] INSERT receipt + bets
   ↓
4. [Redis] Invalider cache: stats:* + query:sales_stats
   ↓
5. [PostgreSQL] INSERT transaction_log (audit)
   ↓
6. [Audit Middleware] Enregistre automatiquement
   ↓
7. [WebSocket] Broadcast aux clients
   ↓
8. [Client] Rafraîchit l'affichage
```

---

## 🛡️ Mode Dégradé

Si Redis est indisponible:

```
✅ Système fonctionne normalement
❌ Cache désactivé (performances réduites)
✅ PostgreSQL reste la source de vérité
⚠️ Sessions perdues au redémarrage serveur
```

Logs:
```
⚠️ Redis non disponible (mode dégradé activé)
```

---

## 📡 Routes d'Accès

### Statistiques

```bash
# Statistiques d'un round (cache 30s)
GET /api/v1/stats/round/96908000

# Statistiques globales (derniers 20 rounds)
GET /api/v1/stats/global?limit=20

# Invalider le cache (admin uniquement)
POST /api/v1/stats/invalidate?roundId=96908000
```

### Audit

```bash
# Historique d'audit d'un ticket (cashier/admin)
GET /api/v1/audit/RECEIPT/5001014968?limit=50

# Historique d'audit d'un round
GET /api/v1/audit/ROUND/96908000?limit=50
```

---

## 🔧 Configuration

### `.env`:

```bash
# PostgreSQL
DB_URL=postgresql://user:password@localhost:5432/hitbet

# Redis
REDIS_URL=redis://localhost:6379

# Round duration
ROUND_WAIT_DURATION_MS=180000  # 3 minutes
```

---

## 📊 Monitoring

### Vérifier PostgreSQL:

```bash
psql postgresql://postgres@localhost:5432/hitbet
SELECT COUNT(*) FROM rounds;
SELECT COUNT(*) FROM transaction_logs;
```

### Vérifier Redis:

```bash
redis-cli
> PING
> KEYS "*"
> GET "game:state:current"
> TTL "session:USER_ID"
```

### Logs serveur:

```
✅ [CACHE] ✓ Stats depuis Redis
[DB] → Stats depuis PostgreSQL
[LOG] ✓ TICKET_CREATED - RECEIPT#5001014968
[AUDIT] Erreur logging: ...
```

---

## 🚀 Performance

| Opération | Sans Cache | Avec Cache |
|-----------|-----------|-----------|
| Récupérer stats round | ~50ms (PG) | ~1ms (Redis) |
| Récupérer session | ~50ms (PG) | ~1ms (Redis) |
| Afficher historique | ~100ms (PG) | Instantané (PG cache) |

**Amélioration: 50-100x plus rapide avec Redis** ⚡

---

## ✅ Checklist d'Implémentation

- [x] PostgreSQL configuré
- [x] Redis configuré
- [x] Strategy PostgreSQL/Redis séparée
- [x] Audit middleware automatique
- [x] Routes stats optimisées
- [x] Mode dégradé activé
- [x] Logs d'audit en PostgreSQL
- [x] Cache de requêtes en Redis
- [x] Sessions Redis 24h
- [x] Invalidation cache automatique
