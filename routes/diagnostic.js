import express from "express";
import { pool } from "../config/db.js";
import { gameState } from "../game.js";

const router = express.Router();

/**
 * GET /api/v1/diagnostic/receipts/:roundId
 * Diagnostic pour vérifier les statuts des tickets d'un round
 */
router.get("/receipts/:roundId", async (req, res) => {
  try {
    const roundId = parseInt(req.params.roundId, 10);
    
    if (!roundId || isNaN(roundId)) {
      return res.status(400).json({ error: "Round ID invalide" });
    }

    // 1. Récupérer les tickets depuis la DB
    const dbResult = await pool.query(
      `SELECT receipt_id, round_id, user_id, total_amount, status, prize, created_at
       FROM receipts 
       WHERE round_id = $1
       ORDER BY created_at DESC`,
      [roundId]
    );

    const dbReceipts = dbResult.rows || [];

    // 2. Récupérer les tickets depuis gameState (round actuel ou historique)
    let gameStateReceipts = [];
    if (gameState.currentRound && gameState.currentRound.id === roundId) {
      gameStateReceipts = gameState.currentRound.receipts || [];
    } else {
      // Chercher dans l'historique
      const historicalRound = gameState.gameHistory.find(r => r.id === roundId);
      if (historicalRound) {
        gameStateReceipts = historicalRound.receipts || [];
      }
    }

    // 3. Comparer les statuts
    const comparison = {
      roundId: roundId,
      dbReceiptsCount: dbReceipts.length,
      gameStateReceiptsCount: gameStateReceipts.length,
      dbReceipts: dbReceipts.map(r => ({
        receipt_id: r.receipt_id,
        user_id: r.user_id,
        total_amount: Number(r.total_amount),
        status: r.status,
        prize: Number(r.prize || 0)
      })),
      gameStateReceipts: gameStateReceipts.map(r => ({
        id: r.id,
        user_id: r.user_id,
        total_amount: (r.bets || []).reduce((sum, b) => sum + (Number(b.value) || 0), 0),
        status: r.status || 'pending',
        prize: r.prize || 0
      })),
      mismatches: []
    };

    // 4. Identifier les incohérences
    for (const dbReceipt of dbReceipts) {
      const dbTotal = Number(dbReceipt.total_amount);
      const matchingGameStateReceipt = gameStateReceipts.find(gs => {
        const gsTotal = (gs.bets || []).reduce((sum, b) => sum + (Number(b.value) || 0), 0);
        const userMatch = (dbReceipt.user_id === gs.user_id) || (!dbReceipt.user_id && !gs.user_id);
        const amountMatch = Math.abs(dbTotal - gsTotal) < 0.01;
        return userMatch && amountMatch;
      });

      if (!matchingGameStateReceipt) {
        comparison.mismatches.push({
          type: 'not_found_in_gamestate',
          dbReceipt: {
            receipt_id: dbReceipt.receipt_id,
            user_id: dbReceipt.user_id,
            total_amount: dbTotal,
            status: dbReceipt.status
          }
        });
      } else if (matchingGameStateReceipt.status !== dbReceipt.status) {
        comparison.mismatches.push({
          type: 'status_mismatch',
          dbReceipt: {
            receipt_id: dbReceipt.receipt_id,
            status: dbReceipt.status,
            prize: Number(dbReceipt.prize || 0)
          },
          gameStateReceipt: {
            id: matchingGameStateReceipt.id,
            status: matchingGameStateReceipt.status || 'pending',
            prize: matchingGameStateReceipt.prize || 0
          }
        });
      }
    }

    // 5. Vérifier si le round est terminé
    const roundInfo = await pool.query(
      `SELECT round_id, round_number, winner_id, started_at, finished_at, total_prize
       FROM rounds 
       WHERE round_id = $1`,
      [roundId]
    );

    const round = roundInfo.rows[0] || null;

    return res.json({
      success: true,
      data: {
        ...comparison,
        round: round ? {
          round_id: round.round_id,
          round_number: round.round_number,
          winner_id: round.winner_id,
          started_at: round.started_at,
          finished_at: round.finished_at,
          total_prize: Number(round.total_prize || 0),
          isFinished: !!round.finished_at
        } : null,
        summary: {
          totalDbReceipts: dbReceipts.length,
          totalGameStateReceipts: gameStateReceipts.length,
          pendingInDb: dbReceipts.filter(r => r.status === 'pending').length,
          wonInDb: dbReceipts.filter(r => r.status === 'won').length,
          lostInDb: dbReceipts.filter(r => r.status === 'lost').length,
          mismatchesCount: comparison.mismatches.length
        }
      }
    });

  } catch (err) {
    console.error('[DIAGNOSTIC] Erreur:', err);
    return res.status(500).json({ 
      error: 'Erreur lors du diagnostic', 
      message: err.message 
    });
  }
});

export default router;

