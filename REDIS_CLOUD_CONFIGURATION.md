# ✅ Configuration Redis Cloud - HITBET777

**Endpoint fourni**: `redis-11555.crce220.us-east-1-4.ec2.cloud.redislabs.com:11555`  
**Provider**: Redis Cloud (Redis Labs)  
**Status**: ✅ Prêt pour configuration

---

## 🔐 ÉTAPE 1: Obtenir le Mot de Passe

Redis Cloud nécessite un mot de passe pour se connecter. Pour l'obtenir:

1. **Connectez-vous à votre compte Redis Cloud**: https://redis.com/cloud/
2. **Sélectionnez votre database** (celle avec l'endpoint `redis-11555...`)
3. **Allez dans "Configuration"** ou "Access Control & Security"
4. **Copiez le mot de passe** (ou créez-en un si nécessaire)

⚠️ **Important**: Le mot de passe est différent du mot de passe de votre compte Redis Cloud.

---

## 📝 ÉTAPE 2: Configurer `.env`

### Format de l'URL Redis Cloud

L'URL complète doit être au format:
```
redis://:PASSWORD@HOST:PORT
```

### Configuration pour votre endpoint

**✅ INFORMATIONS FOURNIES**:
- Database: `database-MJG38XRX`
- Endpoint: `redis-11555.crce220.us-east-1-4.ec2.cloud.redislabs.com:11555`
- Password: `M9W5dTqFXor8nMkWEAOotoKs4SH65Igq`

Créez ou modifiez votre fichier `.env`:

```env
# ============================================
# REDIS CLOUD CONFIGURATION
# ============================================
NODE_ENV=development

# ✅ URL Redis Cloud complète (configuration fournie)
REDIS_URL=redis://:M9W5dTqFXor8nMkWEAOotoKs4SH65Igq@redis-11555.crce220.us-east-1-4.ec2.cloud.redislabs.com:11555

# Configuration Redis
REDIS_TIMEOUT_MS=5000
REDIS_RECONNECT_MAX_ATTEMPTS=5

# TTL Cache (optionnel)
SESSION_TTL=86400
STATS_CACHE_TTL=30
GAMESTATE_CACHE_TTL=3600
QUERY_CACHE_TTL=30
```

### Exemple avec mot de passe (remplacez par le vôtre)

```env
REDIS_URL=redis://:MySecurePassword123@redis-11555.crce220.us-east-1-4.ec2.cloud.redislabs.com:11555
```

---

## ✅ ÉTAPE 3: Tester la Connexion

### Méthode 1: Avec `redis-cli`

```bash
# Windows (si redis-cli installé)
redis-cli -h redis-11555.crce220.us-east-1-4.ec2.cloud.redislabs.com -p 11555 -a YOUR_PASSWORD ping

# Linux/macOS
redis-cli -h redis-11555.crce220.us-east-1-4.ec2.cloud.redislabs.com -p 11555 -a YOUR_PASSWORD ping

# Avec URL complète
redis-cli -u "redis://:YOUR_PASSWORD@redis-11555.crce220.us-east-1-4.ec2.cloud.redislabs.com:11555" ping
```

**Résultat attendu**: `PONG`

### Méthode 2: Avec Node.js (test rapide)

Créez un fichier `test-redis.js`:

```javascript
import redis from 'redis';
import dotenv from 'dotenv';

dotenv.config();

const client = redis.createClient({
  url: process.env.REDIS_URL
});

client.on('error', (err) => {
  console.error('❌ Erreur Redis:', err.message);
  process.exit(1);
});

client.on('connect', () => {
  console.log('✅ Connecté à Redis Cloud');
});

client.on('ready', async () => {
  console.log('✅ Redis prêt');
  
  // Test ping
  const pong = await client.ping();
  console.log('✅ Ping:', pong);
  
  // Test set/get
  await client.set('test', 'Hello Redis Cloud!');
  const value = await client.get('test');
  console.log('✅ Test get:', value);
  
  await client.disconnect();
  console.log('✅ Connexion fermée');
  process.exit(0);
});

client.connect().catch(err => {
  console.error('❌ Impossible de se connecter:', err.message);
  process.exit(1);
});
```

Exécutez:
```bash
node test-redis.js
```

### Méthode 3: Avec l'application

1. **Démarrez l'application**:
   ```bash
   npm run dev
   # ou
   npm start
   ```

2. **Vérifiez les logs**:
   ```
   📍 [STARTUP] Redis Configuration:
      • URL: redis://:***@redis-11555.crce220.us-east-1-4.ec2.cloud.redislabs.com:11555
      • Timeout: 5000ms
      • Max Retries: 5
      • Environment: PRODUCTION
   
   ✅ [REDIS] Connecté avec succès
   ✅ [REDIS] Prêt et fonctionnel
   ```

3. **Vérifiez le health check**:
   ```bash
   curl http://localhost:8080/api/v1/health
   ```
   
   Réponse attendue:
   ```json
   {
     "status": "healthy",
     "services": {
       "redis": "healthy"
     }
   }
   ```

---

## 🔒 SÉCURITÉ

### ⚠️ IMPORTANT: Ne jamais commiter le mot de passe

1. **Ajoutez `.env` à `.gitignore`** (déjà fait normalement):
   ```
   .env
   .env.production
   ```

2. **Utilisez des variables d'environnement** en production:
   - Sur Render/Heroku: Configurez dans le dashboard
   - Sur VPS: Utilisez `export REDIS_URL=...`
   - Sur Docker: Utilisez `-e REDIS_URL=...`

### Exemple pour Render.com

Dans le dashboard Render:
1. Allez dans votre service
2. Section "Environment"
3. Ajoutez:
   ```
   REDIS_URL=redis://:YOUR_PASSWORD@redis-11555.crce220.us-east-1-4.ec2.cloud.redislabs.com:11555
   NODE_ENV=production
   ```

---

## 🚨 DÉPANNAGE

### Erreur: "NOAUTH Authentication required"

**Cause**: Mot de passe manquant ou incorrect.

**Solution**:
1. Vérifiez le format de l'URL: `redis://:PASSWORD@host:port`
2. Vérifiez que le mot de passe est correct dans Redis Cloud dashboard
3. Testez avec `redis-cli` pour confirmer

### Erreur: "Connection refused" ou "ECONNREFUSED"

**Cause**: Firewall ou réseau bloquant la connexion.

**Solution**:
1. Vérifiez que votre IP est autorisée dans Redis Cloud:
   - Redis Cloud Dashboard → Configuration → IP Whitelist
   - Ajoutez votre IP ou `0.0.0.0/0` pour tester (⚠️ moins sécurisé)
2. Vérifiez que le port 11555 est ouvert
3. Testez depuis un autre réseau (ex: mobile hotspot)

### Erreur: "Timeout" ou "Connection timeout"

**Cause**: Timeout trop court ou réseau lent.

**Solution**:
```env
# Augmenter le timeout
REDIS_TIMEOUT_MS=10000  # 10 secondes
```

### Erreur: "Too many reconnection attempts"

**Cause**: Redis Cloud indisponible ou configuration incorrecte.

**Solution**:
1. Vérifiez le statut de votre database dans Redis Cloud dashboard
2. Vérifiez que la database n'est pas suspendue (quota dépassé)
3. Vérifiez les logs pour plus de détails

---

## 📊 MONITORING

### Vérifier le statut Redis dans l'application

```javascript
import { getRedisStatus, getRedisHealth } from './config/redis.js';

const status = getRedisStatus();
console.log('Redis Status:', status);
// {
//   healthy: true,
//   connected: true,
//   disabled: false,
//   url: 'redis://:***@redis-11555...',
//   reconnectAttempts: 0,
//   maxAttempts: 5,
//   environment: 'production',
//   ...
// }

const health = getRedisHealth();
console.log('Redis Health:', health);
// 'ok' | 'offline' | 'disabled'
```

### Endpoint Health Check

```bash
curl http://localhost:8080/api/v1/health | jq .services.redis
# "healthy" | "offline" | "unavailable"
```

---

## ✅ CHECKLIST DE CONFIGURATION

- [ ] Mot de passe Redis Cloud obtenu
- [ ] `.env` configuré avec `REDIS_URL` complet
- [ ] Test `redis-cli` réussi (`PONG`)
- [ ] Application démarre sans erreur Redis
- [ ] Logs montrent `✅ [REDIS] Connecté avec succès`
- [ ] Health check retourne `"redis": "healthy"`
- [ ] `.env` ajouté à `.gitignore` (pas committé)
- [ ] Variables d'environnement configurées en production

---

## 🎯 RÉSUMÉ

**URL complète à utiliser**:
```
redis://:YOUR_PASSWORD@redis-11555.crce220.us-east-1-4.ec2.cloud.redislabs.com:11555
```

**Configuration `.env`**:
```env
NODE_ENV=production
REDIS_URL=redis://:YOUR_PASSWORD@redis-11555.crce220.us-east-1-4.ec2.cloud.redislabs.com:11555
REDIS_TIMEOUT_MS=5000
REDIS_RECONNECT_MAX_ATTEMPTS=5
```

**Test rapide**:
```bash
redis-cli -u "redis://:YOUR_PASSWORD@redis-11555.crce220.us-east-1-4.ec2.cloud.redislabs.com:11555" ping
# Devrait retourner: PONG
```

---

**Une fois configuré, votre application utilisera Redis Cloud pour le cache et les sessions** 🚀

