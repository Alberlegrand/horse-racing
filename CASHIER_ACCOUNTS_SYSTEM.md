# 💰 SYSTÈME DE GESTION DES CAISSES (CASHIER ACCOUNTS)

## Vue d'ensemble

Un système complet pour gérer les comptes de caisse individuels de chaque caissier. Chaque caissier peut:
- Ouvrir/fermer sa caisse chaque jour
- Effectuer des dépôts/retraits
- Voir son solde actuel
- Consulter l'historique de toutes ses transactions
- Générer des relevés de compte pour une période

## Architecture

### Tables de base de données

#### `cashier_accounts`
Stocke les informations du compte de chaque caissier:
- `account_id` (PK): ID unique du compte
- `user_id` (FK): Référence à l'utilisateur caissier (UNIQUE)
- `current_balance`: Solde actuel du compte
- `opening_balance`: Solde initial à l'ouverture
- `opening_time`: Timestamp d'ouverture du compte
- `closing_time`: Timestamp de fermeture (NULL si ouvert)
- `status`: 'open', 'closed', ou 'suspended'
- `notes`: Notes sur le compte (observations de fermeture, etc.)
- `created_at`, `updated_at`: Timestamps de création/modification

**Indices:**
- `idx_cashier_accounts_user_id`: Pour recherche rapide par utilisateur
- `idx_cashier_accounts_status`: Pour filtrer par statut

#### `account_transactions`
Enregistre toutes les transactions du compte:
- `transaction_id` (PK): ID unique de la transaction
- `account_id` (FK): Compte concerné
- `user_id` (FK): Utilisateur qui a effectué l'action
- `transaction_type`: Type de transaction (enum)
- `amount`: Montant de la transaction
- `previous_balance`: Solde avant la transaction
- `new_balance`: Solde après la transaction
- `reference`: Référence externe (Receipt #, Payment ID, etc.)
- `description`: Description détaillée
- `created_at`: Timestamp

**Types de transactions disponibles:**
- `opening`: Ouverture de caisse (montant initial)
- `deposit`: Dépôt d'argent
- `withdrawal`: Retrait d'argent
- `cash-in`: Rentrée d'argent (paiements reçus)
- `cash-out`: Sortie d'argent (remboursement, etc.)
- `payout`: Décaissement de gains au joueur
- `pay-receipt`: Paiement d'un reçu gagnant
- `closing`: Fermeture de caisse (solde final)

**Indices:**
- `idx_account_transactions_account_id`: Pour chercher transactions d'un compte
- `idx_account_transactions_user_id`: Pour tracer les actions d'un utilisateur
- `idx_account_transactions_type`: Pour filtrer par type
- `idx_account_transactions_created_at`: Pour ordre chronologique

## API Routes

### Routes publiques (réservées aux caissiers connectés)

#### GET `/api/v1/accounts/me`
Récupère les détails du compte du caissier connecté.

**Réponse:**
```json
{
  "success": true,
  "account": {
    "accountId": 1,
    "userId": 2,
    "currentBalance": 5000.00,
    "openingBalance": 2000.00,
    "openingTime": "2025-01-15T08:00:00Z",
    "closingTime": null,
    "status": "open",
    "notes": null,
    "createdAt": "2025-01-10T10:30:00Z",
    "updatedAt": "2025-01-15T08:00:00Z"
  }
}
```

#### POST `/api/v1/accounts/me/open`
Ouvre le compte du caissier avec un montant d'ouverture.

**Body:**
```json
{
  "openingBalance": 2000.00
}
```

**Réponse:** Compte ouvert avec status='open'

#### POST `/api/v1/accounts/me/close`
Ferme le compte du caissier.

**Body:**
```json
{
  "closingNotes": "Solde fermé sans problème"
}
```

**Réponse:** Compte fermé avec status='closed'

#### GET `/api/v1/accounts/me/balance`
Récupère rapidement le solde actuel.

**Réponse:**
```json
{
  "success": true,
  "balance": 5000.00,
  "status": "open"
}
```

#### GET `/api/v1/accounts/me/transactions`
Récupère l'historique des transactions (paginé).

**Query params:**
- `limit`: Nombre de résultats (défaut: 50)
- `offset`: Position de départ (défaut: 0)

**Réponse:**
```json
{
  "success": true,
  "transactions": [
    {
      "transactionId": 1,
      "accountId": 1,
      "userId": 2,
      "type": "opening",
      "amount": 2000.00,
      "previousBalance": 0.00,
      "newBalance": 2000.00,
      "reference": null,
      "description": "Ouverture de caisse avec 2000 HTG",
      "createdAt": "2025-01-15T08:00:00Z"
    },
    {
      "transactionId": 2,
      "accountId": 1,
      "userId": 2,
      "type": "cash-in",
      "amount": 1500.00,
      "previousBalance": 2000.00,
      "newBalance": 3500.00,
      "reference": "Receipt #01234567",
      "description": "Paiement reçu pour ticket gagnant",
      "createdAt": "2025-01-15T08:30:00Z"
    }
  ],
  "pagination": {
    "limit": 50,
    "offset": 0,
    "total": 15
  }
}
```

#### GET `/api/v1/accounts/me/stats`
Récupère les statistiques du compte.

**Réponse:**
```json
{
  "success": true,
  "stats": {
    "totalIn": 8500.00,
    "totalOut": 6000.00,
    "transactionCount": 15,
    "currentBalance": 5000.00,
    "accountStatus": "open"
  }
}
```

#### POST `/api/v1/accounts/me/transaction`
Ajoute une transaction manuelle au compte.

**Body:**
```json
{
  "type": "deposit",
  "amount": 500.00,
  "reference": "DEP-001",
  "description": "Dépôt d'argent liquide"
}
```

#### POST `/api/v1/accounts/me/statement`
Récupère un relevé pour une période spécifique.

**Body:**
```json
{
  "fromDate": "2025-01-01",
  "toDate": "2025-01-31"
}
```

### Routes administrateur

#### GET `/api/v1/accounts/`
Récupère tous les comptes (admin seulement).

#### GET `/api/v1/accounts/:userId`
Récupère le compte d'un utilisateur spécifique (admin seulement).

## Logique métier

### Ouverture de caisse
1. Le caissier accède à l'interface de gestion de compte
2. Clique sur "Ouvrir la caisse"
3. Entre le montant d'ouverture (argent physique disponible au démarrage)
4. Le système crée une transaction "opening" et met à jour le statut à "open"

### Fermeture de caisse
1. Le caissier clique sur "Fermer la caisse"
2. Le système enregistre le solde final comme transaction "closing"
3. Met à jour le statut à "closed"
4. Enregistre optionnellement des notes (problèmes, discordances, etc.)

### Transactions courantes
- **Dépôt (deposit)**: Caissier ajoute de l'argent à la caisse
- **Retrait (withdrawal)**: Caissier retire de l'argent de la caisse
- **Cash-in (cash-in)**: Entrée d'argent (gains reçus, paiements de tickets)
- **Cash-out (cash-out)**: Sortie d'argent (remboursement joueur, perte)
- **Payout**: Décaissement d'un ticket gagnant
- **Pay-receipt**: Paiement confirmé d'un reçu gagnant

### Protection contre les soldes négatifs
- Chaque transaction "withdrawal", "cash-out", "payout" vérifie que le solde ne descendra pas en-dessous de 0
- Si insuffisance de fonds, la transaction est rejetée avec message d'erreur

### Intégration avec les paiements
- Lors d'un `/api/v1/money/payout`, si c'est un caissier authentifié, une transaction est ajoutée à son compte
- La relation entre le paiement et la transaction de compte est maintenue via le champ `reference`

### Audit et traçabilité
- Chaque transaction est enregistrée dans `account_transactions`
- Chaque action est aussi loggée dans `transaction_logs` (système global d'audit)
- Permet de tracer qui a fait quoi, quand, et comment

## Intégration UI

### Cashier Interface (`/cashier`)
Ajouter une section "Gestion de caisse" avec:
- Bouton "Ouvrir/Fermer la caisse"
- Affichage du solde actuel
- Liste des 10 dernières transactions
- Bouton "Dépôt/Retrait"
- Lien "Voir l'historique complet"

### Dashboard (`/user-dashboard`)
Ajouter un widget "Mon compte" affichant:
- Solde actuel
- Nombre de transactions aujourd'hui
- Statut (ouvert/fermé)
- Lien "Gérer mon compte"

### Page de détail (à créer)
- Historique complet avec filtres
- Export/impression de relevé
- Statistiques mensuelles/annuelles
- Notes et observations

## Sécurité

### Authentification
- Toutes les routes sont protégées par `requireAuthHTML`
- Les rôles sont vérifiés: `requireRoleHTML('cashier')` pour accès au compte

### Autorisations
- Un caissier ne peut voir/modifier que son propre compte (`user_id` du JWT)
- Les admins peuvent consulter tous les comptes
- Les modifications ne peuvent être faites que par le caissier propriétaire

### Validation
- Tous les montants sont validés (> 0)
- Les types de transactions sont limités à une enum
- Les soldes négatifs sont rejetés au niveau de la base de données et de l'application

### Audit
- Chaque transaction enregistre le `user_id` de qui l'a effectuée
- Les timestamps sont immutables (saisis au moment de l'insertion)
- Les modifications de solde sont traçables (previous_balance → new_balance)

## Exemple de flux complet

```
1. Caissier arrive au travail
   POST /api/v1/accounts/me/open
   {openingBalance: 5000}
   → Transaction 'opening' créée
   → Compte status = 'open'
   → Balance = 5000

2. Premier paiement reçu: 1500 HTG
   POST /api/v1/accounts/me/transaction
   {type: 'cash-in', amount: 1500, reference: 'Receipt #001'}
   → Transaction 'cash-in' créée
   → Balance = 6500

3. Client demande un retrait: 200 HTG
   POST /api/v1/accounts/me/transaction
   {type: 'withdrawal', amount: 200, description: 'Retrait client'}
   → Transaction 'withdrawal' créée
   → Balance = 6300

4. Décaissement d'un payout: 800 HTG
   POST /api/v1/money/payout
   {amount: 800, receiptId: '001'}
   → Transaction 'payout' créée dans account
   → Balance = 5500

5. Fin de journée: fermeture
   POST /api/v1/accounts/me/close
   {closingNotes: 'Compte équilibré'}
   → Transaction 'closing' créée
   → Account status = 'closed'
   → Balance = 5500 (final)

6. Vérification
   GET /api/v1/accounts/me/statement?fromDate=...&toDate=...
   → Relevé complet de la journée
```

## Migration depuis le système ancien

Si un système antérieur existait:
1. Exécuter la migration SQL pour créer les tables
2. Créer des comptes de caisse par défaut pour chaque caissier
3. Optionnellement, importer l'historique ancien dans `account_transactions`
4. Tester les routes API avec des données de test
5. Valider l'affichage dans l'UI

## Déploiement

### Démarrage
- Les tables sont créées automatiquement par `initializeDatabase()` dans `db.js`
- Les comptes sont créés automatiquement pour chaque utilisateur avec rôle='cashier'
- Aucune action manuelle requise

### Production
- Utiliser des migrations SQL appropriées au lieu de DROP/CREATE
- Activer les sauvegardes régulières des données de transaction
- Monitorer les comptes fermés sans relevé

## Test

### Tests recommandés
```bash
# 1. Ouvrir un compte
curl -X POST http://localhost:8080/api/v1/accounts/me/open \
  -H "Cookie: authSession=YOUR_JWT" \
  -H "Content-Type: application/json" \
  -d '{"openingBalance": 5000}'

# 2. Vérifier le solde
curl -X GET http://localhost:8080/api/v1/accounts/me/balance \
  -H "Cookie: authSession=YOUR_JWT"

# 3. Ajouter une transaction
curl -X POST http://localhost:8080/api/v1/accounts/me/transaction \
  -H "Cookie: authSession=YOUR_JWT" \
  -H "Content-Type: application/json" \
  -d '{"type": "deposit", "amount": 1000}'

# 4. Voir les transactions
curl -X GET http://localhost:8080/api/v1/accounts/me/transactions \
  -H "Cookie: authSession=YOUR_JWT"

# 5. Fermer le compte
curl -X POST http://localhost:8080/api/v1/accounts/me/close \
  -H "Cookie: authSession=YOUR_JWT" \
  -H "Content-Type: application/json" \
  -d '{"closingNotes": "Tout bon"}'
```

## Prochaines étapes

- [ ] Créer l'interface UI pour gérer les comptes (voir Intégration UI)
- [ ] Ajouter les filtres par type de transaction
- [ ] Implémenter l'export PDF/Excel des relevés
- [ ] Ajouter des alertes pour soldes critiques
- [ ] Créer un dashboard admin pour voir tous les comptes
- [ ] Implémenter la réconciliation automatique
- [ ] Ajouter des statistiques mensuelles/annuelles
