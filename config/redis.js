import redis from 'redis';

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
const NODE_ENV = process.env.NODE_ENV || 'development';

let redisClient = null;
let isConnecting = false;
let hasLoggedRedisError = false;
let redisHealthy = false; // Track Redis health status
let lastRedisAttempt = 0;

/**
 * Initialise et retourne le client Redis avec reconnection automatique
 */
export async function initRedis() {
  if (redisClient && redisHealthy) {
    return redisClient;
  }

  if (isConnecting) {
    // Attend que la connexion soit établie
    return new Promise((resolve, reject) => {
      const checkInterval = setInterval(() => {
        if (redisHealthy) {
          clearInterval(checkInterval);
          resolve(redisClient);
        }
      }, 100);
      setTimeout(() => {
        clearInterval(checkInterval);
        resolve(null); // Resolve with null instead of rejecting
      }, 5000);
    });
  }

  isConnecting = true;
  lastRedisAttempt = Date.now();

  try {
    redisClient = redis.createClient({ 
      url: REDIS_URL,
      socket: {
        reconnectStrategy: (retries) => {
          const delay = Math.min(1000 * Math.pow(2, retries), 10000); // Max 10s
          if (NODE_ENV === 'production') {
            console.log(`[REDIS] Tentative de reconnexion ${retries}... (délai: ${delay}ms)`);
          }
          return delay;
        },
        connectTimeout: 5000,
        keepAlive: 30000 // 30s keepalive
      }
    });

    redisClient.on('error', (err) => {
      redisHealthy = false;
      if (isConnecting && !hasLoggedRedisError) {
        console.warn(`⚠️ [REDIS] Erreur de connexion: ${err.message}`);
        console.warn(`⚠️ [REDIS] Mode dégradé activé - serveur fonctionne sans cache`);
        hasLoggedRedisError = true;
      }
    });

    redisClient.on('connect', () => {
      redisHealthy = true;
      console.log('✅ [REDIS] Connecté avec succès');
      hasLoggedRedisError = false;
    });

    redisClient.on('ready', () => {
      redisHealthy = true;
      console.log('✅ [REDIS] Prêt et fonctionnel');
    });

    redisClient.on('reconnecting', () => {
      redisHealthy = false;
      console.log('🔄 [REDIS] Reconnexion en cours...');
    });

    // Set a timeout for connection attempt
    const connectionPromise = redisClient.connect();
    const timeoutPromise = new Promise((_, reject) => 
      setTimeout(() => reject(new Error('Redis connection timeout')), 3000)
    );

    try {
      await Promise.race([connectionPromise, timeoutPromise]);
      redisHealthy = true;
      isConnecting = false;
      return redisClient;
    } catch (timeoutErr) {
      // Connection timed out or failed - continue without Redis
      console.warn(`⚠️ [REDIS] Timeout de connexion (${timeoutErr.message})`);
      redisHealthy = false;
      isConnecting = false;
      return null;
    }
  } catch (err) {
    console.warn(`⚠️ [REDIS] Erreur d'initialisation: ${err.message}`);
    redisHealthy = false;
    isConnecting = false;
    return null;
  }
}

/**
 * Vérifie la santé du Redis et tente une reconnexion si nécessaire
 */
export async function checkRedisHealth() {
  if (!redisClient) {
    // Tenter une reconnexion tous les 30 secondes
    if (Date.now() - lastRedisAttempt > 30000) {
      await initRedis().catch(() => {});
    }
    return false;
  }

  try {
    if (redisHealthy && redisClient.isOpen) {
      const pong = await Promise.race([
        redisClient.ping(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Ping timeout')), 2000))
      ]);
      redisHealthy = pong === 'PONG';
      return redisHealthy;
    }
    redisHealthy = false;
    return false;
  } catch (err) {
    redisHealthy = false;
    // Tenter une reconnexion si c'était la première vérification
    if (!hasLoggedRedisError) {
      console.log('[REDIS] Tentative de reconnexion après erreur health check');
      await initRedis().catch(() => {});
    }
    return false;
  }
}

/**
 * Retourne la santé actuelle du Redis (sans attendre)
 */
export function getRedisHealth() {
  return redisHealthy && redisClient?.isOpen ? 'ok' : 'offline';
}

/**
 * Récupère le client Redis (ou null si pas disponible)
 */
export function getRedisClient() {
  return redisClient;
}

// ✅ Export direct du client Redis pour express-session
export { redisClient };

/**
 * Stocke une clé-valeur en cache avec TTL optionnel
 */
export async function cacheSet(key, value, ttl = 3600) {
  const client = await initRedis();
  if (!client) return false;

  try {
    const serialized = JSON.stringify(value);
    if (ttl) {
      await client.setEx(key, ttl, serialized);
    } else {
      await client.set(key, serialized);
    }
    return true;
  } catch (err) {
    // Silent fail - Redis unavailable
    return false;
  }
}

/**
 * Récupère une valeur du cache
 */
export async function cacheGet(key) {
  const client = await initRedis();
  if (!client) return null;

  try {
    const value = await client.get(key);
    return value ? JSON.parse(value) : null;
  } catch (err) {
    // Silent fail - Redis unavailable
    return null;
  }
}

/**
 * Supprime une clé du cache
 */
export async function cacheDel(key) {
  const client = await initRedis();
  if (!client) return false;

  try {
    await client.del(key);
    return true;
  } catch (err) {
    // Silent fail - Redis unavailable
    return false;
  }
}

/**
 * Supprime toutes les clés correspondant à un pattern
 */
export async function cacheDelPattern(pattern) {
  const client = await initRedis();
  if (!client) return false;

  try {
    const keys = await client.keys(pattern);
    if (keys.length > 0) {
      await client.del(keys);
    }
    return true;
  } catch (err) {
    // Silent fail - Redis unavailable
    return false;
  }
}

/**
 * Publish un message sur un canal Redis
 */
export async function cachePub(channel, message) {
  const client = await initRedis();
  if (!client) return false;

  try {
    await client.publish(channel, JSON.stringify(message));
    return true;
  } catch (err) {
    // Silent fail - Redis unavailable
    return false;
  }
}

/**
 * Incrémente une clé (pour les compteurs)
 */
export async function cacheIncr(key, amount = 1) {
  const client = await initRedis();
  if (!client) return null;

  try {
    return await client.incrBy(key, amount);
  } catch (err) {
    // Silent fail - Redis unavailable
    return null;
  }
}

/**
 * Ferme la connexion Redis
 */
export async function closeRedis() {
  if (redisClient) {
    await redisClient.disconnect();
    redisClient = null;
  }
}
