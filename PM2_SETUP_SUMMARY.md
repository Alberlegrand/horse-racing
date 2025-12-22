# 📦 PM2 Production Setup - Résumé Complet

## 🎯 Ce qui a été Configuré

### 1️⃣ Configuration PM2 Optimisée

**Fichier:** `ecosystem.config.cjs`

**Améliorations:**
- ✅ `watch: false` - Désactivé en production (économise CPU)
- ✅ `max_restarts: 5` - Limite les redémarrages en boucle
- ✅ `min_uptime: '10s'` - Détecte les vrais crashes
- ✅ `kill_timeout: 5000` - Graceful shutdown (5s)
- ✅ `listen_timeout: 8000` - Timeout démarrage (8s)
- ✅ `exp_backoff_restart_delay` - Délai exponentiel entre redémarrages
- ✅ Logging séparé: `logs/out.log` et `logs/error.log`
- ✅ Memory monitoring: `max_memory_restart: '500M'`

### 2️⃣ Scripts Automatisés

#### setup-production.bat (Windows)
```bash
./setup-production.bat
```
**Fait automatiquement:**
- Installe PM2 si besoin
- Crée dossier logs/
- Arrête anciennes instances
- Démarre avec NODE_ENV=production
- Sauvegarde configuration
- Affiche status

#### setup-production.sh (Linux/Mac)
```bash
chmod +x setup-production.sh
./setup-production.sh
```
Même fonctionnalité que .bat

### 3️⃣ Scripts de Vérification

#### check-config.bat / check-config.sh
```bash
./check-config.bat
```
**Vérifie:**
- ✅ Fichier .env existe et complet
- ✅ NODE_ENV=production
- ✅ PORT configuré
- ✅ DATABASE_URL présent
- ✅ REDIS_URL présent (optionnel)
- ✅ JWT_SECRET présent
- ✅ ecosystem.config.cjs existe
- ✅ Dossier logs existe
- ✅ node_modules existe
- ✅ server.js et game.js existent

## 📚 Documentation Créée

### 1. PM2_PRODUCTION_SETUP.md (Complet)
```markdown
- Configuration PM2 expliquée
- Installation rapide
- Variables d'environnement
- Déploiement Render.com
- Commandes utiles
- Dépannage
- Monitoring en production
```

### 2. LOCAL_TEST_GUIDE.md (Test avant déploiement)
```markdown
- Étapes de test complètes
- Vérification configuration
- Test endpoints
- Simulation crash
- Checklist validation
- Dépannage courant
```

### 3. PRODUCTION_CHECKLIST.md (Checklist détaillée)
```markdown
- Checklist avant déploiement
- Configuration Render.com
- Variables d'environnement
- Après déploiement
- Monitoring
- Dépannage post-déploiement
```

## 🚀 Démarrage Rapide

### Option 1: Setup Automatisé

```bash
# Windows
./setup-production.bat

# Linux/Mac
chmod +x setup-production.sh
./setup-production.sh
```

### Option 2: Setup Manuel

```bash
# 1. Vérifier config
./check-config.bat

# 2. Installer dépendances
npm install

# 3. Démarrer PM2
npx pm2 start ecosystem.config.cjs --env production

# 4. Vérifier status
npx pm2 status

# 5. Voir les logs
npm run pm2:logs
```

## 📊 Commandes Utiles

```bash
# GESTION PROCESSUS
npm run pm2:start       # Démarrer
npm run pm2:stop        # Arrêter
npm run pm2:restart     # Redémarrer
npm run pm2:delete      # Supprimer

# MONITORING
npm run pm2:logs        # Voir logs (streaming)
npm run pm2:monit       # Dashboard temps réel
npm run pm2:status      # État des processus

# CONFIGURATION
npm run pm2:save        # Sauvegarder config
npm run pm2:resurrect   # Restaurer config

# VÉRIFICATION
./check-config.bat      # Vérifier configuration
./diagnose.bat          # Diagnostic server
./healthcheck.bat       # Santé du serveur
```

## 🎯 Variables d'Environnement Requises

Créer fichier `.env`:

```env
# Obligatoires
NODE_ENV=production
PORT=8080
DATABASE_URL=postgresql://user:pass@host:port/database
JWT_SECRET=your-secret-key-min-32-chars

# Optionnel mais recommandé
REDIS_URL=redis://:password@host:port
LOG_LEVEL=info
```

## 🏗️ Architecture Production

```
┌─────────────────────────────────────┐
│  Render.com                         │
│  ┌──────────────────────────────┐   │
│  │  Web Service                 │   │
│  │  ┌────────────────────────┐  │   │
│  │  │  PM2 Process Manager   │  │   │
│  │  │  ┌──────────────────┐  │  │   │
│  │  │  │  horse-racing    │  │  │   │
│  │  │  │  Node.js Server  │  │  │   │
│  │  │  └──────────────────┘  │  │   │
│  │  │                        │  │   │
│  │  │  Monitoring:           │  │   │
│  │  │  - CPU < 50%           │  │   │
│  │  │  - Memory < 300MB      │  │   │
│  │  │  - Auto restart        │  │   │
│  │  │                        │  │   │
│  │  │  Logging:              │  │   │
│  │  │  - logs/out.log        │  │   │
│  │  │  - logs/error.log      │  │   │
│  │  └────────────────────────┘  │   │
│  └──────────────────────────────┘   │
│                                     │
│  Environment Variables:             │
│  - NODE_ENV=production              │
│  - DATABASE_URL                     │
│  - REDIS_URL                        │
│  - JWT_SECRET                       │
└─────────────────────────────────────┘
         │
         ├──→ PostgreSQL (Aiven)
         │
         └──→ Redis (Aiven)
```

## 🔧 Configuration Fichiers

### ecosystem.config.cjs (MODIFIÉ)
- ✅ Optimisé pour production
- ✅ watch: false
- ✅ max_restarts: 5
- ✅ min_uptime: '10s'
- ✅ Logging actif

### .env (À CRÉER)
```bash
# Créer avec vos valeurs réelles
NODE_ENV=production
PORT=8080
DATABASE_URL=...
REDIS_URL=...
JWT_SECRET=...
```

### render.yml (À CRÉER)
```yaml
services:
  - type: web
    buildCommand: npm ci
    startCommand: npm run pm2:start
    env: production
```

## 📈 Monitoring Recommandé

### Localement

```bash
# Terminal 1: Dashboard temps réel
npm run pm2:monit

# Terminal 2: Logs streaming
npm run pm2:logs

# Terminal 3: Tester endpoints
curl http://localhost:8080/api/v1/health
```

### Sur Render

```
Dashboard → Logs
- Vérifier pas d'erreurs
- CPU et Memory stables
- Uptime en augmentation

Dashboard → Metrics (si disponible)
- Response time < 200ms
- Error rate = 0%
- Uptime = 100%
```

## ✅ Checklist Final

### Avant Déploiement

- [ ] Configuration `.env` complète
- [ ] `npm install` réussi
- [ ] `node server.js` démarre sans erreur
- [ ] `npm run pm2:start` fonctionne
- [ ] Status montre "online"
- [ ] Logs sans erreurs
- [ ] Endpoints répondent (curl test)
- [ ] `ecosystem.config.cjs` optimisé
- [ ] `render.yml` créé
- [ ] Git push réussi

### Après Déploiement sur Render

- [ ] Service status = "Live"
- [ ] Logs sans erreurs
- [ ] `/api/v1/health` répond 200
- [ ] CPU < 50%
- [ ] Memory < 300MB
- [ ] Response time < 200ms
- [ ] Pas d'erreurs de connexion DB
- [ ] Pas d'erreurs Redis
- [ ] Application stable (uptime croissant)

## 🚨 Démarrage Rapide en Cas d'Urgence

```bash
# 1. Arrêter tout
npm run pm2:delete
npm run pm2:kill

# 2. Vérifier config
./check-config.bat

# 3. Relancer
npm run pm2:start

# 4. Vérifier logs
npm run pm2:logs
```

## 📞 Support

Si problème:

1. **Vérifier logs** → `npm run pm2:logs`
2. **Diagnostic** → `./diagnose.bat`
3. **Vérifier config** → `./check-config.bat`
4. **Consulter docs** → `PRODUCTION_TROUBLESHOOTING.md`

## 📚 Fichiers Créés

```
horse-racing/
├── ecosystem.config.cjs                    ✅ CONFIG PM2 (modifié)
├── setup-production.bat                    ✅ SETUP AUTOMATISÉ
├── setup-production.sh                     ✅ SETUP AUTOMATISÉ
├── check-config.bat                        ✅ VÉRIFICATION
├── check-config.sh                         ✅ VÉRIFICATION
├── PM2_PRODUCTION_SETUP.md                 ✅ GUIDE COMPLET
├── LOCAL_TEST_GUIDE.md                     ✅ TEST LOCAL
├── PRODUCTION_CHECKLIST.md                 ✅ CHECKLIST
├── PRODUCTION_TROUBLESHOOTING.md           ✅ DÉPANNAGE
├── render.yml                              ✅ RENDER CONFIG
├── diagnose.bat                            ✅ DIAGNOSTIC
├── diagnose.sh                             ✅ DIAGNOSTIC
├── healthcheck.bat                         ✅ SANTÉ SERVER
├── healthcheck.sh                          ✅ SANTÉ SERVER
└── logs/                                   ✅ DOSSIER (créé par PM2)
    ├── out.log                             ✅ LOGS STANDARD
    └── error.log                           ✅ LOGS ERREURS
```

## 🎉 Configuration Terminée!

**Vous êtes maintenant prêt pour la production! 🚀**

### Prochaines étapes:

1. **Tester localement:**
   ```bash
   ./setup-production.bat
   npm run pm2:logs
   # Vérifier: server running, pas d'erreur
   ```

2. **Configurer Render:**
   - Créer Web Service
   - Ajouter variables d'env
   - Deploy

3. **Monitorer:**
   - Vérifier logs Render quotidiennement
   - Tester endpoints
   - Vérifier CPU et Memory

4. **Maintenir:**
   - Garder PM2 à jour
   - Logs archives (éviter accumulation)
   - Database backups

---

**Questions?** Consulter les fichiers de documentation fournis! 📚
