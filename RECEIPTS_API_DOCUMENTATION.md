# Documentation des Routes et Récupération des Receipts (Tickets)

## Vue d'ensemble

Ce document décrit l'architecture complète de la gestion des receipts (tickets) dans l'application de courses de chevaux. Les receipts sont stockés dans trois sources principales :
- **gameState** (mémoire) : État en temps réel du round actuel
- **PostgreSQL** : Persistance permanente des données
- **Redis** : Cache pour améliorer les performances

---

## Table des matières

1. [Architecture des données](#architecture-des-données)
2. [Routes API](#routes-api)
3. [Stratégies de récupération](#stratégies-de-récupération)
4. [Conversion des montants](#conversion-des-montants)
5. [Flux de données](#flux-de-données)
6. [Gestion du cache](#gestion-du-cache)

---

## Architecture des données

### Structure d'un Receipt

```javascript
{
  id: number,                    // ID unique du ticket (format: STATION_NUMBER + 6 chiffres)
  receipt_id: number,            // Alias pour id
  round_id: number,              // ID du round auquel appartient le ticket
  user_id: number,               // ID de l'utilisateur qui a créé le ticket
  total_amount: number,          // Montant total en système (×100)
  status: string,                // 'pending' | 'won' | 'lost' | 'paid' | 'cancelled'
  prize: number,                 // Gain potentiel en système (×100)
  created_at: Date,             // Date de création
  bets: [                        // Array de paris
    {
      number: number,            // Numéro du participant
      value: number,             // Montant du pari en système (×100)
      participant: {
        number: number,
        name: string,
        coeff: number           // Cote du participant
      },
      prize: number              // Gain potentiel pour ce pari
    }
  ]
}
```

### Sources de données

#### 1. gameState (Mémoire)
- **Localisation** : `gameState.currentRound.receipts`
- **Usage** : Tickets du round actuel en temps réel
- **Avantages** : Accès instantané, pas de latence DB
- **Limitations** : Perdu au redémarrage du serveur

#### 2. PostgreSQL
- **Tables** : `receipts`, `bets`
- **Usage** : Persistance permanente, historique
- **Avantages** : Données persistantes, requêtes complexes
- **Limitations** : Latence réseau, charge DB

#### 3. Redis
- **Clés** : `round:{roundId}:data`
- **Usage** : Cache des tickets par round
- **Avantages** : Performance, réduction charge DB
- **Limitations** : Données temporaires (TTL)

---

## Routes API

### 1. Routes Receipts (`/api/v1/receipts/`)

#### GET `/api/v1/receipts/?action=print&id={receiptId}`
**Description** : Génère le HTML d'impression d'un ticket

**Paramètres** :
- `action=print` (requis)
- `id` : ID du ticket à imprimer

**Flux de récupération** :
1. Cherche dans `gameState.currentRound.receipts`
2. Si trouvé mais sans bets → récupère depuis DB (`getBetsByReceipt`)
3. Si pas trouvé → cherche dans DB
4. Retourne le HTML formaté pour impression

**Réponse** : HTML formaté pour impression 55mm

---

#### GET `/api/v1/receipts/?action=payout&id={receiptId}`
**Description** : Génère le HTML de décaissement pour un ticket gagnant

**Paramètres** :
- `action=payout` (requis)
- `id` : ID du ticket à payer

**Flux de récupération** :
1. Cherche dans `gameState.currentRound.receipts`
2. Si pas trouvé → cherche dans DB
3. Vérifie que le ticket est gagnant (`status === 'won'`)
4. Retourne le HTML formaté pour décaissement

**Réponse** : HTML formaté pour impression décaissement

---

#### POST `/api/v1/receipts/?action=add`
**Description** : Crée un nouveau ticket

**Body** :
```json
{
  "user_id": number,
  "bets": [
    {
      "participant": {
        "number": number,
        "name": string,
        "coeff": number
      },
      "value": number  // En système (×100)
    }
  ]
}
```

**Flux de création** :
1. **Validation** :
   - Vérifie qu'un round actif existe
   - Vérifie que le round existe en DB (jusqu'à 20 tentatives)
   - Vérifie que les paris sont autorisés (pas de course en cours)
   - Valide les participants (doivent exister dans le round)
   - Valide les montants (MIN_BET_AMOUNT ≤ value ≤ MAX_BET_AMOUNT)

2. **Génération ID** :
   - Format : `STATION_NUMBER` (env) + 6 chiffres aléatoires
   - Exemple : `01034521` (station 01 + 034521)

3. **Création en mémoire** :
   - Ajoute à `gameState.currentRound.receipts`
   - Calcule `total_amount` depuis les bets
   - Calcule `prize` si la course est terminée

4. **Persistance DB** (asynchrone) :
   - Crée le receipt en DB (`createReceipt`)
   - Crée les bets en batch (`createBetsBatch`)
   - Met à jour le cache Redis (`addTicketToRoundCache`)

5. **Broadcast WebSocket** :
   - Événement `receipt_added` avec toutes les infos

**Réponse** :
```json
{
  "success": true,
  "data": {
    "id": number,
    "roundId": number,
    "total_amount": number,
    "bets": [...]
  }
}
```

---

#### POST `/api/v1/receipts/?action=delete&id={receiptId}`
**Description** : Supprime (annule) un ticket

**Paramètres** :
- `action=delete` (requis)
- `id` : ID du ticket à supprimer

**Validation** :
- Vérifie que la course n'est pas en cours
- Vérifie que le timer n'est pas proche de 0 (BETTING_LOCK_DURATION_MS)
- Vérifie que le ticket n'appartient pas à un round historique

**Flux de suppression** :
1. **Recherche** :
   - Cherche dans `gameState.currentRound.receipts`
   - Si pas trouvé → cherche dans `gameState.gameHistory`
   - Si pas trouvé → cherche dans DB

2. **Suppression en 3 étapes indépendantes** (ordre critique) :
   
   **ÉTAPE 1 : Suppression gameState** (TOUJOURS effectuée)
   - Retire de `gameState.currentRound.receipts`
   - Décrémente `totalPrize` si présent
   - ✅ Garantie : Même si Redis ou DB échoue, gameState est toujours mis à jour
   
   **ÉTAPE 2 : Suppression Redis** (TOUJOURS effectuée, indépendante de DB)
   - Appelle `deleteTicketFromRoundCache(roundId, ticketId)`
   - Retire le ticket du cache Redis
   - Met à jour les statistiques du cache
   - ✅ Garantie : Même si DB échoue, Redis est toujours mis à jour
   
   **ÉTAPE 3 : Suppression DB** (tentative avec gestion d'erreur)
   - Supprime les bets (`DELETE FROM bets WHERE receipt_id = $1`)
   - Supprime le receipt (`DELETE FROM receipts WHERE receipt_id = $1`)
   - ✅ Si échec : Les suppressions gameState et Redis sont déjà effectuées

3. **Broadcast WebSocket** :
   - Événement `receipt_deleted` avec toutes les infos

**⚠️ IMPORTANT** : Les suppressions gameState et Redis sont TOUJOURS effectuées, même si la DB échoue. Cela garantit que les tickets supprimés ne réapparaissent jamais dans les réponses API.

**Réponse** :
```json
{
  "success": true
}
```

**Note importante** : La suppression mémoire est TOUJOURS effectuée, même si la suppression DB échoue, pour éviter les incohérences.

---

### 2. Routes My-Bets (`/api/v1/my-bets/`)

#### GET `/api/v1/my-bets/`
**Description** : Récupère les tickets d'un utilisateur avec pagination et filtres

**Paramètres de requête** :
- `page` : Numéro de page (défaut: 1)
- `limit` : Nombre de résultats par page (défaut: 10)
- `date` : Filtre par date (format: YYYY-MM-DD)
- `status` : Filtre par statut ('pending' | 'won' | 'lost' | 'paid')
- `searchId` : Recherche par ID de ticket

**Authentification** :
- Requiert JWT token (`req.user.userId`)
- `user_id` extrait depuis `req.user.userId`

**Flux de récupération** :

1. **Récupération depuis DB** :
   ```sql
   SELECT r.*, COUNT(b.bet_id) as bet_count
   FROM receipts r 
   LEFT JOIN bets b ON r.receipt_id = b.receipt_id 
   WHERE r.user_id = $1
   GROUP BY r.receipt_id 
   ORDER BY r.created_at DESC
   ```
   - Récupère tous les tickets de l'utilisateur
   - Récupère les bets en batch (`getBetsByReceiptsBatch`)
   - Convertit les montants système → publique

2. **Filtrage des tickets supprimés** :
   - Pour le round actuel : exclut les tickets qui ne sont pas dans `gameState.currentRound.receipts`
   - Pour les rounds historiques : garde tous les tickets

3. **Ajout des tickets du round actuel** :
   - Récupère depuis `gameState.currentRound.receipts`
   - Filtre par `user_id`
   - Ajoute seulement ceux qui ne sont pas déjà en DB

4. **Application des filtres** :
   - Filtre par `searchId`, `status`, `date`
   - Calcule les statistiques

5. **Pagination** :
   - Découpe les résultats selon `page` et `limit`

**Réponse** :
```json
{
  "success": true,
  "data": {
    "pagination": {
      "currentPage": 1,
      "totalPages": 5,
      "totalItems": 50,
      "limit": 10,
      "displayedRange": "1-10"
    },
    "stats": {
      "totalBetAmount": 1500.00,
      "potentialWinnings": 3000.00,
      "activeTicketsCount": 3,
      "winRate": "45",
      "paidWinnings": 500.00,
      "pendingPayments": 200.00
    },
    "tickets": [...]
  }
}
```

**Cache** : 30 secondes (`cacheResponse(30)`)

---

#### GET `/api/v1/my-bets/:id`
**Description** : Récupère un ticket spécifique avec tous ses détails

**Paramètres** :
- `id` : ID du ticket

**Flux de récupération** :
1. Cherche dans `gameState.currentRound.receipts`
2. Si pas trouvé → cherche dans DB
3. Récupère les bets (`getBetsByReceipt`)
4. Formate avec conversion système → publique

**Réponse** :
```json
{
  "success": true,
  "data": {
    "id": number,
    "roundId": number,
    "totalAmount": number,  // En publique
    "status": string,
    "bets": [...]
  }
}
```

---

#### POST `/api/v1/my-bets/pay/:id`
**Description** : Marque un ticket comme payé

**Flux** :
1. Met à jour le statut en DB (`UPDATE receipts SET status = 'paid'`)
2. Met à jour dans `gameState` si présent
3. Met à jour le cache Redis
4. Broadcast WebSocket `receipt_paid`

---

### 3. Routes Init (`/api/v1/init/`)

#### GET `/api/v1/init/dashboard`
**Description** : Récupère tous les tickets du round actuel pour le dashboard (sans filtre user_id)

**Flux de récupération** :

1. **ÉTAPE 1 : Récupération depuis gameState** :
   - Lit `gameState.currentRound.receipts`
   - Formate les tickets avec conversion système → publique
   - Marque avec `_source: 'memory'`

2. **ÉTAPE 2 : Récupération depuis DB** :
   ```sql
   SELECT r.*, COUNT(b.bet_id) as bet_count
   FROM receipts r 
   LEFT JOIN bets b ON r.receipt_id = b.receipt_id 
   WHERE r.round_id = $1
   GROUP BY r.receipt_id 
   ORDER BY r.created_at DESC
   ```
   - Récupère tous les tickets du round actuel
   - Récupère les bets en batch
   - Convertit les montants système → publique
   - Marque avec `_source: 'database'`

3. **ÉTAPE 3 : Combinaison et filtrage** :
   - **CRITIQUE** : Filtre les tickets de la DB pour ne garder que ceux présents dans `gameState.currentRound.receipts`
   - Cela garantit que les tickets supprimés ne sont pas inclus
   - Combine les tickets DB + mémoire (évite les doublons)
   - Trie par date de création (plus récent en premier)

**Réponse** :
```json
{
  "success": true,
  "data": {
    "round": {
      "id": number,
      "participants": [...],
      "status": "waiting" | "running"
    },
    "tickets": [...],  // Tous les tickets du round actuel
    "timer": {
      "timeLeft": number,
      "totalDuration": number,
      "serverTime": number
    },
    "totalPrize": number,
    "cacheTimestamp": number,
    "source": "memory+db"
  }
}
```

**Cache** : 2 secondes (`Cache-Control: public, max-age=2`)

---

#### GET `/api/v1/init/game`
**Description** : Récupère l'état complet du jeu (zéro requête DB)

**Réponse** :
```json
{
  "success": true,
  "data": {
    "round": {...},
    "timer": {...},
    "tickets": gameState.currentRound.receipts,  // Directement depuis mémoire
    "isRaceRunning": boolean,
    "nextRoundStartTime": number,
    "cacheTimestamp": number,
    "source": "memory"
  }
}
```

**Cache** : 2 secondes

---

## Stratégies de récupération

### Stratégie hybride (gameState + DB)

L'application utilise une stratégie hybride pour garantir la cohérence et la performance :

1. **Tickets du round actuel** :
   - Source principale : `gameState.currentRound.receipts` (mémoire)
   - Source secondaire : DB (pour persistance après refresh)
   - **Filtrage critique** : Seuls les tickets présents dans `gameState` sont inclus dans les réponses API

2. **Tickets historiques** :
   - Source unique : DB
   - Pas de filtrage par `gameState` (rounds terminés)

### Pourquoi cette stratégie ?

- **Performance** : Accès mémoire instantané pour le round actuel
- **Persistance** : Les tickets restent visibles après refresh grâce à la DB
- **Cohérence** : Les tickets supprimés ne réapparaissent pas (filtrage par gameState)
- **Fiabilité** : Fallback DB si gameState est vide

---

## Conversion des montants

### Système vs Publique

L'application utilise deux formats de montants :

- **Système** : Valeurs en centimes (×100)
  - Exemple : `10000` = 100.00 HTG
  - Stockage : DB, gameState (parfois)
  
- **Publique** : Valeurs en unités réelles
  - Exemple : `100.00` = 100.00 HTG
  - Affichage : Interface utilisateur, API responses

### Fonction de conversion

```javascript
// utils.js
export function systemToPublic(systemValue) {
  // Conversion : système (×100) → publique
  return systemValue / 100;
}
```

### Où la conversion est appliquée

1. **API `/api/v1/init/dashboard`** :
   - Convertit `total_amount` et `prize` de système → publique
   - Convertit `bet.value` de système → publique

2. **API `/api/v1/my-bets/`** :
   - Convertit tous les montants avant de retourner la réponse

3. **Client (`app.js`)** :
   - Détecte automatiquement si une valeur est en système (> 100)
   - Convertit si nécessaire avant affichage

### Détection automatique

Le client détecte automatiquement le format :
```javascript
if (value > 100) {
  // Probablement en système, convertir
  value = systemToPublic(value);
}
```

---

## Flux de données

### Création d'un ticket

```
1. Client → POST /api/v1/receipts/?action=add
   ↓
2. Validation (round actif, participants valides, montants)
   ↓
3. Génération ID (STATION_NUMBER + 6 chiffres)
   ↓
4. Ajout à gameState.currentRound.receipts (mémoire)
   ↓
5. Broadcast WebSocket (receipt_added)
   ↓
6. Persistance DB (asynchrone)
   ├─ INSERT INTO receipts
   ├─ INSERT INTO bets (batch)
   └─ Redis cache update
   ↓
7. Réponse au client
```

### Suppression d'un ticket

```
1. Client → POST /api/v1/receipts/?action=delete&id={id}
   ↓
2. Validation (course non en cours, timer OK)
   ↓
3. Recherche (gameState → DB fallback)
   ↓
4. Suppression gameState (TOUJOURS - ÉTAPE 1)
   ├─ Retire de gameState.currentRound.receipts
   └─ Décrémente totalPrize
   ↓
5. Suppression Redis (TOUJOURS - ÉTAPE 2)
   ├─ deleteTicketFromRoundCache(roundId, ticketId)
   └─ Met à jour les stats du cache
   ↓
6. Suppression DB (tentative - ÉTAPE 3)
   ├─ DELETE FROM bets WHERE receipt_id = $1
   └─ DELETE FROM receipts WHERE receipt_id = $1
   ↓
7. Broadcast WebSocket (receipt_deleted)
   ↓
8. Réponse au client
   
⚠️ Les étapes 4 et 5 sont TOUJOURS effectuées, même si l'étape 6 échoue
```

### Récupération des tickets (Dashboard)

```
1. Client → GET /api/v1/init/dashboard
   ↓
2. Récupération gameState
   ├─ gameState.currentRound.receipts
   └─ Formatage + conversion montants
   ↓
3. Récupération DB
   ├─ SELECT FROM receipts WHERE round_id = $1
   ├─ getBetsByReceiptsBatch(receiptIds)
   └─ Formatage + conversion montants
   ↓
4. Filtrage critique
   └─ Garde seulement tickets présents dans gameState
   ↓
5. Combinaison (évite doublons)
   ↓
6. Tri par date (plus récent en premier)
   ↓
7. Réponse au client
```

### Récupération des tickets (My-Bets)

```
1. Client → GET /api/v1/my-bets/?page=1&limit=10
   ↓
2. Extraction user_id (req.user.userId)
   ↓
3. Récupération DB
   ├─ SELECT FROM receipts WHERE user_id = $1
   ├─ getBetsByReceiptsBatch(receiptIds)
   └─ Formatage + conversion montants
   ↓
4. Filtrage tickets supprimés
   └─ Pour round actuel : exclut si pas dans gameState
   ↓
5. Ajout tickets round actuel (gameState)
   └─ Filtre par user_id, évite doublons
   ↓
6. Application filtres (date, status, searchId)
   ↓
7. Calcul statistiques
   ↓
8. Pagination
   ↓
9. Réponse au client
```

---

## Gestion du cache

### Cache Redis

#### Structure de la clé
```
round:{roundId}:data
```

#### Structure des données
```javascript
{
  receipts: [
    {
      id: number,
      user_id: number,
      created_at: number,
      total_amount: number,
      bets: [...]
    }
  ],
  stats: {
    totalReceipts: number,
    totalMise: number,
    participantMise: { [number]: number }
  }
}
```

#### Fonctions de cache

1. **`addTicketToRoundCache(roundId, ticket)`**
   - Ajoute un ticket au cache du round
   - Met à jour les statistiques
   - TTL : 3600 secondes

2. **`deleteTicketFromRoundCache(roundId, ticketId)`**
   - Supprime un ticket du cache
   - Met à jour les statistiques
   - TTL : 3600 secondes

3. **`updateTicketInRoundCache(roundId, ticketId, status, prize)`**
   - Met à jour le statut et le prize d'un ticket
   - TTL : 3600 secondes

### Cache HTTP

- **`/api/v1/init/dashboard`** : 2 secondes
- **`/api/v1/my-bets/`** : 30 secondes
- **`/api/v1/init/game`** : 2 secondes

### Cache client

- **Dashboard** : Cache de 2 secondes avec TTL de 5 secondes pour le chargement initial
- **My-Bets** : Pas de cache client (données toujours fraîches)

---

## Points critiques

### 1. Exclusion des tickets supprimés

**Problème** : Les tickets supprimés peuvent réapparaître après un refresh si on ne filtre pas correctement.

**Solution** : 
- **Suppression garantie** : Les tickets sont supprimés de gameState, Redis ET DB (dans cet ordre)
- **Filtrage API** : Les API filtrent les tickets de la DB pour ne garder que ceux présents dans `gameState.currentRound.receipts`
- **Source unique de vérité** : `gameState.currentRound.receipts` est la source de vérité pour les tickets valides du round actuel

**Implémentation** :
```javascript
// Dans routes/init.js et routes/my_bets.js
const validTicketIds = new Set(
  (gameState.currentRound?.receipts || []).map(r => r.id || r.receipt_id)
);
const validTicketsFromDb = ticketsFromDb.filter(t => validTicketIds.has(t.id));
```

**Garanties** :
- ✅ Suppression gameState : TOUJOURS effectuée (même si Redis/DB échoue)
- ✅ Suppression Redis : TOUJOURS effectuée (même si DB échoue)
- ✅ Suppression DB : Tentative avec gestion d'erreur
- ✅ Filtrage API : Seuls les tickets dans gameState sont inclus dans les réponses

### 2. Conversion des montants

**Problème** : Les montants peuvent être en système ou publique selon la source.

**Solution** :
- Conversion systématique système → publique dans les API
- Détection automatique côté client si nécessaire
- Utilisation de `systemToPublic()` pour cohérence

### 3. Suppression garantie (gameState + Redis + DB)

**Problème** : Si la suppression DB échoue, le ticket peut rester dans Redis ou gameState.

**Solution** :
- **Ordre de suppression** : gameState → Redis → DB (chaque étape est indépendante)
- **Suppression gameState** : TOUJOURS effectuée (même si Redis/DB échoue)
- **Suppression Redis** : TOUJOURS effectuée (même si DB échoue)
- **Suppression DB** : Tentative avec gestion d'erreur
- **Filtrage API** : Les tickets supprimés sont exclus grâce au filtrage par gameState

**Code de suppression** :
```javascript
// ÉTAPE 1: Suppression gameState (TOUJOURS)
gameState.currentRound.receipts = gameState.currentRound.receipts.filter(r => r.id !== id);

// ÉTAPE 2: Suppression Redis (TOUJOURS, indépendant de DB)
try {
  await deleteTicketFromRoundCache(gameState.currentRound.id, id);
} catch (redisErr) {
  // Ne pas bloquer - gameState déjà supprimé
}

// ÉTAPE 3: Suppression DB (tentative)
try {
  await pool.query("DELETE FROM bets WHERE receipt_id = $1", [id]);
  await pool.query("DELETE FROM receipts WHERE receipt_id = $1", [id]);
} catch (dbErr) {
  // Ne pas bloquer - gameState et Redis déjà supprimés
}
```

**Résultat** : Les tickets supprimés ne réapparaissent jamais dans les réponses API, même en cas d'erreur DB.

---

## Modèles de données

### models/receiptModel.js

#### Fonctions principales

1. **`createReceipt({ round_id, user_id, total_amount, status, prize, receipt_id })`**
   - Crée un receipt en DB
   - Validation : `receipt_id` et `round_id` obligatoires

2. **`createBet({ receipt_id, participant_id, participant_number, participant_name, coefficient, value, status, prize })`**
   - Crée un bet en DB

3. **`createBetsBatch(bets)`**
   - Crée plusieurs bets en une seule requête (performance)

4. **`getReceiptsByUser(user_id, limit)`**
   - Récupère les tickets d'un utilisateur
   - Triés par date décroissante

5. **`getBetsByReceipt(receipt_id)`**
   - Récupère les bets d'un ticket

6. **`getBetsByReceiptsBatch(receipt_ids)`**
   - Récupère les bets de plusieurs tickets en une requête

7. **`getReceiptById(receipt_id)`**
   - Récupère un ticket par ID

8. **`updateReceiptStatus(receipt_id, status, prize)`**
   - Met à jour le statut et le prize d'un ticket

---

## WebSocket Events

### Événements émis

1. **`receipt_added`**
   ```javascript
   {
     event: "receipt_added",
     receiptId: number,
     roundId: number,
     receipt: {...},  // Ticket complet
     totalReceipts: number,
     currentRound: {...}
   }
   ```

2. **`receipt_deleted`**
   ```javascript
   {
     event: "receipt_deleted",
     receiptId: number,
     roundId: number,
     totalReceipts: number,
     currentRound: {...},
     totalPrize: number
   }
   ```

3. **`receipt_paid`**
   ```javascript
   {
     event: "receipt_paid",
     receiptId: number,
     roundId: number,
     status: "paid"
   }
   ```

### Gestion côté client

Le client écoute ces événements et met à jour l'UI en temps réel :
- `receipt_added` → Ajoute le ticket au tableau
- `receipt_deleted` → Supprime le ticket du tableau
- `receipt_paid` → Met à jour le statut du ticket

---

## Exemples d'utilisation

### Créer un ticket

```javascript
const response = await fetch('/api/v1/receipts/?action=add', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  credentials: 'include',
  body: JSON.stringify({
    user_id: 123,
    bets: [
      {
        participant: {
          number: 1,
          name: "Cheval 1",
          coeff: 2.5
        },
        value: 10000  // 100.00 HTG en système
      }
    ]
  })
});
```

### Récupérer les tickets du dashboard

```javascript
const response = await fetch('/api/v1/init/dashboard', {
  credentials: 'include'
});
const data = await response.json();
const tickets = data.data.tickets;  // Tous les tickets du round actuel
```

### Récupérer mes tickets

```javascript
const response = await fetch('/api/v1/my-bets/?page=1&limit=10', {
  credentials: 'include',
  headers: { 'Authorization': 'Bearer ' + token }
});
const data = await response.json();
const tickets = data.data.tickets;  // Mes tickets avec pagination
```

### Supprimer un ticket

```javascript
const response = await fetch('/api/v1/receipts/?action=delete&id=123456', {
  method: 'POST',
  credentials: 'include'
});
```

---

## Conclusion

Cette architecture hybride (gameState + DB + Redis) garantit :
- ✅ Performance : Accès mémoire instantané
- ✅ Persistance : Données sauvegardées en DB
- ✅ Cohérence : Exclusion des tickets supprimés
- ✅ Fiabilité : Fallback DB si gameState vide
- ✅ Scalabilité : Cache Redis pour réduire la charge DB

Les tickets sont toujours récupérés de manière cohérente, avec conversion automatique des montants et exclusion des tickets supprimés.

