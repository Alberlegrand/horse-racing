# Déploiement sur Render - Guide Configuration

## Étapes pour Déployer en Production

### 1. Paramètres Render (Environment Variables)

Sur votre dashboard Render pour le service `horse-racing-gmqj`:

**Allez à:** Settings → Environment

**Ajoutez / Vérifiez les variables:**

```
NODE_ENV=production
```

**Autres variables nécessaires (vérifier existance):**
```
DB_URL=postgres://avnadmin:AVNS_7UUhsX4dfeM1gmYNANL@hitskool-alberlegenie-c9aa.c.aivencloud.com:20955/hitbet?SSL_CERTIFICATE=./ca.pem
DATABASE_URL=postgres://avnadmin:AVNS_7UUhsX4dfeM1gmYNANL@hitskool-alberlegenie-c9aa.c.aivencloud.com:20955/vip_surprise?SSL_CERTIFICATE=./ca.pem
JWT_SECRET=2d068e91d42eecbc7c60566513a7e4bd9bfac55c73fd4d5f8c20dc4530a0f321f308a0ecde256302ed618eec2869fdd0e86dfe79bc74cceb976604497b099b33
```

### 2. Vérifier `render.yaml`

Fichier: `render.yaml` (doit exister à la racine)

```yaml
services:
  - type: web
    name: horse-racing
    env: node
    region: oregon
    plan: starter
    
    envVars:
      - key: NODE_ENV
        value: production
      - key: PORT
        value: 8080
    
    buildCommand: npm install
    startCommand: node server.js
```

### 3. Deploy sur Render

**Option A: Git Push (Recommandé)**
```bash
git add .
git commit -m "Enable environment modes and WebSocket configuration"
git push origin main
```

Render déploiera automatiquement.

**Option B: Manual Deploy**
- Sur Render dashboard
- Appuyer sur "Deploy"
- Ou "Clear Cache & Deploy"

### 4. Monitorer les Logs

Sur Render, aller à:
**Your Service → Logs**

Chercher ces messages (dans l'ordre):

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

### 5. Tester la Connexion

**Depuis votre navigateur:**
1. Allez à: https://horse-racing-gmqj.onrender.com
2. Ouvrez DevTools (F12)
3. Onglet: **Network**
4. Filtrer par: **WS** (WebSocket)
5. Vérifier:
   - Nom: `/connection/websocket`
   - Status: `101 Switching Protocols`
   - Protocol: `wss` (secure)

### 6. Dépannage Production

#### Problème: WebSocket Status `PENDING` ou `FAILED`

**Causes possibles:**
1. NODE_ENV pas défini à `production`
2. Certificat SSL/TLS non valide
3. CORS mal configuré

**Solution:**
1. Vérifier Render environment variables
2. Vérifier render.yaml
3. Vérifier server.js CORS configuration

#### Problème: Client reçoit ws:// au lieu de wss://

**Cause:** NODE_ENV=development sur Render

**Solution:**
```
1. Render Dashboard → Settings → Environment
2. NODE_ENV=production (vérifier pas mal écrit)
3. Save
4. Manual Deploy ("Clear Cache & Deploy")
```

#### Problème: "Erreur de connexion WebSocket"

**Vérifier dans logs Render:**
```
grep "WebSocket" 
grep "listening"
grep "Error"
```

Si vous voyez:
```
port: 8081, path: /connection/websocket
```

C'est NORMAL - Render route tout à travers le port 443 (HTTPS).

### 7. Configuration Automatique en Production

Avec la nouvelle configuration:

**Serveur (`server.js`):**
- Lit `NODE_ENV` automatiquement
- Si `production` → WebSocket sur `wss://horse-racing-gmqj.onrender.com:443`
- Si `development` → WebSocket sur `ws://localhost:8081`

**Client (`static/js/websocket-config.js`):**
- Détecte automatiquement hostname
- Si `localhost` → mode dev (`ws://`)
- Si domaine Render → mode prod (`wss://`)

### 8. Checklist Déploiement Final

- [ ] Fichier `.env` existe avec `NODE_ENV=development`
- [ ] Fichier `config/websocket.js` contient environnements
- [ ] Fichier `server.js` importe `logWebSocketConfig`
- [ ] Fichier `render.yaml` définit `NODE_ENV=production`
- [ ] Sur Render Dashboard: Environment variable `NODE_ENV=production` existe
- [ ] Git push fait avec tous les fichiers modifiés
- [ ] Render deploie (vérifier logs)
- [ ] Logs Render montrent "Mode: PRODUCTION"
- [ ] Logs Render montrent "Configuration WebSocket - Mode: PRODUCTION"
- [ ] Test du navigateur montre connexion `wss://` réussie
- [ ] Page charge sans erreurs de connexion WebSocket

### 9. Après Déploiement

**Vérifier en Continu:**

```bash
# Localement, pour tester mode production:
NODE_ENV=production npm run dev
# (Cela essaiera de se connecter à horse-racing-gmqj.onrender.com)
```

**Monitorer les performances:**
- Render Dashboard → Metrics
- Vérifier CPU, Memory, Network

**Vérifier les erreurs:**
- Render Dashboard → Logs
- Chercher: ERROR, WebSocket, failed

### 10. Rollback si Problème

Si le déploiement casse quelque chose:

**Option 1: Revert Git**
```bash
git revert HEAD
git push origin main
# Render va redéployer
```

**Option 2: Sur Render Dashboard**
- Settings → Auto-Deploy: Désactiver temporairement
- Vérifier logs
- Re-activer quand fixé

---

## Fichiers Modifiés pour Production

### `.env`
```env
NODE_ENV=development
```

### `config/websocket.js`
- Lit `NODE_ENV`
- Environnements production/development configurés
- Fonction `logWebSocketConfig()` pour logs

### `server.js`
- Affiche mode au démarrage
- Appelle `logWebSocketConfig()`
- Utilise configuration dynamique

### `static/js/websocket-config.js`
- Déjà compatible
- Auto-détecte environnement par hostname

---

## Comportement Attendu

### Development (localhost:8080)
```
Mode: DEVELOPMENT
WebSocket: ws://localhost:8081/connection/websocket
Logs: Verbeux
```

### Production (Render)
```
Mode: PRODUCTION
WebSocket: wss://horse-racing-gmqj.onrender.com/connection/websocket
Logs: Minimal/Erreurs seulement
```

---

## Contact Support

Si problème sur Render:
1. Vérifier logs Render
2. Vérifier environment variables
3. Vérifier certificat SSL (Render gère automatiquement)
4. Chercher "Configuration WebSocket" dans les logs

---

**Document créé**: 2024-11-30
**Dernière mise à jour**: 2024-11-30
**Status**: ✅ Prêt pour production
