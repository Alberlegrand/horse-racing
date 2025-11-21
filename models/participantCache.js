import { pool } from "../config/db.js";
import { cacheSet, cacheGet, cacheDelPattern } from "../config/redis.js";

// Cache participants en mémoire pour très rapide accès
let participantCache = null;
let cacheExpiresAt = 0;
const CACHE_TTL_MS = 60000; // 1 minute cache en mémoire

/**
 * Récupère tous les participants avec cache
 */
export async function getAllParticipants() {
  const now = Date.now();
  
  // Check memory cache first (fastest)
  if (participantCache && now < cacheExpiresAt) {
    return participantCache;
  }

  // Try Redis cache (medium speed)
  const cachedFromRedis = await cacheGet('participants:all');
  if (cachedFromRedis) {
    participantCache = cachedFromRedis;
    cacheExpiresAt = now + CACHE_TTL_MS;
    return cachedFromRedis;
  }

  // Query database (slowest)
  const res = await pool.query(
    `SELECT * FROM participants ORDER BY number ASC`
  );
  
  const participants = res.rows;
  
  // Store in both caches
  participantCache = participants;
  cacheExpiresAt = now + CACHE_TTL_MS;
  await cacheSet('participants:all', participants, 300); // Redis: 5 min TTL
  
  return participants;
}

/**
 * Récupère un participant par numéro avec cache
 */
export async function getParticipantByNumber(number) {
  const allParticipants = await getAllParticipants();
  return allParticipants.find(p => Number(p.number) === Number(number));
}

/**
 * Récupère plusieurs participants par IDs
 */
export async function getParticipantsByIds(ids) {
  if (!ids || ids.length === 0) return [];
  
  const allParticipants = await getAllParticipants();
  return allParticipants.filter(p => ids.includes(p.participant_id));
}

/**
 * Récupère plusieurs participants par numéros
 */
export async function getParticipantsByNumbers(numbers) {
  if (!numbers || numbers.length === 0) return [];
  
  const allParticipants = await getAllParticipants();
  const numSet = new Set(numbers.map(Number));
  return allParticipants.filter(p => numSet.has(Number(p.number)));
}

/**
 * Invalider le cache des participants
 */
export async function invalidateParticipantCache() {
  participantCache = null;
  cacheExpiresAt = 0;
  await cacheDelPattern('participants:*');
}
