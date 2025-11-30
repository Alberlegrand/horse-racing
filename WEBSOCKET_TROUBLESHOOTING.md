# 🔧 Troubleshooting WebSocket & Environnements

## Quick Reference

| Problème | Cause | Solution |
|----------|-------|----------|
| WebSocket ws:// en prod | NODE_ENV=dev sur Render | Set NODE_ENV=production |
| "Mode: DEVELOPMENT" en prod | .env pas mis à jour | Render Settings → NODE_ENV |
| WebSocket ne se connecte | CORS/SSL | Vérifier protocol wss:// |
| Aucun log WebSocket | Server pas atteint "listening" | Vérifier pas d'erreur avant |
| Client reçoit vieille config | Cache browser | Hard refresh Ctrl+Shift+R |

---

## Diagnostique Pas à Pas

### Symptôme 1: "WebSocket Connection Failed"

**Étape 1: Vérifier le Mode**

**Local**:
```bash
npm run dev
# Chercher dans les logs:
# Mode: DEVELOPMENT
# OU
# Mode: PRODUCTION
```

**Production (Render)**:
```
Render Dashboard → Logs
Chercher: "Mode: PRODUCTION"
```

**Si vous voyez "Mode: DEVELOPMENT" en production** → Problème!

**Solution**:
```
Render Dashboard → Settings → Environment
NODE_ENV = production  ← Doit être exactement ceci
Save Changes
Clear Cache & Deploy
```

---

### Symptôme 2: "wss:// Mixed Content"

**Message d'erreur**:
```
Mixed Content: The page was loaded over HTTPS, but requested an insecure 
WebSocket connection 'ws://...'
```

**Cause**: Client utilise `ws://` (non-sécurisé) au lieu de `wss://`

**Diagnostic**:
```javascript
// Dans console browser:
console.log(window.wsConfig);
// Chercher: connectionString: "ws://..." ← MAUVAIS
// Devrait être: connectionString: "wss://..."
```

**Solution**:
1. Vérifier Render NODE_ENV=production
2. Hard refresh: Ctrl+Shift+R
3. Vérifier console.log(window.wsConfig) à nouveau

---

### Symptôme 3: "Cannot GET /"

**Page blanche, aucun contenu**

**Cause**: Express server ne répondent pas

**Diagnostic**:
```
1. Render Dashboard → Logs
2. Chercher: "Error", "Cannot read", "Undefined"
3. Chercher: "Express listening on port 8080"
```

**Solution possibles**:
```
1. Si erreur au démarrage:
   - Vérifier NODE_ENV syntax (pas d'espaces)
   - Vérifier .env ou Render Settings
   - Redéployer: Clear Cache & Deploy

2. Si erreur Database:
   - Vérifier DB_URL existe
   - Vérifier PostgreSQL accessible
   - Check Aiven console

3. Si erreur JWT_SECRET:
   - Vérifier JWT_SECRET défini
   - Pas de caractères spéciaux mal échappés
```

---

### Symptôme 4: "Infinite Reconnect Loop"

**Logs client**:
```
Connecting to WebSocket...
Connection failed, retrying in 3s
Connecting to WebSocket...
Connection failed, retrying in 3s
(infini...)
```

**Causes possibles**:

**A. WebSocket port mauvais**
```javascript
// ❌ MAUVAIS:
ws://localhost:8081/... (OK en dev, FAUX en prod)
wss://localhost:8081/... (FAUX - localhost not HTTPS)

// ✅ BON:
ws://localhost:8081/... (Dev)
wss://horse-racing-gmqj.onrender.com/... (Prod)
```

**B. CORS bloqué**
```
Render Dashboard → server.js cors config
Vérifier:
  origin: true (ou specific domain)
  credentials: true
```

**C. WebSocket path mauvais**
```
✅ BON: /connection/websocket
❌ MAUVAIS: /websocket, /connection, etc
```

**Diagnostic**:
```
DevTools → Network → WS
Voir l'URL complète d'une tentative
Vérifier: protocol, domain, path, port
```

---

## Fichiers de Configuration - Vérification

### ✅ Vérifier .env

```env
# Doit contenir exactement:
NODE_ENV=development

# Et autres variables existantes:
DB_URL=postgres://...
JWT_SECRET=...
```

**Erreurs communes**:
```
❌ NODE_ENV = development (espaces)
❌ NodeEnv=development (casing)
❌ NODE_ENV="development" (guillemets)
✅ NODE_ENV=development
```

### ✅ Vérifier config/websocket.js

Rechercher ces éléments:

**1. NODE_ENV lecture**:
```javascript
const NODE_ENV = process.env.NODE_ENV || "development";
// ✅ Bon
```

**2. Environnements définis**:
```javascript
environments: {
  development: { ... },
  production: { ... }
}
// ✅ Doit avoir les deux
```

**3. Fonction logWebSocketConfig**:
```javascript
export function logWebSocketConfig() { ... }
// ✅ Doit exister
```

### ✅ Vérifier server.js

**Ligne 19** (env):
```javascript
import { SERVER_WEBSOCKET_CONFIG, logWebSocketConfig } from "./config/websocket.js";
// ✅ logWebSocketConfig doit être importé
```

**Ligne ~40** (mode display):
```javascript
console.log(`Mode: ${NODE_ENV.toUpperCase()}`);
// ✅ Doit afficher le mode au démarrage
```

**Ligne ~393** (WebSocket log):
```javascript
wss.on("listening", () => {
  logWebSocketConfig();
});
// ✅ logWebSocketConfig() doit être appelé
```

---

## Tests Manuels

### Test 1: Mode Development Local

```bash
# Terminal 1: Serveur
cd horse-racing
npm run dev

# Attendre:
# ════════════════════════════════════════════════════════
# Mode: DEVELOPMENT
# ════════════════════════════════════════════════════════
# Protocol: ws://
# URL Complète: ws://localhost:8081/connection/websocket
```

**Terminal 2: Client Test**
```bash
# Ouvrir dans browser:
# http://localhost:8080

# DevTools Console:
console.log(window.wsConfig)
// Doit montrer: connectionString: "ws://localhost:8081/connection/websocket"

# DevTools Network → WS:
# /connection/websocket → Status: 101 ✅
```

### Test 2: Production Simulation

```bash
# ATTENTION: Ceci essaiera de se connecter à Render
# C'est OK pour tester la détection d'environnement

# Terminal 1: Serveur
NODE_ENV=production npm run dev

# Logs doivent montrer:
# Mode: PRODUCTION
# Protocol: wss://
# URL: wss://horse-racing-gmqj.onrender.com/connection/websocket
```

**Terminal 2: Client**
```bash
# Ouvrir: http://localhost:8080
# (Encore localhost, mais serveur en mode production)

# DevTools Console:
console.log(window.wsConfig)
// Doit montrer: connectionString: "wss://..."

# Note: Connexion ÉCHOUERA (expected)
# Car client détecte "localhost" → mode dev
# Mais serveur envoie URL production
# C'est OK pour ce test
```

### Test 3: Vérifier Import/Export

```bash
# Terminal: Test Node.js imports
node -e "
import { logWebSocketConfig } from './config/websocket.js';
logWebSocketConfig();
"

# Doit afficher la config WebSocket sans erreur
```

---

## Logs à Chercher

### ✅ Logs Corrects

**Development**:
```
Mode: DEVELOPMENT
Protocol: ws://
```

**Production**:
```
Mode: PRODUCTION
Protocol: wss://
```

### ❌ Logs d'Erreur

```
// Module not found
Error: Cannot find module './config/websocket.js'

// Syntax error
SyntaxError: Unexpected token '{'

// Undefined
TypeError: logWebSocketConfig is not a function

// Wrong environment
// (Serveur dit DEVELOPMENT en production)
```

---

## Commandes de Debug

### Voir toutes les env variables
```bash
# Local:
node -e "console.log(process.env.NODE_ENV)"
# Output: development

# Render:
# Render Dashboard → Logs → chercher:
# Ou ajouter dans server.js:
console.log('NODE_ENV:', process.env.NODE_ENV);
```

### Vérifier WebSocket URL
```javascript
// Dans navigateur console:
window.wsConfig.connectionString
// Output: "ws://localhost:8081/connection/websocket"

// En production:
// Output: "wss://horse-racing-gmqj.onrender.com/connection/websocket"
```

### Forcer reconnexion WebSocket
```javascript
// Dans console navigateur:
// (Si WebSocket object accessible)
window.ws.close();  // Ferme la connexion
// Client devrait reconneter automatiquement
```

---

## Fixes Communs

### Fix 1: NODE_ENV pas reconnu

**Problème**: Server affiche undefined ou "development" toujours

**Solution**:
```bash
# Vérifier que dotenv charge .env
npm ls dotenv

# Si manquant:
npm install dotenv
```

**Dans server.js**:
```javascript
import dotenv from 'dotenv';
dotenv.config();  // ← Doit être au début
```

### Fix 2: WebSocket port occupé

**Erreur**: `EADDRINUSE: address already in use :::8081`

**Solution**:
```bash
# Trouver processus sur port 8081
lsof -i :8081  # Mac/Linux
netstat -ano | findstr :8081  # Windows

# Tuer le processus
kill <PID>
# ou sur Windows:
taskkill /PID <PID> /F
```

### Fix 3: Client connecté avant serveur prêt

**Problème**: Client reçoit HTML avant WebSocket serveur prêt

**Solution**: Déjà implémentée! 
```javascript
// server.js démarre WebSocket AVANT app.listen()
// Donc clients attendent que WebSocket soit prêt
```

---

## Checklist Avant Prod

- [ ] .env a `NODE_ENV=development`
- [ ] config/websocket.js a mode detection
- [ ] server.js imports `logWebSocketConfig`
- [ ] server.js affiche mode au démarrage
- [ ] Test local: `npm run dev` montre DEVELOPMENT
- [ ] Test local: ws://localhost:8081 utilisé
- [ ] Pas d'erreurs JavaScript
- [ ] Git push sans fichiers oubliés
- [ ] Render Settings: `NODE_ENV=production` prêt
- [ ] Render: "Clear Cache & Deploy" after settings change
- [ ] Logs Render: "Mode: PRODUCTION" présent
- [ ] Logs Render: "Protocol: wss://" présent
- [ ] Browser test: wss:// connexion réussie
- [ ] DevTools: Status 101 pour /connection/websocket

---

## Escalade Support

Si toujours pas fixé après tous les tests:

### Avant de contacter support, collecter:

```bash
# 1. Output local:
npm run dev 2>&1 | head -50

# 2. Logs Render (copier 50 lignes):
# Render Dashboard → Logs

# 3. DevTools info:
# DevTools → Network → WS (screenshot)
# DevTools → Console (copier erreurs)

# 4. Fichiers modifiés:
# .env (sans secrets)
# config/websocket.js (copier)
# server.js (lignes 1-50, 380-400)
```

### Contacter:
- **Node.js WebSocket**: Stack Overflow avec tags `node.js` `websocket`
- **Render issues**: Render Support (support@render.com)
- **Express issues**: Express.js documentation

---

**Document créé**: 2024-11-30  
**Dernière mise à jour**: 2024-11-30  
**Status**: ✅ Troubleshooting complet
