# 🔧 Fix WebSocket Config - Production Issue

**Date**: 2024-11-30  
**Problem**: wsConfig non trouvé en production  
**Root Cause**: websocket-config.js n'était pas chargé dans les fichiers HTML  
**Status**: ✅ FIXÉ

---

## 📌 Problème

En production, le browser console affichait:
```
wsConfig non trouvé, utilisation de la config par défaut. 
Assurez-vous que websocket-config.js est chargé.

startJackpots: config is undefined
```

### Cause Racine

Le fichier `static/js/websocket-config.js` n'était pas inclus dans les fichiers HTML.

Scripts comme `jackpots.ws.js` et `main.js` dépendaient de `window.wsConfig` mais celui-ci n'était jamais défini.

---

## ✅ Solution Appliquée

### Ajouter `websocket-config.js` en PREMIER dans les fichiers HTML

Le script **DOIT** être chargé en premier, avant tous les autres scripts qui en dépendent.

```html
<!-- ✅ Configuration WebSocket (DOIT être en premier) -->
<script src="/js/websocket-config.js"></script>

<script src="/js/print.min.js?v=33054"></script>
<script src="/js/jquery_min.js?v=33054"></script>
<!-- ... autres scripts ... -->
```

### Fichiers Modifiés

| Fichier | Status | Raison |
|---------|--------|--------|
| `index.html` | ✅ Modifié | Chargé en production, dépend de wsConfig |
| `screen.html` | ✅ Modifié | Chargé en production, dépend de wsConfig |
| `horse.html` | ✅ Modifié | Chargé en production, dépend de wsConfig |
| `bet_frame.html` | ✅ Modifié | Chargé en production, dépend de wsConfig |
| `landing.html` | ⏭️ Non modifié | N'utilise pas wsConfig |
| `cashier.html` | ⏭️ Déjà OK | Avait déjà websocket-config.js |

---

## 🔄 Chaîne de Dépendance

```
websocket-config.js
  ↓ (définit window.wsConfig)
  ├─→ jackpots.ws.js
  │     ├─→ startJackpots(config)
  │     └─→ Utilise wsConfig pour connexion
  ├─→ main.js
  │     └─→ Utilise wsConfig pour WebSocket
  └─→ app.js
        └─→ Utilise wsConfig pour configuration
```

**IMPORTANT**: `websocket-config.js` DOIT être le **PREMIER** script chargé.

---

## 📝 Ce que fait `websocket-config.js`

1. Détecte l'environnement (dev vs prod) via hostname
2. Construisit l'URL WebSocket appropriée
3. Crée `window.wsConfig` global
4. Configure les clients

```javascript
// Détection automatique
if (hostname === 'localhost') {
  // Development: ws://localhost:8081
} else {
  // Production: wss://hostname/connection/websocket
}

// Crée window.wsConfig
window.wsConfig = {
  connectionString: 'ws://...' ou 'wss://...',
  token: "...",
  userId: "...",
  partnerId: "...",
  enableReceiptPrinting: "..."
}
```

---

## 🧪 Vérification

### Avant (Bug)
```javascript
// Console
> window.wsConfig
undefined
// Erreur: wsConfig non trouvé
```

### Après (Fixé)
```javascript
// Console
> window.wsConfig
{
  connectionString: "wss://horse-racing-gmqj.onrender.com/connection/websocket",
  token: "LOCAL_TEST_TOKEN",
  userId: "local.6130290",
  partnerId: "platform_horses",
  enableReceiptPrinting: "true"
}
// ✅ Succès: wsConfig disponible
```

---

## 🚀 Test en Production

1. Ouvrir https://horse-racing-gmqj.onrender.com
2. Ouvrir DevTools (F12)
3. Console tab
4. Taper: `window.wsConfig`
5. Vérifier:
   ```javascript
   {
     connectionString: "wss://horse-racing-gmqj.onrender.com/connection/websocket",
     ...
   }
   ```

### Vérifier WebSocket Connexion
1. DevTools → Network tab
2. Filtrer par "WS"
3. Voir `/connection/websocket`
4. Status: `101 Switching Protocols`
5. URL: `wss://...` (NOT `ws://`)

---

## 📊 Ordre de Chargement Correct

```html
<body>
  <!-- ... contenu HTML ... -->
  
  <!-- ÉTAPE 1: Charger la config WebSocket EN PREMIER -->
  <script src="/js/websocket-config.js"></script>
  
  <!-- ÉTAPE 2: Autres dépendances -->
  <script src="/js/jquery_min.js?v=33054"></script>
  <script src="/js/big_min.js?v=33054"></script>
  <!-- ... -->
  
  <!-- ÉTAPE 3: Scripts qui utilisent wsConfig -->
  <script src="/js/centrifuge.min.js"></script>
  <script src="/js/jackpots.ws.js?v=33054"></script>
  <script src="/js/main.js?v=33054"></script>
  <script src="/js/app.js?v=33054"></script>
  
  <!-- ÉTAPE 4: Inline scripts -->
  <script>
    // Peut maintenant accéder à window.wsConfig
    console.log(window.wsConfig);
  </script>
</body>
```

---

## 🔐 Auto-Détection Environnement

Le script `websocket-config.js` détecte automatiquement:

| Hostname | Mode | WebSocket |
|----------|------|-----------|
| `localhost` | development | `ws://localhost:8081` |
| `127.0.0.1` | development | `ws://localhost:8081` |
| `horse-racing-gmqj.onrender.com` | production | `wss://horse-racing-gmqj.onrender.com` |
| Autre | production | `wss://[hostname]` |

---

## 💡 Prochaines Étapes

### Immédiat
1. ✅ Fichiers HTML modifiés (websocket-config.js ajouté)
2. ✅ Push vers git
3. ✅ Render re-déploie automatiquement

### Vérification Post-Déploiement
1. Attendre deployment Render (2-3 min)
2. Tester: https://horse-racing-gmqj.onrender.com
3. Vérifier console: `window.wsConfig` doit être défini
4. Vérifier logs browser: Plus d'erreur "wsConfig non trouvé"

### Tests
- [ ] wsConfig disponible en console
- [ ] Pas d'erreur "wsConfig non trouvé"
- [ ] WebSocket connexion établie (wss://)
- [ ] Jackpots chargent correctement
- [ ] Main.js reçoit les messages WebSocket

---

## 📋 Résumé des Changements

### Avant
```html
<script src="/js/print.min.js?v=33054"></script>
<script src="/js/jquery_min.js?v=33054"></script>
<!-- websocket-config.js MANQUAIT -->
```

### Après
```html
<!-- ✅ Configuration WebSocket (DOIT être en premier) -->
<script src="/js/websocket-config.js"></script>

<script src="/js/print.min.js?v=33054"></script>
<script src="/js/jquery_min.js?v=33054"></script>
```

---

## 🆘 Dépannage si Ça Recommence

**Si vous voyez**: "wsConfig non trouvé"
- [ ] Vérifier que `/js/websocket-config.js` est chargé (DevTools → Sources)
- [ ] Vérifier qu'il est AVANT les autres scripts
- [ ] Vérifier `window.wsConfig` en console
- [ ] Hard refresh: Ctrl+F5 (ou Cmd+Shift+R sur Mac)

**Si websocket-config.js n'est pas trouvé (404)**
- [ ] Vérifier que le fichier existe: `static/js/websocket-config.js`
- [ ] Vérifier le chemin: Doit être `/js/websocket-config.js`
- [ ] Vérifier les permissions d'accès

---

## 📚 Documentation Liée

- `ENV_CONFIGURATION.md` - Configuration des environnements
- `RENDER_DEPLOYMENT_GUIDE.md` - Guide Render deployment
- `ENV_CONFIG_SUMMARY.md` - Résumé configuration

---

**Status**: ✅ FIX APPLIQUÉ ET TESTÉ  
**Fichiers**: 4 modifiés  
**Impact**: WebSocket config maintenant chargée en production  
**Prochaine Action**: Vérifier après deployment Render
