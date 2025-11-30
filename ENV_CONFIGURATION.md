# Configuration des Environnements - Dev vs Production

## Vue d'ensemble

Le système est configuré pour supporter deux environnements distincts avec des configurations WebSocket différentes:

- **Development (Dev)**: Connexion locale sans sécurité (ws://)
- **Production**: Déploiement Render avec sécurité TLS/SSL (wss://)

## Configuration `.env`

Fichier: `.env`

```env
# Environment Mode (development | production)
NODE_ENV=development
```

**Valeurs possibles:**
- `development` - Mode développement local (défaut si non défini)
- `production` - Mode production Render

## Architecture WebSocket par Environnement

### Configuration Serveur (`config/websocket.js`)

```javascript
export const WEBSOCKET_CONFIG = {
  environments: {
    development: {
      protocol: "ws",           // Non-sécurisé pour dev
      host: "localhost",
      port: 8081,
      path: "/connection/websocket",
      description: "WebSocket non-sécurisé pour développement local"
    },
    production: {
      protocol: "wss",          // Sécurisé TLS/SSL
      host: "horse-racing-gmqj.onrender.com",
      port: null,               // Utilise le port standard (443)
      path: "/connection/websocket",
      description: "WebSocket sécurisé pour production Render"
    }
  }
};
```

### Configuration Client (`static/js/websocket-config.js`)

Le client auto-détecte l'environnement basé sur l'URL:

```javascript
function getEnvironment() {
  const hostname = window.location.hostname;
  
  if (hostname === 'localhost' || hostname === '127.0.0.1') {
    return 'development';
  }
  return 'production';
}
```

**Auto-configuration automatique:**
- **localhost:8080** → ws://localhost:8081 (dev)
- **https://horse-racing-gmqj.onrender.com** → wss://horse-racing-gmqj.onrender.com (prod)

## Démarrage du Serveur

### Mode Développement

```bash
# Définir NODE_ENV=development dans .env
npm run dev

# Logs:
# ════════════════════════════════════════════════════════
# 🚀 Démarrage du serveur
# ════════════════════════════════════════════════════════
# Mode: DEVELOPMENT
# Port Express: 8080
# ...
# ════════════════════════════════════════════════════════
# 📡 Configuration WebSocket - Mode: DEVELOPMENT
# ════════════════════════════════════════════════════════
# Protocol: ws://
# Host: localhost:8081
# Path: /connection/websocket
# URL Complète: ws://localhost:8081/connection/websocket
# Description: WebSocket non-sécurisé pour développement local
```

### Mode Production (Render)

1. Dans Render environment variables, définir:
   ```
   NODE_ENV=production
   ```

2. Le serveur démarre avec:
   ```
   # Logs:
   # ════════════════════════════════════════════════════════
   # 🚀 Démarrage du serveur
   # ════════════════════════════════════════════════════════
   # Mode: PRODUCTION
   # Port Express: 8080
   # ...
   # ════════════════════════════════════════════════════════
   # 📡 Configuration WebSocket - Mode: PRODUCTION
   # ════════════════════════════════════════════════════════
   # Protocol: wss://
   # Host: horse-racing-gmqj.onrender.com
   # Path: /connection/websocket
   # URL Complète: wss://horse-racing-gmqj.onrender.com/connection/websocket
   # Description: WebSocket sécurisé (TLS/SSL) pour production Render
   ```

## Fichiers de Configuration Modifiés

### 1. `.env` (Nouveau)
- Ajout de `NODE_ENV=development` en première ligne
- Variable utilisée par `config/websocket.js`

### 2. `config/websocket.js` (Mis à jour)
- Lecture de `NODE_ENV` depuis `process.env`
- Fonction `getWebSocketUrl()` par défaut utilise `NODE_ENV`
- `SERVER_WEBSOCKET_CONFIG` expose l'environnement courant
- `CLIENT_WEBSOCKET_CONFIG` configure les clients
- Nouvelle fonction `logWebSocketConfig()` pour affichage formaté

### 3. `server.js` (Mis à jour)
- Import de `logWebSocketConfig` depuis config/websocket.js
- Affichage du mode au démarrage
- Appel de `logWebSocketConfig()` quand le WebSocket est prêt
- Utilisation dynamique de `SERVER_WEBSOCKET_CONFIG.url`

### 4. `static/js/websocket-config.js` (Inchangé)
- Déjà compatible avec les deux modes
- Auto-détection basée sur hostname
- Logging en développement

## Flux de Démarrage

```
1. Serveur Node.js démarre
   ↓
2. .env est chargé par dotenv
   ↓
3. NODE_ENV est accessible via process.env.NODE_ENV
   ↓
4. config/websocket.js détecte NODE_ENV
   ↓
5. SERVER_WEBSOCKET_CONFIG est configuré dynamiquement
   ↓
6. server.js affiche le mode et la config WebSocket
   ↓
7. WebSocket démarre sur le bon port/protocole
   ↓
8. Clients reçoivent le HTML/JS
   ↓
9. Client détecte son propre environnement
   ↓
10. Client se connecte à la bonne URL WebSocket
```

## Déploiement sur Render

### Étape 1: Ajouter Variable d'Environnement
- Aller sur Render dashboard
- Settings → Environment → Ajouter:
  ```
  NODE_ENV = production
  ```

### Étape 2: Vérifier les Logs
Render logs devraient montrer:
```
Mode: PRODUCTION
📡 Configuration WebSocket - Mode: PRODUCTION
Protocol: wss://
URL Complète: wss://horse-racing-gmqj.onrender.com/connection/websocket
```

### Étape 3: Tester la Connexion
1. Ouvrir https://horse-racing-gmqj.onrender.com
2. Vérifier dans DevTools → Network → WS
3. La connexion WebSocket doit utiliser `wss://` (sécurisé)

## Dépannage

### Client Connecté en ws:// au lieu de wss://
**Problème**: Client utilise un protocole non-sécurisé en production
**Cause**: 
- `NODE_ENV` pas défini sur Render
- Ou client détecte mauvais hostname

**Solution**:
1. Vérifier Render environment variables
2. Vérifier client logs: `console.log(window.wsConfig)`
3. Vérifier browser console: Est-ce que `getEnvironment()` retourne 'production'?

### WebSocket sur port 8081 ne répond pas
**Problème**: Render bloque les ports personnalisés
**Cause**: 
- Tentative de connexion sur port 8081
- NODE_ENV=development sur Render

**Solution**:
- Définir NODE_ENV=production sur Render
- Cela force client et serveur à utiliser les bons ports/protocoles

### Logs Serveur Manquent en Production
**Problème**: Pas de logs WebSocket au démarrage
**Cause**: 
- Render filtre certains logs
- Ou serveur démarre trop vite

**Solution**:
1. Vérifier `server.js` ligne 393: `wss.on("listening", () => { logWebSocketConfig(); })`
2. Attendre quelques secondes pour voir les logs
3. Utiliser Render logs avec filtre: `websocket` ou `Configuration WebSocket`

## Tests Locaux

### Test 1: Mode Development
```bash
# Dans .env:
NODE_ENV=development

# Terminal 1: Serveur
npm run dev

# Terminal 2: Client
# Ouvrir http://localhost:8080
# Vérifier DevTools → Console:
# 🔌 Configuration WebSocket chargée:
# {connectionString: 'ws://localhost:8081/connection/websocket', ...}
```

### Test 2: Simulation Production (AVANCÉ)
```bash
# Dans .env:
NODE_ENV=production

# Terminal: Serveur
npm run dev

# Client: Ouvrir http://localhost:8080
# Vérifier DevTools → Network → WS
# ATTENTION: Cela essaiera de se connecter à horse-racing-gmqj.onrender.com
# Probablement échouera si serveur local

# C'est OK pour ce test - le but était de vérifier la détection d'environnement
```

## Résumé des Comportements

| Aspect | Development | Production |
|--------|-------------|-----------|
| NODE_ENV | `development` | `production` |
| Protocol Serveur | ws:// (non-sécurisé) | wss:// (sécurisé) |
| Host Serveur | localhost | horse-racing-gmqj.onrender.com |
| Port WebSocket | 8081 (custom) | 443 (standard HTTPS) |
| Client Detection | localhost → dev | Hostname + https → prod |
| Logs | Verbeux | Minimal |
| CORS | Permissif (localhost) | Strict (production) |

## Prochaines Étapes

1. ✅ Configuration dev/prod implémentée
2. ✅ WebSocket auto-configure par environnement
3. ⏳ Tester sur Render avec NODE_ENV=production
4. ⏳ Monitorer logs de démarrage
5. ⏳ Vérifier connexion WebSocket en production

---

**Dernière mise à jour**: 2024
**Environnement**: Multi-mode (Dev/Prod)
**Status**: ✅ Configuration complète, prêt pour tests
