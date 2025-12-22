# 🎛️ Dashboard Admin - Guide de Démarrage Rapide

## ✅ Tout Est Configuré

Le dashboard admin est **100% fonctionnel** et prêt à l'emploi!

## 🚀 Comment Accéder

### 1. Lancer le serveur
```bash
npm start
# ou
npm run dev
# ou
npm run pm2:start
```

### 2. Ouvrir le navigateur
```
http://localhost:8080/login.html
```

### 3. Se connecter en tant qu'admin
```
Username: admin
Password: (votre password admin)
Station: 1 (ou n'importe quel numéro)
```

### 4. Automatic redirect vers le dashboard
```
→ http://localhost:8080/admin-dashboard.html
```

## 📊 Qu'est-ce que Vous Pouvez Faire

### 🔍 Surveiller
- État du serveur (En ligne, CPU, RAM)
- Base de données (Connexions, Rounds)
- Redis (Connecté/Déconnecté)
- État du jeu (Round actuel, joueurs, pariours)
- Logs en temps réel (mise à jour toutes les 2s)

### 🎮 Contrôler
- ⟳ **Redémarrer le serveur** (graceful restart)
- 🗑️ **Vider le cache** Redis
- ⚡ **Forcer un nouveau round** (termine le round actuel)
- ⏸️ **Mettre en pause** le jeu
- ▶️ **Reprendre** le jeu
- 💾 **Sauvegarder** la base de données
- 🔄 **Reconstruire le cache** depuis la BD

### 📈 Analyser
- Revenue aujourd'hui
- Avg pari par round
- Rounds complétés
- Taux de succès
- Stats BD complètes

## 🎨 Interface

- **Responsive** - Fonctionne sur desktop, tablet, mobile
- **Temps réel** - Refresh auto chaque 5 secondes
- **Alerts** - Feedback visuel pour chaque action
- **Emojis** - Indication visuelle claire
- **Logs** - 100 derniers logs avec coloration

## 🛡️ Sécurité

✅ **Authentification JWT** - Token sécurisé
✅ **Rôle Admin** - Seulement les admins accèdent
✅ **Logging d'Audit** - Toutes les actions enregistrées
✅ **Gestion d'erreurs** - Erreurs affichées clairement
✅ **HTTPS en Prod** - Sécurisé sur Render.com

## 📝 Actions Populaires

### Je veux redémarrer le serveur
```
1. Cliquez sur "Redémarrer le Serveur"
2. Confirmez dans la modale
3. Serveur redémarre après 2 secondes
4. Page se reconnecte automatiquement
```

### Je veux forcer un nouveau round
```
1. Allez à "Contrôle du Jeu"
2. Cliquez "Forcer Nouveau Round"
3. Confirmez
4. Round actuel se termine immédiatement
5. Nouveau round commence
```

### Je veux vider le cache
```
1. Allez à "Contrôle du Serveur"
2. Cliquez "Vider le Cache"
3. Redis est flushé
4. Tous les caches supprimés
```

### Je veux voir les stats de la BD
```
1. Regardez "État du Serveur" → "Base de Données"
2. Regardez "Statistiques Détaillées" en bas
3. Refresh auto chaque 30 secondes
```

## 🔧 Problèmes Courants

### "Page non trouvée"
```
✅ Vérifier: http://localhost:8080/admin-dashboard.html existe
✅ Vérifier: Fichier en /public/admin-dashboard.html
✅ Redémarrer: npm start
```

### "Non autorisé (401)"
```
✅ Vérifier: Vous êtes connecté en tant qu'admin
✅ Vérifier: localStorage.getItem('authToken') dans console
✅ Vérifier: Role = 'admin' dans la BD
```

### "Erreur de connexion API"
```
✅ Vérifier: npm start (serveur lancé)
✅ Vérifier: http://localhost:8080/api/v1/admin/health (console)
✅ Vérifier: Pas d'erreurs dans server logs
```

## 📱 Responsive Design

✅ **Desktop** (> 768px) - Layout 3 colonnes
✅ **Tablet** (480-768px) - Layout 2 colonnes  
✅ **Mobile** (< 480px) - Layout 1 colonne

Adaptatif pour tous les écrans!

## 🧪 Tester les API

### Via Bash (Linux/Mac)
```bash
chmod +x test-admin-api.sh
./test-admin-api.sh
```

### Via Batch (Windows)
```batch
test-admin-api.bat
```

### Manuellement (Postman/Curl)
```bash
# Get health status
curl -X GET http://localhost:8080/api/v1/admin/health \
  -H "Authorization: Bearer YOUR_TOKEN"

# Pause game
curl -X POST http://localhost:8080/api/v1/admin/game/pause \
  -H "Authorization: Bearer YOUR_TOKEN"

# Resume game
curl -X POST http://localhost:8080/api/v1/admin/game/resume \
  -H "Authorization: Bearer YOUR_TOKEN"
```

## 📞 API Endpoints

```
GET  /api/v1/admin/health                    - État serveur
GET  /api/v1/admin/game/status              - État du jeu
GET  /api/v1/admin/database/stats           - Stats BD
GET  /api/v1/admin/system/metrics           - Metrics système
GET  /api/v1/admin/logs                     - Logs serveur

POST /api/v1/admin/server/restart           - Redémarrer
POST /api/v1/admin/server/cache/clear       - Vider cache
POST /api/v1/admin/game/pause               - Pause jeu
POST /api/v1/admin/game/resume              - Reprendre
POST /api/v1/admin/game/round/force         - Forcer round
POST /api/v1/admin/database/backup          - Backup BD
POST /api/v1/admin/database/cache/rebuild   - Rebuild cache
```

## 🎯 Cas d'Usage

### Avant un déploiement
- ✅ Vérifier la santé du serveur
- ✅ Vérifier les connexions BD
- ✅ Vérifier le Redis
- ✅ Backuper la BD

### Pendant une maintenance
- ✅ Mettre le jeu en pause
- ✅ Vider le cache
- ✅ Reconstruire le cache
- ✅ Reprendre le jeu

### En cas de problème
- ✅ Vérifier les logs
- ✅ Vérifier la santé
- ✅ Forcer un nouveau round
- ✅ Redémarrer le serveur

### Analyse
- ✅ Voir les stats
- ✅ Voir les rounds complétés
- ✅ Voir la revenue
- ✅ Voir les pariours actifs

## 📚 Documentation

Pour plus de détails, voir:
- `ADMIN_DASHBOARD.md` - Documentation complète
- `ADMIN_DASHBOARD_SETUP.md` - Configuration détaillée
- `routes/admin.js` - Code des API
- `public/admin-dashboard.html` - Code frontend

## ✨ Features Highlights

🎯 **Interface Intuitif** - Clair et facile à utiliser
⚡ **Actions Rapides** - Contrôle immédiat du serveur
📊 **Dashboard Temps Réel** - Données live toutes les 5s
🔐 **Sécurisé** - Authentification JWT + Rôle admin
📱 **Responsive** - Desktop, tablet, mobile
🎨 **Moderne** - Design professionnel avec emojis
🛡️ **Robuste** - Gestion complète des erreurs

## 🚀 Prêt à l'emploi

Pas de configuration supplémentaire nécessaire!

Le dashboard est:
✅ Créé
✅ Enregistré
✅ Sécurisé
✅ Documenté
✅ Prêt pour la production

**Utilisez-le maintenant!** 🎉

---

**Besoin d'aide?** Consulter les logs:
```bash
npm run pm2:logs
# ou
tail -f logs/out.log
```

**Date**: 22 Décembre 2025
**Version**: 1.0
**Status**: ✅ Production Ready
