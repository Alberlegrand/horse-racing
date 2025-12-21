# 🚀 REDIS SETUP GUIDE - HITBET777

Redis est utilisé pour:
- **Session management** (express-session)
- **Cache** (résultats de courses, données temporaires)
- **Pub/Sub** (communication WebSocket temps réel)
- **Game state recovery** (restauration après crash)

---

## ✅ CONFIGURATION RAPIDE

### 1️⃣ DÉVELOPPEMENT (Local Redis)

#### Option A: Redis Server Local (Windows avec WSL/Linux)

```bash
# Sur WSL/Linux:
sudo apt-get update
sudo apt-get install redis-server
redis-server

# Ou avec Homebrew (macOS):
brew install redis
redis-server
```

#### Option B: Docker (Recommandé - Windows/Mac/Linux)

```bash
# Lancer Redis en conteneur
docker run -d \
  --name redis-hitbet \
  -p 6379:6379 \
  redis:latest redis-server --appendonly yes

# Vérifier la connexion
docker exec redis-hitbet redis-cli ping
# Output: PONG
```

#### Option C: Redis Desktop Manager (GUI)

Télécharger depuis: https://github.com/lework/RedisDesktopManager

### Configuration `.env` pour développement:

```env
NODE_ENV=development
REDIS_URL=redis://localhost:6379
REDIS_TIMEOUT_MS=5000
REDIS_RECONNECT_MAX_ATTEMPTS=5
```

---

## 🌐 PRODUCTION (Cloud Redis)

### Providers Recommandés:

#### 1. **Aiven Redis** (Utilisé actuellement)

```bash
# 1. Créer un cluster Redis sur Aiven
# 2. Copier l'URL de connexion

# 3. Dans .env production:
REDIS_URL=redis://:your_password@your-cluster-name.aivencloud.com:20955
NODE_ENV=production
REDIS_TIMEOUT_MS=5000
REDIS_RECONNECT_MAX_ATTEMPTS=5

# 4. Tester la connexion:
redis-cli -u "redis://:your_password@your-cluster-name.aivencloud.com:20955" ping
# Output: PONG
```

#### 2. **AWS ElastiCache**

```env
REDIS_URL=redis://:your-auth-token@cache-name.aws-region.cache.amazonaws.com:6379
NODE_ENV=production
```

#### 3. **Redis Cloud** (redis.com)

```env
REDIS_URL=redis://:your_password@your-endpoint.redis.cloud:port
NODE_ENV=production
```

---

## 🔧 VARIABLES D'ENVIRONNEMENT

### `.env` Complet

```env
# ===================================
# REDIS CONFIGURATION
# ===================================
NODE_ENV=development

# URL de connexion à Redis
# Format: redis://[user]:password@host:port/db
REDIS_URL=redis://localhost:6379

# Timeout pour les opérations Redis (ms)
REDIS_TIMEOUT_MS=5000

# Nombre maximum de tentatives de reconnexion en production
# En développement, les reconnexions continuent indéfiniment
REDIS_RECONNECT_MAX_ATTEMPTS=5
```

### Comportement par Environnement

| Paramètre | Development | Production |
|-----------|-------------|-----------|
| **URL** | `redis://localhost:6379` | Cloud URL avec auth |
| **Timeout** | 5000ms | 5000ms |
| **Max Retries** | Illimité | 5 |
| **Backoff** | Exponentiel (1s → 10s) | Exponentiel (1s → 10s) |
| **Action Max Retries** | Continue l'app | ❌ Arrête reconnexions |

---

## ✔️ TEST DE CONNEXION

### Méthode 1: Avec `redis-cli`

```bash
# Local
redis-cli ping
# Output: PONG

# Aiven/Cloud
redis-cli -u "redis://:password@host:port" ping
# Output: PONG
```

### Méthode 2: Avec l'API du serveur

Une fois le serveur lancé:

```bash
curl http://localhost:3000/api/v1/keepalive/health
```

Vérifier dans la réponse:

```json
{
  "redis": "ok"  // ✅ Connected
  // ou
  "redis": "offline"  // ⚠️ Not connected (degraded mode)
}
```

### Méthode 3: Logs du serveur

```bash
npm run dev
# ou
npm start
```

Chercher:

```
✅ [REDIS] Connecté avec succès
✅ [REDIS] Prêt et fonctionnel
```

---

## ⚠️ DÉPANNAGE

### Problème: "Connection refused" ou "Cannot connect"

**Développement:**
```bash
# 1. Vérifier que Redis est lancé
redis-cli ping

# 2. Vérifier le port (défaut: 6379)
netstat -an | grep 6379

# 3. Relancer Redis
redis-server

# 4. Ou avec Docker:
docker ps | grep redis
docker start redis-hitbet
```

**Production:**
```bash
# 1. Vérifier REDIS_URL dans .env
echo $REDIS_URL

# 2. Tester la connexion directement
redis-cli -u "redis://:password@host:port" ping

# 3. Vérifier les logs d'erreur:
# ❌ [REDIS] Limite de reconnexion atteinte
# -> Vérifiez que Redis est accessible de votre serveur
```

### Problème: Timeout

```
⚠️ [REDIS] Timeout de connexion
```

**Solutions:**
- Augmenter `REDIS_TIMEOUT_MS` dans `.env` (ex: 10000)
- Vérifier la latence réseau vers Redis
- En cloud: vérifier que le port 6379 n'est pas bloqué par firewall

### Problème: "Max reconnection attempts reached"

```
❌ [REDIS] Limite de reconnexion atteinte (5 tentatives en prod)
```

**Solutions:**
- En développement: Redémarrer Redis et l'app
- En production:
  1. Vérifier que Redis cloud est actif
  2. Vérifier REDIS_URL et le mot de passe
  3. Vérifier les règles firewall/VPC du cloud
  4. Augmenter `REDIS_RECONNECT_MAX_ATTEMPTS` si besoin

### Problème: "Mode dégradé activé"

```
⚠️ [REDIS] Mode dégradé activé - serveur fonctionne sans cache
```

**Status:** ℹ️ Normal - Redis n'est pas disponible mais l'app fonctionne

**Actions:**
- Vérifier que Redis doit être présent
- Ou accepter le fonctionnement sans cache

---

## 📊 MONITORING & STATS

### Status Redis en temps réel

Accès via API:

```bash
curl http://localhost:3000/api/v1/keepalive/health
```

Exemple de réponse:

```json
{
  "status": "healthy",
  "serverHealth": {
    "redis": "ok",
    "memory": {
      "used": 45.5,
      "total": 100,
      "percentage": 45.5,
      "status": "healthy"
    }
  },
  "timestamp": "2025-12-21T10:30:00Z"
}
```

### Logs Redis

**En développement:**
```bash
npm run dev 2>&1 | grep REDIS
```

**En production (Docker):**
```bash
docker logs -f your-app-container | grep REDIS
```

---

## 🔐 SÉCURITÉ

### En Développement

```env
REDIS_URL=redis://localhost:6379
# ✅ OK - local, pas de password nécessaire
```

### En Production

```env
REDIS_URL=redis://:strong_password_here@redis-host.com:6379
# ✅ Utiliser password authentification
```

**Checklist:**
- [ ] `REDIS_URL` contient une authentification (`:password@`)
- [ ] `.env` n'est pas commité dans Git (dans `.gitignore`)
- [ ] Password très complexe (>20 caractères)
- [ ] Connexion SSL/TLS activée si possible (`rediss://` au lieu de `redis://`)

---

## 🚀 DÉPLOIEMENT

### 1. En développement

```bash
# Lancer Redis (Docker recommandé)
docker run -d -p 6379:6379 redis:latest

# Lancer l'app
npm run dev

# Vérifier dans les logs:
# ✅ [REDIS] Connecté avec succès
# ✅ [REDIS] Prêt et fonctionnel
```

### 2. En production (exemple Heroku/VPS)

```bash
# 1. Mettre à jour .env avec Redis cloud URL
echo "REDIS_URL=redis://:password@host:port" >> .env.production

# 2. Mettre NODE_ENV=production
echo "NODE_ENV=production" >> .env.production

# 3. Lancer l'app
NODE_ENV=production npm start

# 4. Vérifier les logs
tail -f app.log | grep REDIS
```

### 3. Docker Compose (Recommandé)

**docker-compose.yml:**

```yaml
version: '3.8'

services:
  app:
    build: .
    ports:
      - "3000:3000"
    environment:
      NODE_ENV: production
      REDIS_URL: redis://redis:6379
      DATABASE_URL: ${DATABASE_URL}
      JWT_SECRET: ${JWT_SECRET}
    depends_on:
      - redis

  redis:
    image: redis:latest
    ports:
      - "6379:6379"
    volumes:
      - redis-data:/data
    command: redis-server --appendonly yes

volumes:
  redis-data:
```

Lancer:
```bash
docker-compose up -d
```

---

## 📚 RÉFÉRENCES

- [Redis Documentation](https://redis.io/docs/)
- [node-redis Client](https://github.com/lework/node-redis)
- [Express Session with Redis](https://github.com/tj/connect-redis)
- [Aiven Redis Guide](https://aiven.io/docs/products/redis/get-started.html)

---

## ✨ RÉSUMÉ

| Aspect | Développement | Production |
|--------|--------------|-----------|
| **Setup** | Local Docker/WSL | Cloud (Aiven/AWS/Redis.com) |
| **URL** | `redis://localhost:6379` | `redis://:pass@host:port` |
| **Max Retries** | ∞ | 5 |
| **Monitoring** | Logs + CLI | Logs + Dashboard |
| **Failover** | Mode dégradé | Mode dégradé |

---

**Besoin d'aide?**

```bash
# Vérifier status Redis
curl http://localhost:3000/api/v1/keepalive/health

# Vérifier logs
npm run dev 2>&1 | tail -20

# Test redis-cli
redis-cli -u "redis://..." ping
```
