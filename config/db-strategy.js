/**
 * Stratégie d'optimisation PostgreSQL + Redis
 * 
 * PostgreSQL (Persistance):
 * - Logs d'audit (transactions, actions utilisateur)
 * - Statistiques (rounds complétés, gains/pertes)
 * - Données permanentes (rounds, tickets, paris)
 * 
 * Redis (Performance):
 * - Sessions utilisateur (24h TTL)
 * - Cache des statistiques (30s TTL)
 * - État du jeu en mémoire (1h TTL)
 * - Cache des requêtes fréquentes (30s TTL)
 */

import { cacheSet, cacheGet, cacheDelPattern } from './redis.js';
import { pool } from './db.js';
import { createLog } from '../models/logModel.js';
import { createStat, getStatByRound } from '../models/statModel.js';

// ============================================================================
// 1️⃣ SESSIONS UTILISATEUR - Redis uniquement (rapide)
// ============================================================================

export async function saveUserSession(userId, userData, ttl = 86400) {
  /**
   * Sauvegarde une session utilisateur en Redis (24h par défaut)
   * 
   * @param {string} userId - ID unique de l'utilisateur
   * @param {object} userData - { role, loginTime, email, ... }
   * @param {number} ttl - Durée de vie en secondes
   */
  return await cacheSet(`session:${userId}`, userData, ttl);
}

export async function getUserSession(userId) {
  /**
   * Récupère une session utilisateur depuis Redis
   */
  return await cacheGet(`session:${userId}`);
}

export async function destroyUserSession(userId) {
  /**
   * Détruit une session utilisateur
   */
  return await cacheDelPattern(`session:${userId}`);
}

// ============================================================================
// 2️⃣ STATISTIQUES - PostgreSQL + Redis Cache
// ============================================================================

export async function saveRoundStatistics(roundId, stats) {
  /**
   * Sauvegarde les statistiques d'un round en PostgreSQL
   * ET en cache Redis (30s)
   * 
   * @param {number} roundId - ID du round
   * @param {object} stats - { total_receipts, total_stakes, total_paid, ... }
   */
  
  // 1. Persister en PostgreSQL
  const dbStats = await createStat({
    round_id: roundId,
    total_receipts: stats.total_receipts || 0,
    total_bets: stats.total_bets || 0,
    total_stakes: stats.total_stakes || 0,
    total_prize_pool: stats.total_prize_pool || 0,
    total_paid: stats.total_paid || 0,
    house_balance: stats.house_balance || 0
  });

  // 2. Cacher en Redis pour requêtes fréquentes (30s)
  await cacheSet(`stats:round:${roundId}`, dbStats, 30);
  
  // 3. Invalider le cache global des stats
  await cacheDelPattern('stats:global:*');
  
  return dbStats;
}

export async function getRoundStatistics(roundId) {
  /**
   * Récupère les statistiques d'un round
   * Vérifie d'abord Redis, puis PostgreSQL
   */
  
  // 1. Essayer le cache Redis d'abord
  let cachedStats = await cacheGet(`stats:round:${roundId}`);
  if (cachedStats) {
    console.log(`[CACHE] ✓ Stats de round #${roundId} depuis Redis`);
    return cachedStats;
  }

  // 2. Fallback: PostgreSQL
  console.log(`[DB] → Stats de round #${roundId} depuis PostgreSQL`);
  const dbStats = await getStatByRound(roundId);
  
  // 3. Mettre en cache pour prochaine fois
  if (dbStats) {
    await cacheSet(`stats:round:${roundId}`, dbStats, 30);
  }
  
  return dbStats;
}

export async function getGlobalStatistics(limit = 20) {
  /**
   * Récupère les statistiques globales (derniers N rounds)
   * Cache Redis: 30s
   */
  
  const cacheKey = `stats:global:last_${limit}`;
  
  // 1. Vérifier le cache
  let cachedStats = await cacheGet(cacheKey);
  if (cachedStats) {
    console.log(`[CACHE] ✓ Stats globales depuis Redis`);
    return cachedStats;
  }

  // 2. Requête PostgreSQL
  console.log(`[DB] → Stats globales depuis PostgreSQL`);
  const stats = await pool.query(
    `SELECT * FROM game_statistics ORDER BY created_at DESC LIMIT $1`,
    [limit]
  );

  // 3. Cacher le résultat
  if (stats.rows.length > 0) {
    await cacheSet(cacheKey, stats.rows, 30);
  }

  return stats.rows;
}

export async function invalidateStatisticsCache(roundId = null) {
  /**
   * Invalide le cache des statistiques
   * Utilisé quand un nouveau round/ticket est créé
   */
  
  if (roundId) {
    await cacheDelPattern(`stats:round:${roundId}`);
  }
  
  // Invalider aussi le cache global
  await cacheDelPattern('stats:global:*');
  
  console.log(`[CACHE] Statistiques invalidées`);
}

// ============================================================================
// 3️⃣ LOGS D'AUDIT - PostgreSQL uniquement (persistance)
// ============================================================================

export async function logAction(userId, action, entityType, entityId, details = {}, ipAddress = null) {
  /**
   * Crée un log d'audit en PostgreSQL (permanent)
   * 
   * @param {string} userId - ID de l'utilisateur
   * @param {string} action - Type d'action: 'TICKET_CREATED', 'TICKET_DELETED', 'RACE_STARTED', etc.
   * @param {string} entityType - Type d'entité: 'ROUND', 'RECEIPT', 'BET'
   * @param {number} entityId - ID de l'entité
   * @param {object} details - Données additionnelles
   * @param {string} ipAddress - IP du client
   */
  
  try {
    const log = await createLog({
      user_id: userId,
      action: action,
      entity_type: entityType,
      entity_id: entityId,
      old_value: details.old_value || null,
      new_value: details.new_value || null,
      ip_address: ipAddress
    });

    console.log(`[LOG] ✓ ${action} - ${entityType}#${entityId}`);
    return log;
  } catch (err) {
    console.error(`[LOG] ✗ Erreur création log:`, err.message);
    return null;
  }
}

export async function getAuditLog(entityType, entityId, limit = 50) {
  /**
   * Récupère l'historique d'audit pour une entité
   * PostgreSQL uniquement (lecture historique, pas de cache)
   */
  
  const res = await pool.query(
    `SELECT * FROM transaction_logs 
     WHERE entity_type = $1 AND entity_id = $2 
     ORDER BY created_at DESC LIMIT $3`,
    [entityType, entityId, limit]
  );

  return res.rows;
}

// ============================================================================
// 4️⃣ CACHE DES REQUÊTES FRÉQUENTES - Redis uniquement
// ============================================================================

export async function cacheQuery(queryKey, queryFn, ttl = 30) {
  /**
   * Cache générique pour requêtes fréquentes
   * 
   * @param {string} queryKey - Clé du cache (ex: 'query:sales_stats')
   * @param {function} queryFn - Fonction qui exécute la requête
   * @param {number} ttl - Durée de vie en secondes
   */
  
  // 1. Vérifier le cache
  let cached = await cacheGet(queryKey);
  if (cached) {
    console.log(`[CACHE] ✓ ${queryKey} depuis Redis`);
    return cached;
  }

  // 2. Exécuter la requête
  console.log(`[CACHE] → ${queryKey} - Exécution requête`);
  const result = await queryFn();

  // 3. Cacher le résultat
  if (result) {
    await cacheSet(queryKey, result, ttl);
  }

  return result;
}

export async function invalidateQueryCache(pattern) {
  /**
   * Invalide les requêtes en cache correspondant à un pattern
   * Ex: invalidateQueryCache('sales_stats') → vide toutes les clés contenant 'sales_stats'
   */
  return await cacheDelPattern(`query:${pattern}`);
}

// ============================================================================
// 5️⃣ RÉSUMÉ DE LA STRATÉGIE
// ============================================================================

/**
 * MATRICE DE DÉCISION:
 * 
 * ┌─────────────────────────────────────┬──────────┬───────┐
 * │ Type de données                     │ Postgres │ Redis │
 * ├─────────────────────────────────────┼──────────┼───────┤
 * │ Sessions utilisateur                │    -     │   ✓   │ (24h TTL)
 * │ Logs d'audit                        │    ✓     │   -   │ (permanent)
 * │ Statistiques (cache)                │    ✓     │   ✓   │ (DB + 30s cache)
 * │ Données de rounds                   │    ✓     │   -   │ (permanent)
 * │ Tickets & Paris                     │    ✓     │   -   │ (permanent)
 * │ Requêtes fréquentes (ex: sales)     │    -     │   ✓   │ (30s TTL)
 * │ État du jeu (gameState)             │    -     │   ✓   │ (1h TTL)
 * └─────────────────────────────────────┴──────────┴───────┘
 * 
 * FLUX:
 * 1. Action utilisateur (ticket créé)
 *    ↓
 * 2. Sauvegarder en PostgreSQL (permanent)
 *    ↓
 * 3. Invalider cache Redis des stats
 *    ↓
 * 4. Logs d'audit → PostgreSQL
 *    ↓
 * 5. WebSocket aux clients
 *    ↓
 * 6. Clients rafraîchissent l'affichage
 */

// ============================================================================
// 5️⃣ CACHE ROUND ACTIF - Redis pendant le round (zéro DB queries)
// ============================================================================

/**
 * Initialise le cache Redis pour un nouveau round actif
 * Sauvegarde les participants et crée les structures pour receipts/bets
 * 
 * @param {number} roundId - ID du round
 * @param {object} roundData - { participants: [...], ... }
 */
export async function initRoundCache(roundId, roundData) {
  try {
    const roundKey = `round:${roundId}:data`;
    const cacheData = {
      roundId,
      participantNumbers: (roundData.participants || []).map(p => p.number),
      participantsByNumber: {},
      receipts: [],
      stats: {
        totalMise: 0,
        totalReceipts: 0,
        participantMise: {}
      }
    };

    // Construire la map participants par numéro
    (roundData.participants || []).forEach(p => {
      cacheData.participantsByNumber[p.number] = {
        number: p.number,
        name: p.name,
        coeff: p.coeff
      };
      cacheData.stats.participantMise[p.number] = 0;
    });

    await cacheSet(roundKey, cacheData, 3600); // 1h TTL
    console.log(`✅ [CACHE] Round ${roundId} initialized in Redis`);
    return true;
  } catch (err) {
    console.error('[CACHE] Erreur initRoundCache:', err.message);
    return false;
  }
}

/**
 * Ajoute un ticket au cache Redis du round actif
 * Utilisé lors de POST /api/v1/receipts (action=add)
 * 
 * @param {number} roundId - ID du round
 * @param {object} ticket - { id, user_id, created_at, total_amount, bets: [...] }
 */
export async function addTicketToRoundCache(roundId, ticket) {
  try {
    const roundKey = `round:${roundId}:data`;
    const roundCache = await cacheGet(roundKey);
    
    if (!roundCache) {
      console.warn(`[CACHE] Round ${roundId} pas en cache`);
      return false;
    }

    // Ajouter le ticket au cache
    roundCache.receipts.push({
      id: ticket.id,
      user_id: ticket.user_id,
      created_at: ticket.created_at || Date.now(),
      total_amount: ticket.total_amount,
      bets: ticket.bets || []
    });

    // Mettre à jour les stats
    roundCache.stats.totalReceipts += 1;
    roundCache.stats.totalMise += ticket.total_amount;
    
    (ticket.bets || []).forEach(bet => {
      const num = bet.number || bet.participant?.number;
      if (num) {
        roundCache.stats.participantMise[num] = 
          (roundCache.stats.participantMise[num] || 0) + (bet.value || 0);
      }
    });

    await cacheSet(roundKey, roundCache, 3600);
    console.log(`✅ [CACHE] Ticket ${ticket.id} added to round ${roundId}`);
    return true;
  } catch (err) {
    console.error('[CACHE] Erreur addTicketToRoundCache:', err.message);
    return false;
  }
}

/**
 * Supprime un ticket du cache Redis du round actif
 * Utilisé lors de DELETE /api/v1/receipts
 * 
 * @param {number} roundId - ID du round
 * @param {string|number} ticketId - ID du ticket à supprimer
 */
export async function deleteTicketFromRoundCache(roundId, ticketId) {
  try {
    const roundKey = `round:${roundId}:data`;
    const roundCache = await cacheGet(roundKey);
    
    if (!roundCache) {
      console.warn(`[CACHE] Round ${roundId} pas en cache`);
      return false;
    }

    // Trouver le ticket
    const ticketIndex = roundCache.receipts.findIndex(r => r.id === ticketId);
    if (ticketIndex === -1) {
      console.warn(`[CACHE] Ticket ${ticketId} non trouvé`);
      return false;
    }

    // Récupérer les données du ticket avant suppression
    const deletedTicket = roundCache.receipts[ticketIndex];

    // Mettre à jour les stats
    roundCache.stats.totalReceipts -= 1;
    roundCache.stats.totalMise -= deletedTicket.total_amount;
    
    (deletedTicket.bets || []).forEach(bet => {
      const num = bet.number || bet.participant?.number;
      if (num) {
        roundCache.stats.participantMise[num] = 
          (roundCache.stats.participantMise[num] || 0) - (bet.value || 0);
      }
    });

    // Supprimer le ticket
    roundCache.receipts.splice(ticketIndex, 1);

    await cacheSet(roundKey, roundCache, 3600);
    console.log(`✅ [CACHE] Ticket ${ticketId} removed from round ${roundId}`);
    return true;
  } catch (err) {
    console.error('[CACHE] Erreur deleteTicketFromRoundCache:', err.message);
    return false;
  }
}

/**
 * Met à jour le statut et le prize d'un ticket dans le cache Redis
 * Utilisé après la fin de la course pour mettre à jour les statuts
 * 
 * @param {number} roundId - ID du round
 * @param {string|number} ticketId - ID du ticket à mettre à jour
 * @param {string} status - Nouveau statut ('won', 'lost', 'paid', etc.)
 * @param {number} prize - Montant du gain (en système)
 */
export async function updateTicketInRoundCache(roundId, ticketId, status, prize = null) {
  try {
    const roundKey = `round:${roundId}:data`;
    const roundCache = await cacheGet(roundKey);
    
    if (!roundCache) {
      console.warn(`[CACHE] Round ${roundId} pas en cache pour mise à jour ticket ${ticketId}`);
      return false;
    }

    // Trouver le ticket
    const ticketIndex = roundCache.receipts.findIndex(r => r.id === ticketId);
    if (ticketIndex === -1) {
      console.warn(`[CACHE] Ticket ${ticketId} non trouvé dans le cache`);
      return false;
    }

    // Mettre à jour le ticket
    roundCache.receipts[ticketIndex].status = status;
    if (prize !== null) {
      roundCache.receipts[ticketIndex].prize = prize;
    }

    await cacheSet(roundKey, roundCache, 3600);
    console.log(`✅ [CACHE] Ticket ${ticketId} mis à jour: status=${status}, prize=${prize || 'N/A'}`);
    return true;
  } catch (err) {
    console.error('[CACHE] Erreur updateTicketInRoundCache:', err.message);
    return false;
  }
}

/**
 * Récupère tous les tickets du cache Redis du round actif
 * 
 * @param {number} roundId - ID du round
 * @returns {array} Array of tickets or empty array
 */
export async function getRoundTicketsFromCache(roundId) {
  try {
    const roundKey = `round:${roundId}:data`;
    const roundCache = await cacheGet(roundKey);
    
    if (!roundCache) {
      return [];
    }

    return roundCache.receipts || [];
  } catch (err) {
    console.error('[CACHE] Erreur getRoundTicketsFromCache:', err.message);
    return [];
  }
}

/**
 * Récupère les participants du cache Redis du round actif
 * Utilisé pour validation lors de ticket creation
 * 
 * @param {number} roundId - ID du round
 * @returns {object} participantsByNumber map or empty object
 */
export async function getRoundParticipantsFromCache(roundId) {
  try {
    const roundKey = `round:${roundId}:data`;
    const roundCache = await cacheGet(roundKey);
    
    if (!roundCache) {
      return {};
    }

    return roundCache.participantsByNumber || {};
  } catch (err) {
    console.error('[CACHE] Erreur getRoundParticipantsFromCache:', err.message);
    return {};
  }
}

/**
 * Vide le cache Redis d'un round quand la course finit
 * Appelé après batchPersistRound() pour nettoyer
 * 
 * @param {number} roundId - ID du round
 */
export async function clearRoundCache(roundId) {
  try {
    const roundKey = `round:${roundId}:data`;
    await cacheDelPattern(roundKey);
    console.log(`✅ [CACHE] Round ${roundId} cache cleared`);
    return true;
  } catch (err) {
    console.error('[CACHE] Erreur clearRoundCache:', err.message);
    return false;
  }
}

/**
 * Batch persist: sauvegarde ALL tickets d'un round vers PostgreSQL
 * Appelé UNE SEULE FOIS quand la course finit
 * 
 * @param {number} roundId - ID du round
 * @param {object} roundData - { participants, winner, etc }
 */
export async function batchPersistRound(roundId, roundData) {
  const startTime = Date.now();
  try {
    console.log(`⏳ [BATCH PERSIST] Starting for round ${roundId}...`);
    
    // 1. Récupérer tous les tickets du cache
    const roundKey = `round:${roundId}:data`;
    const roundCache = await cacheGet(roundKey);
    
    if (!roundCache || !roundCache.receipts || roundCache.receipts.length === 0) {
      console.warn(`[BATCH PERSIST] No tickets to persist for round ${roundId}`);
      return { success: false, ticketsPersisted: 0, betsPersisted: 0 };
    }

    const receiptsToSave = roundCache.receipts;
    console.log(`  → ${receiptsToSave.length} tickets to persist`);

    // 2. Batch insert receipts dans PostgreSQL
    const receiptIds = [];
    for (const receipt of receiptsToSave) {
      try {
        const result = await pool.query(
          `INSERT INTO receipts (round_id, user_id, total_amount, status, prize, created_at)
           VALUES ($1, $2, $3, $4, $5, $6)
           RETURNING receipt_id`,
          [
            roundId,
            receipt.user_id || null,
            receipt.total_amount || 0,
            'pending',
            receipt.prize || 0,
            new Date(receipt.created_at || Date.now())
          ]
        );
        
        if (result.rows[0]) {
          receiptIds.push(result.rows[0].receipt_id);
        }
      } catch (err) {
        console.error(`  ⚠️ Error inserting receipt:`, err.message);
      }
    }

    console.log(`  ✅ ${receiptIds.length} receipts persisted`);

    // 3. Batch insert bets
    let betsPersisted = 0;
    for (let i = 0; i < receiptsToSave.length; i++) {
      const receipt = receiptsToSave[i];
      const dbReceiptId = receiptIds[i];

      if (!dbReceiptId) continue;

      for (const bet of receipt.bets || []) {
        try {
          const participantNum = bet.number || bet.participant?.number;
          const participant = roundData.participants?.find(p => p.number === participantNum);
          
          if (!participant) continue;

          await pool.query(
            `INSERT INTO bets (receipt_id, participant_id, coefficient, value, created_at)
             VALUES ($1, $2, $3, $4, $5)`,
            [
              dbReceiptId,
              participant.id || null,
              bet.participant?.coeff || bet.coeff || 0,
              bet.value || 0,
              new Date()
            ]
          );
          betsPersisted += 1;
        } catch (err) {
          console.error(`  ⚠️ Error inserting bet:`, err.message);
        }
      }
    }

    console.log(`  ✅ ${betsPersisted} bets persisted`);

    // 4. Nettoyer le cache après persist
    await clearRoundCache(roundId);

    const elapsed = Date.now() - startTime;
    console.log(`✅ [BATCH PERSIST] Completed in ${elapsed}ms for round ${roundId}`);

    return {
      success: true,
      ticketsPersisted: receiptIds.length,
      betsPersisted,
      timeMs: elapsed
    };

  } catch (err) {
    console.error('[BATCH PERSIST] Erreur:', err.message);
    return { success: false, ticketsPersisted: 0, betsPersisted: 0, error: err.message };
  }
}

export default {
  // Sessions
  saveUserSession,
  getUserSession,
  destroyUserSession,
  
  // Statistiques
  saveRoundStatistics,
  getRoundStatistics,
  getGlobalStatistics,
  invalidateStatisticsCache,
  
  // Logs
  logAction,
  getAuditLog,
  
  // Cache
  cacheQuery,
  invalidateQueryCache,
  
  // Round cache (NEW - optimisation tickets)
  initRoundCache,
  addTicketToRoundCache,
  deleteTicketFromRoundCache,
  updateTicketInRoundCache, // ✅ NOUVEAU: Export pour mise à jour statut tickets
  getRoundTicketsFromCache,
  getRoundParticipantsFromCache,
  clearRoundCache,
  batchPersistRound
};
