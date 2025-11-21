import { cacheSet, cacheGet, cacheDel } from '../config/redis.js';

/**
 * Crée une session Redis pour un utilisateur
 */
export async function createSession(userId, userData, ttl = 86400) {
  const sessionKey = `session:${userId}`;
  await cacheSet(sessionKey, userData, ttl);
  return sessionKey;
}

/**
 * Récupère les données de session
 */
export async function getSession(userId) {
  const sessionKey = `session:${userId}`;
  return await cacheGet(sessionKey);
}

/**
 * Supprime une session
 */
export async function destroySession(userId) {
  const sessionKey = `session:${userId}`;
  await cacheDel(sessionKey);
}

/**
 * Middleware pour charger la session
 */
export function sessionMiddleware() {
  return async (req, res, next) => {
    if (!req.user) {
      return next();
    }

    // Essaie de charger la session depuis Redis
    const sessionData = await getSession(req.user.userId);
    if (sessionData) {
      req.session = sessionData;
    }

    next();
  };
}
