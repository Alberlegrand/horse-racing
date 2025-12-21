// middleware/keepalive-monitor.js
// Middleware de monitoring du keepalive pour la production

import { getRedisHealth, checkRedisHealth } from '../config/redis.js';

/**
 * Middleware pour monitorer la santé du serveur durant les keepalives
 * Enregistre les stats et les anomalies pour la production
 */
export function createKeepaliveMonitor() {
  const stats = {
    totalRequests: 0,
    healthyRequests: 0,
    degradedRequests: 0,
    criticalRequests: 0,
    averageResponseTime: 0,
    lastCheck: null,
    redisOfflineCount: 0,
    redisOfflineSince: null
  };

  /**
   * Middleware pour capturer les keepalive
   */
  function monitor(req, res, next) {
    const startTime = Date.now();

    // Intercepter la méthode send pour capturer les réponses
    const originalSend = res.send;
    res.send = function(data) {
      const duration = Date.now() - startTime;
      
      try {
        const jsonData = typeof data === 'string' ? JSON.parse(data) : data;
        
        stats.totalRequests++;
        stats.averageResponseTime = 
          (stats.averageResponseTime + duration) / 2; // Moyenne mobile
        
        // Categoriser par santé
        if (jsonData.serverHealth) {
          const status = jsonData.serverHealth.status;
          
          if (status === 'healthy') {
            stats.healthyRequests++;
          } else if (status === 'degraded') {
            stats.degradedRequests++;
            
            // Tracker Redis offline
            if (jsonData.serverHealth.checks.redis === 'offline') {
              stats.redisOfflineCount++;
              if (!stats.redisOfflineSince) {
                stats.redisOfflineSince = new Date().toISOString();
              }
            }
          } else if (status === 'critical') {
            stats.criticalRequests++;
          }
        }
        
        stats.lastCheck = new Date().toISOString();
      } catch (e) {
        // Ignore parsing errors
      }
      
      return originalSend.call(this, data);
    };

    next();
  }

  /**
   * Obtenir les stats actuelles
   */
  function getStats() {
    const healthyPercent = stats.totalRequests > 0 
      ? ((stats.healthyRequests / stats.totalRequests) * 100).toFixed(1)
      : '0';
    
    return {
      ...stats,
      healthyPercent: parseFloat(healthyPercent),
      uptime: process.uptime(),
      memory: {
        used: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
        total: Math.round(process.memoryUsage().heapTotal / 1024 / 1024)
      }
    };
  }

  /**
   * Réinitialiser les stats
   */
  function reset() {
    stats.totalRequests = 0;
    stats.healthyRequests = 0;
    stats.degradedRequests = 0;
    stats.criticalRequests = 0;
    stats.averageResponseTime = 0;
    stats.redisOfflineCount = 0;
    stats.redisOfflineSince = null;
  }

  /**
   * Afficher un rapport de santé
   */
  async function printHealthReport() {
    const currentStats = getStats();
    const redisHealth = getRedisHealth();

    console.log(`
════════════════════════════════════════════════════════
📊 KEEPALIVE HEALTH REPORT
════════════════════════════════════════════════════════
✅ Total Requests: ${currentStats.totalRequests}
✅ Healthy: ${currentStats.healthyRequests} (${currentStats.healthyPercent}%)
⚠️ Degraded: ${currentStats.degradedRequests}
🔴 Critical: ${currentStats.criticalRequests}
🔄 Avg Response: ${currentStats.averageResponseTime.toFixed(0)}ms
📡 Redis Status: ${redisHealth}
⏱️  Last Check: ${currentStats.lastCheck || 'N/A'}
════════════════════════════════════════════════════════

Memory: ${currentStats.memory.used}MB / ${currentStats.memory.total}MB
Uptime: ${(currentStats.uptime / 3600).toFixed(1)}h
════════════════════════════════════════════════════════
    `);

    // Si Redis est offline depuis longtemps
    if (redisHealth === 'offline' && currentStats.redisOfflineSince) {
      const offlineTime = new Date() - new Date(currentStats.redisOfflineSince);
      const minutes = Math.round(offlineTime / 1000 / 60);
      console.warn(`⚠️ ATTENTION: Redis offline depuis ${minutes} minutes`);
      console.warn('🔧 Actions recommandées:');
      console.warn('   1. Vérifier les logs Redis: docker logs redis');
      console.warn('   2. Vérifier la connexion réseau');
      console.warn('   3. Redémarrer le conteneur Redis si nécessaire');
    }
  }

  return {
    middleware: monitor,
    getStats,
    reset,
    printHealthReport
  };
}

export default createKeepaliveMonitor;
