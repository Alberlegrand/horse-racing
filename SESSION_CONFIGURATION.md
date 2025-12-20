# Configuration des Sessions - Production Ready

## ✅ Problème Résolu

**Avant:** Avertissement `Warning: connect.session() MemoryStore is not designed for a production environment...`

**Après:** Configuration express-session avec Redis Store pour production

## 📋 Changements Apportés

### 1. Installation des dépendances
```bash
npm install express-session connect-redis@7
```
- **express-session**: Middleware standard pour les sessions
- **connect-redis@7**: Redis Store compatible avec redis@4.x

### 2. Configuration dans `server.js`

#### Imports
```javascript
import session from "express-session";
import RedisStore from "connect-redis";
```

#### Initialisation du RedisStore
```javascript
let sessionStore = null;

// Après la connexion Redis
if (redisClient && redisClient.isOpen) {
  sessionStore = new RedisStore({
    client: redisClient,
    prefix: 'session:',
    ttl: 86400 // 24 heures
  });
  console.log('✅ Express-Session configuré avec Redis Store (production-ready)');
} else {
  console.warn('⚠️ Redis non disponible, utilisation du store en mémoire');
  sessionStore = new session.MemoryStore();
}
```

#### Middleware express-session
```javascript
app.use(session({
  store: sessionStore,
  secret: process.env.SESSION_SECRET || 'your-secret-key-change-in-production',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: NODE_ENV === 'production',  // HTTPS seulement en production
    httpOnly: true,
    sameSite: 'strict',
    maxAge: 86400000  // 24 heures
  },
  name: 'sessionId'
}));
```

### 3. Export du Redis Client

**Fichier:** `config/redis.js`

```javascript
// Export direct du client Redis pour express-session
export { redisClient };
```

## 🔧 Architecture des Sessions

### Flux des Sessions
```
1. Utilisateur se connecte
   ↓
2. Express-session crée un sessionId
   ↓
3. RedisStore sauvegarde les données dans Redis
   - Clé: session:{sessionId}
   - TTL: 24 heures (auto-delete)
   ↓
4. Cookie sessionId envoyé au client
   - HttpOnly: sécurité contre XSS
   - Secure: HTTPS seulement en prod
   - SameSite: strict (CSRF protection)
   ↓
5. À chaque requête, sessionId est validé
   ↓
6. Données de session restaurées depuis Redis
```

### Données Stockées dans la Session
```javascript
req.session = {
  userId: 123,
  username: 'user@example.com',
  role: 'cashier',
  createdAt: 1234567890,
  // ... autres données utilisateur
}
```

## 📊 Performance & Scalabilité

### MemoryStore (Développement seulement)
- ❌ Fuite mémoire progressive
- ❌ Données perdues au redémarrage
- ❌ Pas de partage multi-processus
- ✅ Simple pour développement local

### Redis Store (Production)
- ✅ Persistance optionnelle (RDB/AOF)
- ✅ Partage entre plusieurs serveurs
- ✅ TTL automatique (évite les sessions mortes)
- ✅ Atomicité garantie
- ✅ Performance: ~1-5ms par opération
- ✅ Scalabilité linéaire

## 🔐 Sécurité des Sessions

### Configuration Sécurisée
| Parameter | Valeur | Raison |
|-----------|--------|--------|
| `httpOnly` | `true` | Empêche l'accès JavaScript (XSS) |
| `secure` | `true` (prod) | HTTPS seulement |
| `sameSite` | `strict` | Protection CSRF |
| `secret` | Variable d'env | Rotation des clés possible |
| `ttl` | 86400s | Expiration automatique |

### JWT vs Sessions Redis
- **Session Redis**: Stockage serveur, révocation immédiate
- **JWT**: Stateless, révocation difficile
- **Notre approche**: Hybride (JWT + Sessions Redis)

## 🚀 Déploiement Production

### Variables d'Environnement Requises
```env
REDIS_URL=redis://username:password@redis-host:6379
SESSION_SECRET=your-very-long-random-secret-key
NODE_ENV=production
```

### Configuration Redis Recommandée
```redis
# Éviction des sessions expirées
maxmemory-policy allkeys-lru

# Persistance
save 900 1
save 300 10
save 60 10000

# TLS/SSL
port 0
tls-port 6379
```

### Monitoring
```bash
# Vérifier les sessions actives
redis-cli KEYS "session:*" | wc -l

# Voir le TTL d'une session
redis-cli TTL "session:{sessionId}"

# Nettoyer les sessions expirées manuellement
redis-cli EVAL "return redis.call('del', KEYS[1])" 1 "session:*"
```

## ✅ Vérification

### Test d'une Session
```javascript
// Dans une route:
app.get('/test-session', (req, res) => {
  req.session.userId = 123;
  req.session.username = 'testuser';
  req.session.save((err) => {
    if (err) res.status(500).json({ error: 'Session save failed' });
    res.json({ session: req.session, message: 'Session créée' });
  });
});
```

### Logs de Démarrage
```
✅ Express-Session configuré avec Redis Store (production-ready)
```

Si vous voyez ce message au démarrage, c'est que tout est configuré correctement !

## 📚 Ressources

- [express-session Documentation](https://github.com/expressjs/session)
- [connect-redis Documentation](https://github.com/tj/connect-redis)
- [Redis Sessions Best Practices](https://redis.io/docs/latest/develop/use-cases/sessions/)
- [Session Security](https://owasp.org/www-community/attacks/Session_hijacking_attack)

## 🔄 Migration depuis MemoryStore

Si vous aviez des sessions en mémoire:
1. Elles seront perdues (normal)
2. Les utilisateurs seront reconnectés
3. Nouvelles sessions créées dans Redis
4. Aucune perte de données applicative (BD PostgreSQL persiste)

## ⚠️ Débogage

### Session non sauvegardée
```javascript
req.session.save((err) => {
  if (err) console.error('Session save error:', err);
});
```

### Redis non disponible
- Fallback automatique vers MemoryStore
- Avertissement dans les logs
- Application continue de fonctionner
- Pour la production: Mettre en place une alerting

### Vérifier la connexion Redis
```javascript
if (redisClient.isOpen) {
  console.log('✅ Redis connecté');
} else {
  console.log('❌ Redis non disponible');
}
```
