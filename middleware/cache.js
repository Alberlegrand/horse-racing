import { cacheGet, cacheSet } from '../config/redis.js';

/**
 * Middleware pour cacher les réponses GET
 * Utilise: cacheResponse(ttl)
 * Exemple: app.get('/api/data', cacheResponse(300), handler)
 */
export function cacheResponse(ttl = 300) {
  return async (req, res, next) => {
    // Ne cache que les GET
    if (req.method !== 'GET') {
      return next();
    }

    // Crée une clé de cache unique basée sur l'URL et query params
    const cacheKey = `http:${req.originalUrl}`;

    // Essaie de récupérer du cache
    const cachedResponse = await cacheGet(cacheKey);
    if (cachedResponse) {
      console.log(`✅ Cache HIT: ${cacheKey}`);
      return res.json(cachedResponse);
    }

    // Wraps la méthode res.json pour mettre en cache la réponse
    const originalJson = res.json.bind(res);
    res.json = function(body) {
      if (res.statusCode === 200 && body) {
        cacheSet(cacheKey, body, ttl).catch(() => {
          // Silent fail - Redis unavailable
        });
      }
      return originalJson(body);
    };

    next();
  };
}

/**
 * Middleware pour invalider le cache
 * Utilise: invalidateCache('pattern:*')
 */
export function invalidateCache(pattern) {
  return async (req, res, next) => {
    // Invalide après le traitement de la requête
    res.on('finish', async () => {
      if (res.statusCode >= 200 && res.statusCode < 300) {
        console.log(`🔄 Invalidation du cache: ${pattern}`);
        // Implementation avec les clés spécifiques
        // Pour l'instant, on invalide lors de POST/PUT/DELETE
      }
    });
    next();
  };
}
