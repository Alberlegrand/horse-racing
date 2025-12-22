# 🎛️ Panneau d'Administration Admin Dashboard

## 📋 Présentation

Le **Panneau d'Administration** est une interface web responsive complète permettant aux administrateurs de:
- ✅ Surveiller l'état du serveur en temps réel
- ✅ Contrôler les processus du serveur (redémarrage, cache)
- ✅ Gérer les rounds et le flux du jeu
- ✅ Accéder aux statistiques détaillées
- ✅ Consulter les logs du système

## 🚀 Accès

### Conditions Requises
- Compte avec rôle **`admin`** dans la base de données
- Connexion via la page de login (`/login.html`)
- Token JWT valide

### URL
```
https://your-app.com/admin-dashboard.html
```

### Redirection Automatique
Après connexion en tant qu'admin:
```
/login → Authentification → /admin-dashboard.html
```

## 📊 Sections Principales

### 1. **État du Serveur**
Affiche en temps réel:
- Statut (En ligne / Hors ligne)
- Uptime (durée de fonctionnement)
- Port écoute (8080)
- Version Node.js
- Mode (production/development)

### 2. **Base de Données**
Statistiques:
- PostgreSQL: Connectée/Déconnectée
- Nombre de connexions actives
- Redis: Connectée/Déconnectée

### 3. **État du Jeu**
Informations en temps réel:
- Round actuel
- Joueurs en ligne
- Parieurs actifs
- Total pariés dans l'heure

### 4. **Contrôles Serveur**
Actions disponibles:
- ⟳ **Redémarrer le Serveur** - Redémarrage gracieux
- 🗑️ **Vider le Cache** - Flush Redis entièrement
- ✓ **Vérifier la Santé** - Diagnostic complet

### 5. **Contrôles du Jeu**
Gestion des rounds:
- ⚡ **Forcer Nouveau Round** - Termine round actuel immédiatement
- ⏸️ **Pause Jeu** - Arrête tous les rounds
- ▶️ **Reprendre Jeu** - Relance les rounds

### 6. **Contrôles BD**
Maintenance:
- 💾 **Sauvegarder BD** - Crée un backup
- 🔄 **Reconstruire Cache** - Rempli Redis depuis PostgreSQL

### 7. **Statistiques Détaillées**
Dashboard avec:
- Revenue aujourd'hui
- Avg pari par round
- Rounds complétés
- Taux de succès

### 8. **Logs du Serveur**
- Affichage des 100 derniers logs
- Filtrage par niveau (info, success, warning, error)
- Effacement des logs

## 🔌 API Endpoints

Tous les endpoints sont protégés par:
1. Authentification JWT (`verifyToken`)
2. Rôle admin (`requireRole('admin')`)

### Health Check
```
GET /api/v1/admin/health
Response: { status, uptime, port, database, redis, gameState, stats }
```

### Server Controls
```
POST /api/v1/admin/server/restart        → Redémarrage
POST /api/v1/admin/server/cache/clear    → Vider cache
POST /api/v1/admin/server/logs/clear     → Effacer logs
```

### Game Controls
```
POST /api/v1/admin/game/round/force      → Forcer nouveau round
POST /api/v1/admin/game/pause            → Mettre en pause
POST /api/v1/admin/game/resume           → Reprendre
GET  /api/v1/admin/game/status           → État du jeu
```

### Database Controls
```
POST /api/v1/admin/database/backup             → Sauvegarde BD
POST /api/v1/admin/database/cache/rebuild      → Reconstruire cache
GET  /api/v1/admin/database/stats              → Statistiques BD
```

### System
```
GET /api/v1/admin/system/metrics         → CPU, RAM, uptime
GET /api/v1/admin/logs                   → Logs serveur
```

## 🎨 Responsive Design

Le dashboard est entièrement responsive:

### Desktop (> 768px)
- Grid 3 colonnes pour les cards
- Layouts optimisés
- Plein écran

### Tablet (480px - 768px)
- Grid 2 colonnes
- Boutons adapté

### Mobile (< 480px)
- Grid 1 colonne
- Boutons fullwidth
- Navigation centralisée

## 🔐 Sécurité

### Protections
1. **JWT Authentication** - Token stocké en localStorage
2. **Role-Based Access** - Seuls les admins accèdent
3. **CORS** - Requêtes depuis domaines autorisés
4. **HttpOnly Cookies** - Session sécurisée
5. **HTTPS obligatoire** - En production

### Logs d'Audit
Chaque action d'admin est loggée:
```
[ADMIN] Redémarrage du serveur initialisé par username
[ADMIN] Cache vidé par username
[ADMIN] Nouveau round forcé par username
```

## 📱 Utilisation

### 1. Connexion
```
1. Aller à /login.html
2. Entrer credentials admin
3. Automatic redirect vers /admin-dashboard.html
```

### 2. Surveiller le Serveur
- Page se refresh automatiquement chaque 5 sec
- Logs se refresh chaque 2 sec
- Badges colorés indiquent le statut

### 3. Redémarrer le Serveur
```
1. Cliquer "Redémarrer le Serveur"
2. Confirmation modale apparaît
3. Serveur redémarre après 2 sec
```

### 4. Forcer un Nouveau Round
```
1. Aller à "Contrôle du Jeu"
2. Cliquer "Forcer Nouveau Round"
3. Round actuel se termine immédiatement
4. Nouveau round commence
```

## 🛠️ Dépannage

### Problème: "Page non trouvée"
- Vérifier que `/admin-dashboard.html` est en `/public`
- Vérifier permission fichier
- Vérifier `NODE_ENV` du serveur

### Problème: "Non autorisé (401)"
- Vérifier que vous êtes connecté
- Vérifier que le token est valide
- Vérifier le rôle: doit être `'admin'`
- Vérifier le localStorage: `authToken`

### Problème: "Erreur de connexion BD"
- Vérifier `DATABASE_URL` dans `.env`
- Vérifier connexion PostgreSQL
- Vérifier firewall/proxy

### Problème: "État du serveur ne se met pas à jour"
- Vérifier que `/api/v1/admin/health` répond (Postman)
- Vérifier les logs du serveur
- Vérifier la console du navigateur (F12)

## 📈 Architecture

```
admin-dashboard.html (Frontend)
        ↓
  Fetch API (JWT Auth)
        ↓
  /api/v1/admin/* (Express Routes)
        ↓
  routes/admin.js (Route Handler)
        ↓
  game.js, redis.js, db.js (Backend Services)
```

## 🚀 Production

### Déploiement sur Render.com
1. `admin-dashboard.html` doit être en `/public`
2. Routes API dans `routes/admin.js`
3. Middleware de protection en place
4. Environment variables configurées

### Fichiers Critiques
- `public/admin-dashboard.html` - Interface
- `routes/admin.js` - API endpoints
- `server.js` - Enregistrement des routes

## 📝 Logs

Les actions admin génèrent des logs:
```
[ADMIN] Server restart initiated
[ADMIN] Cache cleared
[ADMIN] Force new round initiated
[ADMIN] Game paused
[ADMIN] Game resumed
[ADMIN] Database backup initiated
[ADMIN] Cache rebuilt
```

## 🔄 Actualisation

- **Status**: Chaque 5 secondes
- **Logs**: Chaque 2 secondes
- **Manuel**: Bouton Refresh (optionnel)

## 📞 Support

Pour problèmes:
1. Consulter les logs du serveur
2. Vérifier `/api/v1/admin/health`
3. Vérifier les credentials admin
4. Consulter `PRODUCTION_TROUBLESHOOTING.md`

---

**Créé le**: 22 Décembre 2025
**Version**: 1.0
**État**: Production-Ready ✅
