// routes/keepalive.js
// Route pour maintenir la session active et monitorer la santé du serveur

import express from "express";
import { wrap } from "../game.js";
import { redisClient } from "../config/redis.js";

const router = express.Router();
const PORT = process.env.PORT || 8080;
const NODE_ENV = process.env.NODE_ENV || "development";

// Configuration du keepalive par environnement
const KEEPALIVE_CONFIG = {
  development: {
    tick: 20000,      // 20 secondes (plus frequent en dev pour tester)
    timeout: 5000,    // 5 secondes
    maxRetries: 2
  },
  staging: {
    tick: 25000,      // 25 secondes
    timeout: 5000,
    maxRetries: 3
  },
  production: {
    tick: 30000,      // 30 secondes (optimal pour production)
    timeout: 8000,    // 8 secondes (plus tolerant en production)
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
    memory: process.memoryUsage(),
    checks: {}
  };

  // ✅ Vérifier Redis
  try {
    if (redisClient && redisClient.isOpen) {
      const pong = await redisClient.ping();
      health.checks.redis = pong === 'PONG' ? 'ok' : 'slow';
    } else {
      health.checks.redis = 'offline';
      health.status = 'degraded';
    }
  } catch (err) {
    health.checks.redis = 'error';
    health.status = 'degraded';
    console.error('[keepalive] Redis health check failed:', err.message);
  }

  // ✅ Vérifier mémoire (warn si > 500MB)
  if (health.memory.heapUsed > 500 * 1024 * 1024) {
    health.checks.memory = 'warning';
    health.status = 'degraded';
  } else {
    health.checks.memory = 'ok';
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

    // Préparer la réponse
    const payload = {
      keepAliveTick: config.tick,
      keepAliveTimeout: config.timeout,
      keepAliveUrl,
      environment: NODE_ENV,
      serverHealth: health.status,
      serverTime: new Date().toISOString(),
      configVersion: 1
    };

    // Log pour monitoring (seulement erreurs/dégradation)
    if (health.status !== 'healthy') {
      console.warn(`[keepalive] Server health: ${health.status}`, health.checks);
    }

    return res.json(wrap(payload));
  } catch (error) {
    console.error('[keepalive] Error in keepalive handler:', error);
    
    // Répondre avec configuration de secours
    const host = req.get('host') || `localhost:${PORT}`;
    const proto = req.headers['x-forwarded-proto'] || req.protocol || 'http';
    const keepAliveUrl = `${proto}://${host}/api/v1/keepalive/`;

    return res.json(wrap({
      keepAliveTick: config.tick,
      keepAliveTimeout: config.timeout,
      keepAliveUrl,
      environment: NODE_ENV,
      serverHealth: 'degraded',
      serverTime: new Date().toISOString(),
      error: 'Partial health check failure'
    }));
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
