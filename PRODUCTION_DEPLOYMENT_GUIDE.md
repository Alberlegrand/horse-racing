# 🚀 Déploiement Production - Guide Complet

## ❓ Qu'est-ce que "Application exited early"?

Sur Render.com, ce message signifie:
```
PM2 démarre → Le serveur crash immédiatement → PM2 ne peut pas voir l'erreur
```

## 🎯 Cause Probable

L'une de ces raisons:
1. **Variables d'environnement manquantes** (DATABASE_URL, REDIS_URL)
2. **Dépendances manquantes** (npm install non exécuté)
3. **Erreur au démarrage du serveur** (ex: connexion BD/Redis échoue)
4. **Fichiers manquants après build**

## ✅ Comment Déboguer

### Étape 1: Tester localement en production

```bash
# Windows
./diagnose.bat

# Linux/Mac
./diagnose.sh
```

Cela lance le serveur sans PM2 et affiche **la vraie erreur**.

### Étape 2: Vérifier les logs Render

```bash
# Voir les logs PM2
npm run pm2:logs

# Voir le status
npx pm2 show horse-racing-server
```

### Étape 3: Vérifier la santé du serveur

```bash
# Windows
./healthcheck.bat

# Linux/Mac
./healthcheck.sh
```

## 🔧 Configuration Render.com

### Option 1: Utiliser render.yml (automatique)

Fichier `render.yml` à la racine:
```yaml
services:
  - type: web
    buildCommand: npm ci
    startCommand: npm run pm2:start
    env: production
```

### Option 2: Configuration manuelle

1. **Build Command:**
   ```bash
   npm ci
   ```

2. **Start Command:**
   ```bash
   npm run pm2:start
   ```

3. **Environment Variables** (définir dans Render dashboard):
   - `NODE_ENV` = production
   - `PORT` = 8080
   - `DATABASE_URL` = votre-url-postgres
   - `REDIS_URL` = votre-url-redis
   - `JWT_SECRET` = votre-secret

## 📊 Checklist Avant Déploiement

- [ ] ✅ Tester localement avec `diagnose.bat`
- [ ] ✅ Vérifier que `npm install` fonctionne
- [ ] ✅ Vérifier les variables d'environnement
- [ ] ✅ Vérifier la connexion à PostgreSQL
- [ ] ✅ Vérifier la connexion à Redis
- [ ] ✅ Vérifier `ecosystem.config.cjs` existe
- [ ] ✅ Vérifier `render.yml` ou les paramètres Render
- [ ] ✅ Tester `npm run pm2:start` localement

## 🚀 Déploiement

### Avec GitHub + Render:

1. **Push le code sur GitHub**
   ```bash
   git add .
   git commit -m "Add PM2 configuration for production"
   git push origin main
   ```

2. **Créer une Web Service sur Render.com**
   - Connectez votre repo GitHub
   - Render détectera `render.yml` automatiquement
   - Ou configurez manuellement:
     - Build Command: `npm ci`
     - Start Command: `npm run pm2:start`

3. **Configurer les variables d'environnement**
   - Allez dans **Environment** sur Render
   - Ajoutez:
     - `DATABASE_URL`
     - `REDIS_URL`
     - `JWT_SECRET`

4. **Déployer**
   - Cliquez sur **Deploy**
   - Attendez la fin du build
   - Vérifiez dans **Logs**

## 📝 Fichiers Importants

| Fichier | Usage |
|---------|-------|
| `ecosystem.config.cjs` | Config PM2 (local) |
| `ecosystem.config.production.cjs` | Config PM2 (production) |
| `render.yml` | Configuration Render.com |
| `diagnose.bat/sh` | Déboguer le serveur |
| `healthcheck.bat/sh` | Vérifier la santé |
| `PRODUCTION_TROUBLESHOOTING.md` | Guide détaillé |

## 🛠️ Commandes Utiles

```bash
# Démarrer localement avec PM2
npm run pm2:start

# Voir les logs
npm run pm2:logs

# Voir le dashboard
npm run pm2:monit

# Tester en mode production
NODE_ENV=production node server.js

# Déboguer
./diagnose.bat  (Windows)
./diagnose.sh   (Linux/Mac)

# Santé du serveur
./healthcheck.bat  (Windows)
./healthcheck.sh   (Linux/Mac)
```

## ❌ Erreurs Courantes

### "Application exited early" → Utiliser `diagnose.bat`
### "Cannot find module" → Exécuter `npm ci`
### "ECONNREFUSED" → Vérifier DATABASE_URL et REDIS_URL
### "PORT already in use" → Vérifier le port 8080

## 🎯 Résumé Rapide

1. **Tester localement:**
   ```bash
   ./diagnose.bat
   ```

2. **Configurer Render:**
   - Build: `npm ci`
   - Start: `npm run pm2:start`
   - Env vars: DATABASE_URL, REDIS_URL, JWT_SECRET

3. **Déployer:**
   ```bash
   git push origin main
   ```

4. **Vérifier:**
   - Voir les logs Render
   - Tester l'endpoint: `https://your-app.onrender.com/api/v1/health`

---

**Important:** Si ça ne fonctionne pas, utilisez `diagnose.bat` pour voir l'erreur réelle!
