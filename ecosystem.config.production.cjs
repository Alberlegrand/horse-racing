/**
 * PM2 Configuration pour PRODUCTION (Render.com)
 * Format: CommonJS (.cjs)
 * 
 * Cette configuration optimisée pour la production expose les erreurs
 * et améliore le monitoring en environnement cloud.
 */

module.exports = {
  apps: [
    {
      name: 'horse-racing-server',
      script: './server.js',
      instances: 1,
      exec_mode: 'fork',
      
      // Environment PRODUCTION
      env_production: {
        NODE_ENV: 'production',
        PORT: process.env.PORT || 8080,
        LOG_LEVEL: 'info'
      },
      
      // Options de redémarrage - AGRESSIVES pour capturer les erreurs
      restart_delay: 2000,        // Redémarrer rapidement après crash
      max_restarts: 5,            // Limiter les tentatives (éviter boucle infinie)
      min_uptime: '30s',          // Attendre 30s avant de considérer comme "stable"
      exp_backoff_restart_delay: 100, // Augmenter délai exponentiellement
      
      // Logging DÉTAILLÉ pour production
      output: './logs/production.log',
      error: './logs/production-error.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,
      
      // Memory management
      max_memory_restart: '500M',
      
      // Graceful shutdown
      kill_timeout: 5000,          // 5s pour arrêt propre
      listen_timeout: 8000,        // 8s pour démarrage
      
      // Auto restart au crash
      autorestart: true,
      
      // Ne pas watch en production (trop de ressources)
      watch: false,
      
      // Informations détaillées
      instance_var: 'INSTANCE_ID'
    }
  ]
};
