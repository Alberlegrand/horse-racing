# 🚨 Production Troubleshooting - "Application exited early"

## ❓ Qu'est-ce que cela signifie?

L'erreur **"Application exited early"** en production sur Render signifie:

```
PM2 lance le serveur → Serveur crash immédiatement → PM2 ne peut pas capturer l'erreur
```

## 🔍 Causes Possibles

### 1️⃣ Variables d'environnement manquantes
- `.env` fichier n'existe pas
- Port déjà utilisé
- Base de données non accessible

### 2️⃣ Dépendances manquantes
- `npm install` n'a pas été exécuté
- Node modules corrompus

### 3️⃣ Erreurs au démarrage du serveur
- Erreur d'importation ES module
- Connexion Redis/PostgreSQL échoue
- Configuration invalide

### 4️⃣ Problèmes de déploiement
- Build script échoue
- Fichiers manquants après deployment
- Permissions insuffisantes

## ✅ Solution Étape par Étape

### Étape 1: Tester localement en mode production

```bash
# Lancer le serveur directement (sans PM2) pour voir l'erreur réelle
./diagnose.bat          # Windows
./diagnose.sh           # Linux/Mac
```

Ou manuellement:
```bash
set NODE_ENV=production
node server.js
```

Ceci affichera la **vraie erreur** que PM2 cache.

### Étape 2: Configurer render.com

Dans le **render.yml** ou l'interface Render:

```yaml
services:
  - type: web
    name: horse-racing
    runtime: node
    buildCommand: npm install
    startCommand: npm run pm2:start
    envVars:
      - key: NODE_ENV
        value: production
      - key: PORT
        value: 8080
      - key: DATABASE_URL
        value: your-database-url
      - key: REDIS_URL
        value: your-redis-url
```

### Étape 3: Vérifier les logs Render

Dans Render.com:
1. Allez à **Logs**
2. Cherchez les erreurs 
3. Copiez l'erreur exacte

### Étape 4: Vérifier les fichiers critiques

Assurez-vous que ces fichiers existent:
- ✅ `server.js`
- ✅ `package.json`
- ✅ `ecosystem.config.cjs`
- ✅ `.env` (ou variables d'environnement définies)

## 🔧 Configuration Render pour PM2

Pour que PM2 fonctionne sur Render:

**render.yml:**
```yaml
services:
  - type: web
    buildCommand: npm ci
    startCommand: npm run pm2:start
    env: production
    numInstances: 1
```

Ou via l'interface:
- **Build Command:** `npm ci`
- **Start Command:** `npm run pm2:start`
- **Environment:** `production`

## 📝 Fichiers de Configuration

### ecosystem.config.cjs (Development)
- Logging détaillé
- Watch mode activé
- Pour local development

### ecosystem.config.production.cjs (Production)
- Logging en fichier
- Watch mode désactivé
- Max restarts limité

## 🛠️ Debugging Avancé

### Afficher les logs PM2
```bash
npx pm2 logs
npx pm2 logs --err
```

### Voir le status en détail
```bash
npx pm2 show horse-racing-server
```

### Simuler l'erreur de production localement
```bash
NODE_ENV=production node server.js
```

## 📊 Checklist Production

- [ ] Variables d'environnement définies
- [ ] `npm install` exécuté
- [ ] Base de données accessible
- [ ] Redis accessible
- [ ] Port 8080 disponible
- [ ] Fichiers `.env` ou `render.yml` configurés
- [ ] `ecosystem.config.cjs` présent
- [ ] Build command: `npm ci`
- [ ] Start command: `npm run pm2:start`

## 🆘 Erreurs Courantes et Solutions

### Error: connect ECONNREFUSED
**Cause:** Redis ou PostgreSQL non accessible
**Solution:** Vérifier les variables `DATABASE_URL` et `REDIS_URL`

### Error: PORT already in use
**Cause:** Port 8080 déjà utilisé
**Solution:** Changer le port dans `ecosystem.config.cjs` ou vérifier les processus

### Error: Cannot find module
**Cause:** `npm install` n'a pas été exécuté
**Solution:** Ajouter `npm ci` dans le build command

### Application exited early (exit code 1)
**Cause:** Erreur au démarrage
**Solution:** Utiliser `diagnose.sh/bat` pour voir l'erreur réelle

## 🚀 Démarrage Alternatif Sans PM2

Si PM2 pose problème, utiliser directement Node:

**package.json:**
```json
"start": "node server.js"
```

**render.yml:**
```yaml
startCommand: npm start
```

## 📞 Support

Si vous ne trouvez pas l'erreur:

1. Utilisez `./diagnose.bat` ou `./diagnose.sh`
2. Copiez l'erreur exacte affichée
3. Consultez Render logs
4. Vérifiez les variables d'environnement

---

**Note:** PM2 est excellent pour la production mais masque les erreurs de démarrage. Toujours tester localement avec `diagnose.bat/sh` avant de déployer!
