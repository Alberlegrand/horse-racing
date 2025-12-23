# 🚀 PM2 - Gestion des Processus HITBET777

PM2 a été intégré au projet pour une meilleure gestion et monitoring des processus Node.js.

## ⚡ Démarrage rapide

### Windows
```bash
start-pm2.bat
```

### Linux/Mac
```bash
./start-pm2.sh
```

### Manuellement
```bash
npm run pm2:start
```

## 📋 Commandes essentielles

| Commande | Description |
|----------|-------------|
| `npm run pm2:start` | Démarrer l'application |
| `npm run pm2:stop` | Arrêter l'application |
| `npm run pm2:restart` | Redémarrer l'application |
| `npm run pm2:logs` | Voir les logs en temps réel |
| `npm run pm2:monit` | Dashboard de monitoring |
| `npm run pm2:delete` | Supprimer les processus |
| `npm run pm2:save` | Sauvegarder la configuration |
| `npm run pm2:resurrect` | Restaurer les processus sauvegardés |

## 📊 Monitoring

Pour voir l'état de votre application:
```bash
npm run pm2:monit
```

Affichage en temps réel:
- CPU et mémoire utilisés
- État du processus
- Nombre de redémarrages
- Uptime

## 🔍 Logs

Voir les logs en temps réel:
```bash
npm run pm2:logs
```

Voir seulement les erreurs:
```bash
pm2 logs --err
```

Voir les logs d'une instance spécifique:
```bash
pm2 logs horse-racing-server
```

## 🔄 Auto-restart au reboot serveur

Pour restaurer automatiquement l'application au redémarrage du serveur:

```bash
npm run pm2:save
```

Puis sur Linux/Mac:
```bash
pm2 startup
```

## 📁 Fichiers de configuration

- **`ecosystem.config.js`** - Configuration PM2
- **`PM2_GUIDE.md`** - Guide complet
- **`start-pm2.bat`** - Script de démarrage (Windows)
- **`start-pm2.sh`** - Script de démarrage (Linux/Mac)

## 🛠️ Configuration personnalisée

Éditez `ecosystem.config.js` pour:
- Changer le nombre d'instances
- Modifier les variables d'environnement
- Configurer le watch mode
- Ajuster les limites mémoire

Exemple - Mode cluster avec 4 instances:
```javascript
{
  instances: 4,
  exec_mode: 'cluster'
}
```

## 🐛 Troubleshooting

**Le processus redémarre continuellement:**
```bash
npm run pm2:logs
```
Vérifiez les erreurs dans les logs.

**Le port 8080 est déjà utilisé:**
```bash
# Windows
netstat -ano | findstr :8080

# Linux/Mac
lsof -i :8080
```

**Voir plus de détails:**
```bash
pm2 show horse-racing-server
```

## 📚 Ressources

- [PM2 Documentation](https://pm2.keymetrics.io/)
- [Fichier complet: PM2_GUIDE.md](./PM2_GUIDE.md)
- [Configuration: ecosystem.config.js](./ecosystem.config.js)

## 💡 Tips

1. **Sauvegardez régulièrement** après des changements:
   ```bash
   npm run pm2:save
   ```

2. **Monitorez la mémoire** pour les fuites:
   ```bash
   npm run pm2:monit
   ```

3. **Testez en développement** avant production:
   ```bash
   NODE_ENV=development npm run pm2:start
   ```

4. **Gardez les logs** organisés:
   ```bash
   pm2 logs > logs/app.log
   ```

---

**Questions?** Consultez le [guide complet PM2](./PM2_GUIDE.md)
