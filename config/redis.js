import redis from 'redis';
import dotenv from 'dotenv';

// Charger les variables d'environnement
dotenv.config();

const NODE_ENV = process.env.NODE_ENV || 'development';
const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
const REDIS_TIMEOUT_MS = parseInt(process.env.REDIS_TIMEOUT_MS || '5000');
const MAX_RECONNECT_ATTEMPTS = parseInt(process.env.REDIS_RECONNECT_MAX_ATTEMPTS || '5');

// ✅ Configuration TTL par environnement
const SESSION_TTL = parseInt(process.env.SESSION_TTL || '86400'); // 24h par défaut
const STATS_CACHE_TTL = parseInt(process.env.STATS_CACHE_TTL || '30'); // 30s par défaut
const GAMESTATE_CACHE_TTL = parseInt(process.env.GAMESTATE_CACHE_TTL || '3600'); // 1h par défaut
const QUERY_CACHE_TTL = parseInt(process.env.QUERY_CACHE_TTL || '30'); // 30s par défaut

// ✅ Configuration différenciée dev/prod
const isProduction = NODE_ENV === 'production';
const isDevelopment = NODE_ENV === 'development';

// Variables d'état
let redisClient = null;
let isConnecting = false;
let hasLoggedRedisError = false;
let redisHealthy = false; // Track Redis health status
let lastRedisAttempt = 0;
let redisReconnectAttempts = 0;
let redisDisabled = false; // ✅ NOUVEAU: Flag pour désactiver Redis après trop d'échecs

// ✅ NOUVEAU: Cache local en mémoire comme fallback quand Redis n'est pas disponible
const localCache = new Map(); // { key: { value, expiresAt } }
let lastLogTime = 0; // Pour throttling des logs
const LOG_THROTTLE_MS = 10000; // Log max toutes les 10s

// ✅ NOUVEAU: Limite même en dev pour éviter le spam (20 tentatives max)
const MAX_DEV_RECONNECT_ATTEMPTS = 20;

// ✅ Fonction de configuration d'URL Redis sécurisée avec différenciation dev/prod
function getRedisConfig() {
  const config = {
    url: REDIS_URL,
    socket: {
      connectTimeout: REDIS_TIMEOUT_MS,
      keepAlive: isProduction ? 60000 : 30000, // 60s en prod, 30s en dev
      reconnectStrategy: (retries) => {
        redisReconnectAttempts = retries;
        
        // ✅ PRODUCTION: Arrêter après MAX_RECONNECT_ATTEMPTS
        if (isProduction && retries >= MAX_RECONNECT_ATTEMPTS) {
          redisDisabled = true;
          const now = Date.now();
          if (now - lastLogTime > LOG_THROTTLE_MS) {
            console.error(
              `❌ [REDIS-PROD] Limite de reconnexion atteinte (${MAX_RECONNECT_ATTEMPTS} tentatives). ` +
              `Redis désactivé, utilisation du cache local.`
            );
            lastLogTime = now;
          }
          return new Error('Max reconnection attempts reached');
        }
        
        // ✅ DÉVELOPPEMENT: Limiter à MAX_DEV_RECONNECT_ATTEMPTS pour éviter le spam
        if (isDevelopment && retries >= MAX_DEV_RECONNECT_ATTEMPTS) {
          redisDisabled = true;
          const now = Date.now();
          if (now - lastLogTime > LOG_THROTTLE_MS) {
            console.warn(
              `⚠️ [REDIS-DEV] Trop de tentatives de reconnexion (${MAX_DEV_RECONNECT_ATTEMPTS}). ` +
              `Redis désactivé, utilisation du cache local en mémoire. ` +
              `Pour réactiver: redémarrer le serveur après avoir démarré Redis.`
            );
            lastLogTime = now;
          }
          return new Error('Max dev reconnection attempts reached');
        }
        
        // ✅ Backoff exponentiel avec throttling des logs
        const delay = Math.min(1000 * Math.pow(2, Math.min(retries, 5)), isProduction ? 10000 : 5000);
        const env = isProduction ? '[PROD]' : '[DEV]';
        
        // ✅ Throttling: log seulement toutes les 10s ou toutes les 5 tentatives
        const now = Date.now();
        if ((now - lastLogTime > LOG_THROTTLE_MS) || (retries % 5 === 0)) {
          console.log(`🔄 ${env} [REDIS] Tentative de reconnexion ${retries}/${isProduction ? MAX_RECONNECT_ATTEMPTS : MAX_DEV_RECONNECT_ATTEMPTS}... (délai: ${delay}ms)`);
          lastLogTime = now;
        }
        
        return delay;
      }
    }
  };
  
  // ✅ PRODUCTION: Configuration supplémentaire pour la stabilité
  if (isProduction) {
    config.socket.noDelay = true; // Désactiver Nagle pour latence réduite
    config.socket.keepAliveInitialDelay = 10000; // Démarrer keepalive après 10s
  }
  
  return config;
}


/**
 * ✅ Initialise et retourne le client Redis avec reconnection automatique
 * Si Redis est désactivé (trop d'échecs), retourne null immédiatement
 */
export async function initRedis() {
  // ✅ NOUVEAU: Si Redis est désactivé, ne pas essayer de se reconnecter
  if (redisDisabled) {
    return null;
  }

  if (redisClient && redisHealthy) {
    return redisClient;
  }

  if (isConnecting) {
    // Attend que la connexion soit établie
    return new Promise((resolve) => {
      const checkInterval = setInterval(() => {
        if (redisHealthy) {
          clearInterval(checkInterval);
          resolve(redisClient);
        }
        if (redisDisabled) {
          clearInterval(checkInterval);
          resolve(null);
        }
      }, 100);
      setTimeout(() => {
        clearInterval(checkInterval);
        resolve(null); // Resolve with null instead of rejecting
      }, REDIS_TIMEOUT_MS + 1000);
    });
  }

  // ✅ NOUVEAU: Vérifier si on a déjà tenté trop de fois récemment
  const timeSinceLastAttempt = Date.now() - lastRedisAttempt;
  if (timeSinceLastAttempt < 5000 && redisReconnectAttempts > MAX_DEV_RECONNECT_ATTEMPTS) {
    // Ne pas essayer si on vient d'essayer il y a moins de 5s et qu'on a déjà trop d'échecs
    return null;
  }

  isConnecting = true;
  lastRedisAttempt = Date.now();

  try {
    console.log(`📍 [REDIS] Tentative de connexion à: ${REDIS_URL.replace(/:[^:]*@/, ':***@')}`);
    
    redisClient = redis.createClient(getRedisConfig());

    // Event listeners
    redisClient.on('error', (err) => {
      redisHealthy = false;
      if (isConnecting && !hasLoggedRedisError) {
        console.warn(`⚠️ [REDIS] Erreur de connexion: ${err.message}`);
        console.warn(`⚠️ [REDIS] Mode dégradé activé - serveur fonctionne sans cache`);
        console.warn(`💡 [REDIS] Assurez-vous que Redis est:
  - En développement: redis-server en local (port 6379)
  - En production: REDIS_URL correcte dans .env`);
        hasLoggedRedisError = true;
      }
    });

    redisClient.on('connect', () => {
      redisHealthy = true;
      redisDisabled = false; // ✅ Réactiver si connexion réussie
      hasLoggedRedisError = false;
      redisReconnectAttempts = 0; // ✅ Reset compteur
      console.log('✅ [REDIS] Connecté avec succès - Cache local désactivé');
    });

    redisClient.on('ready', () => {
      redisHealthy = true;
      redisDisabled = false; // ✅ Réactiver si prêt
      redisReconnectAttempts = 0; // ✅ Reset compteur
      console.log('✅ [REDIS] Prêt et fonctionnel');
    });

    redisClient.on('reconnecting', () => {
      redisHealthy = false;
      // ✅ Throttling: log seulement toutes les 10s
      const now = Date.now();
      if (now - lastLogTime > LOG_THROTTLE_MS) {
        console.log(`🔄 [REDIS] Reconnexion en cours... (tentative ${redisReconnectAttempts}/${isProduction ? MAX_RECONNECT_ATTEMPTS : MAX_DEV_RECONNECT_ATTEMPTS})`);
        lastLogTime = now;
      }
    });

    // Connection timeout logic
    const connectionPromise = redisClient.connect();
    const timeoutPromise = new Promise((_, reject) => 
      setTimeout(() => reject(new Error('Redis connection timeout')), REDIS_TIMEOUT_MS)
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
 * ✅ Retourne la santé actuelle du Redis (sans attendre)
 * ✅ NOUVEAU: Indique si cache local est utilisé
 */
export function getRedisHealth() {
  if (redisDisabled) {
    return 'disabled'; // Redis désactivé après trop d'échecs
  }
  if (redisHealthy && redisClient?.isOpen) {
    return 'ok';
  }
  return 'offline'; // Redis offline mais cache local actif
}

/**
 * ✅ Récupère le statut détaillé de Redis avec configuration TTL
 * ✅ NOUVEAU: Inclut info sur cache local
 */
export function getRedisStatus() {
  return {
    healthy: redisHealthy,
    connected: redisClient?.isOpen || false,
    disabled: redisDisabled, // ✅ NOUVEAU: Redis désactivé après trop d'échecs
    url: REDIS_URL.replace(/:[^:]*@/, ':***@'), // Mask password
    reconnectAttempts: redisReconnectAttempts,
    maxAttempts: isProduction ? MAX_RECONNECT_ATTEMPTS : MAX_DEV_RECONNECT_ATTEMPTS,
    environment: NODE_ENV,
    timeout: REDIS_TIMEOUT_MS,
    // ✅ NOUVEAU: Configuration TTL
    ttl: {
      session: SESSION_TTL,
      stats: STATS_CACHE_TTL,
      gamestate: GAMESTATE_CACHE_TTL,
      query: QUERY_CACHE_TTL
    },
    // ✅ NOUVEAU: Mode de fonctionnement
    mode: isProduction ? 'production' : 'development',
    gracefulDegradation: true, // L'app fonctionne sans Redis
    // ✅ NOUVEAU: Info cache local
    localCache: {
      enabled: redisDisabled || !redisHealthy,
      size: localCache.size,
      maxSize: 1000
    }
  };
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
 * ✅ Stocke une clé-valeur en cache avec TTL optionnel
 * Gère automatiquement les TTL selon le type de clé et l'environnement
 * ✅ NOUVEAU: Utilise cache local si Redis n'est pas disponible
 */
export async function cacheSet(key, value, ttl = null) {
  // ✅ TTL automatique selon le type de clé si non spécifié
  if (ttl === null) {
    if (key.startsWith('session:')) {
      ttl = SESSION_TTL;
    } else if (key.startsWith('stats:')) {
      ttl = STATS_CACHE_TTL;
    } else if (key.startsWith('game:state:')) {
      ttl = GAMESTATE_CACHE_TTL;
    } else if (key.startsWith('query:') || key.startsWith('round:')) {
      ttl = QUERY_CACHE_TTL;
    } else {
      ttl = isProduction ? 3600 : 300; // 1h en prod, 5min en dev par défaut
    }
  }

  // ✅ Essayer Redis d'abord
  const client = await initRedis();
  if (client) {
    try {
      const serialized = JSON.stringify(value);
      if (ttl > 0) {
        await client.setEx(key, ttl, serialized);
      } else {
        await client.set(key, serialized);
      }
      return true;
    } catch (err) {
      // Redis échoué, fallback sur cache local
    }
  }

  // ✅ FALLBACK: Cache local en mémoire
  const expiresAt = ttl > 0 ? Date.now() + (ttl * 1000) : null;
  localCache.set(key, { value, expiresAt });
  
  // ✅ Nettoyer les entrées expirées périodiquement (max 1000 entrées)
  if (localCache.size > 1000) {
    const now = Date.now();
    for (const [k, v] of localCache.entries()) {
      if (v.expiresAt && v.expiresAt < now) {
        localCache.delete(k);
      }
    }
  }
  
  return true; // ✅ Toujours retourner true avec cache local
}

/**
 * ✅ Récupère une valeur du cache
 * ✅ NOUVEAU: Utilise cache local si Redis n'est pas disponible
 */
export async function cacheGet(key) {
  // ✅ Essayer Redis d'abord
  const client = await initRedis();
  if (client) {
    try {
      const value = await client.get(key);
      if (value) {
        return JSON.parse(value);
      }
    } catch (err) {
      // Redis échoué, fallback sur cache local
    }
  }

  // ✅ FALLBACK: Cache local en mémoire
  const cached = localCache.get(key);
  if (!cached) {
    return null;
  }

  // ✅ Vérifier expiration
  if (cached.expiresAt && cached.expiresAt < Date.now()) {
    localCache.delete(key);
    return null;
  }

  return cached.value;
}

/**
 * ✅ Supprime une clé du cache
 * ✅ NOUVEAU: Supprime aussi du cache local
 */
export async function cacheDel(key) {
  // ✅ Essayer Redis d'abord
  const client = await initRedis();
  if (client) {
    try {
      await client.del(key);
    } catch (err) {
      // Redis échoué, continuer avec cache local
    }
  }

  // ✅ Toujours supprimer du cache local aussi
  localCache.delete(key);
  return true;
}

/**
 * ✅ Supprime toutes les clés correspondant à un pattern
 * ✅ NOUVEAU: Supprime aussi du cache local
 */
export async function cacheDelPattern(pattern) {
  let deletedCount = 0;

  // ✅ Essayer Redis d'abord
  const client = await initRedis();
  if (client) {
    try {
      const keys = await client.keys(pattern);
      if (keys.length > 0) {
        await client.del(keys);
        deletedCount += keys.length;
      }
    } catch (err) {
      // Redis échoué, continuer avec cache local
    }
  }

  // ✅ Supprimer du cache local aussi (pattern matching simple)
  const regex = new RegExp(pattern.replace(/\*/g, '.*'));
  for (const key of localCache.keys()) {
    if (regex.test(key)) {
      localCache.delete(key);
      deletedCount++;
    }
  }

  return deletedCount > 0;
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
    try {
      await redisClient.disconnect();
      console.log('✅ [REDIS] Connexion fermée proprement');
    } catch (err) {
      console.warn(`⚠️ [REDIS] Erreur lors de la fermeture:`, err.message);
    } finally {
      redisClient = null;
      redisHealthy = false;
    }
  }
}

// ✅ Export des constantes TTL pour utilisation dans d'autres modules
export const REDIS_TTL = {
  SESSION: SESSION_TTL,
  STATS: STATS_CACHE_TTL,
  GAMESTATE: GAMESTATE_CACHE_TTL,
  QUERY: QUERY_CACHE_TTL
};
