# 🧪 Guide de Test Local Avant Production

## 🎯 Objectif

Vérifier que PM2 fonctionne correctement **localement** avant de deployer sur Render.com.

## ⏱️ Durée Estimée

5-10 minutes

## 📋 Étapes

### Étape 1: Vérifier Configuration (.env)

```bash
# Windows
./check-config.bat

# Linux/Mac
./check-config.sh
```

**Attendez:** ✅ pour toutes les variables

### Étape 2: Installer Dépendances

```bash
npm install
```

**Attendez:** Fin de l'installation sans erreurs

### Étape 3: Tester Server Directement

```bash
# Lancer server sans PM2
node server.js
```

**Cherchez:**
```
✅ Server is running on http://localhost:8080
✅ WebSocket server listening
✅ Database connected
✅ Redis connected
```

**Puis:**
```
Ctrl + C  (arrêter le serveur)
```

### Étape 4: Tester avec PM2

#### 4.1 Démarrer avec PM2

```bash
npm run pm2:start
```

**Attendez:** Status change to "online"

#### 4.2 Vérifier Status

```bash
npm run pm2:status
```

**Résultat attendu:**
```
┌─────────────────────────┬──────┬───────┬──────┐
│ Name                    │ Mode │ Status │ Up   │
├─────────────────────────┼──────┼───────┼──────┤
│ horse-racing-server     │ fork │online │ 0s  │
└─────────────────────────┴──────┴───────┴──────┘
```

#### 4.3 Vérifier les Logs

```bash
npm run pm2:logs
```

**Cerchez:**
```
✅ Aucune erreur dans les logs
✅ "Server is running"
✅ "Database connected"
✅ "Redis connected"
```

**Pour quitter:**
```
Ctrl + C
```

### Étape 5: Tester Endpoints

```bash
# Dans un autre terminal/PowerShell

# Test 1: Health Check
curl http://localhost:8080/api/v1/health

# Test 2: Status
curl http://localhost:8080/api/v1/rounds/status

# Test 3: Frontend
curl http://localhost:8080
```

**Attendez:**
```
✅ Réponse HTTP 200
✅ JSON valide
✅ HTML de l'accueil
```

### Étape 6: Tester Simulation de Crash

```bash
# Voir les processus
npm run pm2:status

# Simuler un crash (dans un autre terminal)
npx pm2 kill horse-racing-server

# Vérifier que PM2 redémarre auto
npm run pm2:status
# Doit afficher uptime faible (auto-restart)

# Vérifier les logs
npm run pm2:logs
```

**Attendez:**
```
✅ Voir les messages de redémarrage
✅ Status revient à "online"
✅ Uptime repart de 0s
```

### Étape 7: Vérifier Mémoire

```bash
npm run pm2:monit
```

**Vérifiez:**
```
✅ CPU: < 50%
✅ Memory: < 100MB
✅ Aucune fuite mémoire (stable)
```

**Pour quitter:**
```
Ctrl + C
```

### Étape 8: Arrêter pour Production

```bash
npm run pm2:stop
npm run pm2:delete
```

**Vérifiez:**
```bash
npm run pm2:status
# Doit montrer: "stopped"
```

## ✅ Checklist de Validation

- [ ] Configuration .env complète
- [ ] `npm install` réussi
- [ ] `node server.js` lance sans erreur
- [ ] PM2 démarre correctement
- [ ] Status affiche "online"
- [ ] Logs sans erreurs
- [ ] Endpoints répondent (200 OK)
- [ ] Simulation crash fonctionne
- [ ] Mémoire stable
- [ ] Services arrêtés proprement

## 🚨 Problèmes Courants

### ❌ "Cannot find module"

**Solution:**
```bash
npm install
```

### ❌ "ECONNREFUSED" (Database)

**Vérifier:**
```bash
# DATABASE_URL dans .env
echo $DATABASE_URL

# Tester connexion
psql $DATABASE_URL
```

### ❌ "Port already in use"

**Trouver et tuer le process:**
```bash
# Windows
netstat -ano | findstr :8080
taskkill /PID <PID> /F

# Linux/Mac
lsof -i :8080
kill -9 <PID>
```

### ❌ PM2 status: "errored"

**Voir l'erreur:**
```bash
npm run pm2:logs
tail -f logs/error.log
```

### ❌ Logs vides

**Vérifier permissions:**
```bash
# Linux/Mac
chmod 755 logs
chmod 644 logs/*.log
```

## 🔍 Debug Avancé

### Voir Configuration PM2 Actuelle

```bash
npx pm2 show horse-racing-server
```

### Voir Historique Redémarrages

```bash
npx pm2 logs --lines 50
```

### Exporter Logs vers Fichier

```bash
npm run pm2:logs > local-test.log
```

## 📊 Résumé Rapide

```bash
# 1. Check config
./check-config.bat

# 2. Install deps
npm install

# 3. Test direct
node server.js  # Ctrl+C après voir "running"

# 4. Test PM2
npm run pm2:start
npm run pm2:status
npm run pm2:logs  # Ctrl+C

# 5. Test endpoints
curl http://localhost:8080/api/v1/health

# 6. Cleanup
npm run pm2:delete
```

## ✨ Après Test Réussi

Vous êtes prêt pour **Render.com**! 🚀

**Prochaines étapes:**
1. Commit les changements: `git add . && git commit -m "PM2 config" && git push`
2. Créer Web Service sur Render.com
3. Ajouter variables d'environnement
4. Déployer

---

**Besoin d'aide?** Consulter `PRODUCTION_CHECKLIST.md`
