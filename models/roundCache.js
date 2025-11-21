import { pool } from "../config/db.js";
import { cacheSet, cacheGet } from "../config/redis.js";

/**
 * Récupère un round par ID avec cache
 */
export async function getRoundWithCache(roundId) {
  const cacheKey = `round:${roundId}`;
  
  // Try Redis cache first
  const cachedRound = await cacheGet(cacheKey);
  if (cachedRound) {
    return cachedRound;
  }

  // Query database
  const res = await pool.query(
    `SELECT * FROM rounds WHERE round_id = $1`,
    [roundId]
  );
  
  const round = res.rows[0];
  if (round) {
    // Cache for 5 minutes
    await cacheSet(cacheKey, round, 300);
  }
  
  return round;
}

/**
 * Récupère les derniers rounds
 */
export async function getRecentRounds(limit = 10) {
  const cacheKey = `rounds:recent:${limit}`;
  
  // Try Redis cache first
  const cachedRounds = await cacheGet(cacheKey);
  if (cachedRounds) {
    return cachedRounds;
  }

  // Query database
  const res = await pool.query(
    `SELECT * FROM rounds ORDER BY created_at DESC LIMIT $1`,
    [limit]
  );
  
  const rounds = res.rows;
  
  // Cache for 2 minutes
  await cacheSet(cacheKey, rounds, 120);
  
  return rounds;
}

/**
 * Récupère les rounds actifs/en attente
 */
export async function getActiveRounds() {
  const cacheKey = 'rounds:active';
  
  // Try Redis cache first
  const cachedRounds = await cacheGet(cacheKey);
  if (cachedRounds) {
    return cachedRounds;
  }

  // Query database with index
  const res = await pool.query(
    `SELECT * FROM rounds WHERE status IN ('waiting', 'running') ORDER BY created_at DESC`
  );
  
  const rounds = res.rows;
  
  // Cache for 30 seconds
  await cacheSet(cacheKey, rounds, 30);
  
  return rounds;
}
