// config/keepalive.config.js
// Configuration optimale du keepalive pour chaque environnement

const NODE_ENV = process.env.NODE_ENV || 'development';

/**
 * Configuration Keepalive par Environnement
 * 
 * keepAliveTick: Intervalle entre les requêtes keepalive (ms)
 * keepAliveTimeout: Timeout pour une requête keepalive (ms)
 * maxRetries: Nombre de tentatives avant d'abandonner
 * healthCheckInterval: Intervalle des checks de santé serveur (ms)
 * maxConsecutiveFailures: Nombre max de failures avant alerte
 */

export const KEEPALIVE_CONFIG = {
  development: {
    // ⚡ En développement: plus rapide pour tester
    keepAliveTick: 20000,           // 20 secondes
    keepAliveTimeout: 5000,         // 5 secondes
    maxRetries: 2,                  // 2 tentatives
    healthCheckInterval: 30000,     // Check santé chaque 30s
    maxConsecutiveFailures: 3,      // Alerte après 3 failures
    enableDetailedLogs: true,
    enableServerHealthMonitoring: true
  },

  staging: {
    // 🔶 En staging: équilibre entre dev et production
    keepAliveTick: 25000,           // 25 secondes
    keepAliveTimeout: 6000,         // 6 secondes
    maxRetries: 3,                  // 3 tentatives
    healthCheckInterval: 45000,     // Check santé chaque 45s
    maxConsecutiveFailures: 4,      // Alerte après 4 failures
    enableDetailedLogs: true,
    enableServerHealthMonitoring: true
  },

  production: {
    // 🚀 En production: robustesse maximale
    keepAliveTick: 30000,           // 30 secondes (recommandé)
    keepAliveTimeout: 8000,         // 8 secondes (tolérant aux pics)
    maxRetries: 3,                  // 3 tentatives
    healthCheckInterval: 60000,     // Check santé chaque 60s
    maxConsecutiveFailures: 5,      // Alerte après 5 failures
    enableDetailedLogs: false,      // Logs minimales en production
    enableServerHealthMonitoring: true,
    // En production, ne pas recharger page sur failures (laisser utilisateur continuer)
    autoReloadOnFailure: false
  }
};

/**
 * Retourner la configuration pour l'environnement actuel
 */
export function getKeepaliveConfig() {
  const config = KEEPALIVE_CONFIG[NODE_ENV] || KEEPALIVE_CONFIG.production;
  
  return {
    ...config,
    environment: NODE_ENV,
    configVersion: 1,
    timestamp: new Date().toISOString()
  };
}

/**
 * Optimisations par cas d'usage
 */
export const KEEPALIVE_PRESETS = {
  // Cas normal: utilisateur à l'écran, jeu actif
  active: {
    keepAliveTick: 30000,
    keepAliveTimeout: 8000,
    maxRetries: 3
  },

  // Cas idle: utilisateur loin de l'écran mais connecté
  idle: {
    keepAliveTick: 60000,      // Plus lent pour économiser bande passante
    keepAliveTimeout: 10000,
    maxRetries: 2
  },

  // Cas mobile: réseau potentiellement instable
  mobile: {
    keepAliveTick: 20000,      // Plus rapide pour détecter déconnexions
    keepAliveTimeout: 10000,   // Plus tolérant au lag
    maxRetries: 4              // Plus de tentatives
  },

  // Cas haute latence: serveur loin ou réseau lent
  highLatency: {
    keepAliveTick: 45000,
    keepAliveTimeout: 15000,
    maxRetries: 4
  },

  // Cas réseau instable: wifi faible ou réseau mobile mauvais
  unstableNetwork: {
    keepAliveTick: 15000,      // Très rapide pour détecter vite
    keepAliveTimeout: 12000,   // Très tolérant
    maxRetries: 5              // Beaucoup de tentatives
  }
};

/**
 * Mesures de santé serveur
 */
export const SERVER_HEALTH_THRESHOLDS = {
  memory: {
    warning: 400 * 1024 * 1024,    // 400 MB
    critical: 600 * 1024 * 1024    // 600 MB
  },
  
  uptime: {
    restart_check: 60000           // Check redémarrage chaque 60s
  },

  redis: {
    warning_latency: 500,          // ms
    critical_latency: 2000         // ms
  },

  database: {
    warning_latency: 1000,         // ms
    critical_latency: 5000         // ms
  }
};

/**
 * Messages d'état pour client
 */
export const KEEPALIVE_MESSAGES = {
  connecting: '🔗 Connexion au serveur...',
  connected: '✅ Connecté',
  retrying: '🔄 Tentative de reconnexion (%attempt%/%max%)',
  offline: '❌ Serveur indisponible',
  degraded: '⚠️  Serveur en santé réduite',
  slow: '🐢 Connexion lente'
};

/**
 * Configuration pour chaque page
 */
export const PAGE_KEEPALIVE_CONFIG = {
  'main.js': {
    // Page de jeu principale
    config: 'active',
    enableRealTimeHealthStatus: true,
    displayHealthStatus: false
  },

  'cashier.html': {
    // Page caissier
    config: 'active',
    enableRealTimeHealthStatus: true,
    displayHealthStatus: true
  },

  'screen.html': {
    // Écran public (moniteur)
    config: 'active',
    enableRealTimeHealthStatus: true,
    displayHealthStatus: false,
    criticalFailureAction: 'reload'  // Recharger si perte connexion
  },

  'horse.html': {
    // Page chevaux
    config: 'idle',
    enableRealTimeHealthStatus: false,
    displayHealthStatus: false
  },

  'landing.html': {
    // Page d'accueil
    config: 'idle',
    enableRealTimeHealthStatus: false,
    displayHealthStatus: false
  }
};

export default getKeepaliveConfig();
