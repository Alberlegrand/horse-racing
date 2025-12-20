import redis from 'redis';

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

let redisClient = null;
let isConnecting = false;
let hasLoggedRedisError = false; // Prevent log spam

/**
 * Initialise et retourne le client Redis
 */
export async function initRedis() {
  if (redisClient) {
    return redisClient;
  }

  if (isConnecting) {
    // Attend que la connexion soit établie
    return new Promise((resolve, reject) => {
      const checkInterval = setInterval(() => {
        if (redisClient) {
          clearInterval(checkInterval);
          resolve(redisClient);
        }
      }, 100);
      setTimeout(() => {
        clearInterval(checkInterval);
        reject(new Error('Redis connexion timeout'));
      }, 5000);
    });
  }

  isConnecting = true;

  try {
    redisClient = redis.createClient({ 
      url: REDIS_URL,
      socket: {
        reconnectStrategy: (retries) => {
          if (retries > 3) {
            return new Error('Max Redis connection retries reached');
          }
          return retries * 100; // Exponential backoff
        }
      }
    });

    redisClient.on('error', (err) => {
      // Only log once during initialization
      if (isConnecting && !hasLoggedRedisError) {
        console.warn('⚠️ Redis non disponible (mode dégradé activé)');
        hasLoggedRedisError = true;
      }
      redisClient = null;
      isConnecting = false;
    });

    redisClient.on('connect', () => {
      console.log('✅ Connecté à Redis');
      hasLoggedRedisError = false; // Reset flag on successful connection
    });

    // Set a timeout for connection attempt
    const connectionPromise = redisClient.connect();
    const timeoutPromise = new Promise((_, reject) => 
      setTimeout(() => reject(new Error('Redis connection timeout')), 3000)
    );

    try {
      await Promise.race([connectionPromise, timeoutPromise]);
      isConnecting = false;
      return redisClient;
    } catch (timeoutErr) {
      // Connection timed out or failed - continue without Redis
      if (!hasLoggedRedisError) {
        hasLoggedRedisError = true;
      }
      redisClient = null;
      isConnecting = false;
      return null;
    }
  } catch (err) {
    if (!hasLoggedRedisError) {
      hasLoggedRedisError = true;
    }
    redisClient = null;
    isConnecting = false;
    return null;
  }
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
