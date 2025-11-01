# 📡 Configuration WebSocket Centralisée

## 📋 Vue d'ensemble

La configuration WebSocket a été centralisée pour faciliter la maintenance et garantir la cohérence dans toute l'application.

## 📁 Structure

### Backend (`config/websocket.js`)

Fichier de configuration côté serveur qui définit :
- Port du serveur WebSocket (par défaut : 8081)
- Chemin du WebSocket (`/connection/websocket`)
- Configurations pour différents environnements (development/production)

**Utilisation dans le serveur :**
```javascript
import { SERVER_WEBSOCKET_CONFIG } from "./config/websocket.js";

const wss = new WebSocketServer({ 
  port: SERVER_WEBSOCKET_CONFIG.port, 
  path: SERVER_WEBSOCKET_CONFIG.path 
});
```

### Frontend (`static/js/websocket-config.js`)

Script JavaScript côté client qui :
- Détecte automatiquement l'environnement (dev/prod)
- Construit l'URL WebSocket automatiquement
- Expose `window.wsConfig` pour toute l'application

**Utilisation dans les pages HTML :**
```html
<!-- À charger EN PREMIER, avant tous les autres scripts -->
<script src="/js/websocket-config.js"></script>
```

## 🔧 Configuration par défaut

### Développement
```javascript
{
  connectionString: "ws://localhost:8081/connection/websocket",
  token: "LOCAL_TEST_TOKEN",
  userId: "local.6130290",
  partnerId: "platform_horses",
  enableReceiptPrinting: "true"
}
```

### Production
```javascript
{
  connectionString: "wss://[hostname]/connection/websocket",
  token: "[production_token]",
  userId: "[production_user_id]",
  partnerId: "platform_horses",
  enableReceiptPrinting: "true"
}
```

## 🎯 Surcharge personnalisée

Pour surcharger la configuration dans une page spécifique, vous pouvez :

### Option 1 : Script inline après websocket-config.js
```html
<script src="/js/websocket-config.js"></script>
<script>
  // Surcharge pour cette page uniquement
  window.wsConfig.connectionString = "ws://custom-host:8081/connection/websocket";
</script>
```

### Option 2 : Attribut data-ws-config
```html
<head>
  <meta data-ws-config='{"connectionString": "ws://custom-host:8081/connection/websocket"}'>
</head>
<script src="/js/websocket-config.js"></script>
```

## 📝 Fichiers modifiés

### Backend
- ✅ `server.js` : Utilise maintenant `SERVER_WEBSOCKET_CONFIG`
- ✅ `config/websocket.js` : **NOUVEAU** - Configuration centralisée serveur

### Frontend
- ✅ `static/js/websocket-config.js` : **NOUVEAU** - Configuration centralisée client
- ✅ `static/js/main.js` : Vérifie si `wsConfig` existe avant de définir une config par défaut
- ✅ `index.html` : Inclut `websocket-config.js` et supprime config hardcodée
- ✅ `horse.html` : Inclut `websocket-config.js` et supprime config hardcodée
- ✅ `cashier.html` : Inclut `websocket-config.js` et supprime config hardcodée

## 🚀 Avantages

1. **Maintenance facilitée** : Un seul endroit pour modifier la config WebSocket
2. **Cohérence** : Toutes les pages utilisent la même configuration
3. **Environnements multiples** : Support facile pour dev/prod
4. **Détection automatique** : L'URL est construite automatiquement selon l'environnement

## ⚠️ Notes importantes

- Le script `websocket-config.js` doit être chargé **AVANT** tous les autres scripts qui utilisent `window.wsConfig`
- Les fichiers de test (`test.html`) peuvent avoir leur propre configuration pour des besoins spécifiques
- La configuration peut être surchargée par page si nécessaire

## 🔍 Vérification

Pour vérifier que la configuration est correctement chargée :

```javascript
// Dans la console du navigateur
console.log(window.wsConfig);
// Devrait afficher la configuration complète
```

## 📚 Références

- Documentation WebSocket : [MDN WebSocket API](https://developer.mozilla.org/en-US/docs/Web/API/WebSocket)
- Package `ws` : [ws documentation](https://github.com/websockets/ws)

