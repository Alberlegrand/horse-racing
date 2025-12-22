# 🚀 Configuration PM2 Production - Guide Complet

## 📋 Vue d'ensemble

PM2 (Process Manager 2) gère votre serveur Node.js en production avec:
- ✅ Redémarrage automatique en cas de crash
- ✅ Équilibrage de la charge
- ✅ Logging centralisé
- ✅ Monitoring en temps réel
- ✅ Démarrage automatique après reboot

## 🎯 Configuration Optimisée pour Production

### Stratégie de Redémarrage

```javascript
restart_delay: 4000,              // 4s avant redémarrage
max_restarts: 5,                  // Max 5 redémarrages en 15s
min_uptime: '10s',                // Crash = arrêt < 10s
exp_backoff_restart_delay: 100   // +100ms entre tentatives
```

**Signification:**
- Si serveur crash: attendre 4s, puis redémarrer
- Si crash > 5 fois en 15s: arrêter définitivement
- Chaque tentative successive attend +100ms (exponential backoff)

### Timeouts Critiques

```javascript
kill_timeout: 5000,               // 5s avant SIGKILL forcé
listen_timeout: 8000,             // 8s avant timeout démarrage
```

**Signification:**
- Serveur a 5s pour terminer proprement après SIGTERM
- Serveur a 8s pour se considérer démarré avec succès
- Si pas de réponse: kill forcé → redémarrage automatique

### Gestion des Ressources

```javascript
max_memory_restart: '500M',       // Redémarrer si > 500MB
watch: false,                     // Pas de watch en production
```

**Signification:**
- Surveillance mémoire constante
- Redémarrage automatique si fuite mémoire
- Pas de surveillance fichiers (économise CPU)

### Logging

```javascript
output: './logs/out.log',         // Logs standard (console.log)
error: './logs/error.log',        // Logs erreurs (console.error)
log_date_format: 'YYYY-MM-DD HH:mm:ss Z'
merge_logs: true                  // Fusionner tous les logs
```

## ⚙️ Installation Rapide

### Étape 1: Démarrer en Production

```bash
# Windows
./setup-production.bat

# Linux/Mac
chmod +x setup-production.sh
./setup-production.sh
```

**Ce script fait automatiquement:**
1. ✅ Vérifie PM2 installé (installe si besoin)
2. ✅ Crée dossier `logs/`
3. ✅ Arrête anciennes instances
4. ✅ Démarre avec `NODE_ENV=production`
5. ✅ Sauvegarde la configuration

### Étape 2: Vérifier le Status

```bash
# Voir tous les processus
npx pm2 status

# Voir les logs en temps réel
npm run pm2:logs

# Dashboard interactif
npm run pm2:monit
```

### Étape 3: Configurer Autostart

```bash
# Créer script de démarrage automatique
npx pm2 startup

# Sauvegarder pour que PM2 redémarre au reboot
npx pm2 save
```

**⚠️ IMPORTANT:** Exécutez `npx pm2 startup` - cela crée un cron job ou service qui redémarre PM2 au reboot du serveur!

## 📊 Fichiers Importants

| Fichier | Usage |
|---------|-------|
| `ecosystem.config.cjs` | Configuration PM2 (CommonJS) |
| `logs/out.log` | Sortie standard (console.log) |
| `logs/error.log` | Erreurs (console.error) |
| `setup-production.bat/sh` | Setup automatisé |

## 🔍 Comprendre les États

### État: `online`
✅ Application fonctionne correctement

```
┌─────────────────┬──────┬────────┐
│ Name            │ Mode │ Status │
├─────────────────┼──────┼────────┤
│ horse-racing... │ fork │ online │
└─────────────────┴──────┴────────┘
```

### État: `stopped`
⚠️ Application arrêtée (normale ou erreur)

```bash
npm run pm2:start  # Redémarrer
```

### État: `errored`
❌ Application en erreur

```bash
npm run pm2:logs   # Voir l'erreur
npm run pm2:restart # Redémarrer après fix
```

### État: `one-launch-status`
🔄 Redémarrage en cours

## 🛠️ Commandes Utiles

### Démarrage & Arrêt

```bash
# Démarrer avec config
npm run pm2:start

# Arrêter (graceful shutdown)
npm run pm2:stop

# Redémarrer
npm run pm2:restart

# Supprimer complètement
npm run pm2:delete
```

### Monitoring

```bash
# Voir les logs
npm run pm2:logs

# Dashboard temps réel
npm run pm2:monit

# Détails du processus
npx pm2 show horse-racing-server

# Voir historique redémarrages
npx pm2 save
npx pm2 resurrect
```

### Configuration

```bash
# Sauvegarder état actuel (pour autostart)
npm run pm2:save

# Restaurer configuration sauvegardée
npm run pm2:resurrect

# Créer autostart au reboot
npx pm2 startup
npm run pm2:save
```

## 🌐 Déploiement sur Render.com

### Configuration render.yml

```yaml
services:
  - type: web
    buildCommand: npm ci
    startCommand: npm run pm2:start
    env: production
    envVars:
      - key: NODE_ENV
        value: production
      - key: PORT
        value: 8080
      - key: DATABASE_URL
        sync: false
      - key: REDIS_URL
        sync: false
      - key: JWT_SECRET
        sync: false
```

### Variables d'Environnement Render

Dans le dashboard Render, ajouter:

```
NODE_ENV        = production
PORT            = 8080
DATABASE_URL    = postgresql://...
REDIS_URL       = redis://...
JWT_SECRET      = votre-secret
```

### Deploy Step-by-Step

1. **Commit et push:**
   ```bash
   git add .
   git commit -m "PM2 production configuration"
   git push origin main
   ```

2. **Créer Web Service sur Render:**
   - Connecter repo GitHub
   - Build Command: `npm ci`
   - Start Command: `npm run pm2:start`

3. **Ajouter variables d'environnement:**
   - Aller dans Settings → Environment
   - Ajouter DATABASE_URL, REDIS_URL, JWT_SECRET

4. **Déployer:**
   - Cliquer "Deploy"
   - Attendre fin du build
   - Vérifier dans Logs

## 📈 Monitoring en Production

### Logs Quotidiens

```bash
# Voir logs temps réel
npm run pm2:logs

# Voir les 100 dernières lignes
npx pm2 logs --lines 100

# Suivre logs spécifiques
npx pm2 logs horse-racing-server
```

### Alertes Critiques

PM2 surveille automatiquement:
- ❌ **Crash**: Application se arrête → redémarrage auto
- 💾 **Mémoire**: > 500MB → redémarrage préventif
- ⏱️ **Timeout**: Pas de réponse > 8s → kill forcé

### Dashboard Monit

```bash
npm run pm2:monit
```

Affiche en temps réel:
- CPU usage
- Memory usage
- Nombre requêtes/min
- Uptime

## ⚡ Performance Tips

### 1. Désactiver Watch (déjà fait)
```javascript
watch: false,  // Production n'a pas besoin de watch
```

### 2. Limiter Restart Attempts
```javascript
max_restarts: 5,  // Éviter boucles infinies
```

### 3. Exponential Backoff
```javascript
exp_backoff_restart_delay: 100,  // Augmente délai entre tentatives
```

### 4. Memory Limits
```javascript
max_memory_restart: '500M',  // Redémarrer avant fuite
```

## 🔐 Sécurité

### 1. Logs Sensibles
```bash
# Sécuriser logs
chmod 640 logs/out.log
chmod 640 logs/error.log
```

### 2. Permissions PM2
```bash
# PM2 doit avoir accès aux fichiers
sudo npm install -g pm2
sudo pm2 startup -u $USER
```

### 3. Autostart Sécurisé
```bash
# Créer autostart pour utilisateur courant
npx pm2 startup
npx pm2 save

# Vérifier cron job créé
sudo crontab -l | grep pm2
```

## 🐛 Dépannage

### Problème: "Application exited early"

**Solution 1:** Voir l'erreur réelle
```bash
./diagnose.bat  # ou ./diagnose.sh
```

**Solution 2:** Vérifier les logs
```bash
npm run pm2:logs
tail -f logs/error.log
```

**Solution 3:** Vérifier config
```bash
# Afficher config actuelle
npx pm2 show horse-racing-server
```

### Problème: Mémoire augmente

```bash
# Ajouter dans ecosystem.config.cjs:
max_memory_restart: '300M'  // Réduire si besoin

# Puis redémarrer
npm run pm2:restart
```

### Problème: Trop de redémarrages

```javascript
// Diminuer sensibilité
min_uptime: '30s',    // au lieu de 10s
max_restarts: 3,      // au lieu de 5
restart_delay: 8000   // au lieu de 4000
```

## 📚 Documentation

- [PM2 Official Docs](https://pm2.keymetrics.io/)
- [Render.com Deployment](https://render.com/docs)
- [Node.js Best Practices](https://nodejs.org/en/docs/guides/nodejs-performance/)

## ✅ Checklist Final

- [ ] PM2 installé: `npm install pm2`
- [ ] Config `ecosystem.config.cjs` optimisée
- [ ] Scripts `npm run pm2:*` fonctionnent
- [ ] Dossier `logs/` créé
- [ ] Autostart configuré: `npx pm2 startup && npm run pm2:save`
- [ ] Variables d'env définis
- [ ] Deploy sur Render avec `render.yml`
- [ ] Logs vérifiés sur Render dashboard
- [ ] Server health check: `./healthcheck.bat`

---

**Configuration PM2 terminée et optimisée pour production! 🎉**
