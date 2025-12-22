# 🎛️ Configuration Complète du Dashboard Admin

## ✅ Statut de Configuration

Tous les éléments du dashboard admin sont maintenant **opérationnels** ✅

### Checklist de Configuration

- [x] **Page Admin HTML** (`public/admin-dashboard.html`) - Créée et stylisée
- [x] **Routes API Admin** (`routes/admin.js`) - Implémentées avec gestion d'erreurs
- [x] **Enregistrement des Routes** - Ajoutées dans `server.js`
- [x] **Authentification** - Middleware `verifyToken` + `requireRole('admin')`
- [x] **Route /auth/me** - Ajoutée pour récupérer les infos utilisateur
- [x] **Redirection Login** - Admin → `/admin-dashboard.html`
- [x] **Gestion d'Erreurs** - Avec alertes et logs
- [x] **Emojis et Feedback** - Feedback visuel complet

---

## 📡 Endpoints API Configurés

### Health & Status
```
GET /api/v1/admin/health
Response: { status, uptime, port, nodeVersion, database, redis, gameState, stats }
```

### Server Controls
```
POST /api/v1/admin/server/restart          → Redémarrage serveur
POST /api/v1/admin/server/cache/clear      → Vider le cache Redis
POST /api/v1/admin/server/logs/clear       → Effacer les logs
```

### Game Controls
```
POST /api/v1/admin/game/round/force        → Forcer nouveau round
POST /api/v1/admin/game/pause              → Mettre le jeu en pause
POST /api/v1/admin/game/resume             → Reprendre le jeu
GET  /api/v1/admin/game/status             → État du jeu
```

### Database Controls
```
POST /api/v1/admin/database/backup         → Sauvegarder la BD
POST /api/v1/admin/database/cache/rebuild  → Reconstruire le cache
GET  /api/v1/admin/database/stats          → Statistiques BD
```

### System
```
GET /api/v1/admin/system/metrics           → Métriques CPU/RAM
GET /api/v1/admin/logs                     → Logs du serveur
GET /api/v1/admin/user/me                  → Infos utilisateur
```

### Auth
```
GET /api/v1/auth/me                        → Récupérer l'user actuellement connecté
```

---

## 🎨 Features du Dashboard

### 1️⃣ État du Serveur
- ✅ Statut en temps réel (En ligne / Dégradé)
- ✅ Uptime au format lisible (2j 3h)
- ✅ Port, Version Node.js, Mode (prod/dev)

### 2️⃣ État de la Base de Données
- ✅ PostgreSQL connecté/déconnecté
- ✅ Nombre de connexions actives
- ✅ Redis connecté/déconnecté

### 3️⃣ État du Jeu
- ✅ Round actuel
- ✅ Joueurs en ligne
- ✅ Parieurs actifs
- ✅ Total pariés dans l'heure

### 4️⃣ Contrôles Serveur
- ✅ **Redémarrer** - Restart gracieux après 2s
- ✅ **Vider Cache** - Flush Redis avec confirmation
- ✅ **Vérifier Santé** - Diagnostic complet

### 5️⃣ Contrôles du Jeu
- ✅ **Forcer Nouveau Round** - Termine round actuel immédiatement
- ✅ **Pause Jeu** - Arrête les rounds
- ✅ **Reprendre Jeu** - Relance les rounds

### 6️⃣ Contrôles BD
- ✅ **Sauvegarder** - Backup scheduling
- ✅ **Reconstruire Cache** - Rempli Redis depuis PostgreSQL

### 7️⃣ Statistiques
- ✅ Revenue aujourd'hui
- ✅ Avg pari par round
- ✅ Rounds complétés
- ✅ Taux de succès

### 8️⃣ Logs
- ✅ Affichage 100 derniers logs
- ✅ Filtrage par niveau (info, success, warning, error)
- ✅ Coloration syntaxe
- ✅ Bouton effacer

---

## 🔧 Fonctionnalités de Sécurité

### Authentification
```javascript
// Protégé par middleware
router.use(verifyToken, requireRole('admin'));

// Vérifie JWT dans cookie ou Authorization header
// Vérifie que l'utilisateur a le rôle 'admin'
```

### Logging d'Audit
Toutes les actions admin sont loggées:
```
[ADMIN] Force new round initiated by username
[ADMIN] Cache cleared by username
[ADMIN] Server restart initiated by username
[ADMIN] Game paused by username
```

### Erreur Handling
- Gestion d'erreurs complète
- Feedback utilisateur via alertes
- Logs détaillés pour débogage
- Messages d'erreur clairs

---

## 📝 Actions avec Logs Détaillés

### Redémarrage du Serveur
```
User: Admin clicks "Redémarrer le Serveur"
    ↓
Confirmation modale: "Êtes-vous sûr?"
    ↓
POST /api/v1/admin/server/restart
    ↓
[ADMIN] Server restart initiated by admin_username
    ↓
Alert: "Serveur en cours de redémarrage..."
    ↓
Process.exit(0) après 2s
    ↓
Log: "⚠️ Redémarrage du serveur initialisé"
```

### Forcer Nouveau Round
```
User: Admin clicks "Forcer Nouveau Round"
    ↓
Confirmation modale
    ↓
POST /api/v1/admin/game/round/force
    ↓
[ADMIN] Force new round initiated by admin_username
    ↓
gameState.forceNewRound = true
    ↓
Alert: "Nouveau round forcé avec succès"
    ↓
Log: "⚡ Nouveau round forcé (Round #123)"
```

### Vider le Cache
```
User: Admin clicks "Vider le Cache"
    ↓
POST /api/v1/admin/server/cache/clear
    ↓
[ADMIN] Cache cleared by admin_username
    ↓
redisClient.flushDb()
    ↓
Alert: "Cache vidé avec succès"
    ↓
Log: "🗑️ Cache vidé: Redis"
```

---

## 🎯 Utilisation Pratique

### Se Connecter en tant qu'Admin

1. **Aller au login**
   ```
   http://localhost:8080/login.html
   ```

2. **Entrer les credentials admin**
   - Username: admin
   - Password: (admin password from DB)
   - Station: (any station number)

3. **Automatic redirect**
   ```
   → /admin-dashboard.html
   ```

### Surveiller le Serveur

- Dashboard se refresh **toutes les 5 secondes**
- Logs se refresh **toutes les 2 secondes**
- Indicateurs colorés pour statut:
  - 🟢 Vert (En ligne / OK)
  - 🔴 Rouge (Hors ligne / Erreur)
  - 🟡 Jaune (Avertissement)

### Actions avec Confirmation

Certaines actions demandent une confirmation:
- **Redémarrer le Serveur** - Modale de confirmation
- **Forcer un Nouveau Round** - Modale de confirmation
- **Sauvegarder BD** - Modale de confirmation

Cliquez **Confirmer** pour procéder ou **Annuler** pour annuler.

---

## 🚀 Responsive Design

Le dashboard fonctionne sur tous les appareils:

### Desktop (> 768px)
- Grid 3 colonnes
- Full featured
- Plein écran

### Tablet (480-768px)
- Grid 2 colonnes
- Adaptation layout

### Mobile (< 480px)
- Grid 1 colonne
- Boutons full-width
- Navigation optimisée

---

## 🛠️ Dépannage

### Problème: "Non autorisé (401)"
**Cause:** Token invalide ou rôle non-admin
**Solution:** 
```
1. Vérifier être connecté en tant qu'admin
2. Vérifier localStorage → authToken existe
3. Vérifier le rôle dans la base: SELECT role FROM accounts WHERE username='admin'
```

### Problème: "Page non trouvée"
**Cause:** Fichier non en `/public`
**Solution:**
```
1. Vérifier: ls -la public/admin-dashboard.html
2. Sinon créer depuis 0
```

### Problème: API ne répond pas
**Cause:** Routes non enregistrées
**Solution:**
```
1. Vérifier dans server.js: app.use("/api/v1/admin/", adminRouter);
2. Vérifier admin.js import: import adminRouter from "./routes/admin.js";
3. Redémarrer le serveur: npm start
```

### Problème: États ne se mettent pas à jour
**Cause:** Refresh interval ne fonctionne pas
**Solution:**
```
1. Ouvrir console: F12 → Console
2. Vérifier les erreurs (red messages)
3. Vérifier authToken: localStorage.getItem('authToken')
```

---

## 📊 Formats de Données

### Health Response
```json
{
  "status": "ok",
  "uptime": 3600,
  "port": 8080,
  "nodeVersion": "v18.20.8",
  "nodeEnv": "production",
  "database": {
    "connected": true,
    "connections": 5
  },
  "redis": {
    "connected": true
  },
  "gameState": {
    "currentRound": 42,
    "onlinePlayers": 10,
    "activeBettors": 7,
    "totalBets": 150000
  },
  "stats": {
    "revenueToday": 5000,
    "avgBetPerRound": 3000,
    "completedRounds": 100,
    "successRate": 98.5
  }
}
```

### Error Response
```json
{
  "error": "message d'erreur détaillé"
}
```

---

## 📞 Logs Réels

Les logs affichent:
- **Timestamp** - Heure précise
- **Niveau** - INFO, SUCCESS, WARNING, ERROR
- **Message** - Description lisible
- **Emojis** - Indication visuelle

Exemple:
```
[15:30:45] ✅ Connexion au panneau d'administration
[15:31:02] ⚠️ Redémarrage du serveur initialisé
[15:31:04] ⚡ Nouveau round forcé (Round #43)
[15:31:10] ❌ Erreur accès API admin: 401
```

---

## ✨ Améliorations Futures (Optionnel)

- [ ] Graphiques de performance en temps réel
- [ ] Export des logs en CSV
- [ ] Gestion des utilisateurs (créer/modifier/supprimer)
- [ ] Configuration des timers depuis le dashboard
- [ ] Monitoring des connexions WebSocket
- [ ] Historique des actions d'admin
- [ ] Système de notifications
- [ ] Mode sombre/clair

---

## 📦 Fichiers Modifiés/Créés

```
✅ public/admin-dashboard.html                  (CRÉÉ - Page complète)
✅ routes/admin.js                              (CRÉÉ - Toutes les API)
✅ routes/auth.js                               (MODIFIÉ - Ajout /auth/me)
✅ server.js                                    (MODIFIÉ - Enregistrement route admin)
✅ ADMIN_DASHBOARD.md                           (CRÉÉ - Documentation)
✅ ADMIN_DASHBOARD_SETUP.md                     (CRÉÉ - Ce fichier)
```

---

## 🎉 Status Final

**Dashboard Admin: ✅ 100% Opérationnel**

Tous les éléments sont:
- ✅ Créés
- ✅ Enregistrés
- ✅ Testés
- ✅ Documentés
- ✅ Sécurisés
- ✅ Responsive

**Prêt pour la production!** 🚀

---

**Date**: 22 Décembre 2025
**Version**: 1.0 - Final
**Status**: ✅ Production Ready
