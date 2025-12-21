# 🚀 KEEPALIVE PRODUCTION GUIDE
## Configuration et Troubleshooting en Production

**Date**: 20 Décembre 2025  
**Status**: Production Ready  
**Environment**: Linux/Docker (hitbet777.store)

---

## 📋 RÉSUMÉ EXÉCUTIF

Le système keepalive est maintenant **pleinement configuré pour la production** avec:

✅ Gestion robuste des reconnexions Redis  
✅ Health checks intégrés (serveur + Redis)  
✅ Fallback gracieux si Redis est offline  
✅ Monitoring automatique des anomalies  
✅ Logs structurés pour diagnostic  

---

## 🔍 PROBLÈME IDENTIFIÉ EN PRODUCTION

### Symptôme Observé
```
[keepalive] Server health: degraded { redis: 'offline', memory: 'ok' }
```

**Ce n'est PAS un problème critique.** C'est un avertissement normal quand Redis est indisponible.

### Causes Possibles
1. **Redis n'est pas démarré** - Conteneur Docker redis arrêté
2. **Réseau isolé** - Serveur Node ne peut pas atteindre Redis
3. **Redis surchargé** - Pas de réponse aux pings
4. **Configuration REDIS_URL incorrecte** - Variables d'environnement

---

## ✅ SOLUTION: Vérifier et Corriger Redis

### Étape 1: Vérifier l'état de Redis

```bash
# Vérifier si le conteneur Redis est en cours d'exécution
docker ps | grep redis

# Ou avec compose
docker-compose ps redis

# Vérifier les logs Redis
docker logs redis  # ou docker-compose logs redis
```

**Sortie attendue**:
```
Ready to accept connections
```

### Étape 2: Vérifier la connectivité Redis

```bash
# Entrer dans le conteneur Node
docker exec -it <node-container> bash

# Tester la connexion Redis
redis-cli -h <redis-host> -p 6379 ping

# Ou depuis le conteneur Node directement
node -e "
const redis = require('redis');
const client = redis.createClient({ url: process.env.REDIS_URL });
client.connect().then(() => {
  client.ping().then(pong => {
    console.log('✅ Redis response:', pong);
    process.exit(0);
  });
}).catch(err => {
  console.error('❌ Error:', err.message);
  process.exit(1);
});
"
```

### Étape 3: Vérifier les variables d'environnement

```bash
# Dans le conteneur Node
echo $REDIS_URL
echo $NODE_ENV

# Devrait afficher:
# REDIS_URL=redis://redis:6379  (ou votre URL)
# NODE_ENV=production
```

### Étape 4: Redémarrer Redis si nécessaire

```bash
# Redémarrer avec docker-compose
docker-compose restart redis

# Ou avec docker
docker restart <redis-container>

# Attendre 3 secondes
sleep 3

# Vérifier les logs
docker logs redis --tail=20
```

### Étape 5: Redémarrer Node.js après Redis

```bash
# Redémarrer le serveur Node
docker-compose restart app

# Ou avec docker
docker restart <node-container>

# Vérifier les logs
docker logs app --tail=20

# Vous devriez voir:
# ✅ [REDIS] Connecté avec succès
```

---

## 📊 VÉRIFIER QUE KEEPALIVE FONCTIONNE

### Dans le Browser Console

```javascript
// Ouvrir DevTools (F12) → Console

// Tester une requête keepalive
fetch('/api/v1/keepalive/')
  .then(r => r.json())
  .then(data => {
    console.log('Status:', data.serverHealth.status);
    console.log('Redis:', data.serverHealth.checks.redis);
    console.log('Memory:', data.serverHealth.checks.memory);
  })
  .catch(e => console.error('Error:', e));

// Résultat attendu:
// Status: healthy
// Redis: ok
// Memory: ok
```

### Dans Network Tab

1. Ouvrir DevTools → Network
2. Filtrer: `keepalive`
3. Attendre 30 secondes
4. Vérifier que des requêtes GET `/api/v1/keepalive/` arrivent régulièrement
5. Toutes doivent retourner **200 OK**

**Ne JAMAIS voir**:
- ❌ 404 Not Found
- ❌ 500 Server Error
- ❌ Timeout

---

## 🔧 CONFIGURATION EN PRODUCTION

### Environment Variables à Configurer

```bash
# .env ou docker-compose.yml

# URL Redis (remplacer par votre configuration)
REDIS_URL=redis://redis:6379

# Environnement
NODE_ENV=production

# (Optionnel) Port serveur
PORT=8080
```

### Configuration du Keepalive pour Production

**Fichier**: `config/keepalive.config.js`

```javascript
production: {
  tick: 30000,        // 30 secondes - NE PAS réduire < 25s
  timeout: 8000,      // 8 secondes - Tolérant pour réseau instable
  maxRetries: 3,
  healthCheckFrequency: 2  // Vérifier tous les 60s
}
```

**Pourquoi 30 secondes?**
- ✅ Réduit la charge serveur
- ✅ Maintient les sessions actives (timeout typique 5-10 min)
- ✅ Détecte les déconnexions en < 1 minute
- ✅ Standard de l'industrie

### Health Check Thresholds

```javascript
// Mémoire
warningThreshold: 80    // Alert si > 80% utilisée
criticalThreshold: 90   // Critical si > 90% utilisée

// Si critique: Le serveur reportera status='critical'
// Le serveur continuera à fonctionner (pas de shutdown automatique)
```

---

## 📈 MONITORING EN PRODUCTION

### Logs à Surveiller

```bash
# Regarder les logs en temps réel
docker logs -f app

# Chercher les patterns
docker logs app | grep -E "keepalive|REDIS|health"

# Erreurs
docker logs app | grep -E "ERROR|error|Error"
```

**Logs Normaux** ✅:
```
[REDIS] Connecté avec succès
✅ [REDIS] Prêt et fonctionnel
✅ Server health: healthy
```

**Logs d'Avertissement** 🟡:
```
⚠️ [REDIS] Erreur de connexion: Connection refused
⚠️ [REDIS] Mode dégradé activé - serveur fonctionne sans cache
🟡 Server health: degraded (redis offline, memory ok)
```

**Logs Critiques** 🔴:
```
🔴 Server health: CRITICAL
🔴 Mémoire critique: 92.5%
```

### Créer des Alertes

```bash
# Exemple: Alert si Redis offline pendant 5 minutes
# Ajouter au script de monitoring/alerting

docker logs app --since 5m | grep -q "redis.*offline" && \
  send_alert "ALERTE: Redis offline depuis 5 minutes"
```

---

## 🐛 TROUBLESHOOTING

### Problème 1: Status = "degraded" (Redis offline)

**Symptôme**:
```
[keepalive] Server health: degraded { redis: 'offline', memory: 'ok' }
```

**Solution**:
1. Vérifier que Redis est démarré: `docker ps | grep redis`
2. Vérifier la connectivité: `redis-cli ping`
3. Vérifier REDIS_URL: `echo $REDIS_URL`
4. Redémarrer Redis: `docker-compose restart redis`

**Est-ce que c'est grave?**
- ❌ Non, le serveur fonctionne normalement sans Redis
- ⚠️ Oui, le cache est désactivé (plus lent)
- ✅ Les sessions continuent à marcher avec MemoryStore

### Problème 2: Status = "critical" (Mémoire)

**Symptôme**:
```
🔴 Server health: CRITICAL
🔴 Mémoire critique: 92.5%
```

**Solution**:
1. Redémarrer le conteneur: `docker-compose restart app`
2. Augmenter la limite mémoire en Docker
3. Optimiser les queries qui chargent trop de données

```yaml
# docker-compose.yml
services:
  app:
    mem_limit: 1g  # Augmenter de 512m à 1g par exemple
```

### Problème 3: Keepalive Returns 404

**Symptôme** (DevTools Network):
```
GET /api/v1/keepalive/ 404 Not Found
```

**Solution** (Déjà appliquée):
✅ `webclient.js` ligne 93: Utilise `?` au lieu de `&`
✅ `screen.html` ligne 547: Inclut le `/` final

Si le problème persiste:
1. Vider le cache du navigateur: `Ctrl+Shift+Delete`
2. Redémarrer le serveur: `docker-compose restart app`
3. Vérifier les routes: `curl -I http://localhost:8080/api/v1/keepalive/`

### Problème 4: Timeouts Fréquents

**Symptôme**:
```
Keepalive timeout après 8s de attente
```

**Causes**:
- Serveur surchargé
- Problèmes réseau
- Redis en lock

**Solution**:
1. Augmenter le timeout: `timeout: 10000` dans `keepalive.config.js`
2. Réduire la fréquence: `tick: 45000` (45s au lieu de 30s)
3. Vérifier CPU/Mémoire: `docker stats`

---

## 🎯 CHECKLIST DE PRODUCTION

### Avant le Déploiement

- [ ] Redis est configuré et testé
- [ ] REDIS_URL est correctement définie
- [ ] NODE_ENV=production
- [ ] Keepalive tick = 30000ms (30s)
- [ ] Tous les logs sont en place
- [ ] Monitoring/alerting est configuré

### Après le Déploiement

- [ ] Requêtes keepalive reçoivent 200 OK
- [ ] Status = "healthy" (ou "degraded" si Redis intentionnellement offline)
- [ ] Pas de timeouts dans les logs
- [ ] Mémoire < 80%
- [ ] Sessions persistes > 5 minutes (vérifier avec MemoryStore si Redis down)

### Monitoring Continu

- [ ] Vérifier les logs chaque jour: `docker logs app | tail -100`
- [ ] Monitorer Redis health: `redis-cli ping`
- [ ] Vérifier la mémoire: `docker stats`
- [ ] Tester keepalive: `curl http://localhost:8080/api/v1/keepalive/`

---

## 📞 SUPPORT RAPIDE

### Commandes Rapides

```bash
# Vérifier que tout est OK
curl -s http://hitbet777.store/api/v1/keepalive/ | jq '.serverHealth'

# Restart complet
docker-compose down && docker-compose up -d

# Voir les stats
docker stats

# Logs détaillés
docker logs app -f --tail=50
```

### Questions Fréquentes

**Q: Le keepalive toutes les 30s, c'est normal?**  
A: ✅ Oui, c'est optimal pour la production.

**Q: Pourquoi Redis est offline?**  
A: Probablement pas démarré. Vérifier: `docker ps`

**Q: Peux-je augmenter la fréquence du keepalive?**  
A: ❌ Non, 30s est optimal. Plus fréquent = plus de charge.

**Q: Que se passe-t-il si Redis est offline?**  
A: ✅ Le serveur fonctionne normalement, juste sans cache.

**Q: Les sessions expirent-elles sans Redis?**  
A: ✅ Elles utilisent MemoryStore (redémarrage = perte).

---

## 📝 LOG EXAMPLES

### ✅ Cas Normal

```
════════════════════════════════════════════════════════
📡 KEEPALIVE CONFIGURATION [PRODUCTION]
════════════════════════════════════════════════════════
✅ Intervalle: 30000ms (30.0s)
✅ Timeout: 8000ms
✅ Max retries: 3
✅ Health check chaque: 2 ticks (60.0s)
✅ Logs verbeux: NON
════════════════════════════════════════════════════════

✅ [REDIS] Connecté avec succès
✅ [REDIS] Prêt et fonctionnel
✅ Server health: healthy
```

### 🟡 Cas Dégradé (Redis Offline)

```
⚠️ [REDIS] Erreur de connexion: Connection refused
⚠️ [REDIS] Mode dégradé activé - serveur fonctionne sans cache
🟡 Server health: degraded (redis offline, memory ok)

💡 RESOLUTION: Redémarrer Redis
docker-compose restart redis
```

### 🔴 Cas Critique

```
🔴 Server health: CRITICAL
🔴 Mémoire critique: 92.5%

💡 RESOLUTION: Redémarrer le serveur
docker-compose restart app
```

---

## 🎊 CONCLUSION

✅ **Keepalive est maintenant robuste en production**

- Gère gracieusement Redis offline
- Health checks détaillés
- Monitoring automatique
- Fallback intégré
- Prêt pour la haute disponibilité

**Prochaine étape:** Monitorer pendant 48h après déploiement.

---

**Questions?** Consulter les logs: `docker logs app | grep -i keepalive`
