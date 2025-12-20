# Health Check Endpoint

## Endpoint: `GET /api/v1/health`

### Description
Permet de vérifier la santé du serveur et de tous ses services.

### Avantages
- ✅ **Pas d'authentification requise** - Accessible publiquement pour les monitoring tools
- ✅ **Détection des problèmes** - Vérifie la DB, WebSocket, Redis
- ✅ **Info en temps réel** - État du jeu, prochain round, receipts
- ✅ **Uptime tracking** - Temps depuis le démarrage du serveur
- ✅ **Dégradation gracieuse** - Retourne "degraded" si certains services échouent

### Réponse Succès (HTTP 200)

```json
{
  "status": "healthy",
  "timestamp": 1734687542831,
  "uptime": 3600.5,
  "services": {
    "database": "healthy",
    "websocket": "healthy",
    "redis": "healthy"
  },
  "game": {
    "isRaceRunning": false,
    "currentRoundId": 10000005,
    "totalReceipts": 42,
    "nextRoundStartTime": 1734687645000,
    "timeUntilNextRound": 102169
  },
  "version": "1.0.0"
}
```

### Réponse Dégradée (HTTP 200 avec status="degraded")

Si la base de données est down mais le serveur continue:

```json
{
  "status": "degraded",
  "timestamp": 1734687542831,
  "uptime": 3600.5,
  "services": {
    "database": "unhealthy",
    "websocket": "healthy",
    "redis": "healthy"
  },
  ...
}
```

### Réponse Erreur (HTTP 503)

```json
{
  "status": "unhealthy",
  "error": "Unexpected error during health check",
  "timestamp": 1734687542831
}
```

## Utilisation

### cURL
```bash
curl http://localhost:8080/api/v1/health
```

### JavaScript
```javascript
fetch('/api/v1/health')
  .then(res => res.json())
  .then(data => console.log('Server health:', data.status))
  .catch(err => console.error('Server down:', err));
```

### Monitor (polling toutes les 30 secondes)
```javascript
setInterval(async () => {
  try {
    const res = await fetch('/api/v1/health');
    const health = await res.json();
    
    if (health.status === 'healthy') {
      console.log('✅ Server is healthy');
    } else if (health.status === 'degraded') {
      console.warn('⚠️ Server degraded:', health.services);
    } else {
      console.error('❌ Server unhealthy');
    }
  } catch (err) {
    console.error('❌ Cannot reach server');
  }
}, 30000);
```

## Champs Retournés

| Champ | Type | Description |
|-------|------|-------------|
| `status` | string | "healthy", "degraded" ou "unhealthy" |
| `timestamp` | number | Timestamp Unix (ms) de la vérification |
| `uptime` | number | Temps depuis le démarrage du serveur (secondes) |
| `services.database` | string | État de PostgreSQL |
| `services.websocket` | string | État du serveur WebSocket |
| `services.redis` | string | État de Redis (optionnel) |
| `game.isRaceRunning` | boolean | Une course est-elle en cours? |
| `game.currentRoundId` | number | ID du round actuel |
| `game.totalReceipts` | number | Nombre de tickets du round actuel |
| `game.nextRoundStartTime` | number | Timestamp du prochain round |
| `game.timeUntilNextRound` | number | Temps avant le prochain round (ms) |
| `version` | string | Version de l'API |

## Cas d'Usage

1. **Monitoring externe** - Prometheus, Datadog, Uptimerobot
2. **Load balancer** - Vérifier avant de router les requêtes
3. **Client-side** - Afficher l'état du serveur aux utilisateurs
4. **CI/CD** - Vérifier la santé après déploiement
5. **Alertes** - Notifier l'équipe si le serveur est down

## Implémentation

L'endpoint vérifie:
- ✅ Connexion PostgreSQL (query simple: `SELECT NOW()`)
- ✅ Serveur WebSocket (vérification de `wss` object)
- ✅ Connexion Redis (ping optionnel)
- ✅ État du jeu (round, receipts, timers)
