/**
 * Routes pour accéder aux statistiques et logs
 * 
 * Endpoints:
 * - GET /api/v1/stats/round/:roundId - Stats d'un round (avec cache Redis 30s)
 * - GET /api/v1/stats/global - Stats globales (avec cache Redis 30s)
 * - GET /api/v1/audit/:entityType/:entityId - Historique d'audit d'une entité
 */

import express from 'express';
import { verifyToken, requireRole } from './auth.js';
import {
  getRoundStatistics,
  getGlobalStatistics,
  getAuditLog,
  invalidateStatisticsCache
} from '../config/db-strategy.js';
import { wrap } from '../game.js';

const router = express.Router();

/**
 * GET /api/v1/stats/round/:roundId
 * Récupère les statistiques d'un round
 * Cache Redis: 30 secondes
 */
router.get('/round/:roundId', verifyToken, async (req, res) => {
  try {
    const { roundId } = req.params;
    
    console.log(`[STATS] Requête stats round #${roundId}`);
    const stats = await getRoundStatistics(roundId);

    if (!stats) {
      return res.status(404).json(wrap({
        error: 'Round not found',
        roundId: roundId
      }));
    }

    return res.json(wrap(stats));
  } catch (err) {
    console.error('[STATS] Erreur:', err.message);
    return res.status(500).json(wrap({
      error: 'Internal server error',
      message: err.message
    }));
  }
});

/**
 * GET /api/v1/stats/global?limit=20
 * Récupère les statistiques globales (derniers N rounds)
 * Cache Redis: 30 secondes
 */
router.get('/global', verifyToken, async (req, res) => {
  try {
    const limit = parseInt(req.query.limit, 10) || 20;
    
    console.log(`[STATS] Requête stats globales (limit: ${limit})`);
    const stats = await getGlobalStatistics(limit);

    return res.json(wrap({
      count: stats.length,
      data: stats
    }));
  } catch (err) {
    console.error('[STATS] Erreur:', err.message);
    return res.status(500).json(wrap({
      error: 'Internal server error',
      message: err.message
    }));
  }
});

/**
 * GET /api/v1/audit/:entityType/:entityId?limit=50
 * Récupère l'historique d'audit d'une entité
 * Exemples:
 *   - /api/v1/audit/RECEIPT/5001014968
 *   - /api/v1/audit/ROUND/96908000
 * 
 * Accès: Admin ou Cashier uniquement
 */
router.get('/:entityType/:entityId', verifyToken, requireRole('admin', 'cashier'), async (req, res) => {
  try {
    const { entityType, entityId } = req.params;
    const limit = parseInt(req.query.limit, 10) || 50;
    
    console.log(`[AUDIT] Requête logs ${entityType}#${entityId}`);
    const logs = await getAuditLog(entityType, entityId, limit);

    return res.json(wrap({
      entityType,
      entityId,
      count: logs.length,
      data: logs
    }));
  } catch (err) {
    console.error('[AUDIT] Erreur:', err.message);
    return res.status(500).json(wrap({
      error: 'Internal server error',
      message: err.message
    }));
  }
});

/**
 * POST /api/v1/stats/invalidate?roundId=...
 * Invalide le cache des statistiques (admin uniquement)
 * Utilisé quand on sait qu'une action majeure a impacté les stats
 */
router.post('/invalidate', verifyToken, requireRole('admin'), async (req, res) => {
  try {
    const { roundId } = req.query;
    
    console.log(`[STATS] Invalidation cache${roundId ? ` round #${roundId}` : ' global'}`);
    await invalidateStatisticsCache(roundId);

    return res.json(wrap({
      message: 'Statistics cache invalidated',
      roundId: roundId || 'all'
    }));
  } catch (err) {
    console.error('[STATS] Erreur invalidation:', err.message);
    return res.status(500).json(wrap({
      error: 'Internal server error',
      message: err.message
    }));
  }
});

export default router;
