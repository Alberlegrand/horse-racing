# 🗄️ Documentation de la Base de Données - Horse Racing

## Vue d'ensemble

Ce projet utilise **PostgreSQL** pour persister les données du jeu de course de chevaux. Le schéma est conçu pour :
- ✅ Gérer les rounds/courses (timeline, participants, gagnants)
- ✅ Stocker les tickets (receipts) et les paris (bets) de manière atomique
- ✅ Calculer les gains et gérer les paiements
- ✅ Auditer toutes les transactions via journaux
- ✅ Générer des rapports statistiques

---

## 📊 Structure des Données

### 1. **UTILISATEURS** (users, user_profiles)

#### `users` - Gestion des comptes
```sql
CREATE TABLE users (
  user_id INT PRIMARY KEY,
  username VARCHAR(50) UNIQUE,
  email VARCHAR(255) UNIQUE,
  password VARCHAR(255),
  role VARCHAR(20), -- 'admin', 'cashier', 'viewer'
  is_active BOOLEAN,
  is_suspended BOOLEAN,
  is_blocked BOOLEAN,
  created_at TIMESTAMP
)
```

**Rôles disponibles:**
- `admin` - Accès complet, gestion des utilisateurs
- `cashier` - Gestion des tickets, paiements
- `viewer` - Consultation uniquement

#### `user_profiles` - Profils détaillés
```sql
CREATE TABLE user_profiles (
  profile_id INT PRIMARY KEY,
  user_id INT FOREIGN KEY,
  first_name VARCHAR(50),
  last_name VARCHAR(50),
  phone VARCHAR(20),
  address VARCHAR(255),
  date_of_birth DATE
)
```

---

### 2. **PARTICIPANTS** (Chevaux/Sportifs)

```sql
CREATE TABLE participants (
  participant_id INT PRIMARY KEY,
  number INT UNIQUE,        -- Numéro du cheval (6, 7, 8, 9, 10, 54)
  name VARCHAR(100),        -- De Bruyne, Ronaldo, Mbappe, etc.
  coeff DECIMAL(10,2),      -- Coefficient (4.5 à 8.1)
  family INT,               -- ID famille/groupe (0-5)
  is_active BOOLEAN,
  created_at TIMESTAMP
)
```

**Données par défaut:**
| number | name | coeff | family |
|--------|------|-------|--------|
| 6 | De Bruyne | 5.5 | 0 |
| 7 | Ronaldo | 4.7 | 1 |
| 8 | Mbappe | 7.2 | 2 |
| 9 | Halland | 5.8 | 3 |
| 10 | Messi | 8.1 | 4 |
| 54 | Vinicius | 4.5 | 5 |

---

### 3. **ROUNDS** (Courses)

#### `rounds` - Métadonnées des courses
```sql
CREATE TABLE rounds (
  round_id INT PRIMARY KEY,
  round_number INT UNIQUE,  -- Numéro séquentiel (1, 2, 3...)
  status VARCHAR(20),       -- 'waiting' | 'running' | 'finished'
  winner_id INT FK,         -- Participant gagnant
  total_prize DECIMAL(15,2), -- Pot total
  started_at TIMESTAMP,
  finished_at TIMESTAMP,
  next_start_time TIMESTAMP,
  created_at TIMESTAMP
)
```

**Statuts:**
- `waiting` - En attente de début
- `running` - Course en cours
- `finished` - Terminée

#### `round_participants` - Positions dans une course
```sql
CREATE TABLE round_participants (
  round_participant_id INT PRIMARY KEY,
  round_id INT FK,
  participant_id INT FK,
  place INT,  -- 1ère position, 2e, etc.
  created_at TIMESTAMP
)
```

**Exemple:** 
- Round 42, Participant "De Bruyne" (6), Place 3
- Round 42, Participant "Mbappe" (8), Place 1 (gagnant)

---

### 4. **TICKETS ET PARIS**

#### `receipts` - Tickets de pari
```sql
CREATE TABLE receipts (
  receipt_id BIGINT PRIMARY KEY,  -- Généré par ChaCha20
  round_id INT FK,
  user_id INT FK,
  status VARCHAR(20),      -- 'pending' | 'won' | 'lost' | 'paid' | 'cancelled'
  total_amount DECIMAL(15,2),  -- Montant misé (en système: ÷100)
  prize DECIMAL(15,2),     -- Gains calculés
  paid_at TIMESTAMP,
  created_at TIMESTAMP
)
```

**Exemple:**
```
receipt_id: 7542918364
round_id: 42
status: 'won'
total_amount: 500 (= 5.00 HTG en affichage)
prize: 2100 (= 21.00 HTG)
```

#### `bets` - Paris individuels d'un ticket
```sql
CREATE TABLE bets (
  bet_id INT PRIMARY KEY,
  receipt_id BIGINT FK,
  participant_id INT FK,
  participant_number INT,
  participant_name VARCHAR(100),
  coefficient DECIMAL(10,2),
  value DECIMAL(15,2),     -- Montant du pari
  prize DECIMAL(15,2),     -- Gains du pari
  status VARCHAR(20),      -- 'pending' | 'won' | 'lost'
  created_at TIMESTAMP
)
```

**Exemple - Ticket avec 3 paris:**
```
receipt_id: 7542918364
├─ Bet 1: Mbappe (8), coeff=7.2, value=200, prize=1440, status='won'
├─ Bet 2: De Bruyne (6), coeff=5.5, value=200, prize=0, status='lost'
└─ Bet 3: Ronaldo (7), coeff=4.7, value=100, prize=0, status='lost'
```

---

### 5. **PAIEMENTS**

```sql
CREATE TABLE payments (
  payment_id INT PRIMARY KEY,
  receipt_id BIGINT FK,
  user_id INT FK,
  amount DECIMAL(15,2),
  method VARCHAR(50),      -- 'cash' | 'transfer' | 'card'
  status VARCHAR(20),      -- 'pending' | 'completed' | 'failed' | 'refunded'
  transaction_ref VARCHAR(100),
  created_at TIMESTAMP
)
```

---

### 6. **AUDIT ET JOURNAUX**

#### `transaction_logs` - Journalisation complète
```sql
CREATE TABLE transaction_logs (
  log_id INT PRIMARY KEY,
  user_id INT FK,
  action VARCHAR(100),     -- 'BET_PLACED', 'TICKET_PAID', 'RECEIPT_CANCELLED', etc.
  entity_type VARCHAR(50), -- 'receipt' | 'bet' | 'payment' | 'round'
  entity_id VARCHAR(100),  -- ID de l'entité
  old_value TEXT,          -- Valeur avant changement
  new_value TEXT,          -- Valeur après changement
  ip_address VARCHAR(45),
  created_at TIMESTAMP
)
```

**Exemple:**
```
action: 'TICKET_PAID'
entity_type: 'receipt'
entity_id: '7542918364'
old_value: '{"status":"won","prize":2100}'
new_value: '{"status":"paid","prize":2100,"paid_at":"2024-01-15T14:30:00Z"}'
```

---

### 7. **STATISTIQUES**

#### `game_statistics` - Stats par round
```sql
CREATE TABLE game_statistics (
  stat_id INT PRIMARY KEY,
  round_id INT FK,
  total_receipts INT,      -- Nombre de tickets vendus
  total_bets INT,          -- Nombre total de paris
  total_stakes DECIMAL(15,2),  -- Montant total misé
  total_prize_pool DECIMAL(15,2), -- Pot total à distribuer
  total_paid DECIMAL(15,2),   -- Montants payés
  house_balance DECIMAL(15,2), -- Solde maison
  created_at TIMESTAMP
)
```

**Exemple Round 42:**
```
total_receipts: 157 tickets
total_bets: 428 paris
total_stakes: 25420 (254.20 HTG)
total_prize_pool: 18800 (188.00 HTG)
house_balance: 6620 (66.20 HTG)
```

---

### 8. **CONFIGURATION**

```sql
CREATE TABLE app_settings (
  setting_id INT PRIMARY KEY,
  app_name VARCHAR(150),
  company_name VARCHAR(150),
  contact_email VARCHAR(255),
  timezone VARCHAR(50),
  currency VARCHAR(10),
  round_duration_ms INT,
  race_duration_ms INT,
  created_at TIMESTAMP,
  updated_at TIMESTAMP
)
```

---

## 🔗 Relations Clés

```
rounds (1) ─────────────── (N) receipts (1) ───────────── (N) bets
                                  │
                                  └──────────────────────────────────┐
                                                                     │
                                  (1) payments (N)                  (N) participants
                                      │
                                      │
                                      └──── (N) users

transaction_logs ──────────────────► users, receipts, bets, payments
game_statistics ──────────────────► rounds, receipts, bets
reports ──────────────────────────► users (created_by)
```

---

## 💾 Conversion de Valeurs

### Système vs Affichage

Le projet utilise deux représentations:

**Système (Base de données):**
- Entiers sans décimales
- 1 unité = 1/100 HTG
- Exemple: 1000 en base = 10.00 HTG

**Affichage (Utilisateur):**
- Décimales avec 2 chiffres significatifs
- Formaté: "10.00 HTG"
- Conversion: `publicValue = systemValue ÷ 100`

**Exemple avec rebet:**
```javascript
// En base de données
{ value: 500 }  // 5.00 HTG

// Conversion pour affichage
displayValue = 500 / 100 = 5.00

// Conversion inverse (soumission formulaire)
userInput: "5.00"
systemValue = 5.00 * 100 = 500
```

---

## 🚀 Initialisation

### Via `config/db.js`

```javascript
import { initializeDatabase } from "./config/db.js";

// Au démarrage du serveur
await initializeDatabase();
// ✅ Crée toutes les tables
// ✅ Insère admin par défaut
// ✅ Ajoute les 6 participants
// ✅ Configure les paramètres par défaut
```

### Vérifier la connexion
```javascript
import { testConnection } from "./config/db.js";

const isConnected = await testConnection();
// ✅ Connexion PostgreSQL établie
```

---

## 📚 Migrations de Données

### Migrer un round depuis la mémoire

```javascript
import { saveRound } from "./config/db-migration.js";
import game from "./game.js";

// Après chaque round terminé
await saveRound(game.gameState.currentRound);
```

### Récupérer l'historique

```javascript
import { fetchAllRounds, fetchRoundDetails } from "./config/db-migration.js";

const allRounds = await fetchAllRounds();
const roundDetails = await fetchRoundDetails(42);
```

---

## 🔐 Sécurité

### SSL/TLS pour PostgreSQL
```
DATABASE_URL=postgres://user:pass@host:5432/db
SSL_CERTIFICATE=./ca.pem  # Chemin au certificat
```

### Protection des données sensibles
- Mots de passe hashés (bcrypt/argon2)
- Tokens JWT pour sessions
- Audit complet via `transaction_logs`
- IP tracking dans les logs

---

## 📈 Performance

### Indices créés par défaut
```sql
idx_receipts_round_id       -- Récupérer les tickets d'un round
idx_receipts_user_id        -- Historique d'un utilisateur
idx_receipts_status         -- Filtre par statut
idx_receipts_created_at     -- Tri chronologique
idx_bets_receipt_id         -- Détails d'un ticket
idx_bets_participant_id     -- Stats par participant
idx_payments_receipt_id     -- Historique de paiement
idx_rounds_status           -- Courses en cours
idx_transaction_logs_*      -- Recherche d'audit
```

---

## 🛠️ Maintenance

### Sauvegarde PostgreSQL
```bash
pg_dump horse_racing > backup.sql
```

### Restauration
```bash
psql horse_racing < backup.sql
```

### Purger les vieux logs (> 90 jours)
```sql
DELETE FROM transaction_logs
WHERE created_at < CURRENT_DATE - INTERVAL '90 days';
```

---

## 📋 Checklist d'Implémentation

- [ ] PostgreSQL installé et configuré
- [ ] Variables d'environnement dans `.env`
- [ ] `config/db.js` importé et initialisé au démarrage
- [ ] SSL/TLS configuré pour production
- [ ] Migrations de jeu en mémoire → base de données
- [ ] Tests de requêtes d'audit
- [ ] Rapports statistiques générés
- [ ] Sauvegardes PostgreSQL planifiées
- [ ] Monitoring des connexions

---

## 📞 Support

Pour questions ou modifications:
- Consulter `config/db.js` pour structure
- Consulter `config/db-migration.js` pour requêtes
- Logs détaillés: vérifier `process.env.LOG_LEVEL`
