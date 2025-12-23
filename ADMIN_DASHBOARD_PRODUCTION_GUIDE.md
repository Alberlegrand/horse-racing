# 📊 Guide de Déploiement Admin Dashboard - Production

## 🎯 Vue d'ensemble

Le dashboard admin est maintenant **production-ready** avec:
- ✅ URL dynamique (fonctionne en dev ET production)
- ✅ Authentification sécurisée avec JWT
- ✅ Gestion des erreurs robuste
- ✅ Auto-reconnexion après redémarrage
- ✅ Logging complet des accès admin
- ✅ Headers de sécurité (Helmet)
- ✅ Configuration CORS pour production
- ✅ Sessions Redis (scalable)
- ✅ Middleware d'audit

---

## 📋 Pré-requis Production

1. **Node.js 18.x+** déployé
2. **PostgreSQL** accessible
3. **Redis** accessible
4. **Variables d'environnement** configurées
5. **HTTPS** activé (recommandé)

---

## 🔧 Configuration Avant Déploiement

### 1️⃣ Variables d'Environnement

Créer un fichier `.env` en production avec:

```bash
NODE_ENV=production
PORT=8080
DATABASE_URL=postgresql://user:pass@host/db
REDIS_URL=redis://user:pass@host:6379
JWT_SECRET=your-production-secret-key-here
SESSION_SECRET=your-production-session-key-here
ALLOWED_ORIGINS=https://yourdomain.com,https://app.yourdomain.com
```

### 2️⃣ Vérifier les Dépendances

```bash
# Installer si manquant
npm install helmet

# Vérifier que helmet est dans package.json
npm list helmet
```

### 3️⃣ Tester en Staging

Avant la production, tester:
- ✅ Login et redirect vers admin dashboard
- ✅ Chargement du statut serveur
- ✅ Redémarrage du serveur (npm run start)
- ✅ Auto-reconnexion du dashboard
- ✅ Pause/Resume du jeu
- ✅ Forçage d'une nouvelle manche

---

## 🚀 Déploiement sur Render.com

### Étape 1: Pousser le code

```bash
git add .
git commit -m "Production-ready admin dashboard with security headers"
git push origin main
```

### Étape 2: Render va auto-déployer

- Render détecte le changement
- Exécute `npm install`
- Exécute `npm start` pour lancer le serveur

### Étape 3: Vérifier le Déploiement

1. Accéder au dashboard: `https://your-render-domain.onrender.com/login.html`
2. Se connecter avec un compte admin
3. Vérifier que `/admin-dashboard.html` charge correctement
4. Tester les fonctionnalités principales

---

## 📊 Accès au Dashboard Admin

### URL de Production
```
https://your-domain.com/admin-dashboard.html
```

### Authentification
- Le dashboard se charge **SEULEMENT** pour les utilisateurs avec rôle **admin**
- Si l'utilisateur n'est pas admin, il est redirigé vers `/user-dashboard.html`
- Si pas connecté, redirection vers `/login.html`

### Protections de Sécurité
- ✅ JWT Bearer token obligatoire
- ✅ Rôle admin vérifié sur chaque requête
- ✅ IP logging pour audit
- ✅ Session Redis (pas de session en mémoire)
- ✅ Headers de sécurité (HSTS, CSP, X-Frame-Options)

---

## ⚙️ Fonctionnalités Admin

### 1. **Moniteur de Serveur** (Mis à jour toutes les 5 secondes)
- Status en ligne/hors ligne
- Uptime du serveur
- Version Node.js
- Port d'écoute
- Environnement (dev/production)

### 2. **Connecteurs** (Statut temps réel)
- 🗄️ Database PostgreSQL (connectée/déconnectée)
- 🔴 Redis Cache (connectée/déconnectée)

### 3. **Statistiques Jeu** (En direct)
- Manche actuelle
- Joueurs en ligne
- Parieurs actifs
- Total pariés
- Revenu du jour
- Taux de succès

### 4. **Contrôles Serveur**
- **Redémarrer**: Lance `npm run start` en arrière-plan
  - Timeout: 3 secondes avant redémarrage
  - Auto-reconnexion: 30 tentatives (30 secondes max)
  - Feedback en temps réel via logs
  
- **Vider Cache**: Flush Redis complet
  - Utile après changement de configuration
  
- **Health Check**: Test connectivité DB + Redis

### 5. **Contrôles Jeu**
- **Pause Jeu**: Arrête la création de nouvelles manches
- **Reprendre**: Reprend le jeu normal
- **Forcer Nouvelle Manche**: Termine manche actuelle immédiatement

### 6. **Gestion Base de Données**
- **Sauvegarde**: Crée une sauvegarde (2-5 min)
- **Reconstruire Cache**: Met en cache toutes les manches dans Redis
- **Statistiques**: Affiche nombre de manches, paris, comptes

### 7. **Logs Temps Réel** (Mis à jour toutes les 2 secondes)
- Historique des 100 dernières actions
- Color-coded par niveau (info, success, warning, error)
- Peut être vidé manuellement

---

## 🔍 Monitoring en Production

### Logs à Surveiller

**Logs Admin** (tous préfixés par `[ADMIN]`):
```
[ADMIN] [2025-12-22T10:30:45.123Z] GET /api/v1/admin/health - User: alice - IP: 192.168.1.1
[ADMIN] Server restart initiated by alice
[ADMIN] Performing graceful restart
[ADMIN] Restart command sent (npm run start), exiting current process...
```

**Logs de Démarrage** (vérifier que le dashboard est enregistré):
```
✅ Health check endpoint registered
✅ Game status endpoint registered
✅ Admin dashboard API mounted at /api/v1/admin/
```

### Métriques à Vérifier

1. **Performance du Dashboard**
   - Temps de chargement < 2s
   - Rafraîchissement du statut toutes les 5s
   - Logs rafraîchis toutes les 2s

2. **Availability**
   - Uptime du serveur
   - Statut Redis
   - Statut Database

3. **Sécurité**
   - Pas d'accès non-autorisé (vérifier les logs d'IP)
   - Pas de tokens JWT expirés
   - Pas d'erreurs d'authentification

---

## 🐛 Troubleshooting Production

### Problème: Dashboard charge mais pas de données

**Cause possible**: Variables d'environnement manquantes
```bash
# Solution: Vérifier .env en production
echo $DATABASE_URL
echo $REDIS_URL
echo $JWT_SECRET
```

### Problème: Redémarrage ne fonctionne pas

**Cause possible**: npm run start n'existe pas
```bash
# Solution: Vérifier package.json
cat package.json | grep -A 5 '"scripts"'
# Doit contenir: "start": "node server.js"
```

### Problème: Erreur CORS au chargement

**Cause possible**: ALLOWED_ORIGINS n'est pas configuré
```bash
# Solution: Ajouter à .env
ALLOWED_ORIGINS=https://your-domain.com
```

### Problème: Sessions ne persistent pas

**Cause possible**: Redis n'est pas accessible
```bash
# Solution: Vérifier Redis
npm install redis
# et vérifier REDIS_URL dans .env
```

---

## ✅ Checklist Avant Production

- [ ] `.env` configuré avec tous les secrets
- [ ] `npm install helmet` exécuté
- [ ] Tests de login/admin effectués en staging
- [ ] Redémarrage du serveur testé
- [ ] Logs d'audit vérifiés
- [ ] HTTPS activé
- [ ] CORS origins spécifiés
- [ ] Redis disponible et accessible
- [ ] PostgreSQL disponible et accessible
- [ ] JWT_SECRET différent du dev
- [ ] SESSION_SECRET différent du dev
- [ ] Monitoring des logs configuré

---

## 📝 Notes de Sécurité Production

1. **JWT Secret**: Générer une clé cryptographique forte
   ```bash
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   ```

2. **Session Secret**: Idem
   ```bash
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   ```

3. **HTTPS Obligatoire**: Render l'applique automatiquement

4. **Session Cookies**: 
   - HttpOnly: Activé (protection XSS)
   - Secure: Activé sur HTTPS
   - SameSite: Strict (protection CSRF)

5. **Rate Limiting**: À ajouter si beaucoup d'attaques
   ```bash
   npm install express-rate-limit
   ```

---

## 🎯 Prochaines Étapes

1. Déployer en production
2. Tester l'accès au dashboard
3. Monitorer les logs
4. Configurer alertes (si disponible)
5. Documenter les procédures opérationnelles

---

## 📞 Support

En cas de problème:
1. Vérifier les logs Render
2. Vérifier les variables d'environnement
3. Vérifier la connectivité aux services externes
4. Tester en local en premier

---

**Version**: 1.0.0  
**Dernière mise à jour**: 2025-12-22  
**Statut**: ✅ Production-Ready
