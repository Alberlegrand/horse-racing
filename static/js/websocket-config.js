// static/js/websocket-config.js
// Configuration WebSocket centralisée côté client

/**
 * Configuration WebSocket par défaut
 * Cette configuration peut être surchargée par les pages HTML si nécessaire
 */
(function() {
  'use strict';

  // Détection automatique de l'environnement basée sur l'URL
  function getEnvironment() {
    const hostname = window.location.hostname;
    
    if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '') {
      return 'development';
    }
    
    // Production ou autres environnements
    return 'production';
  }

  // Construction automatique de l'URL WebSocket
  function buildWebSocketUrl() {
    const env = getEnvironment();
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const hostname = window.location.hostname;
    const port = window.location.port ? `:${window.location.port}` : '';
    
    // WebSocket est maintenant sur le MÊME port que Express (8080 dev, 80/443 prod)
    // Plus besoin de redirection vers 8081
    return `${protocol}//${hostname}${port}/connection/websocket`;
  }

  // Configuration par défaut
  const defaultConfig = {
    connectionString: buildWebSocketUrl(),
    token: "LOCAL_TEST_TOKEN",
    userId: "local.6130290",
    partnerId: "platform_horses",
    enableReceiptPrinting: "true"
  };

  // Expose la configuration globale
  // Si window.wsConfig existe déjà, on le merge avec la config par défaut
  if (typeof window !== 'undefined') {
    window.wsConfig = window.wsConfig || {};
    Object.assign(window.wsConfig, defaultConfig);
    
    // Surcharge possible via data-ws-config dans le body ou head
    const configElement = document.querySelector('[data-ws-config]');
    if (configElement) {
      try {
        const customConfig = JSON.parse(configElement.getAttribute('data-ws-config'));
        Object.assign(window.wsConfig, customConfig);
      } catch (e) {
        console.warn('Erreur parsing data-ws-config:', e);
      }
    }
    
    // Log en développement
    if (getEnvironment() === 'development') {
      console.log('🔌 Configuration WebSocket chargée:', window.wsConfig);
    }
  }
})();

