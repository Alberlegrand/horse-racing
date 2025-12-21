// routes/keepalive.js
// Route pour maintenir la session active et monitorer la santé du serveur

import express from "express";
import { wrap } from "../game.js";
import { checkRedisHealth, getRedisHealth } from "../config/redis.js";

const router = express.Router();
const PORT = process.env.PORT || 8080;
const NODE_ENV = process.env.NODE_ENV || "development";

// Configuration du keepalive par environnement
const KEEPALIVE_CONFIG = {
  development: {
    tick: 20000,      // 20 secondes
    timeout: 5000,    // 5 secondes
    maxRetries: 2
  },
  staging: {
    tick: 25000,      // 25 secondes
    timeout: 5000,
    maxRetries: 3
  },
  production: {
    tick: 30000,      // 30 secondes
    timeout: 8000,    // 8 secondes
    maxRetries: 3
  }
};

const config = KEEPALIVE_CONFIG[NODE_ENV] || KEEPALIVE_CONFIG.production;

// === FONCTION: Vérifier la santé du serveur ===
async function checkServerHealth() {
  const health = {
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    memory: {
      used: Math.round(process.memoryUsage().heapUsed / 1024 / 1024), // MB
      total: Math.round(process.memoryUsage().heapTotal / 1024 / 1024) // MB
    },
    checks: {}
  };

  // ✅ Vérifier Redis
  const redisHealth = getRedisHealth(); // Sans attendre
  health.checks.redis = redisHealth;
  
  // Vérifier la santé proactive du Redis en arrière-plan
  checkRedisHealth().catch(() => {}); // Tenter une reconnexion si nécessaire

  // ✅ Vérifier mémoire
  const memoryPercent = (health.memory.used / health.memory.total) * 100;
  if (memoryPercent > 80) {
    health.checks.memory = 'warning';
    health.status = 'degraded';
    console.warn(`[keepalive] ⚠️ Mémoire élevée: ${memoryPercent.toFixed(1)}%`);
  } else if (memoryPercent > 90) {
    health.checks.memory = 'critical';
    health.status = 'critical';
    console.error(`[keepalive] 🚨 Mémoire critique: ${memoryPercent.toFixed(1)}%`);
  } else {
    health.checks.memory = 'ok';
  }

  // Déterminer le statut global
  if (health.checks.redis === 'offline') {
    // Si Redis est offline, c'est "degraded" mais pas "unhealthy"
    if (health.status !== 'critical') {
      health.status = 'degraded';
    }
    console.log(`[keepalive] 🟡 Server health: degraded (redis offline, memory ok)`);
  } else if (health.status === 'critical') {
    console.error(`[keepalive] 🔴 Server health: CRITICAL`);
  } else {
    console.log(`[keepalive] ✅ Server health: healthy`);
  }

  return health;
}

// === ROUTE KEEPALIVE PRINCIPALE ===
// Route /api/v1/keepalive/ pour maintenir la session et checker la santé
router.all("/", async (req, res) => {
  try {
    const host = req.get('host') || `localhost:${PORT}`;
    const proto = req.headers['x-forwarded-proto'] || req.protocol || 'http';
    const basePath = '/api/v1/keepalive/';
    const keepAliveUrl = `${proto}://${host}${basePath}`;

    // Vérifier la santé du serveur
    const health = await checkServerHealth();

    // Répondre avec les infos de keepalive et health
    res.status(200).json({
      success: true,
      keepAliveTick: config.tick,
      keepAliveTimeout: config.timeout,
      keepAliveUrl: keepAliveUrl,
      serverHealth: health,
      // Pour compatibilité avec ancien client
      health: health.status,
      redis: health.checks.redis
    });
  } catch (err) {
    console.error('[keepalive] Erreur:', err);
    res.status(200).json({
      success: true,
      keepAliveTick: config.tick,
      keepAliveTimeout: config.timeout,
      serverHealth: {
        status: 'unknown',
        error: err.message
      }
    });
  }
});

// === ROUTE HEALTH CHECK ===
// Endpoint dédié pour les health checks (load balancers, monitoring)
router.get("/health", async (req, res) => {
  try {
    const health = await checkServerHealth();
    const statusCode = health.status === 'healthy' ? 200 : 503;
    return res.status(statusCode).json(health);
  } catch (error) {
    console.error('[keepalive/health] Error:', error);
    return res.status(503).json({
      status: 'error',
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// === ROUTE PING (ultra-léger) ===
// Ping ultra-rapide pour détection de latence (no DB/Redis checks)
router.get("/ping", (req, res) => {
  return res.json({
    pong: true,
    timestamp: Date.now()
  });
});

export default router;
