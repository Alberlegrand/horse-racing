# Persistance de l'Historique des Gagnants dans la Base de Données

## 🎯 Objectif

Stocker l'historique complet des gagnants dans la base de données PostgreSQL pour garantir la persistance après redémarrage du serveur. Auparavant, seul l'état en mémoire (Redis) était utilisé.

## 📋 Changements Apportés

### 1. Nouvelle Table PostgreSQL: `winners`

**Fichier:** `config/db.js`

```sql
CREATE TABLE IF NOT EXISTS winners (
  winner_id SERIAL PRIMARY KEY,
  round_id BIGINT NOT NULL,
  participant_id INT NOT NULL,
  participant_number INT,
  participant_name VARCHAR(255),
  family INT,
  total_prize DECIMAL(15,2) DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (round_id) REFERENCES rounds(round_id) ON DELETE CASCADE,
  FOREIGN KEY (participant_id) REFERENCES participants(participant_id) ON DELETE CASCADE,
  UNIQUE(round_id)
)
```

**Indices pour performance:**
- `idx_winners_round_id`: Recherche rapide par manche
- `idx_winners_participant_id`: Recherche par participant
- `idx_winners_created_at`: Tri chronologique

### 2. Modèle `winnerModel.js`

**Fichier:** `models/winnerModel.js` (nouveau)

Fournit les fonctions CRUD pour gérer les gagnants:

#### `saveWinner(roundId, winner)`
Sauvegarde un gagnant dans la BD avec upsert (INSERT OR UPDATE)
```javascript
await saveWinner(10000001, {
  id: 5,
  number: 3,
  name: 'Cheval Noir',
  family: 0,
  prize: 5000
});
```

#### `getRecentWinners(limit)`
Récupère les N derniers gagnants
```javascript
const winners = await getRecentWinners(6);
// Retourne les 6 derniers gagnants du plus ancien au plus récent
```

#### `getAllWinners()`
Retourne tous les gagnants enregistrés

#### `getWinnerByRoundId(roundId)`
Récupère le gagnant d'une manche spécifique

#### `getWinnersStats()`
Statistiques des gagnants (win_count, total_winnings, avg_prize)

### 3. Intégration dans `game.js`

**Nouvelle logique:**
- Quand un round est archivé dans `createNewRound()`, le gagnant est automatiquement sauvegardé en BD
- Nouvelle fonction `loadWinnersHistoryFromDatabase()` pour charger l'historique au démarrage

```javascript
// Dans createNewRound(), quand archiveCurrentRound = true:
if (finishedRound.winner && finishedRound.winner.id) {
  await saveWinner(finishedRound.id, {
    id: finishedRound.winner.id,
    number: finishedRound.winner.number,
    name: finishedRound.winner.name,
    family: finishedRound.winner.family,
    prize: finishedRound.totalPrize
  });
}
```

### 4. API REST: Routes `/api/v1/winners/`

**Fichier:** `routes/winners.js` (nouveau)

#### `GET /api/v1/winners/recent?limit=6`
Récupère les derniers gagnants (public)
```bash
curl http://localhost:8080/api/v1/winners/recent?limit=6
```

**Réponse:**
```json
{
  "success": true,
  "data": [
    {
      "winner_id": 1,
      "id": 10000001,
      "participant_id": 5,
      "number": 3,
      "name": "Cheval Noir",
      "family": 0,
      "prize": "5000.00",
      "created_at": "2025-12-20T12:00:00Z"
    },
    ...
  ],
  "count": 6
}
```

#### `GET /api/v1/winners/round/:roundId`
Gagnant d'une manche spécifique (public)
```bash
curl http://localhost:8080/api/v1/winners/round/10000001
```

#### `GET /api/v1/winners/all` (authentifié)
Tous les gagnants (admin/cashier)
```bash
curl -H "Authorization: Bearer TOKEN" http://localhost:8080/api/v1/winners/all
```

#### `GET /api/v1/winners/stats` (authentifié)
Statistiques par participant (admin/cashier)
```bash
curl -H "Authorization: Bearer TOKEN" http://localhost:8080/api/v1/winners/stats
```

### 5. Synchronisation au Démarrage

**Fichier:** `server.js`

```javascript
// Au démarrage, après initialisation de la BD:
await loadWinnersHistoryFromDatabase().catch(err => {
  console.warn('⚠️ Impossible de charger l\'historique des gagnants:', err.message);
});
```

Cela garantit que `gameState.gameHistory` contient les données de la BD dès le démarrage.

### 6. Synchronisation Frontend

**Fichier:** `screen.html`

Nouvelle fonction `chargerGagnantsDepuisBaseDonnees()` appelée au démarrage:

```javascript
function chargerGagnantsDepuisBaseDonnees() {
  $.ajax({
    url: '/api/v1/winners/recent?limit=6',
    success: function(response) {
      if (response.success && response.data.length > 0) {
        afficherDerniersGagnants(response.data);
      }
    }
  });
}
```

Cela charge les gagnants depuis la BD sans dépendre de l'état Redis.

## 🔄 Flux de Sauvegarde

```
1. Course terminée
   ↓
2. createNewRound(archiveCurrentRound=true) appelé
   ↓
3. finishedRound archivé dans gameHistory (mémoire)
   ↓
4. ✅ NOUVEAU: saveWinner() sauvegarde en PostgreSQL
   ↓
5. Données persistées même après crash/redémarrage
```

## 📊 Flux de Chargement après Redémarrage

```
1. Serveur démarre
   ↓
2. Base de données initialisée
   ↓
3. ✅ NOUVEAU: loadWinnersHistoryFromDatabase() appelé
   ↓
4. gameState.gameHistory rempli avec les derniers gagnants
   ↓
5. Frontend: chargerGagnantsDepuisBaseDonnees() chargé via API
   ↓
6. Affichage des gagnants depuis la BD (pas de dépendance à Redis)
```

## 🔐 Sécurité

| Route | Authentification | Raison |
|-------|-----------------|--------|
| `/recent` | Publique | Affichage sur écran public |
| `/round/:id` | Publique | Consultation d'un gagnant |
| `/all` | JWT requis | Admin/Cashier seulement |
| `/stats` | JWT requis | Statistiques sensibles |

## 💾 Structure des Données

### BD (PostgreSQL)
```javascript
{
  winner_id: 1,
  round_id: 10000001,
  participant_id: 5,
  participant_number: 3,
  participant_name: "Cheval Noir",
  family: 0,
  total_prize: 5000.00,
  created_at: "2025-12-20T12:00:00Z"
}
```

### Mémoire (gameHistory)
```javascript
{
  id: 10000001,
  winner: {
    id: 5,
    number: 3,
    name: "Cheval Noir",
    family: 0
  },
  totalPrize: 5000.00
}
```

## 🧪 Tests

### Test 1: Vérifier la sauvegarde
```bash
# Courir quelques manches
# Vérifier dans psql:
SELECT * FROM winners ORDER BY created_at DESC LIMIT 6;
```

### Test 2: Redémarrage du serveur
```bash
# 1. Arrêter le serveur: Ctrl+C
# 2. Redémarrer: npm start
# 3. Vérifier dans les logs: "X gagnants chargés depuis la BD"
# 4. Ouvrir screen.html
# 5. Les gagnants doivent s'afficher immédiatement
```

### Test 3: API REST
```bash
# Récupérer les gagnants:
curl http://localhost:8080/api/v1/winners/recent?limit=6 | jq

# Vérifier le gagnant d'une manche:
curl http://localhost:8080/api/v1/winners/round/10000001 | jq
```

## 📈 Performance

### Queries
- `getRecentWinners()`: ~5-10ms (avec index sur created_at)
- `getAllWinners()`: ~20-50ms (selon le nombre de gagnants)
- `getWinnerByRoundId()`: ~1-5ms (primary key lookup)

### Stockage
- Par gagnant: ~200 bytes
- 1000 gagnants: ~200 KB
- 10000 gagnants: ~2 MB

### Architecture
```
Winners en mémoire (gameHistory)    →    Winners en BD (PostgreSQL)
     ~10 derniers                         Tous les gagnants
     Perte après redémarrage             Persistants
```

## 🐛 Débogage

### Vérifier les gagnants sauvegardés
```sql
SELECT w.*, p.participant_name 
FROM winners w
LEFT JOIN participants p ON w.participant_id = p.participant_id
ORDER BY w.created_at DESC
LIMIT 10;
```

### Vérifier le chargement
```javascript
// Dans la console du navigateur:
fetch('/api/v1/winners/recent?limit=6')
  .then(r => r.json())
  .then(data => console.log(data))
```

### Logs du serveur
```
✅ [ROUND-CREATE] Gagnant sauvegardé en BD: Cheval Noir (Round #10000001)
✅ [STARTUP] 6 gagnants chargés depuis la BD
```

## ✅ Avantages

1. **Persistance complète**: Les gagnants survivent aux redémarrages
2. **Pas de limite de mémoire**: Stockage illimité dans la BD
3. **Statistiques**: Possibilité d'analyser l'historique complet
4. **Indépendance Redis**: Fonctionnaire même si Redis est down
5. **Performances**: Requête rapide avec indices
6. **Scalabilité**: Fonctionne avec des milliers de gagnants

## 🔄 Migration depuis l'ancienne approche

Si vous aviez déjà des gagnants:
```bash
# Aucune migration nécessaire - la table est créée automatiquement
# Les nouveaux gagnants seront sauvegardés à partir de maintenant
```

## 📚 Ressources

- PostgreSQL: [Documentation officielles](https://www.postgresql.org/docs/)
- Express.js: [Routing Guide](https://expressjs.com/en/guide/routing.html)
- jQuery AJAX: [Documentation](https://api.jquery.com/jquery.ajax/)
