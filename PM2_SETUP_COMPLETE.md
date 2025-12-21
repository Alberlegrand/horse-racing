# ✅ PM2 Installation et Configuration - RÉSUMÉ

## 🚀 État Actuel

**Application:** ✅ **EN COURS D'EXÉCUTION** avec PM2
- **Status:** online
- **PID:** Géré par PM2
- **Uptime:** 2+ minutes
- **Redémarrages:** 0

## 📦 Installation

PM2 a été installé comme dépendance de développement:
```bash
npm install --save-dev pm2
```

## ⚙️ Configuration

### Fichier de Configuration
- **Fichier:** `ecosystem.config.cjs` (CommonJS, compatible avec PM2)
- **Contient:** Configuration de l'application horse-racing-server

### Points Clés
- **Type:** fork (une seule instance)
- **Script:** `server.js`
- **Environnement:** development (modifiable en production)
- **Port:** 8080
- **Auto-restart:** Oui
- **Max Memory:** 500MB
- **Watch Mode:** Activé pour les fichiers principaux

## 🎯 Commandes Essentielles

Toutes les commandes utilisent `npx pm2` (PM2 local du projet):

```bash
# Démarrer
npm run pm2:start

# Arrêter
npm run pm2:stop

# Redémarrer
npm run pm2:restart

# Voir les logs
npm run pm2:logs

# Dashboard de monitoring
npm run pm2:monit

# Supprimer (attention: l'app s'arrête)
npm run pm2:delete

# Sauvegarder l'état (pour auto-restart)
npm run pm2:save

# Restaurer depuis sauvegarde
npm run pm2:resurrect
```

## 🔍 Vérification de l'État

```bash
# Liste des processus
npx pm2 list

# Détails complets
npx pm2 show horse-racing-server

# Logs en temps réel
npx pm2 logs

# Dashboard interactif
npx pm2 monit
```

## 📝 Fichiers Créés

| Fichier | Description |
|---------|-------------|
| `ecosystem.config.cjs` | Configuration PM2 (CommonJS) |
| `PM2_GUIDE.md` | Guide complet et détaillé |
| `PM2_QUICK_START.md` | Guide rapide |
| `start-pm2.bat` | Script de démarrage (Windows) |
| `start-pm2.sh` | Script de démarrage (Linux/Mac) |

## 🛠️ Script package.json

Les 8 scripts PM2 ont été ajoutés à `package.json`:

```json
"pm2:start": "npx pm2 start ecosystem.config.cjs",
"pm2:stop": "npx pm2 stop all",
"pm2:restart": "npx pm2 restart all",
"pm2:logs": "npx pm2 logs",
"pm2:monit": "npx pm2 monit",
"pm2:delete": "npx pm2 delete all",
"pm2:save": "npx pm2 save",
"pm2:resurrect": "npx pm2 resurrect"
```

## 💾 Persister l'Application au Reboot

Pour que l'application se relance automatiquement au reboot du serveur:

```bash
npm run pm2:save
```

Puis sur Linux/Mac:
```bash
npx pm2 startup
```

## 📊 Monitoring

La commande suivante affiche un tableau de bord en temps réel:

```bash
npm run pm2:monit
```

Informations affichées:
- ✅ CPU et mémoire
- ✅ État du processus  
- ✅ Nombre de redémarrages
- ✅ Uptime

## 🐛 Troubleshooting

**La commande `pm2` n'est pas reconnue:**
- Utilisez `npx pm2` à la place (déjà configuré dans les scripts npm)

**Le processus redémarre continuellement:**
```bash
npm run pm2:logs
```
Vérifiez les erreurs dans les logs

**Port déjà utilisé:**
```bash
# Trouver le processus utilisant le port 8080
netstat -ano | findstr :8080
```

## 📚 Documentation Complète

Pour plus de détails, consultez:
- `PM2_GUIDE.md` - Guide complet avec tous les paramètres
- https://pm2.keymetrics.io/docs/usage/quick-start

## ✨ Prochaines Étapes

1. ✅ **En développement local:** Utilisez `npm run pm2:start`
2. ✅ **Pour production:** Modifiez `ecosystem.config.cjs` (instances, env, etc.)
3. ✅ **Au déploiement:** Exécutez `npm run pm2:save`
4. ✅ **Au redémarrage:** Exécutez `npm run pm2:resurrect`

---

**Note:** PM2 est maintenant la solution standard pour la gestion des processus. Les anciens scripts `npm start` et `npm run dev` restent disponibles si vous préférez.
