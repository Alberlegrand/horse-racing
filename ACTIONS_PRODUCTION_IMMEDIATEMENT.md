# 🔧 ACTIONS CONCRÈTES PRODUCTION
## Pour hitbet777.store - 20 Décembre 2025

---

## 🎯 OBJECTIF

**Problème observé en production:**
```
[keepalive] Server health: degraded { redis: 'offline', memory: 'ok' }
```

**Objectif:** Rendre le keepalive robuste et le serveur résilient.

**Solution:** Redéployer avec Keepalive v2.0 (improvements complètes).

---

## ✅ ACTIONS À FAIRE

### Action 1: Vérifier Redis (URGENT)
**Durée:** 5 minutes

```bash
# Sur le serveur hitbet777.store

# 1. Vérifier que Redis est lancé
docker ps | grep redis

# 2. Vérifier la réponse de Redis
redis-cli ping
# Résultat attendu: PONG

# 3. Si pas réponse, redémarrer Redis
docker-compose restart redis
sleep 3

# 4. Vérifier à nouveau
redis-cli ping
```

**Résultat attendu:**
```
PONG
```

**Si erreur connection refused:**
```bash
# Redis n'est pas lancé
# Redémarrer tout le stack
docker-compose down
docker-compose up -d
sleep 5
redis-cli ping
```

---

### Action 2: Déployer Keepalive v2.0
**Durée:** 10 minutes

```bash
# Sur le serveur hitbet777.store

# 1. Pull le code mis à jour
cd /home/docker/horse-racing
git pull origin main

# 2. Vérifier les changements
git log --oneline -10
git show HEAD:routes/keepalive.js | head -20

# 3. Redémarrer le serveur Node
docker-compose restart app
sleep 5

# 4. Vérifier que le serveur a démarré
docker logs app | grep -E "KEEPALIVE|REDIS" | tail -20
```

**Résultat attendu:**
```
════════════════════════════════════════════════════════
📡 KEEPALIVE CONFIGURATION [PRODUCTION]
════════════════════════════════════════════════════════
✅ Intervalle: 30000ms (30.0s)
✅ Timeout: 8000ms
✅ Max retries: 3

✅ [REDIS] Connecté avec succès
✅ [REDIS] Prêt et fonctionnel
```

---

### Action 3: Tester le Keepalive
**Durée:** 5 minutes

```bash
# Sur le serveur hitbet777.store

# 1. Test simple (HTTP)
curl -s https://hitbet777.store/api/v1/keepalive/ | jq '.serverHealth'

# 2. Vérifier la réponse
# Résultat attendu:
{
  "status": "healthy",
  "checks": {
    "redis": "ok",
    "memory": "ok"
  }
}

# 3. Vérifier les logs de keepalive
docker logs app | grep -i "keepalive" | tail -10

# 4. Vérifier qu'il n'y a pas d'erreurs
docker logs app | grep -i "error" | head -20
```

**Résultats attendus:**
- ✅ HTTP 200 OK
- ✅ status = "healthy" ou "degraded" (OK si Redis offline temporairement)
- ✅ Pas d'erreurs dans les logs

---

### Action 4: Vérifier les Clients
**Durée:** 5 minutes

```bash
# Sur un client (navigateur ou via curl depuis autre machine)

# 1. Ouvrir DevTools (F12) → Console

# 2. Coller ce code
fetch('https://hitbet777.store/api/v1/keepalive/')
  .then(r => r.json())
  .then(data => {
    console.log('✅ Keepalive fonctionne');
    console.log('Status:', data.serverHealth.status);
    console.log('Redis:', data.serverHealth.checks.redis);
    console.log('Memory:', data.serverHealth.checks.memory);
  })
  .catch(e => console.error('❌ Erreur:', e))

# 3. Vérifier Network tab
# - Filtre: keepalive
# - Toutes les requêtes doivent être 200 OK
# - Aucune 404 ou 500
```

**Résultats attendus:**
```
✅ Keepalive fonctionne
Status: healthy
Redis: ok
Memory: ok
```

---

### Action 5: Monitoring Actif
**Durée:** Continu (1 minute par jour)

```bash
# Sur le serveur hitbet777.store

# 1. Setup un monitoring script (cron job)
cat > /home/docker/monitor-keepalive.sh << 'EOF'
#!/bin/bash
# Monitor keepalive toutes les heures

STATUS=$(curl -s https://hitbet777.store/api/v1/keepalive/ | jq -r '.serverHealth.status')
REDIS=$(curl -s https://hitbet777.store/api/v1/keepalive/ | jq -r '.serverHealth.checks.redis')
MEMORY=$(curl -s https://hitbet777.store/api/v1/keepalive/ | jq -r '.serverHealth.checks.memory')

echo "[$(date)] Status: $STATUS, Redis: $REDIS, Memory: $MEMORY" >> /var/log/keepalive-monitor.log

if [ "$STATUS" == "critical" ]; then
  echo "⚠️ ALERTE: Server en état critique" | mail -s "Alerte Server" admin@example.com
fi
EOF

# 2. Rendre executable
chmod +x /home/docker/monitor-keepalive.sh

# 3. Ajouter au cron job (toutes les heures)
crontab -e
# Ajouter:
# 0 * * * * /home/docker/monitor-keepalive.sh

# 4. Vérifier le monitoring
tail -f /var/log/keepalive-monitor.log
```

---

## 📊 INDICATEURS À SURVEILLER

### Green Indicators ✅
```
✅ status = "healthy"
✅ redis = "ok"
✅ memory = "ok"
✅ HTTP 200 OK
✅ Response time < 50ms
✅ No errors in logs
```

### Yellow Indicators 🟡
```
🟡 status = "degraded"
🟡 redis = "offline" (mais serveur fonctionne)
🟡 memory = "warning" (80% utilisée)
🟡 Response time 50-100ms
🟡 Occasionally 5xx errors
```

### Red Indicators 🔴
```
🔴 status = "critical"
🔴 memory = "critical" (90% utilisée)
🔴 HTTP 500/503 errors
🔴 Response time > 5s
🔴 Multiple 5xx errors
🔴 Server not responding
```

---

## 🚨 TROUBLESHOOTING RAPIDE

### Cas 1: Redis Offline Persistant

**Symptôme:**
```
redis = "offline" depuis > 1 heure
```

**Actions:**
```bash
# 1. Vérifier les logs Redis
docker logs redis | tail -50

# 2. Vérifier la connectivité
docker exec app redis-cli -h redis ping

# 3. Redémarrer Redis
docker-compose restart redis

# 4. Attendre 10 secondes
sleep 10

# 5. Vérifier la reconnexion
docker logs app | grep -i "redis.*connecté"
```

### Cas 2: Memory Critical

**Symptôme:**
```
memory = "critical" (90% utilisée)
```

**Actions:**
```bash
# 1. Vérifier la charge
docker stats app --no-stream

# 2. Vérifier les processus
docker top app

# 3. Redémarrer le serveur
docker-compose restart app

# 4. Si problème persiste, augmenter la mémoire
# Éditer docker-compose.yml:
# services:
#   app:
#     mem_limit: 1g  (augmenter de 512m)

docker-compose down
docker-compose up -d
```

### Cas 3: Timeouts Fréquents

**Symptôme:**
```
Keepalive timeout après 8s
```

**Actions:**
```bash
# 1. Vérifier la latence
ping hitbet777.store

# 2. Vérifier CPU
docker stats app --no-stream

# 3. Augmenter le timeout
# config/keepalive.config.js ligne ~60:
# timeout: 10000  (augmenter de 8000)

git pull
docker-compose restart app

# 4. Réduire la fréquence si nécessaire
# config/keepalive.config.js ligne ~55:
# tick: 45000  (augmenter de 30000 pour réduire la charge)
```

---

## ✅ CHECKLIST FINAL

### Avant Déploiement
- [ ] Code pullé: `git pull origin main`
- [ ] Redis est UP: `docker ps | grep redis`
- [ ] Aucun commit non-committés: `git status`

### Pendant Déploiement
- [ ] Serveur redémarré: `docker-compose restart app`
- [ ] Logs OK: `docker logs app | grep KEEPALIVE`
- [ ] Pas d'erreurs: `docker logs app | grep ERROR` (aucun résultat)

### Après Déploiement
- [ ] Keepalive 200 OK: `curl .../keepalive/ -w '%{http_code}'`
- [ ] Status = healthy: `curl .../keepalive/ | jq '.serverHealth.status'`
- [ ] Clients connectés: Browser console test
- [ ] Logs stables: `docker logs app | tail -50` (pas d'erreurs)

### Monitoring
- [ ] Health check toutes les heures
- [ ] Logs surveillés quotidiennement
- [ ] Alertes configurées pour critical

---

## 📞 CONTACT & SUPPORT

### En Cas de Problème Urgent
```bash
# Redémarrage complet (nuclear option)
docker-compose down
docker volume prune -f
docker-compose up -d

# Attendre 30 secondes
sleep 30

# Vérifier
docker logs app -f | grep -E "KEEPALIVE|REDIS"
```

### Documentation
- **Guide Complet**: `KEEPALIVE_PRODUCTION_GUIDE.md`
- **Config**: `config/keepalive.config.js`
- **Monitoring**: `middleware/keepalive-monitor.js`
- **Checklist**: `KEEPALIVE_DEPLOYMENT_CHECKLIST.md` (ce fichier)

---

## 🎊 RÉSUMÉ

**Ce qui va se passer après déploiement:**

1. ✅ Keepalive reconnecte automatiquement à Redis
2. ✅ Server fonctionne même si Redis offline
3. ✅ Health checks toutes les 30 secondes
4. ✅ Logs structurés pour diagnostics faciles
5. ✅ Monitoring automatique des anomalies
6. ✅ Serveur maintient sa santé en permanence

**Timeline:**
- Deploy: < 5 minutes
- Vérification: < 5 minutes
- Total: < 15 minutes

**Résultat:**
- ✅ Production stable
- ✅ Keepalive robuste
- ✅ Monitoring intégré
- ✅ Support facile

---

**Status**: ✅ PRÊT POUR DÉPLOIEMENT IMMÉDIAT

Exécuter les 5 actions ci-dessus dans l'ordre.

Questions? Consulter `KEEPALIVE_PRODUCTION_GUIDE.md`
