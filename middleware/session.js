import { cacheSet, cacheGet, cacheDel } from '../config/redis.js';
import jwt from 'jsonwebtoken';

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

/**
 * Middleware pour protéger les routes API - vérifie le cookie d'authentification
 */
export function requireAuthHTML(req, res, next) {
  const cookie = req.cookies?.authSession;
  if (!cookie) {
    return res.status(401).json({ error: "Authentification requise" });
  }
  try {
    const JWT_SECRET = process.env.JWT_SECRET || "your-secret-key-change-in-production";
    const decoded = jwt.verify(cookie, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    console.log('[AUTH] Invalid session cookie');
    return res.status(401).json({ error: "Session expirée ou invalide" });
  }
}

/**
 * Middleware pour vérifier le rôle sur les routes API
 */
export function requireRoleHTML(role) {
  return (req, res, next) => {
    const cookie = req.cookies?.authSession;
    if (!cookie) {
      return res.status(401).json({ error: "Authentification requise" });
    }
    try {
      const JWT_SECRET = process.env.JWT_SECRET || "your-secret-key-change-in-production";
      const decoded = jwt.verify(cookie, JWT_SECRET);
      req.user = decoded;
      
      if (decoded.role !== role && decoded.role !== 'admin') {
        console.log(`[AUTH] Access denied: required role ${role}, got ${decoded.role}`);
        return res.status(403).json({ error: `Rôle requis: ${role}` });
      }
      next();
    } catch (err) {
      console.log('[AUTH] Invalid session cookie');
      return res.status(401).json({ error: "Session expirée ou invalide" });
    }
  };
}
