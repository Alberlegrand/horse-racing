// config/websocket.js
// Configuration centralisée du WebSocket

/**
 * Configuration du serveur WebSocket
 */
export const WEBSOCKET_CONFIG = {
  // Port du serveur WebSocket
  port: 8081,
  
  // Chemin du WebSocket
  path: "/connection/websocket",
  
  // Configuration pour différents environnements
  environments: {
    development: {
      protocol: "ws",
      host: "localhost",
      port: 8081,
      path: "/connection/websocket"
    },
    production: {
      protocol: "wss",
      host: "wss.paryajpam.com",
      port: null, // Utilise le port standard pour wss (443)
      path: "/connection/websocket"
    }
  }
};

/**
 * Obtient l'URL de connexion WebSocket selon l'environnement
 * @param {string} env - 'development' ou 'production'
 * @returns {string} URL de connexion WebSocket
 */
export function getWebSocketUrl(env = "development") {
  const config = WEBSOCKET_CONFIG.environments[env] || WEBSOCKET_CONFIG.environments.development;
  
  if (config.port) {
    return `${config.protocol}://${config.host}:${config.port}${config.path}`;
  } else {
    return `${config.protocol}://${config.host}${config.path}`;
  }
}

/**
 * Configuration par défaut pour les clients
 * À utiliser côté client dans window.wsConfig
 */
export const CLIENT_WEBSOCKET_CONFIG = {
  connectionString: getWebSocketUrl("development"),
  token: "LOCAL_TEST_TOKEN",
  userId: "local.6130290",
  partnerId: "platform_horses",
  enableReceiptPrinting: "true"
};

/**
 * Configuration pour le serveur (exporte les valeurs nécessaires)
 */
export const SERVER_WEBSOCKET_CONFIG = {
  port: WEBSOCKET_CONFIG.port,
  path: WEBSOCKET_CONFIG.path
};

