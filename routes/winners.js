import express from "express";
import { getRecentWinners } from "../models/winnerModel.js";
import { wrap } from "../game.js";

const router = express.Router();

/**
 * GET /api/v1/winners/recent?limit=10
 * Récupère les N derniers gagnants (public)
 */
router.get("/recent", async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 10;
    const winners = await getRecentWinners(limit);
    
    return res.json(wrap({
      winners,
      count: winners.length,
      limit
    }));
  } catch (err) {
    console.error("❌ [WINNERS-API] Erreur lors de la récupération des gagnants:", err);
    return res.status(500).json({ error: "Erreur serveur lors de la récupération des gagnants" });
  }
});

export default router;

