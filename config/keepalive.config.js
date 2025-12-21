// config/keepalive.config.js
// Configuration complète du système keepalive pour la production

const NODE_ENV = process.env.NODE_ENV || 'development';

/**
 * Configuration globale du keepalive
 * Gère la santé du serveur et les reconnexions
 */
export const KEEPALIVE_CONFIG = {
  // ============================================
  // PARAMÈTRES PAR ENVIRONNEMENT
  // ============================================
  
  development: {
    // Intervalle de keepalive (ms) - Plus fréquent pour développement
    tick: 20000,        // 20 secondes
    
    // Timeout pour les requêtes keepalive
    timeout: 5000,      // 5 secondes
    
    // Nombre maximum de tentatives avant de marquer comme offline
    maxRetries: 2,
    
    // Vérifier la santé tous les X ticks
    healthCheckFrequency: 1,
    
    // Permettre les logs verbeux
    verbose: true
  },

  staging: {
    tick: 25000,        // 25 secondes
    timeout: 5000,      // 5 secondes
    maxRetries: 3,
    healthCheckFrequency: 2,
    verbose: false
  },

  production: {
    // ⚠️ EN PRODUCTION: Équilibrer fréquence vs charge serveur
    tick: 30000,        // 30 secondes - Optimal pour réduire la charge
    timeout: 8000,      // 8 secondes - Plus tolérant pour réseau instable
    maxRetries: 3,      // 3 tentatives avant de déclarer offline
    healthCheckFrequency: 2,  // Vérifier santé tous les 2 ticks (60s)
    verbose: false      // Pas de logs verbeux en production
  }
};

/**
 * Configuration spécifique Redis pour la production
 */
export const REDIS_PRODUCTION_CONFIG = {
  // URL de connexion (depuis env)
  url: process.env.REDIS_URL || 'redis://localhost:6379',

  // Options de socket
  socket: {
    // Délai d'attente pour la connexion
    connectTimeout: 5000,

    // Garder la connexion alive même au repos
    keepAlive: 30000,    // 30 secondes

    // Stratégie de reconnexion avec backoff exponentiel
    reconnectStrategy: (retries) => {
      // Délai: 100ms * 2^retries, max 10 secondes
      const delay = Math.min(100 * Math.pow(2, retries), 10000);
      console.log(`[REDIS] Reconnexion tentative ${retries} (délai: ${delay}ms)`);
      return delay;
    }
  },

  // Timeouts
  commandsQueueBehavior: 'auto' // Requêtes mises en queue en cas de déconnexion

  // Commandes automatiques au démarrage
  // lazyConnect: false (défaut - connecter immédiatement)
};

/**
 * Configuration du healthcheck du serveur
 */
export const HEALTHCHECK_CONFIG = {
  // Seuils d'alerte mémoire
  memory: {
    // Avertissement si usage > 80%
    warningThreshold: 80,
    
    // Critique si usage > 90%
    criticalThreshold: 90,
    
    // Vérifier en MB (pour logs)
    warningMB: 500
  },

  // Détails de santé à retourner
  includeDetails: {
    uptime: true,
    memory: true,
    redis: true,
    timestamp: true
  }
};

/**
 * Obtenir la configuration pour l'environnement actuel
 */
export function getConfig() {
  return KEEPALIVE_CONFIG[NODE_ENV] || KEEPALIVE_CONFIG.production;
}

/**
 * Obtenir la configuration du healthcheck
 */
export function getHealthCheckConfig() {
  return HEALTHCHECK_CONFIG;
}

/**
 * Logs de configuration au démarrage
 */
export function logKeepaliveConfig() {
  const config = getConfig();
  
  console.log(`
════════════════════════════════════════════════════════
📡 KEEPALIVE CONFIGURATION [${NODE_ENV.toUpperCase()}]
════════════════════════════════════════════════════════
✅ Intervalle: ${config.tick}ms (${(config.tick / 1000).toFixed(1)}s)
✅ Timeout: ${config.timeout}ms
✅ Max retries: ${config.maxRetries}
✅ Health check chaque: ${config.healthCheckFrequency} ticks (${(config.tick * config.healthCheckFrequency / 1000).toFixed(1)}s)
✅ Logs verbeux: ${config.verbose ? 'OUI' : 'NON'}
════════════════════════════════════════════════════════
  `);
}

/**
 * Validation de la configuration
 */
export function validateConfig() {
  const config = getConfig();
  
  // Vérifier que tick > timeout
  if (config.tick <= config.timeout) {
    console.warn('⚠️ ATTENTION: keepalive.tick doit être > keepalive.timeout');
  }
  
  // Avertir si tick est trop court en production
  if (NODE_ENV === 'production' && config.tick < 25000) {
    console.warn('⚠️ ATTENTION: keepalive.tick < 25s peut surcharger le serveur');
  }
  
  // Avertir si tick est trop long en production
  if (NODE_ENV === 'production' && config.tick > 60000) {
    console.warn('⚠️ ATTENTION: keepalive.tick > 60s peut laisser expirer les sessions');
  }
  
  return true;
}

export default getConfig();
