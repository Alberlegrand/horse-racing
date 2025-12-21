/**
 * PM2 Ecosystem Configuration
 * Gestion des processus Node.js avec PM2
 * 
 * Format: CommonJS (.cjs) car PM2 nécessite CommonJS
 * 
 * Usage:
 *   npm run pm2:start      - Démarrer les processus
 *   npm run pm2:stop       - Arrêter les processus
 *   npm run pm2:restart    - Redémarrer les processus
 *   npm run pm2:logs       - Afficher les logs
 *   npm run pm2:monit      - Monitor les processus
 *   npm run pm2:delete     - Supprimer les processus de PM2
 *   npm run pm2:save       - Sauvegarder la configuration
 *   npm run pm2:resurrect  - Restaurer les processus sauvegardés
 */

module.exports = {
  apps: [
    {
      // ✅ Application principale - Server Node.js
      name: 'horse-racing-server',
      script: './server.js',
      instances: 1,
      exec_mode: 'fork',
      
      // Environnement
      env: {
        NODE_ENV: 'development',
        PORT: 8080,
        LOG_LEVEL: 'debug'
      },
      
      // Production environment
      env_production: {
        NODE_ENV: 'production',
        PORT: 8080,
        LOG_LEVEL: 'info'
      },
      
      // Options de redémarrage automatique
      restart_delay: 4000,        // Délai avant redémarrage (4s)
      max_restarts: 10,           // Nombre max de redémarrages
      min_uptime: '10s',          // Temps min avant comptabiliser comme crash
      
      // Fichiers à ignorer pour le watch mode
      watch: [
        'server.js',
        'game.js',
        'routes/',
        'models/',
        'middleware/',
        '.env'
      ],
      ignore_watch: [
        'node_modules',
        'logs',
        'public',
        'screens',
        '.git',
        'package-lock.json'
      ],
      
      // Logging
      output: './logs/out.log',
      error: './logs/error.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      
      // Gestion de la mémoire
      max_memory_restart: '500M',  // Redémarrer si dépassement 500MB
      
      // Signaux de terminaison
      kill_timeout: 3000,          // Timeout avant kill forcé (3s)
      listen_timeout: 5000,        // Timeout avant considérer comme démarré (5s)
      
      // Merges des logs des instances
      merge_logs: true,
      
      // Pas d'autorestart au démarrage si sauvegardé
      autorestart: true,
      
      // Détails des erreurs
      instance_var: 'INSTANCE_ID'
    }
  ],

  // Configuration du cluster (optionnel)
  // Décommenter pour utiliser le mode cluster avec plusieurs instances
  /*
  deploy: {
    production: {
      user: 'node',
      host: 'your-server.com',
      ref: 'origin/main',
      repo: 'git@github.com:your-repo/horse-racing.git',
      path: '/var/www/horse-racing',
      'post-deploy': 'npm install && npm run build && npm run pm2:restart'
    }
  }
  */
};
