# ✅ PM2 Production Configuration Checklist

## 📋 Avant le Déploiement

### 1️⃣ Configuration Locale

- [ ] **PM2 installé localement**
  ```bash
  npm install pm2
  ```

- [ ] **Fichier ecosystem.config.cjs optimisé**
  ```bash
  cat ecosystem.config.cjs | grep "watch: false"
  cat ecosystem.config.cjs | grep "max_restarts: 5"
  ```

- [ ] **Fichier .env complet avec variables**
  ```bash
  ./check-config.bat  # Windows
  ./check-config.sh   # Linux/Mac
  ```

- [ ] **Dossier logs existe**
  ```bash
  mkdir -p logs
  ```

### 2️⃣ Test Localement

- [ ] **Vérifier que server démarre**
  ```bash
  node server.js
  # Doit afficher: "Server is running..."
  # Puis Ctrl+C pour arrêter
  ```

- [ ] **Vérifier que PM2 peut le démarrer**
  ```bash
  npm run pm2:start
  npm run pm2:status
  # Doit afficher: "online"
  ```

- [ ] **Vérifier les logs**
  ```bash
  npm run pm2:logs
  # Voir les logs sans erreurs
  ```

- [ ] **Arrêter PM2**
  ```bash
  npm run pm2:stop
  npm run pm2:delete
  ```

### 3️⃣ Préparation Render

- [ ] **Créer compte Render.com**
  ```
  https://render.com/register
  ```

- [ ] **Connecter repo GitHub**
  ```
  Dashboard → Connect Repository
  ```

- [ ] **Créer fichier render.yml**
  ```bash
  cat render.yml | grep "startCommand: npm run pm2:start"
  ```

- [ ] **Ajouter variables d'environnement dans Render**
  ```
  Environment Variables:
  - NODE_ENV=production
  - PORT=8080
  - DATABASE_URL=...
  - REDIS_URL=...
  - JWT_SECRET=...
  ```

### 4️⃣ Avant le Push Git

- [ ] **Vérifier pas de fichiers sensibles en .gitignore**
  ```bash
  cat .gitignore | grep ".env"
  cat .gitignore | grep "logs"
  cat .gitignore | grep "node_modules"
  ```

- [ ] **Faire un commit avec tous les changements PM2**
  ```bash
  git add ecosystem.config.cjs
  git add setup-production.bat
  git add setup-production.sh
  git add PM2_PRODUCTION_SETUP.md
  git add check-config.bat
  git add check-config.sh
  git add render.yml
  git commit -m "Add PM2 production configuration"
  ```

- [ ] **Push sur GitHub**
  ```bash
  git push origin main
  ```

## 🚀 Déploiement Render

### Étape 1: Créer Web Service

- [ ] Aller sur Render.com Dashboard
- [ ] Cliquer "New +" → "Web Service"
- [ ] Sélectionner repo GitHub
- [ ] Render doit détecter `render.yml` automatiquement

### Étape 2: Configurer Service

- [ ] **Name:** horse-racing-server
- [ ] **Build Command:** `npm ci`
- [ ] **Start Command:** `npm run pm2:start`
- [ ] **Environment:** Select "production"

### Étape 3: Variables d'Environnement

Dans "Environment" (à côté de "Settings"), ajouter:

| Key | Value |
|-----|-------|
| `NODE_ENV` | `production` |
| `PORT` | `8080` |
| `DATABASE_URL` | `postgresql://...` |
| `REDIS_URL` | `redis://:...@...` |
| `JWT_SECRET` | `votre-secret` |

### Étape 4: Déployer

- [ ] Cliquer "Deploy"
- [ ] Attendre la fin du build (~5-10 min)
- [ ] Vérifier status: doit être **"Live"**

### Étape 5: Vérifier

- [ ] Aller à l'URL fournie par Render
- [ ] Tester l'endpoint: `https://your-app.onrender.com/api/v1/health`
- [ ] Voir les logs Render: Dashboard → Logs
- [ ] Vérifier aucune erreur

## 📊 Après le Déploiement

### Monitoring

- [ ] Vérifier logs Render tous les jours
  ```
  Dashboard → Logs → voir derniers logs
  ```

- [ ] Vérifier alertes Render
  ```
  Settings → Notifications
  ```

- [ ] Tester endpoints principaux
  ```
  GET  /api/v1/health
  GET  /api/v1/rounds/status
  POST /api/v1/auth/login (test)
  ```

### Performance

- [ ] Vérifier CPU % dans Render
  - Doit être < 50% en normal
  - Max pics à 80%

- [ ] Vérifier Memory % dans Render
  - Doit être < 200MB en normal
  - Max à 400MB

- [ ] Vérifier Response Time
  - Doit être < 200ms pour la plupart
  - Max < 1s

### Logs

- [ ] Vérifier pas d'erreurs dans les logs
  ```bash
  # Sur Render
  Logs → filter "error"
  Logs → filter "ERROR"
  Logs → filter "crash"
  ```

- [ ] Vérifier structure logs correcte
  ```
  Format attendu: YYYY-MM-DD HH:mm:ss Z
  Exemple: 2025-12-21 10:30:45 +0000
  ```

## 🔧 Si Problème après Deploy

### 1. Application exited early

```bash
# Sur votre machine locale:
./diagnose.bat  # Windows

# Voir l'erreur réelle
```

**Causes probables:**
- Variables d'env manquantes dans Render
- Database non accessible
- Redis non accessible
- Module importé mais pas installé

**Solution:**
1. Vérifier variables d'env dans Render
2. Vérifier DATABASE_URL valide
3. Vérifier REDIS_URL valide
4. Relancer: Dashboard → Redeploy

### 2. Port already in use

**Cause:** Un autre process utilise le port 8080

**Solution:** Render gère cela automatiquement, juste redeploy

### 3. Memory leak

**Symptôme:** Memory augmente constamment dans Render

**Solution:**
1. Vérifier pas de boucles infinies
2. Diminuer `max_memory_restart` dans ecosystem.config.cjs
3. Redeploy

```javascript
max_memory_restart: '300M'  // Redémarrer plus tôt
```

## 📞 Commandes de Secours

### Reset Complet Render

```bash
# Sur Render Dashboard:
1. Aller à Settings
2. Cliquer "Clear Build Cache"
3. Cliquer "Redeploy"
```

### Reset Complet Local

```bash
# Sur votre machine:
npm run pm2:delete
npm run pm2:kill
rm -rf node_modules package-lock.json logs
npm install
npm run pm2:start
```

### Vérifier Santé

```bash
# Windows
./healthcheck.bat

# Linux/Mac
./healthcheck.sh

# Doit afficher:
# ✅ Server responding
# ✅ Health endpoint working
# ✅ Database connected
```

## 🎯 URLs Importantes

| Service | URL |
|---------|-----|
| Render Dashboard | https://dashboard.render.com |
| App URL (après deploy) | https://your-app.onrender.com |
| Health Endpoint | https://your-app.onrender.com/api/v1/health |
| Status Page | https://your-app.onrender.com/api/v1/rounds/status |

## 📝 Documentation Utile

- **PM2 Docs:** https://pm2.keymetrics.io/docs
- **Render Docs:** https://render.com/docs
- **Node.js Best Practices:** https://nodejs.org/en/docs/guides/

## ✨ Finalisation

- [ ] Configuration PM2 complète ✅
- [ ] Test local réussi ✅
- [ ] Push sur GitHub ✅
- [ ] Deploy sur Render réussi ✅
- [ ] Application en ligne et stable ✅
- [ ] Logs sans erreurs ✅
- [ ] Monitoring configuré ✅

---

**🎉 Bravo! Votre application est en production avec PM2!**

### Prochaines Actions Recommandées:

1. **Monitoring quotidien:** Vérifier logs Render
2. **Alertes:** Configurer notifications Render pour erreurs
3. **Backups:** Database backups configurés?
4. **Updates:** Maintenir Node.js et PM2 à jour
5. **Documentation:** Documenter votre setup
