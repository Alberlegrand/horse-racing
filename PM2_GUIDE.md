# PM2 Configuration pour HITBET777

## Installation

PM2 a été ajouté au projet. Pour installer ou mettre à jour:

```bash
npm install
```

## Commandes de base

### Démarrer l'application
```bash
npm run pm2:start
```
Cela démarre le serveur Node.js avec PM2 en utilisant la configuration `ecosystem.config.js`.

### Arrêter l'application
```bash
npm run pm2:stop
```
Arrête tous les processus gérés par PM2.

### Redémarrer l'application
```bash
npm run pm2:restart
```
Redémarre tous les processus sans les supprimer de la liste PM2.

### Afficher les logs
```bash
npm run pm2:logs
```
Affiche les logs en temps réel de tous les processus.

### Monitor les processus
```bash
npm run pm2:monit
```
Affiche un tableau de bord interactif montrant:
- CPU et mémoire utilisés
- État des processus
- Nombre de redémarrages
- Uptime

### Supprimer les processus
```bash
npm run pm2:delete
```
Supprime tous les processus de la gestion PM2.

### Sauvegarder la configuration
```bash
npm run pm2:save
```
Sauvegarde la liste des processus actuels pour la restauration automatique au redémarrage.

### Restaurer les processus sauvegardés
```bash
npm run pm2:resurrect
```
Restaure les processus sauvegardés précédemment avec `pm2:save`.

## Configuration

### Fichier: `ecosystem.config.js`

Le fichier contient la configuration suivante:

#### Général
- **name**: `horse-racing-server` - Nom de l'application
- **script**: `./server.js` - Point d'entrée
- **instances**: `1` - Nombre d'instances (1 pour développement, `max` pour production)
- **exec_mode**: `fork` - Mode d'exécution (fork ou cluster)

#### Environnement
```javascript
env: {
  NODE_ENV: 'development',
  PORT: 8080,
  LOG_LEVEL: 'debug'
}
```

Pour production:
```javascript
env_production: {
  NODE_ENV: 'production',
  PORT: 8080,
  LOG_LEVEL: 'info'
}
```

#### Redémarrage automatique
- **restart_delay**: 4000ms - Délai avant redémarrage
- **max_restarts**: 10 - Nombre maximum de redémarrages
- **min_uptime**: 10s - Temps minimum avant de considérer comme réussi
- **max_memory_restart**: 500M - Redémarrer si mémoire > 500MB

#### Watch Mode (optionnel)
Le watch mode est désactivé par défaut. Pour l'activer:

1. Installez `nodemon` (optionnel):
```bash
npm install --save-dev nodemon
```

2. Modifiez `ecosystem.config.js`:
```javascript
watch: true,
watch_delay: 1000
```

3. Redémarrez PM2:
```bash
npm run pm2:delete
npm run pm2:start
```

#### Logging
- **output**: `./logs/out.log` - Logs de sortie standard
- **error**: `./logs/error.log` - Logs d'erreur
- **log_date_format**: Format des timestamps dans les logs

## Cas d'usage

### Démarrage en développement
```bash
npm run pm2:start
npm run pm2:monit
```

### Démarrage en production
```bash
NODE_ENV=production npm run pm2:start
npm run pm2:save
npm run pm2:resurrect  # Au redémarrage du serveur
```

### Debugging
```bash
# Voir tous les logs
npm run pm2:logs

# Voir seulement les erreurs
pm2 logs --err

# Voir les logs d'une instance spécifique
pm2 logs horse-racing-server

# Suivre l'évolution de la mémoire
npm run pm2:monit
```

### Gestion de plusieurs instances (Cluster Mode - Production)

Pour utiliser le mode cluster avec 4 instances:

1. Modifiez `ecosystem.config.js`:
```javascript
{
  name: 'horse-racing-server',
  script: './server.js',
  instances: 4,           // ou 'max' pour tous les CPU
  exec_mode: 'cluster',   // Changez en 'cluster'
  // ...
}
```

2. Redémarrez:
```bash
npm run pm2:delete
npm run pm2:start
npm run pm2:monit
```

## Troubleshooting

### Le processus redémarre continuellement

1. Vérifiez les logs:
```bash
npm run pm2:logs
```

2. Vérifiez que le port 8080 est disponible:
```bash
# Windows
netstat -ano | findstr :8080

# Linux/Mac
lsof -i :8080
```

3. Augmentez les délais si nécessaire dans `ecosystem.config.js`:
```javascript
kill_timeout: 5000,        // 5s au lieu de 3s
listen_timeout: 10000      // 10s au lieu de 5s
```

### Voir les détails d'un crash
```bash
pm2 show horse-racing-server
```

### Réinitialiser tous les compteurs
```bash
pm2 reset horse-racing-server
```

## Variables d'environnement

PM2 supporte les fichiers `.env`. Créez un fichier `.env.pm2`:

```env
NODE_ENV=production
PORT=8080
LOG_LEVEL=info
DB_HOST=localhost
DB_PORT=5432
```

Puis utilisez-le:
```bash
pm2 start ecosystem.config.js --env pm2
```

## Intégration CI/CD

Pour un déploiement automatique:

```bash
# Dans votre pipeline CI/CD
npm install
npm run pm2:delete      # Supprimer les anciens processus
npm run pm2:start       # Démarrer les nouveaux
npm run pm2:save        # Sauvegarder pour auto-restart
```

## Monitoring avancé

PM2+ (version pro) offre:
- Dashboard web
- Alertes en temps réel
- Historique complet
- Auto-restart au reboot serveur

Documentation: https://pm2.io/

## Ressources

- [PM2 Documentation](https://pm2.keymetrics.io/)
- [PM2 API Reference](https://pm2.keymetrics.io/docs/usage/pm2-api)
- [PM2 Ecosystem File](https://pm2.keymetrics.io/docs/usage/application-declaration)
