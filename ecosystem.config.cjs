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
      instances: 1,                // 1 instance (fork mode)
      exec_mode: 'fork',           // Mode fork (pas de clustering)
      
      // ======================================
      // ENVIRONNEMENT
      // ======================================
      env: {
        // DÉVELOPPEMENT
        NODE_ENV: 'development',
        PORT: 8080,
        LOG_LEVEL: 'debug'
      },
      
      env_production: {
        // PRODUCTION
        NODE_ENV: 'production',
        PORT: 8080,
        LOG_LEVEL: 'info'
      },
      
      // ======================================
      // STRATÉGIE DE REDÉMARRAGE
      // ======================================
      restart_delay: 4000,         // Délai avant redémarrage (4s)
      max_restarts: 5,             // Max 5 redémarrages en 15s
      min_uptime: '10s',           // Considérer comme crash si arrêt < 10s
      exp_backoff_restart_delay: 100, // +100ms à chaque tentative
      
      // ======================================
      // MONITORING DES FICHIERS (Watch)
      // ======================================
      watch: false,                // ❌ DÉSACTIVER en production
      // ✅ Utiliser en développement (décommenter):
      // watch: ['server.js', 'game.js', 'routes/', 'middleware/', '.env'],
      
      ignore_watch: [
        'node_modules',
        'logs',
        'public',
        'screens',
        '.git',
        'package-lock.json'
      ],
      
      // ======================================
      // LOGGING
      // ======================================
      output: './logs/out.log',              // Sortie standard
      error: './logs/error.log',             // Sorties d'erreur
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,              // Fusionner logs
      
      // ======================================
      // GESTION DES RESSOURCES
      // ======================================
      max_memory_restart: '500M',    // Redémarrer si > 500MB
      
      // ======================================
      // SIGNAUX & TIMEOUTS
      // ======================================
      kill_timeout: 5000,            // Timeout SIGKILL (5s)
      listen_timeout: 8000,          // Timeout démarrage (8s)
      
      // ======================================
      // COMPORTEMENT GÉNÉRAL
      // ======================================
      autorestart: true,
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
