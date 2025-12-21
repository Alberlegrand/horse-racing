# Système de Gestion des Comptes de Caisse 💰

## Vue d'ensemble

Le système de gestion des comptes de caisse permet à chaque caissier de gérer son propre compte avec un **solde NET en temps réel** qui reflète exactement l'argent disponible dans sa caisse.

### Caractéristiques principales

✅ **Solde NET en temps réel** - Le solde affiché dans le header du cashier.html est mis à jour automatiquement  
✅ **Historique complet des transactions** - Chaque opération (dépôt, retrait, décaissement) est enregistrée  
✅ **Auto-refresh toutes les 15 secondes** - Le solde se met à jour automatiquement  
✅ **Mise à jour instantanée après payout** - Dès qu'un décaissement est effectué, le solde change  
✅ **Intégration WebSocket** - Les transactions se synchronisent en temps réel  
✅ **Persistance en base de données** - Toutes les données sont sauvegardées  

## Architecture

### Tables de base de données

#### `cashier_accounts`
Stocke les informations de compte pour chaque caissier.

```sql
CREATE TABLE cashier_accounts (
  account_id SERIAL PRIMARY KEY,
  user_id INT NOT NULL UNIQUE,              -- Lié à l'utilisateur (caissier)
  current_balance DECIMAL(15,2) DEFAULT 0,  -- Solde NET actuel
  opening_balance DECIMAL(15,2) DEFAULT 0,  -- Solde au démarrage
  opening_time TIMESTAMP,                    -- Quand le compte a été ouvert
  closing_time TIMESTAMP,                    -- Quand le compte a été fermé
  status VARCHAR(20) DEFAULT 'open',        -- open, closed, suspended
  notes TEXT,
  created_at TIMESTAMP,
  updated_at TIMESTAMP
)
```

#### `account_transactions`
Historique de toutes les transactions du compte.

```sql
CREATE TABLE account_transactions (
  transaction_id SERIAL PRIMARY KEY,
  account_id INT NOT NULL,                   -- Compte lié
  user_id INT NOT NULL,                      -- Caissier qui a fait l'action
  transaction_type VARCHAR(50),              -- deposit, withdrawal, payout, pay-receipt, etc.
  amount DECIMAL(15,2),                      -- Montant de la transaction
  previous_balance DECIMAL(15,2),            -- Solde avant
  new_balance DECIMAL(15,2),                 -- Solde après
  reference VARCHAR(100),                    -- Ex: Receipt #123
  description TEXT,                          -- Description libre
  created_at TIMESTAMP
)
```

### Routes API

#### Récupérer le compte actuel
```
GET /api/v1/accounts/me
Authorization: authSession cookie

Response:
{
  "success": true,
  "account": {
    "accountId": 1,
    "userId": 2,
    "currentBalance": 5250.50,    // ← SOLDE NET ACTUEL
    "openingBalance": 5000.00,
    "openingTime": "2025-12-20T08:00:00Z",
    "closingTime": null,
    "status": "open",
    "notes": null,
    "createdAt": "2025-12-01T10:00:00Z",
    "updatedAt": "2025-12-20T14:30:00Z"
  }
}
```

#### Récupérer le solde uniquement
```
GET /api/v1/accounts/me/balance

Response:
{
  "success": true,
  "balance": 5250.50,
  "status": "open"
}
```

#### Ouvrir un compte (début de journée)
```
POST /api/v1/accounts/me/open

Request:
{
  "openingBalance": 5000.00
}

Response:
{
  "success": true,
  "message": "Compte ouvert avec succès",
  "account": { ... }
}
```

#### Fermer un compte (fin de journée)
```
POST /api/v1/accounts/me/close

Request:
{
  "closingNotes": "Caisse équilibrée - Solde final: 5250.50"
}
```

#### Ajouter une transaction
```
POST /api/v1/accounts/me/transaction

Request:
{
  "type": "payout",        // deposit, withdrawal, payout, pay-receipt, cash-in, cash-out
  "amount": 100.50,
  "reference": "Receipt #12345",
  "description": "Décaissement gagnant"
}

Response:
{
  "success": true,
  "message": "Transaction ajoutée avec succès",
  "transaction": {
    "transactionId": 42,
    "type": "payout",
    "amount": 100.50,
    "previousBalance": 5350.00,
    "newBalance": 5249.50,    // ← Nouveau solde après la transaction
    "reference": "Receipt #12345",
    "description": "Décaissement gagnant",
    "createdAt": "2025-12-20T14:30:00Z"
  }
}
```

#### Récupérer l'historique des transactions
```
GET /api/v1/accounts/me/transactions?limit=50&offset=0

Response:
{
  "success": true,
  "transactions": [
    {
      "transactionId": 42,
      "type": "payout",
      "amount": 100.50,
      "previousBalance": 5350.00,
      "newBalance": 5249.50,
      "reference": "Receipt #12345",
      "description": "Décaissement gagnant",
      "createdAt": "2025-12-20T14:30:00Z"
    },
    ...
  ],
  "pagination": {
    "limit": 50,
    "offset": 0,
    "total": 127
  }
}
```

#### Récupérer les statistiques du compte
```
GET /api/v1/accounts/me/stats

Response:
{
  "success": true,
  "stats": {
    "totalIn": 10250.50,       // Total des dépôts/entrées
    "totalOut": 5000.00,       // Total des retraits/sorties
    "transactionCount": 127,
    "currentBalance": 5250.50,
    "accountStatus": "open"
  }
}
```

#### Récupérer un relevé de compte (période)
```
POST /api/v1/accounts/me/statement

Request:
{
  "fromDate": "2025-12-20T00:00:00Z",
  "toDate": "2025-12-20T23:59:59Z"
}

Response:
{
  "success": true,
  "statement": [ ... ],
  "period": {
    "from": "2025-12-20T00:00:00Z",
    "to": "2025-12-20T23:59:59Z"
  }
}
```

## Frontend - Gestionnaire JavaScript

### Classe `CashierAccountManager`

Fichier: `static/js/cashier-account-manager.js`

#### Utilisation basique

```javascript
// Le gestionnaire est créé globalement dans cashier.html
const accountManager = new CashierAccountManager();

// Initialiser (charge le solde et active auto-refresh)
await accountManager.init();

// Récupérer le solde actuel
const balance = accountManager.getBalance();
console.log(`Solde: ${balance} HTG`);

// Récupérer le statut
const status = accountManager.getStatus();

// Recharger manuellement
await accountManager.loadAccountData();

// Rafraîchir (avec feedback visual)
await accountManager.manualRefresh();
```

#### Gestion des transactions

```javascript
// Ajouter une transaction
try {
  const transaction = await accountManager.addTransaction(
    'payout',                    // Type
    100.50,                      // Montant
    'Receipt #12345',            // Référence optionnelle
    'Décaissement gagnant'       // Description optionnelle
  );
  console.log('Nouvelle balance:', transaction.newBalance);
} catch (err) {
  console.error('Erreur:', err.message);
}
```

#### Ouvrir/Fermer un compte

```javascript
// Ouvrir la caisse (début de jour)
try {
  const account = await accountManager.openAccount(5000); // Solde d'ouverture
  console.log('Caisse ouverte');
} catch (err) {
  console.error('Erreur:', err.message);
}

// Fermer la caisse (fin de jour)
try {
  const account = await accountManager.closeAccount('Notes de fermeture');
  console.log('Caisse fermée. Solde final:', account.currentBalance);
} catch (err) {
  console.error('Erreur:', err.message);
}
```

#### Écouter les changements

```javascript
// Ajouter un listener pour réagir aux changements
accountManager.onChange((data) => {
  console.log(`Solde: ${data.balance} HTG`);
  console.log(`Statut: ${data.status}`);
  console.log(`Dernière mise à jour: ${data.lastUpdate}`);
});
```

### Affichage du solde NET dans le header

Le solde NET est automatiquement affiché dans l'élément `#cashBalanceHeader`:

```html
<div class="text-xs text-slate-300">
  Solde caisse:
  <span id="cashBalanceHeader" class="font-semibold">50,000.00 HTG</span>
</div>
```

**Couleurs dynamiques:**
- 🟢 **Vert** - Solde positif (caisse ouverte)
- 🔴 **Rouge** - Solde négatif (alerte!)
- 🟠 **Orange** - Solde zéro
- ⚪ **Gris** - Caisse fermée

### Auto-refresh

Le gestionnaire se met à jour **automatiquement toutes les 15 secondes**:
- Affiche le solde NET à jour
- Notifie les listeners
- Ne recharge que si modifié

## Intégration avec les paiements

### Flux payout/décaissement

1. **Caissier clique sur "Payer"** pour un ticket gagnant
2. **Route POST /api/v1/money/payout** est appelée
3. **Automatiquement:** 
   - Transaction créée dans `account_transactions`
   - `cashier_accounts.current_balance` est mise à jour
   - WebSocket notifie les clients
4. **Frontend:**
   - `accountManager.loadAccountData()` rechargele solde
   - Affichage dans le header se met à jour
   - Listeners sont notifiés

### Code de l'intégration (routes/money.js)

```javascript
// ✅ Enregistrer la transaction dans le compte du caissier
if (userId && req.user?.role === 'cashier') {
  try {
    const transaction = await accountModel.addTransaction(
      userId,
      'payout',
      amount,
      receiptId ? `Receipt #${receiptId}` : null,
      reason || 'Manual payout'
    );
    console.log(`💸 Payout enregistré: ${amount} HTG`);
  } catch (accountErr) {
    console.warn(`⚠️ Erreur enregistrement transaction: ${accountErr.message}`);
  }
}
```

## Déploiement

### 1. Migration de la base de données

Les tables sont créées automatiquement au démarrage du serveur:

```javascript
// config/db.js - createTables()
await client.query(`CREATE TABLE IF NOT EXISTS cashier_accounts ...`);
await client.query(`CREATE TABLE IF NOT EXISTS account_transactions ...`);
```

### 2. Comptes de caissiers créés automatiquement

Au démarrage, pour chaque utilisateur avec `role='cashier'`, un compte est créé:

```javascript
const cashierUsers = await client.query(
  "SELECT user_id, username FROM users WHERE role = 'cashier'"
);

for (const cashier of cashierUsers.rows) {
  await client.query(`
    INSERT INTO cashier_accounts (user_id, current_balance, opening_balance, status)
    VALUES ($1, 0, 0, 'closed')
  `);
}
```

### 3. Démarrage du serveur

```bash
npm start
# ou
nodemon server.js
```

## Exemples d'utilisation

### Cas d'usage 1: Affichage du solde en temps réel

```html
<!-- cashier.html -->
<script src="/js/cashier-account-manager.js"></script>

<script>
  const accountManager = new CashierAccountManager();
  
  // Initialiser au chargement
  document.addEventListener('DOMContentLoaded', async () => {
    await accountManager.init();
    
    // Le solde est automatiquement affiché dans #cashBalanceHeader
    // et mis à jour toutes les 15 secondes
  });
</script>
```

### Cas d'usage 2: Récupérer le solde en JavaScript

```javascript
// Récupérer le solde NET actuel
const balance = accountManager.currentBalance;
console.log(`Solde NET: ${balance.toFixed(2)} HTG`);

// Afficher avec formatage
const formatted = balance.toLocaleString('fr-HT', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2
});
console.log(`Solde: ${formatted} HTG`);
```

### Cas d'usage 3: Recharger manuellement depuis un bouton

```javascript
// Bouton "Refresh" déjà présent dans le header
document.getElementById('refreshBtn').addEventListener('click', () => {
  accountManager.manualRefresh();
});
```

### Cas d'usage 4: Ajouter une transaction personnalisée

```javascript
// Dépôt d'argent
await accountManager.addTransaction(
  'deposit',      // Type
  500,            // Montant
  null,           // Pas de référence
  'Dépôt du directeur'  // Description
);

// Retrait
await accountManager.addTransaction(
  'withdrawal',
  100,
  null,
  'Retrait pour fournitures'
);
```

## Modèle de données

### Flux des données

```
User (caissier) ← Authentification
    ↓
User Table (role='cashier')
    ↓
Cashier_Accounts (current_balance, status)
    ↓
Account_Transactions (historique)
    ↓
Frontend Display (#cashBalanceHeader)
```

### Cohérence des données

- **Chaque transaction** change `current_balance` atomiquement
- **Pas de transactions négatives** - Validation avant insertion
- **Audit trail complet** - Tout est enregistré dans `account_transactions`
- **Logs système** - Tout est tracé dans `transaction_logs`

## Monitoring et débogage

### Logs console
```javascript
// Affiche les mises à jour du gestionnaire
console.log('💰 Affichage mis à jour: XXX HTG');
console.log('✅ Compte chargé: Solde NET = XXX HTG');
console.log('💳 Transaction détectée via WebSocket, rechargement...');
```

### Inspection du solde
```javascript
// Dans la console du navigateur
console.log(accountManager.currentBalance);
console.log(accountManager.currentAccount);
console.log(accountManager.transactions);
```

### Tester l'API directement
```bash
# Récupérer le compte
curl -X GET http://localhost:8080/api/v1/accounts/me \
  -H "Cookie: authSession=YOUR_JWT_TOKEN"

# Ajouter une transaction
curl -X POST http://localhost:8080/api/v1/accounts/me/transaction \
  -H "Content-Type: application/json" \
  -H "Cookie: authSession=YOUR_JWT_TOKEN" \
  -d '{"type": "payout", "amount": 100}'
```

## Limitations et notes

- Les transactions ne peuvent pas être supprimées (audit trail)
- Un compte ne peut être réouvert qu'après fermeture
- Le solde ne peut pas être négatif (validation côté serveur)
- Les transactions sont enregistrées en HTG (devise du système)

## Prochaines améliorations

- [ ] Réconciliation automatique (match physique vs système)
- [ ] Rapports journaliers PDF
- [ ] Alertes si variance détectée
- [ ] Support multi-devises
- [ ] Approbation des retraits > X HTG
- [ ] Vérification des signatures digitales
