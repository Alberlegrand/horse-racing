# ✅ Configuration Redis Cloud Complète - HITBET777

**Date**: 2025-12-21  
**Status**: ✅ Configuration prête

---

## 🔐 INFORMATIONS REDIS CLOUD

- **Provider**: Redis Cloud (Redis Labs)
- **Database**: `database-MJG38XRX`
- **Public Endpoint**: `redis-11555.crce220.us-east-1-4.ec2.cloud.redislabs.com:11555`
- **Password**: `M9W5dTqFXor8nMkWEAOotoKs4SH65Igq`

---

## 📝 CONFIGURATION `.env`

### Configuration complète pour votre projet

Créez ou modifiez votre fichier `.env` à la racine du projet :

```env
# ============================================
# REDIS CLOUD CONFIGURATION
# ============================================
NODE_ENV=development

# ✅ URL Redis Cloud complète avec authentification
REDIS_URL=redis://:M9W5dTqFXor8nMkWEAOotoKs4SH65Igq@redis-11555.crce220.us-east-1-4.ec2.cloud.redislabs.com:11555

# Configuration Redis
REDIS_TIMEOUT_MS=5000
REDIS_RECONNECT_MAX_ATTEMPTS=5

# TTL Cache (optionnel)
SESSION_TTL=86400
STATS_CACHE_TTL=30
GAMESTATE_CACHE_TTL=3600
QUERY_CACHE_TTL=30

# ============================================
# AUTRES CONFIGURATIONS
# ============================================
# Database PostgreSQL (si nécessaire)
DATABASE_URL=postgresql://user:password@localhost:5432/hitbet777

# Session Secret (changez en production!)
SESSION_SECRET=your-secret-key-change-in-production

# JWT Secret (changez en production!)
JWT_SECRET=your-jwt-secret-key-change-in-production
```

---

## ✅ VÉRIFICATION DE LA CONFIGURATION

### Étape 1: Vérifier le format de l'URL

L'URL doit être exactement :
```
redis://:M9W5dTqFXor8nMkWEAOotoKs4SH65Igq@redis-11555.crce220.us-east-1-4.ec2.cloud.redislabs.com:11555
```

**Format**: `redis://:PASSWORD@HOST:PORT`

### Étape 2: Tester avec redis-cli

```bash
# Windows (si redis-cli installé)
redis-cli -u "redis://:M9W5dTqFXor8nMkWEAOotoKs4SH65Igq@redis-11555.crce220.us-east-1-4.ec2.cloud.redislabs.com:11555" ping

# Linux/macOS
redis-cli -u "redis://:M9W5dTqFXor8nMkWEAOotoKs4SH65Igq@redis-11555.crce220.us-east-1-4.ec2.cloud.redislabs.com:11555" ping
```

**Résultat attendu**: `PONG`

### Étape 3: Démarrer l'application

```bash
npm run dev
```

### Étape 4: Vérifier les logs

**Logs attendus** (succès) :
```
📍 [STARTUP] Redis Configuration:
   • URL: redis://:***@redis-11555.crce220.us-east-1-4.ec2.cloud.redislabs.com:11555
   • Timeout: 5000ms
   • Max Retries: 5
   • Environment: DEVELOPMENT

✅ [REDIS] Connecté avec succès
✅ [REDIS] Prêt et fonctionnel
```

**Si vous voyez encore des erreurs** :
- Vérifiez que `.env` est bien à la racine du projet
- Vérifiez qu'il n'y a pas d'espaces dans l'URL
- Vérifiez que le fichier `.env` est sauvegardé
- Redémarrez le serveur après modification

---

## 🔒 SÉCURITÉ

### ⚠️ IMPORTANT: Ne jamais commiter le mot de passe

1. **Vérifiez que `.env` est dans `.gitignore`** :
   ```
   .env
   .env.local
   .env.production
   ```

2. **Ne jamais commiter** :
   - Le fichier `.env`
   - Le mot de passe Redis dans le code
   - Les secrets dans les fichiers de configuration

3. **En production** :
   - Utilisez les variables d'environnement du serveur
   - Configurez dans le dashboard de déploiement (Render, Heroku, etc.)

---

## 🚀 DÉPLOIEMENT EN PRODUCTION

### Sur Render.com

1. Allez dans votre service
2. Section "Environment"
3. Ajoutez les variables :
   ```
   NODE_ENV=production
   REDIS_URL=redis://:M9W5dTqFXor8nMkWEAOotoKs4SH65Igq@redis-11555.crce220.us-east-1-4.ec2.cloud.redislabs.com:11555
   REDIS_TIMEOUT_MS=5000
   REDIS_RECONNECT_MAX_ATTEMPTS=5
   ```

### Sur VPS/Linux

```bash
# Ajouter dans ~/.bashrc ou ~/.profile
export NODE_ENV=production
export REDIS_URL=redis://:M9W5dTqFXor8nMkWEAOotoKs4SH65Igq@redis-11555.crce220.us-east-1-4.ec2.cloud.redislabs.com:11555
export REDIS_TIMEOUT_MS=5000
export REDIS_RECONNECT_MAX_ATTEMPTS=5
```

### Avec Docker

```dockerfile
ENV NODE_ENV=production
ENV REDIS_URL=redis://:M9W5dTqFXor8nMkWEAOotoKs4SH65Igq@redis-11555.crce220.us-east-1-4.ec2.cloud.redislabs.com:11555
```

Ou avec docker-compose :
```yaml
environment:
  - NODE_ENV=production
  - REDIS_URL=redis://:M9W5dTqFXor8nMkWEAOotoKs4SH65Igq@redis-11555.crce220.us-east-1-4.ec2.cloud.redislabs.com:11555
```

---

## 🧪 TEST DE CONNEXION COMPLET

Créez un fichier `test-redis-connection.js` :

```javascript
import redis from 'redis';
import dotenv from 'dotenv';

dotenv.config();

const REDIS_URL = process.env.REDIS_URL;

console.log('🔍 Test de connexion Redis Cloud...');
console.log('📍 URL:', REDIS_URL.replace(/:[^:]*@/, ':***@'));

const client = redis.createClient({
  url: REDIS_URL
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
  
  try {
    // Test ping
    const pong = await client.ping();
    console.log('✅ Ping:', pong);
    
    // Test set/get
    await client.set('test:connection', 'Hello Redis Cloud!');
    const value = await client.get('test:connection');
    console.log('✅ Test get:', value);
    
    // Test TTL
    await client.setEx('test:ttl', 60, 'TTL test');
    const ttl = await client.ttl('test:ttl');
    console.log('✅ Test TTL:', ttl, 'secondes');
    
    // Nettoyage
    await client.del('test:connection', 'test:ttl');
    console.log('✅ Tests terminés avec succès');
    
    await client.disconnect();
    console.log('✅ Connexion fermée proprement');
    process.exit(0);
  } catch (err) {
    console.error('❌ Erreur lors des tests:', err.message);
    process.exit(1);
  }
});

client.connect().catch(err => {
  console.error('❌ Impossible de se connecter:', err.message);
  console.error('💡 Vérifiez:');
  console.error('   1. Que REDIS_URL est correcte dans .env');
  console.error('   2. Que le mot de passe est correct');
  console.error('   3. Que votre IP est autorisée dans Redis Cloud');
  process.exit(1);
});
```

Exécutez :
```bash
node test-redis-connection.js
```

---

## 📊 MONITORING

### Vérifier le statut Redis dans l'application

Une fois l'application démarrée, vérifiez le health check :

```bash
curl http://localhost:8080/api/v1/health
```

Réponse attendue :
```json
{
  "status": "healthy",
  "services": {
    "database": "healthy",
    "websocket": "healthy",
    "redis": "healthy"
  }
}
```

### Logs de monitoring

L'application affiche automatiquement le statut Redis au démarrage :
```
📍 [STARTUP] Redis Configuration:
   • URL: redis://:***@redis-11555.crce220.us-east-1-4.ec2.cloud.redislabs.com:11555
   • Timeout: 5000ms
   • Max Retries: 5
   • Environment: DEVELOPMENT
```

---

## 🚨 DÉPANNAGE

### Erreur: "Invalid protocol"

**Cause**: URL mal formatée

**Solution**: Vérifiez que l'URL commence par `redis://` :
```env
REDIS_URL=redis://:M9W5dTqFXor8nMkWEAOotoKs4SH65Igq@redis-11555.crce220.us-east-1-4.ec2.cloud.redislabs.com:11555
```

### Erreur: "NOAUTH Authentication required"

**Cause**: Mot de passe incorrect ou manquant

**Solution**: Vérifiez que le mot de passe est correct dans `.env`

### Erreur: "Connection refused" ou "ECONNREFUSED"

**Cause**: IP non autorisée ou firewall

**Solution**:
1. Allez dans Redis Cloud Dashboard
2. Configuration → IP Whitelist
3. Ajoutez votre IP ou `0.0.0.0/0` pour tester (⚠️ moins sécurisé)

### Erreur: "Timeout"

**Cause**: Réseau lent ou timeout trop court

**Solution**: Augmentez le timeout :
```env
REDIS_TIMEOUT_MS=10000  # 10 secondes
```

---

## ✅ CHECKLIST DE CONFIGURATION

- [x] Database Redis Cloud créée : `database-MJG38XRX`
- [x] Endpoint obtenu : `redis-11555.crce220.us-east-1-4.ec2.cloud.redislabs.com:11555`
- [x] Mot de passe obtenu : `M9W5dTqFXor8nMkWEAOotoKs4SH65Igq`
- [ ] `.env` configuré avec URL complète
- [ ] Test `redis-cli` réussi (`PONG`)
- [ ] Application démarre sans erreur Redis
- [ ] Logs montrent `✅ [REDIS] Connecté avec succès`
- [ ] Health check retourne `"redis": "healthy"`
- [ ] `.env` ajouté à `.gitignore`
- [ ] Variables d'environnement configurées en production

---

## 🎯 RÉSUMÉ

**URL Redis complète** :
```
redis://:M9W5dTqFXor8nMkWEAOotoKs4SH65Igq@redis-11555.crce220.us-east-1-4.ec2.cloud.redislabs.com:11555
```

**Configuration `.env`** :
```env
NODE_ENV=development
REDIS_URL=redis://:M9W5dTqFXor8nMkWEAOotoKs4SH65Igq@redis-11555.crce220.us-east-1-4.ec2.cloud.redislabs.com:11555
REDIS_TIMEOUT_MS=5000
REDIS_RECONNECT_MAX_ATTEMPTS=5
```

**Test rapide** :
```bash
redis-cli -u "redis://:M9W5dTqFXor8nMkWEAOotoKs4SH65Igq@redis-11555.crce220.us-east-1-4.ec2.cloud.redislabs.com:11555" ping
```

---

**Configuration complète ! Votre application est prête à utiliser Redis Cloud** 🚀

