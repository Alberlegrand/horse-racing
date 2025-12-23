// config/websocket.js
// Configuration centralisée du WebSocket

/**
 * Détecte l'environnement courant
 */
const NODE_ENV = process.env.NODE_ENV || "development";

/**
 * Configuration du serveur WebSocket
 */
export const WEBSOCKET_CONFIG = {
  // Port du serveur WebSocket (uniquement utilisé en dev)
  port: 8081,
  
  // Chemin du WebSocket
  path: "/connection/websocket",
  
  // Configuration pour différents environnements
  environments: {
    development: {
      protocol: "ws",
      host: "localhost",
      port: 8081,
      path: "/connection/websocket",
      description: "WebSocket non-sécurisé pour développement local"
    },
    production: {
      protocol: "wss",
      host: "horses.hitbet777.store",
      port: null, // Utilise le port standard pour wss (443)
      path: "/connection/websocket",
      description: "WebSocket sécurisé (TLS/SSL) pour production Render"
    }
  }
};

/**
 * Obtient l'URL de connexion WebSocket selon l'environnement
 * @param {string} env - 'development' ou 'production' (défaut: NODE_ENV)
 * @returns {string} URL de connexion WebSocket
 */
export function getWebSocketUrl(env = NODE_ENV) {
  const config = WEBSOCKET_CONFIG.environments[env] || WEBSOCKET_CONFIG.environments.development;
  
  if (config.port) {
    return `${config.protocol}://${config.host}:${config.port}${config.path}`;
  } else {
    return `${config.protocol}://${config.host}${config.path}`;
  }
}

/**
 * Configuration pour les clients (côté frontend)
 * À utiliser côté client dans window.wsConfig
 */
export const CLIENT_WEBSOCKET_CONFIG = {
  connectionString: getWebSocketUrl(),
  token: "LOCAL_TEST_TOKEN",
  userId: "local.6130290",
  partnerId: "platform_horses",
  enableReceiptPrinting: "true",
  environment: NODE_ENV
};

/**
 * Configuration pour le serveur
 */
export const SERVER_WEBSOCKET_CONFIG = {
  port: WEBSOCKET_CONFIG.port,
  path: WEBSOCKET_CONFIG.path,
  environment: NODE_ENV,
  url: getWebSocketUrl()
};

/**
 * Fonction helper pour logs avec info environnement
 */
export function logWebSocketConfig() {
  const config = WEBSOCKET_CONFIG.environments[NODE_ENV];
  console.log(`
  ════════════════════════════════════════════════════════
  📡 Configuration WebSocket - Mode: ${NODE_ENV.toUpperCase()}
  ════════════════════════════════════════════════════════
  Protocol: ${config.protocol}://
  Host: ${config.host}${config.port ? `:${config.port}` : ' (standard port)'}
  Path: ${config.path}
  URL Complète: ${getWebSocketUrl()}
  Description: ${config.description}
  ════════════════════════════════════════════════════════
  `);
}

