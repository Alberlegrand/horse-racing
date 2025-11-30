# 🔧 WebSocket Production Fix - Render Port Issue

**Date**: 2024-11-30  
**Problem**: WebSocket connexion échoue en production: "connection to wss://... failed"  
**Root Cause**: WebSocket sur port 8081 non accessible sur Render (expose seulement 80/443)  
**Status**: ✅ **FIXÉ ET TESTÉ LOCALEMENT**

---

## 📌 Le Problème Production

**Erreur rapportée**:
```
WebSocket connection to 'wss://horse-racing-gmqj.onrender.com/connection/websocket' failed
Erreur WebSocket: Event {...}
WebSocket déconnecté — reconnexion dans 1000ms
...reconnexion dans 2000ms, 4000ms, 8000ms (exponential backoff)
```

**Cause**: 
- Le serveur WebSocket était sur un port séparé (8081)
- Render n'expose que les ports 80 (HTTP) et 443 (HTTPS)
- Le port 8081 n'est pas accessible depuis l'extérieur
- Les clients ne peuvent jamais se connecter

---

## ✅ Solution Appliquée

### Avant
```javascript
// server.js - Ancien code
const wss = new WebSocketServer({ 
  port: SERVER_WEBSOCKET_CONFIG.port,  // 8081 - PORT SÉPARÉ!
  path: SERVER_WEBSOCKET_CONFIG.path 
});

// Ce WebSocket écoute sur port 8081 uniquement
// Express écoute sur port 8080
// Render n'expose que 80/443
// Donc port 8081 n'est jamais accessible!
```

### Après
```javascript
// server.js - Nouveau code
// 1. Créer le serveur HTTP manuellement (au lieu de app.listen())
const http = await import('http');
const httpServer = http.createServer(app);

// 2. Écouter sur le port standard
httpServer.listen(PORT, async () => {
  // 3. ATTACHER le WebSocket au serveur HTTP existant
  wss = new WebSocketServer({
    server: httpServer,  // Attacher à Express/HTTP, pas un port séparé!
    path: SERVER_WEBSOCKET_CONFIG.path
  });
  
  // 4. Configurer les handlers
  setupWebSocket();
});
```

### Changements Clés

| Aspect | Avant | Après |
|--------|-------|-------|
| **Port WebSocket** | 8081 (séparé) | Même que Express (80/443 via Render) |
| **Architecture** | 2 serveurs (Express + WS) | 1 serveur (Express + WS attaché) |
| **Render Accès** | Impossible | ✅ Via port 443 (HTTPS) |
| **Dev Mode** | Port 8081 direct | Via Express (port 8080) |
| **Prod Mode** | Port 8081 bloqué ❌ | Via HTTPS port 443 ✅ |

---

## 🔄 Architecture Finale

```
┌─────────────────────────────────────────────┐
│           Client Browser                     │
└─────────────────────────────────────────────┘
                    │
         HTTPS (port 443)
                    │
                    ▼
┌─────────────────────────────────────────────┐
│        Render (Proxy/Load Balancer)          │
│  Expose: port 80 (HTTP) & 443 (HTTPS)      │
└─────────────────────────────────────────────┘
                    │
         HTTP/HTTPS (internal)
                    │
                    ▼
┌─────────────────────────────────────────────┐
│         Node.js Server (port 8080)           │
├─────────────────────────────────────────────┤
│  Express App                                 │
│  ├─ HTTP routes (/api/v1/...)               │
│  └─ Static files (index.html, etc)          │
├─────────────────────────────────────────────┤
│  WebSocket (attaché à Express)              │
│  └─ /connection/websocket (path)            │
└─────────────────────────────────────────────┘
```

---

## 📝 Fichiers Modifiés

### `server.js` (PRINCIPAL)

**Ligne ~42**: Créer le serveur HTTP manuellement
```javascript
const http = await import('http');
const httpServer = http.createServer(app);
```

**Ligne ~105**: Déclarer `wss` sans le créer immédiatement
```javascript
let wss;  // Sera créé après app.listen()
```

**Ligne ~130**: Créer fonction `setupWebSocket()`
```javascript
function setupWebSocket() {
  wss.on("connection", (ws) => { ... });
  wss.on("listening", () => { ... });
}
```

**Ligne ~360**: Utiliser `httpServer.listen()` et créer `wss` dedans
```javascript
httpServer.listen(PORT, async () => {
  // Créer WebSocket attaché au serveur HTTP
  wss = new WebSocketServer({
    server: httpServer,  // ATTACHER!
    path: SERVER_WEBSOCKET_CONFIG.path
  });
  
  // Puis configurer les handlers
  setupWebSocket();
});
```

---

## ✅ Tests Effectués

### Local (Development)
```bash
npm run dev
```

**Résultats**:
```
✅ Serveur démarre sans erreur
✅ WebSocket attaché au serveur HTTP
✅ Round #1 créé
✅ Clients peuvent se connecter
✅ Job scheduler démarre
✅ Database initializes
```

**Pas d'erreurs** WebSocket!

---

## 🚀 Impact Production

### Avant le Fix
- ❌ WebSocket port 8081 non accessible
- ❌ Tous les clients échouent à se connecter
- ❌ Page charge mais pas de temps réel
- ❌ Pas de mises à jour round/timer
- ❌ Application non-fonctionnelle

### Après le Fix
- ✅ WebSocket via port 443 (HTTPS)
- ✅ Tous les clients se connectent
- ✅ Temps réel fonctionne
- ✅ Mises à jour round/timer en direct
- ✅ Application fonctionnelle ✅

---

## 🎯 Comportement Attendu Production

### Client Logs (DevTools Console)
```javascript
// AVANT (échec):
WebSocket connection to 'wss://...' failed
Erreur WebSocket: Event {...}
WebSocket déconnecté — reconnexion...
(infini - exponential backoff)

// APRÈS (succès):
🔌 Configuration WebSocket chargée
WebSocket connecté
📨 main.js WebSocket: connected Round: [roundId]
📨 main.js WebSocket: timer_update Round: [roundId]
```

### DevTools Network (WS)
```
AVANT:
❌ Status: (connection failed)
❌ URL: wss://horse-racing-gmqj.onrender.com/connection/websocket (FAILED)

APRÈS:
✅ Status: 101 Switching Protocols
✅ URL: wss://horse-racing-gmqj.onrender.com/connection/websocket
✅ Frames: messages flowing in real-time
```

### Render Logs
```
✅ Serveur de jeu lancé sur http://localhost:8080
📡 WebSocket attaché au serveur HTTP sur le chemin /connection/websocket
✅ [STARTUP] Premier round lancé avec succès
📡 Client connecté au WebSocket local
(repeat: Client connected...)
```

---

## 🆘 Dépannage si Toujours Pas de Connexion

### 1. Vérifier Render Deployment
```
Dashboard → Service status = "Live"
Vérifier pas d'erreur au démarrage
Vérifier le log: "WebSocket attaché au serveur HTTP"
```

### 2. Vérifier Client Config
```javascript
// DevTools Console:
> window.wsConfig.connectionString
// Devrait être: "wss://horse-racing-gmqj.onrender.com/connection/websocket"
```

### 3. Vérifier Connexion Réseau
```
DevTools → Network → WS filter
Voir si /connection/websocket est présent
Vérifier status: 101 (pas 0 ou error)
```

### 4. Vérifier Certificate SSL
```
Browser → Cadenas icon → Certificate
Vérifier certificat valide (Render gère automatiquement)
```

---

## 💡 Avantages de Cette Architecture

✅ **Simplifié**: Un seul serveur, pas de confusion ports  
✅ **Production-Ready**: Fonctionne avec Render constraints  
✅ **Scalable**: Facile d'ajouter replicas/load balancing  
✅ **Robuste**: Pas de port bloqué, connexion directe  
✅ **Compatible**: Fonctionne aussi en développement local  

---

## 🔄 Déploiement

### Étapes
```bash
# 1. Commit changements
git add server.js
git commit -m "fix: Attach WebSocket to Express server for Render compatibility"

# 2. Push vers Render
git push origin main

# 3. Render auto-déploie (2-3 min)

# 4. Vérifier logs Render
# Dashboard → Logs → chercher "WebSocket attaché"

# 5. Tester client
# Ouvrir https://horse-racing-gmqj.onrender.com
# DevTools → Console: window.wsConfig
# DevTools → Network → WS: voir connexion établie
```

---

## 📊 Résumé des Changements

| Fichier | Changement | Ligne | Status |
|---------|-----------|-------|--------|
| `server.js` | Créer httpServer manuellement | 40 | ✅ |
| `server.js` | Déclarer `let wss;` | 105 | ✅ |
| `server.js` | Créer `setupWebSocket()` fonction | 130 | ✅ |
| `server.js` | Utiliser `httpServer.listen()` | 360 | ✅ |
| `server.js` | Attacher WebSocket à Express | 365 | ✅ |
| `server.js` | Appeler `setupWebSocket()` | 373 | ✅ |
| `server.js` | Supprimer ancien `wss.on("listening")` | 415 | ✅ |

**Total**: 7 changements majeurs, 1 fichier modifié

---

## 🎉 Expected Outcome

Après le déploiement sur Render:
- ✅ Page charge correctement
- ✅ WebSocket se connecte automatiquement
- ✅ Timer/Round affiche correctement
- ✅ Pas d'erreur "connection failed"
- ✅ Pas de reconnexion exponential backoff infini
- ✅ Application fonctionnelle en temps réel

---

**Status Final**: ✅ **FIX APPLIQUÉ ET TESTÉ LOCALEMENT**

Prêt pour git push et Render deployment!

---

**Document créé**: 2024-11-30  
**Problème**: WebSocket port 8081 inaccessible sur Render  
**Solution**: Attacher WebSocket à serveur Express  
**Impact**: Production-ready WebSocket via HTTPS port 443
