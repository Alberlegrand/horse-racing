/**
 * Query Cache Module - Caches frequently-used aggregation and lookup queries
 * Implements 3-tier caching: Memory (fast) -> Redis (persistent) -> DB (slow)
 * 
 * This significantly reduces database load for repeated aggregation queries
 * like getSalesStats(), getActiveRounds(), etc.
 */

import { pool } from "../config/db.js";
import { cacheGet, cacheSet, cacheDel, cacheDelPattern } from "../config/redis.js";

// Memory cache for ultra-fast access
let queryMemoryCache = {};
const CACHE_TTL_MS = 30000; // 30 seconds for memory cache
const CACHE_EXPIRY = {};

/**
 * Generic query cache with 3-tier strategy
 * @param {string} cacheKey - Unique cache key
 * @param {async function} queryFn - Function that executes the DB query
 * @param {number} ttlSeconds - Redis TTL in seconds (memory is always 30s)
 */
async function cachedQuery(cacheKey, queryFn, ttlSeconds = 60) {
  const now = Date.now();
  
  // Tier 1: Check memory cache (< 1ms)
  if (queryMemoryCache[cacheKey] && CACHE_EXPIRY[cacheKey] > now) {
    console.log(`[CACHE] ✓ Memory hit: ${cacheKey}`);
    return queryMemoryCache[cacheKey];
  }
  
  // Tier 2: Check Redis cache (< 5ms)
  try {
    const redisValue = await cacheGet(cacheKey);
    if (redisValue) {
      // Restore to memory cache
      queryMemoryCache[cacheKey] = redisValue;
      CACHE_EXPIRY[cacheKey] = now + CACHE_TTL_MS;
      console.log(`[CACHE] ✓ Redis hit: ${cacheKey}`);
      return redisValue;
    }
  } catch (err) {
    // Redis unavailable, continue to DB query
  }
  
  // Tier 3: Query database (50-100ms)
  try {
    console.log(`[CACHE] → Database query: ${cacheKey}`);
    const result = await queryFn();
    
    // Store in memory cache
    queryMemoryCache[cacheKey] = result;
    CACHE_EXPIRY[cacheKey] = now + CACHE_TTL_MS;
    
    // Store in Redis cache
    try {
      await cacheSet(cacheKey, result, ttlSeconds);
    } catch (err) {
      // Redis unavailable, continue with memory cache only
    }
    
    return result;
  } catch (err) {
    console.error(`[CACHE] ✗ Error executing query ${cacheKey}:`, err.message);
    throw err;
  }
}

/**
 * Get sales statistics (cached)
 * Used by /api/v1/money route
 * Expected savings: 2 queries -> 1 query + caching = ~80% reduction
 */
export async function getSalesStats() {
  return cachedQuery("query:sales_stats", async () => {
    const res = await pool.query(`
      SELECT 
        COALESCE(SUM(CASE WHEN status IN ('pending', 'won', 'paid', 'lost') THEN total_amount ELSE 0 END), 0) AS total_received,
        COALESCE(SUM(CASE WHEN status = 'paid' THEN prize ELSE 0 END), 0) AS total_payouts,
        COUNT(*) as total_receipts,
        SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending_count,
        SUM(CASE WHEN status = 'won' THEN 1 ELSE 0 END) as won_count,
        SUM(CASE WHEN status = 'paid' THEN 1 ELSE 0 END) as paid_count,
        SUM(CASE WHEN status = 'lost' THEN 1 ELSE 0 END) as lost_count
      FROM receipts
    `);
    return res.rows[0];
  }, 60); // 60 second Redis TTL
}

/**
 * Get active round details with bet count (cached)
 * Used by various routes for round information
 * Expected savings: Multiple queries -> 1 query + caching
 */
export async function getActiveRoundsStats() {
  return cachedQuery("query:active_rounds_stats", async () => {
    const res = await pool.query(`
      SELECT 
        r.round_id,
        r.status,
        r.created_at,
        COUNT(rc.receipt_id) as receipt_count,
        COUNT(DISTINCT rc.user_id) as unique_players,
        COALESCE(SUM(rc.total_amount), 0) as total_bets,
        COALESCE(SUM(rc.prize), 0) as total_prizes
      FROM rounds r
      LEFT JOIN receipts rc ON r.round_id = rc.round_id
      WHERE r.status IN ('active', 'running')
      GROUP BY r.round_id, r.status, r.created_at
      ORDER BY r.created_at DESC
    `);
    return res.rows;
  }, 30); // 30 second Redis TTL for active rounds (more volatile)
}

/**
 * Get participant participation stats (cached)
 * Shows which participants are most bet on
 */
export async function getParticipantStats() {
  return cachedQuery("query:participant_stats", async () => {
    const res = await pool.query(`
      SELECT 
        p.participant_id,
        p.number,
        p.name,
        COUNT(b.bet_id) as bet_count,
        COALESCE(SUM(b.value), 0) as total_bet_value,
        COALESCE(SUM(b.prize), 0) as total_prizes_won,
        COUNT(DISTINCT b.receipt_id) as unique_bets
      FROM participants p
      LEFT JOIN bets b ON p.participant_id = b.participant_id
      GROUP BY p.participant_id, p.number, p.name
      ORDER BY bet_count DESC
    `);
    return res.rows;
  }, 120); // 2 minute Redis TTL for less volatile data
}

/**
 * Get user betting summary (cached per user)
 * Shows user's total bets, wins, losses
 */
export async function getUserBettingSummary(userId) {
  return cachedQuery(`query:user_summary:${userId}`, async () => {
    const res = await pool.query(`
      SELECT 
        COUNT(*) as total_receipts,
        COALESCE(SUM(total_amount), 0) as total_wagered,
        COALESCE(SUM(prize), 0) as total_winnings,
        SUM(CASE WHEN status = 'paid' THEN 1 ELSE 0 END) as paid_receipts,
        SUM(CASE WHEN status = 'won' THEN 1 ELSE 0 END) as won_receipts,
        SUM(CASE WHEN status = 'lost' THEN 1 ELSE 0 END) as lost_receipts,
        SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending_receipts
      FROM receipts
      WHERE user_id = $1
    `, [userId]);
    return res.rows[0];
  }, 120); // 2 minute Redis TTL per user
}

/**
 * Invalidate all query caches (called after mutations)
 */
export function invalidateAllCaches() {
  queryMemoryCache = {};
  Object.keys(CACHE_EXPIRY).forEach(key => delete CACHE_EXPIRY[key]);
  console.log("[CACHE] ✓ All query caches invalidated");
}

/**
 * Invalidate specific cache key
 */
export function invalidateCache(cacheKey) {
  delete queryMemoryCache[cacheKey];
  delete CACHE_EXPIRY[cacheKey];
  console.log(`[CACHE] ✓ Cache invalidated: ${cacheKey}`);
}

/**
 * Invalidate caches matching a pattern
 */
export async function invalidateCachePattern(pattern) {
  Object.keys(queryMemoryCache)
    .filter(key => key.includes(pattern))
    .forEach(key => {
      delete queryMemoryCache[key];
      delete CACHE_EXPIRY[key];
    });
  console.log(`[CACHE] ✓ Caches matching '${pattern}' invalidated`);
  
  // Also try to remove from Redis
  try {
    await cacheDelPattern(`query:${pattern}*`);
  } catch (err) {
    // Redis unavailable
  }
}

export default {
  cachedQuery,
  getSalesStats,
  getActiveRoundsStats,
  getParticipantStats,
  getUserBettingSummary,
  invalidateAllCaches,
  invalidateCache,
  invalidateCachePattern
};
