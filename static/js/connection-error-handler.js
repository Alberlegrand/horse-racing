/**
 * Connection Error Handler
 * Manages network errors, timeouts, and connection issues with user-friendly feedback
 */
class ConnectionErrorHandler {
  constructor() {
    this.isOnline = navigator.onLine;
    this.connectionStatus = document.getElementById('connectionStatus');
    this.lastErrorTime = null;
    this.errorDebounceTime = 1000; // ms
    this.isRetrying = false;
    this.retryAttempts = 0;
    this.maxRetries = 3;

    this.initConnectionMonitoring();
    this.setupGlobalErrorHandling();
  }

  /**
   * Monitor online/offline status
   */
  initConnectionMonitoring() {
    window.addEventListener('online', () => this.handleOnline());
    window.addEventListener('offline', () => this.handleOffline());
  }

  /**
   * Handle online event
   */
  handleOnline() {
    console.log('[CONNECTION] ✅ Connexion rétablie');
    this.isOnline = true;
    this.showConnectionStatus('✅ Connexion rétablie', 'success', 3000);
    this.retryAttempts = 0;
  }

  /**
   * Handle offline event
   */
  handleOffline() {
    console.error('[CONNECTION] ❌ Connexion perdue');
    this.isOnline = false;
    this.showConnectionStatus('❌ Connexion perdue - Certaines fonctionnalités peuvent être limitées', 'error', 0);
  }

  /**
   * Show connection status message
   * @param {string} message - Message to display
   * @param {string} type - 'success' | 'error' | 'warning'
   * @param {number} duration - Duration in ms (0 = indefinite)
   */
  showConnectionStatus(message, type = 'warning', duration = 5000) {
    if (!this.connectionStatus) {
      // Fallback: create toast notification
      this.showToast(message, type);
      return;
    }

    this.connectionStatus.textContent = message;
    this.connectionStatus.className = `connection-status status-${type}`;
    this.connectionStatus.style.display = 'block';

    if (duration > 0) {
      setTimeout(() => {
        this.connectionStatus.style.display = 'none';
      }, duration);
    }
  }

  /**
   * Show toast notification
   */
  showToast(message, type = 'info') {
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.style.cssText = `
      position: fixed;
      top: 20px;
      right: 20px;
      padding: 12px 20px;
      border-radius: 6px;
      z-index: 9999;
      animation: slideIn 0.3s ease-out;
      font-weight: 500;
      max-width: 400px;
      background-color: ${type === 'error' ? '#ef4444' : type === 'success' ? '#10b981' : '#f59e0b'};
      color: white;
      box-shadow: 0 4px 12px rgba(0,0,0,0.15);
    `;
    toast.textContent = message;

    const style = document.createElement('style');
    style.textContent = `
      @keyframes slideIn {
        from { transform: translateX(400px); opacity: 0; }
        to { transform: translateX(0); opacity: 1; }
      }
    `;
    document.head.appendChild(style);
    document.body.appendChild(toast);

    setTimeout(() => toast.remove(), 4000);
  }

  /**
   * Handle fetch errors with detailed reporting
   * @param {Error} error - The error object
   * @param {Object} context - Additional context
   */
  async handleFetchError(error, context = {}) {
    const now = Date.now();
    
    // Debounce errors
    if (this.lastErrorTime && now - this.lastErrorTime < this.errorDebounceTime) {
      console.warn('[ERROR] Ignoring debounced error');
      return;
    }
    this.lastErrorTime = now;

    const errorMessage = this.categorizeError(error, context);
    console.error('[CONNECTION ERROR]', errorMessage);

    // Network error
    if (!this.isOnline || error instanceof TypeError && error.message.includes('Failed to fetch')) {
      this.showConnectionStatus('❌ Erreur réseau - Vérifiez votre connexion', 'error', 0);
      return;
    }

    // Timeout error
    if (error.message.includes('timeout') || error.name === 'AbortError') {
      this.showConnectionStatus('⏱️ Délai d\'attente dépassé - Le serveur prend trop de temps à répondre', 'error', 5000);
      return;
    }

    // Server error
    if (context.status >= 500) {
      this.showConnectionStatus('🔧 Erreur serveur - Veuillez réessayer dans quelques instants', 'error', 5000);
      return;
    }

    // Authentication error
    if (context.status === 401 || context.status === 403) {
      this.showConnectionStatus('🔐 Session expirée - Veuillez vous reconnecter', 'error', 0);
      setTimeout(() => window.location.href = '/login', 2000);
      return;
    }

    // Client error
    if (context.status >= 400 && context.status < 500) {
      this.showToast(errorMessage, 'warning');
      return;
    }

    // Generic error
    this.showToast(errorMessage, 'error');
  }

  /**
   * Categorize error and return user-friendly message
   */
  categorizeError(error, context = {}) {
    if (error instanceof TypeError) {
      if (error.message.includes('Failed to fetch')) {
        return 'Impossible de contacter le serveur. Vérifiez votre connexion Internet.';
      }
      return 'Erreur de réseau. Veuillez réessayer.';
    }

    if (error.message.includes('timeout')) {
      return 'Le serveur met trop de temps à répondre. Veuillez réessayer.';
    }

    if (context.status === 401) {
      return 'Vous êtes déconnecté. Veuillez vous reconnecter.';
    }

    if (context.status === 403) {
      return 'Vous n\'avez pas la permission d\'effectuer cette action.';
    }

    if (context.status === 404) {
      return 'La ressource demandée n\'existe pas.';
    }

    if (context.status === 409) {
      return 'Un conflit a été détecté. Veuillez actualiser et réessayer.';
    }

    if (context.status >= 500) {
      return 'Erreur serveur. L\'équipe technique a été notifiée.';
    }

    return error.message || 'Une erreur est survenue. Veuillez réessayer.';
  }

  /**
   * Setup global error handler
   */
  setupGlobalErrorHandling() {
    window.addEventListener('error', (event) => {
      console.error('[GLOBAL ERROR]', event.error);
    });

    window.addEventListener('unhandledrejection', (event) => {
      console.error('[UNHANDLED REJECTION]', event.reason);
      if (event.reason instanceof Error) {
        this.handleFetchError(event.reason);
      }
    });
  }

  /**
   * Retry with exponential backoff
   * @param {Function} operation - Async function to retry
   * @param {number} maxAttempts - Max retry attempts
   */
  async retryWithBackoff(operation, maxAttempts = 3) {
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        console.log(`[RETRY] Tentative ${attempt}/${maxAttempts}`);
        return await operation();
      } catch (error) {
        if (attempt === maxAttempts) {
          throw error;
        }
        const delay = Math.pow(2, attempt) * 1000; // Exponential backoff
        console.warn(`[RETRY] Nouvelle tentative dans ${delay}ms...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }

  /**
   * Fetch with timeout
   * @param {string} url - URL to fetch
   * @param {Object} options - Fetch options
   * @param {number} timeout - Timeout in ms
   */
  async fetchWithTimeout(url, options = {}, timeout = 10000) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
      const response = await fetch(url, {
        ...options,
        signal: controller.signal
      });
      clearTimeout(timeoutId);
      return response;
    } catch (error) {
      clearTimeout(timeoutId);
      throw error;
    }
  }

  /**
   * Safe fetch with full error handling
   */
  async safeFetch(url, options = {}, timeout = 10000) {
    try {
      if (!this.isOnline) {
        throw new Error('Mode hors ligne - Vérifiez votre connexion');
      }

      const response = await this.fetchWithTimeout(url, options, timeout);
      
      if (!response.ok) {
        const error = new Error(`HTTP ${response.status}`);
        error.status = response.status;
        await this.handleFetchError(error, { status: response.status });
        throw error;
      }

      return response;
    } catch (error) {
      await this.handleFetchError(error, options);
      throw error;
    }
  }
}

// Export singleton instance
window.connectionErrorHandler = new ConnectionErrorHandler();
