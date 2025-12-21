// money.js
import express from "express";
import { wrap } from "../game.js";
import { systemToPublic } from "../utils.js";
import { pool } from "../config/db.js";
import { cacheResponse } from "../middleware/cache.js";
import { cacheDelPattern } from "../config/redis.js";
import { getSalesStats, invalidateCachePattern } from "../models/queryCache.js";
import * as accountModel from "../models/accountModel.js";

const router = express.Router();

// GET /api/v1/money/ - calcule le solde caisse depuis la base (CACHED)
router.get("/", cacheResponse(30), async (req, res) => {
  try {
    // OPTIMISATION: Utiliser la query cache - combine 2 queries en 1 + multi-tier caching
    const stats = await getSalesStats();
    
    const totalReceivedSystem = Number(stats.total_received) || 0;
    const totalPayoutsSystem = Number(stats.total_payouts) || 0;
    
    const totalReceived = systemToPublic(totalReceivedSystem);
    const totalPayouts = systemToPublic(totalPayoutsSystem);
    const cashBalance = totalReceived - totalPayouts;

    console.log(`💰 Money: received=${totalReceived}, payouts=${totalPayouts}, balance=${cashBalance}`);
    return res.json(wrap({ money: cashBalance, totalReceived, totalPayouts }));
  } catch (err) {
    console.error('Erreur /api/v1/money:', err);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
});

// Support legacy clients that POST to /api/v1/money/ (some frontends expect POST)
router.post("/", async (req, res) => {
  try {
    // OPTIMISATION: Utiliser la query cache - combine 2 queries en 1 + multi-tier caching
    const stats = await getSalesStats();
    
    const totalReceivedSystem = Number(stats.total_received) || 0;
    const totalPayoutsSystem = Number(stats.total_payouts) || 0;
    
    const totalReceived = systemToPublic(totalReceivedSystem);
    const totalPayouts = systemToPublic(totalPayoutsSystem);
    const cashBalance = totalReceived - totalPayouts;

    console.log(`💰 Money (POST): received=${totalReceived}, payouts=${totalPayouts}, balance=${cashBalance}`);
    
    // Invalidate cache after money state change
    await invalidateCachePattern("sales_stats");
    await cacheDelPattern("http:*/api/v1/money*");
    
    return res.json(wrap({ money: cashBalance, totalReceived, totalPayouts }));
  } catch (err) {
    console.error('Erreur POST /api/v1/money:', err);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /api/v1/money/payout - enregistrer un décaissement/payout
router.post("/payout", async (req, res) => {
  try {
    const { amount, reason, receiptId } = req.body;
    const userId = req.user?.user_id || req.user?.userId; // Support both JWT formats

    if (!amount || amount <= 0) {
      return res.status(400).json({ error: 'Montant invalide' });
    }

    // ✅ NOUVEAU: Si l'utilisateur est un caissier, enregistrer la transaction dans son compte
    if (userId && req.user?.role === 'cashier') {
      try {
        const transaction = await accountModel.addTransaction(
          userId,
          'payout',
          amount,
          receiptId ? `Receipt #${receiptId}` : null,
          reason || 'Manual payout'
        );
        console.log(`💸 Payout enregistré dans le compte du caissier: ${amount} HTG (Transaction ID: ${transaction.transaction_id})`);
      } catch (accountErr) {
        console.warn(`⚠️ Impossible d'enregistrer la transaction du payout: ${accountErr.message}`);
        // Ne pas bloquer le payout si l'account transaction échoue
        // Juste logger l'erreur et continuer
      }
    }

    // Insérer dans payout_log (table optionnelle pour tracer les décaissements manuels)
    await pool.query(
      `INSERT INTO payout_log (amount, reason, created_at) VALUES ($1, $2, CURRENT_TIMESTAMP)`,
      [amount, reason || 'Manual payout']
    ).catch(err => {
      // Table n'existe pas, c'est OK — on log juste en console
      console.log('[INFO] payout_log table does not exist, skipping DB insert');
    });

    console.log(`💸 Payout enregistré: ${amount} HTG (${reason})`);
    
    // Invalidate cache after payout
    await invalidateCachePattern("sales_stats");
    await cacheDelPattern("http:*/api/v1/money*");
    
    return res.json(wrap({ success: true, message: `Décaissement de ${amount} HTG enregistré` }));
  } catch (err) {
    console.error('Erreur POST /api/v1/money/payout:', err);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
});

export default router;
