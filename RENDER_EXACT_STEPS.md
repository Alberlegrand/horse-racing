# ⚙️ Configuration Render - Checklist Exacte

## IMMÉDIAT: Tâches à Effectuer sur Render Dashboard

### Étape 1: Ajouter Variable d'Environnement

**URL**: https://dashboard.render.com/  
**Allez à**: Your Services → horse-racing-gmqj → Settings → Environment

**Action**: Ajouter ou Vérifier

```
KEY: NODE_ENV
VALUE: production
```

**Screenshot mental**:
```
Environment Variables
┌─────────────────────────────────────────┐
│ KEY             VALUE                   │
├─────────────────────────────────────────┤
│ NODE_ENV        production      ← ADD   │
│ DB_URL          postgres://...  ← EXIST│
│ JWT_SECRET      ...             ← EXIST│
└─────────────────────────────────────────┘
```

### Étape 2: Sauvegarder

- Cliquer: **"Save Changes"**
- Attendre le redéploiement automatique
- Ou cliquer: **"Clear Cache & Deploy"** pour forcer

### Étape 3: Vérifier les Logs

**URL**: Your Services → horse-racing-gmqj → Logs

**Chercher dans les logs** (peut prendre 30-60 secondes):

```
Mode: PRODUCTION
```

Puis:

```
📡 Configuration WebSocket - Mode: PRODUCTION
Protocol: wss://
Host: horse-racing-gmqj.onrender.com
URL Complète: wss://horse-racing-gmqj.onrender.com/connection/websocket
```

**Exemple complet de logs attendus**:
```
2025-11-30 14:30:45 │ ════════════════════════════════════════════════════════
2025-11-30 14:30:45 │ 🚀 Démarrage du serveur
2025-11-30 14:30:45 │ ════════════════════════════════════════════════════════
2025-11-30 14:30:45 │ Mode: PRODUCTION
2025-11-30 14:30:45 │ Port Express: 8080
2025-11-30 14:30:45 │ Timestamp: 2025-11-30T14:30:45.123Z
2025-11-30 14:30:45 │ ════════════════════════════════════════════════════════
2025-11-30 14:30:47 │ ✅ Base de données prête (latence: 450ms)
2025-11-30 14:30:48 │ ✅ [STARTUP] Participants chargés (5 chevaux)
2025-11-30 14:30:49 │ ════════════════════════════════════════════════════════
2025-11-30 14:30:49 │ 📡 Configuration WebSocket - Mode: PRODUCTION
2025-11-30 14:30:49 │ ════════════════════════════════════════════════════════
2025-11-30 14:30:49 │ Protocol: wss://
2025-11-30 14:30:49 │ Host: horse-racing-gmqj.onrender.com
2025-11-30 14:30:49 │ Path: /connection/websocket
2025-11-30 14:30:49 │ URL Complète: wss://horse-racing-gmqj.onrender.com/connection/websocket
2025-11-30 14:30:49 │ Description: WebSocket sécurisé (TLS/SSL) pour production Render
2025-11-30 14:30:49 │ ════════════════════════════════════════════════════════
```

---

## Vérification Client Côté Navigateur

### Étape 4: Ouvrir la Page

```
URL: https://horse-racing-gmqj.onrender.com
```

### Étape 5: Vérifier DevTools

**Windows/Linux**: F12 ou Ctrl+Shift+I  
**Mac**: Cmd+Option+I

**Onglet: Network**

**Filtre**: Taper `WS` pour voir les WebSockets

**Vérifier**:
1. Ligne avec `/connection/websocket`
2. Colonne "Status" = `101 Switching Protocols` ✅
3. Colonne "Type" = `websocket`
4. Colonne "Protocol" = **`wss`** (NOT `ws`)

**Exact à voir**:
```
Name                      Status  Type         Protocol
/connection/websocket     101     websocket    wss
```

### Étape 6: Vérifier Console

**Onglet: Console**

**Chercher**: (Il ne devrait PAS y avoir d'erreurs WebSocket)

```
❌ NE PAS VOIR:
  - WebSocket is closed before the connection is established
  - Failed to connect to WebSocket
  - ws:// (en production, ce serait une erreur)

✅ VOIR PEUT-ÊTRE:
  - 🔌 Configuration WebSocket chargée
  - Connection established
  - Ou rien (pas de logs en prod)
```

---

## Rollback si Problème

### Problème: WebSocket ne se connecte pas

**Étape 1**: Vérifier `NODE_ENV` sur Render
```
Render Dashboard → Settings → Environment
NODE_ENV = production  ← Vérifier cette ligne exactement
```

**Étape 2**: Si mal écrit, corriger et Save
```
❌ FAUX:
  - Production (majuscule)
  - PRODUCTION
  - prod
  - NODE_ENV=prod

✅ CORRECT:
  - production (lowercase)
```

**Étape 3**: Forcer redéploiement
```
Render Dashboard → Your Service
Cliquer: "Clear Cache & Deploy"
```

**Étape 4**: Attendre 60 secondes et vérifier logs

### Problème: Serveur ne démarre pas

**Chercher dans les logs**:
```
Error
Failed
Cannot
Undefined
```

**Actions**:
1. Copier l'erreur
2. Vérifier tous les fichiers modifiés sont bien à jour
3. Vérifier syntax des fichiers .js

---

## Fichiers à Vérifier Avant Render

**Avant de pousser sur Render, vérifier** (en local):

### ✅ Checklist

- [ ] `.env` contient `NODE_ENV=development`
- [ ] `config/websocket.js` a NODE_ENV detection
- [ ] `server.js` importe `logWebSocketConfig`
- [ ] `server.js` affiche "Mode: " au démarrage
- [ ] `server.js` appelle `logWebSocketConfig()` 
- [ ] Test local: `npm run dev` montre "Mode: DEVELOPMENT"
- [ ] Test local: Affiche "Protocol: ws://"
- [ ] Pas d'erreurs JavaScript en mode dev

### Git Commit

```bash
git add .env config/websocket.js server.js
git add ENV_CONFIGURATION.md RENDER_DEPLOYMENT_GUIDE.md
git commit -m "Enable dev/prod environment modes with WebSocket configuration"
git push origin main
```

**Render va déployer automatiquement.**

---

## Vérification Post-Déploiement (Production)

### Une fois déployé sur Render

**Checklist**:

- [ ] Logs Render montrent "Mode: PRODUCTION"
- [ ] Logs Render montrent "Protocol: wss://"
- [ ] Navigateur se connecte à wss:// (pas ws://)
- [ ] DevTools Network montre Status 101
- [ ] Page fonctionne sans erreurs WebSocket
- [ ] Database requêtes travaillent
- [ ] Game rounds lancent
- [ ] Timer compte à rebours
- [ ] Bets acceptés
- [ ] Receipts printent

---

## Commandes de Monitoring

**Pour monitorer en production**:

```bash
# Depuis terminal local, voir les logs Render en temps réel:
# (Si Render CLI installé)
render logs horse-racing-gmqj --follow

# Sinon: Aller sur Render Dashboard manuellement
```

---

## Dépannage Avancé

### WebSocket sur Production avec ws:// au lieu wss://

**Diagnostic**:
```
1. Client reçoit ws://horse-racing-gmqj.onrender.com
   (au lieu de wss://...)

2. Causes possibles:
   - NODE_ENV pas défini
   - NODE_ENV=development sur Render
   - Client cache vieux websocket-config.js
```

**Solution**:
```
1. Vérifier NODE_ENV sur Render: Settings → Environment
2. Si mal, corriger et Save
3. Cliquer: "Clear Cache & Deploy"
4. Attendre 2 minutes
5. Hard refresh navigateur: Ctrl+Shift+R (ou Cmd+Shift+R Mac)
6. Tester WebSocket connexion
```

### Serveur Démarre mais WebSocket n'apparaît pas

**Chercher dans logs**:
```
"Configuration WebSocket - Mode:"
```

Si absent = serveur ne reach pas le "listening" event

**Solution**:
1. Vérifier pas d'erreurs avant ce point
2. Vérifier WebSocket port pas bloqué
3. Vérifier `wss.on("listening", ...)` exists en server.js
4. Redéployer: "Clear Cache & Deploy"

---

## Données Importantes à Noter

### Pour Votre Déploiement
```
Render Service: horse-racing-gmqj
Domain: horse-racing-gmqj.onrender.com
WebSocket (Prod): wss://horse-racing-gmqj.onrender.com/connection/websocket
Database: PostgreSQL (Aiven)
```

### Pour Prochain Développeur
```
Si besoin de changer config:
1. Modifier config/websocket.js
2. Ajouter nouveau environnement dans "environments"
3. Mettre à jour NODE_ENV dans .env ou Render Settings
```

---

## Timeline de Déploiement

```
T+0:00  → Ajouter NODE_ENV=production sur Render
T+0:30  → Render commence déploiement
T+1:00  → Serveur démarre, affiche "Mode: PRODUCTION"
T+1:30  → WebSocket configure comme wss://
T+2:00  → Clients peuvent se connecter
T+3:00  → Tout devrait être fonctionnel
```

---

## Contact Support Render

Si erreur Render propre (not Node.js related):
- Support: support@render.com
- Docs: https://render.com/docs
- Status: https://status.render.com

Si erreur Node.js/WebSocket:
1. Vérifier logs localement
2. Reproduire avec `NODE_ENV=production npm run dev`
3. Vérifier config/websocket.js syntax
4. Check server.js imports

---

**SUMMARY**: 
1. Set `NODE_ENV=production` on Render Settings
2. Save & Deploy
3. Check logs for "Mode: PRODUCTION"
4. Test WebSocket connection from browser (should be wss://)
5. Done! ✅

**Estimated Time**: 5-10 minutes total
