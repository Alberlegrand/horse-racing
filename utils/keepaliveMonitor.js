// utils/keepaliveMonitor.js
// Utilitaire de monitoring et diagnostic du keepalive

class KeepaliveMonitor {
  constructor() {
    this.stats = {
      totalRequests: 0,
      successfulRequests: 0,
      failedRequests: 0,
      retriedRequests: 0,
      totalLatency: 0,
      maxLatency: 0,
      minLatency: Infinity,
      consecutiveFailures: 0,
      disconnectionTime: null,
      reconnectionTime: null
    };

    this.history = [];
    this.maxHistorySize = 100;
    this.isEnabled = false;
  }

  /**
   * Démarrer le monitoring
   */
  start() {
    this.isEnabled = true;
    this.stats.startTime = new Date().toISOString();
    console.log('[KeepaliveMonitor] Started monitoring at', this.stats.startTime);
  }

  /**
   * Arrêter le monitoring
   */
  stop() {
    this.isEnabled = false;
    this.stats.endTime = new Date().toISOString();
    console.log('[KeepaliveMonitor] Stopped monitoring at', this.stats.endTime);
  }

  /**
   * Enregistrer une requête réussie
   */
  recordSuccess(latency, serverHealth = 'healthy') {
    if (!this.isEnabled) return;

    this.stats.totalRequests++;
    this.stats.successfulRequests++;
    this.stats.consecutiveFailures = 0;
    this.stats.totalLatency += latency;
    this.stats.maxLatency = Math.max(this.stats.maxLatency, latency);
    this.stats.minLatency = Math.min(this.stats.minLatency, latency);

    // Enregistrer dans l'historique
    this._addToHistory({
      type: 'success',
      latency,
      serverHealth,
      timestamp: new Date().toISOString()
    });

    // Notification si reconnexion
    if (this.stats.disconnectionTime) {
      const downtime = (Date.now() - this.stats.disconnectionTime) / 1000;
      console.log(`[KeepaliveMonitor] ✅ Reconnected after ${downtime.toFixed(1)}s downtime`);
      this.stats.reconnectionTime = new Date().toISOString();
      this.stats.disconnectionTime = null;
    }
  }

  /**
   * Enregistrer un échec
   */
  recordFailure(error, attempt = 1, maxAttempts = 3) {
    if (!this.isEnabled) return;

    this.stats.totalRequests++;
    this.stats.failedRequests++;
    this.stats.consecutiveFailures++;

    // Marquer comme déconnecté si première failure
    if (!this.stats.disconnectionTime) {
      this.stats.disconnectionTime = new Date().toISOString();
      console.log('[KeepaliveMonitor] ⚠️ Disconnection detected at', this.stats.disconnectionTime);
    }

    // Enregistrer dans l'historique
    this._addToHistory({
      type: 'failure',
      error: error?.toString?.() || String(error),
      attempt,
      maxAttempts,
      timestamp: new Date().toISOString()
    });

    // Alerte si trop d'échecs consécutifs
    if (this.stats.consecutiveFailures >= 3) {
      console.error(`[KeepaliveMonitor] ❌ ${this.stats.consecutiveFailures} consecutive failures!`);
    }
  }

  /**
   * Enregistrer une tentative supplémentaire
   */
  recordRetry(attempt, maxAttempts) {
    if (!this.isEnabled) return;

    this.stats.retriedRequests++;

    this._addToHistory({
      type: 'retry',
      attempt,
      maxAttempts,
      timestamp: new Date().toISOString()
    });
  }

  /**
   * Ajouter une entrée à l'historique
   */
  _addToHistory(entry) {
    this.history.push(entry);
    
    // Limiter la taille de l'historique
    if (this.history.length > this.maxHistorySize) {
      this.history.shift();
    }
  }

  /**
   * Obtenir les statistiques
   */
  getStats() {
    const stats = { ...this.stats };
    
    // Calculer les moyennes
    if (stats.successfulRequests > 0) {
      stats.averageLatency = (stats.totalLatency / stats.successfulRequests).toFixed(2);
    } else {
      stats.averageLatency = 0;
    }

    // Calculer le taux de succès
    if (stats.totalRequests > 0) {
      stats.successRate = ((stats.successfulRequests / stats.totalRequests) * 100).toFixed(1) + '%';
    } else {
      stats.successRate = 'N/A';
    }

    // Uptime
    if (stats.startTime) {
      const uptime = Date.now() - new Date(stats.startTime).getTime();
      stats.uptimeMs = uptime;
      stats.uptimeFormatted = this._formatUptime(uptime);
    }

    // Downtime
    if (stats.disconnectionTime) {
      const downtime = Date.now() - new Date(stats.disconnectionTime).getTime();
      stats.downtimeMs = downtime;
      stats.downtimeFormatted = this._formatUptime(downtime);
    }

    return stats;
  }

  /**
   * Afficher un rapport
   */
  printReport() {
    const stats = this.getStats();
    
    console.group('[KeepaliveMonitor] Rapport de Monitoring');
    console.log('📊 Statistiques:');
    console.log(`  • Requêtes totales: ${stats.totalRequests}`);
    console.log(`  • Succès: ${stats.successfulRequests} (${stats.successRate})`);
    console.log(`  • Échecs: ${stats.failedRequests}`);
    console.log(`  • Tentatives: ${stats.retriedRequests}`);
    console.log('⏱️ Latence:');
    console.log(`  • Moyenne: ${stats.averageLatency}ms`);
    console.log(`  • Min: ${stats.minLatency === Infinity ? 'N/A' : stats.minLatency}ms`);
    console.log(`  • Max: ${stats.maxLatency}ms`);
    console.log('⏰ Temps:');
    console.log(`  • Uptime: ${stats.uptimeFormatted}`);
    if (stats.disconnectionTime) {
      console.log(`  • Downtime: ${stats.downtimeFormatted}`);
    }
    console.log(`  • Failures actuelles: ${stats.consecutiveFailures}`);
    console.groupEnd();
  }

  /**
   * Formater une durée en ms
   */
  _formatUptime(ms) {
    const seconds = Math.floor(ms / 1000) % 60;
    const minutes = Math.floor(ms / (1000 * 60)) % 60;
    const hours = Math.floor(ms / (1000 * 60 * 60)) % 24;
    const days = Math.floor(ms / (1000 * 60 * 60 * 24));

    const parts = [];
    if (days > 0) parts.push(`${days}j`);
    if (hours > 0) parts.push(`${hours}h`);
    if (minutes > 0) parts.push(`${minutes}m`);
    if (seconds > 0) parts.push(`${seconds}s`);

    return parts.length > 0 ? parts.join(' ') : '<1s';
  }

  /**
   * Exporter les données
   */
  exportData() {
    return {
      stats: this.getStats(),
      history: this.history,
      exportTime: new Date().toISOString()
    };
  }

  /**
   * Réinitialiser le monitoring
   */
  reset() {
    this.stats = {
      totalRequests: 0,
      successfulRequests: 0,
      failedRequests: 0,
      retriedRequests: 0,
      totalLatency: 0,
      maxLatency: 0,
      minLatency: Infinity,
      consecutiveFailures: 0,
      disconnectionTime: null,
      reconnectionTime: null
    };
    this.history = [];
  }
}

// Singleton
const keepaliveMonitor = new KeepaliveMonitor();

export default keepaliveMonitor;
