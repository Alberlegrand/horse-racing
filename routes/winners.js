import express from 'express';
import { 
  getRecentWinners, 
  getAllWinners, 
  getWinnerByRoundId,
  getWinnersStats 
} from '../models/winnerModel.js';
import { verifyToken } from './auth.js';

export default function createWinnersRouter() {
  const router = express.Router();

  /**
   * GET /api/v1/winners/recent
   * Récupère les N derniers gagnants pour l'affichage sur screen
   */
  router.get('/recent', async (req, res) => {
    try {
      const limit = parseInt(req.query.limit || '6', 10);
      const winners = await getRecentWinners(Math.min(limit, 20)); // Max 20
      
      res.json({
        success: true,
        data: winners,
        count: winners.length
      });
    } catch (err) {
      console.error('[WINNERS-API] Erreur:', err);
      res.status(500).json({
        success: false,
        error: 'Erreur lors de la récupération des gagnants'
      });
    }
  });

  /**
   * GET /api/v1/winners/all
   * Récupère tous les gagnants (pour statistiques)
   * Protégé par authentification
   */
  router.get('/all', verifyToken, async (req, res) => {
    try {
      const winners = await getAllWinners();
      
      res.json({
        success: true,
        data: winners,
        count: winners.length
      });
    } catch (err) {
      console.error('[WINNERS-API] Erreur:', err);
      res.status(500).json({
        success: false,
        error: 'Erreur lors de la récupération des gagnants'
      });
    }
  });

  /**
   * GET /api/v1/winners/round/:roundId
   * Récupère le gagnant d'une manche spécifique
   */
  router.get('/round/:roundId', async (req, res) => {
    try {
      const { roundId } = req.params;
      const winner = await getWinnerByRoundId(roundId);
      
      if (!winner) {
        return res.status(404).json({
          success: false,
          error: 'Aucun gagnant trouvé pour cette manche'
        });
      }
      
      res.json({
        success: true,
        data: winner
      });
    } catch (err) {
      console.error('[WINNERS-API] Erreur:', err);
      res.status(500).json({
        success: false,
        error: 'Erreur lors de la récupération du gagnant'
      });
    }
  });

  /**
   * GET /api/v1/winners/stats
   * Récupère les statistiques des gagnants par participant
   * Protégé par authentification
   */
  router.get('/stats', verifyToken, async (req, res) => {
    try {
      const stats = await getWinnersStats();
      
      res.json({
        success: true,
        data: stats,
        count: stats.length
      });
    } catch (err) {
      console.error('[WINNERS-API] Erreur:', err);
      res.status(500).json({
        success: false,
        error: 'Erreur lors de la récupération des statistiques'
      });
    }
  });

  return router;
}
