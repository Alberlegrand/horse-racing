// money.js
import express from "express";
import { wrap } from "../game.js";
import { systemToPublic } from "../utils.js";
import { pool } from "../config/db.js";

const router = express.Router();

// GET /api/v1/money/ - calcule le solde caisse depuis la base
router.get("/", async (req, res) => {
  try {
    // Total entrées (mises reçues = somme des total_amount des tickets)
    const receivedRes = await pool.query(`SELECT COALESCE(SUM(total_amount),0) AS total_received FROM receipts WHERE status IN ('pending', 'won', 'paid', 'lost')`);
    const totalReceivedSystem = Number(receivedRes.rows[0].total_received) || 0;
    const totalReceived = systemToPublic(totalReceivedSystem); // Convertir en valeur publique

    // Total sorties (gains décaissés = somme des prizes des tickets payés)
    const payoutRes = await pool.query(`SELECT COALESCE(SUM(prize),0) AS total_payouts FROM receipts WHERE status = 'paid'`);
    const totalPayoutsSystem = Number(payoutRes.rows[0].total_payouts) || 0;
    const totalPayouts = systemToPublic(totalPayoutsSystem); // Convertir en valeur publique

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
    const receivedRes = await pool.query(`SELECT COALESCE(SUM(total_amount),0) AS total_received FROM receipts WHERE status IN ('pending', 'won', 'paid', 'lost')`);
    const totalReceivedSystem = Number(receivedRes.rows[0].total_received) || 0;
    const totalReceived = systemToPublic(totalReceivedSystem); // Convertir en valeur publique

    const payoutRes = await pool.query(`SELECT COALESCE(SUM(prize),0) AS total_payouts FROM receipts WHERE status = 'paid'`);
    const totalPayoutsSystem = Number(payoutRes.rows[0].total_payouts) || 0;
    const totalPayouts = systemToPublic(totalPayoutsSystem); // Convertir en valeur publique

    const cashBalance = totalReceived - totalPayouts;

    console.log(`💰 Money (POST): received=${totalReceived}, payouts=${totalPayouts}, balance=${cashBalance}`);
    return res.json(wrap({ money: cashBalance, totalReceived, totalPayouts }));
  } catch (err) {
    console.error('Erreur POST /api/v1/money:', err);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /api/v1/money/payout - enregistrer un décaissement/payout
router.post("/payout", async (req, res) => {
  try {
    const { amount, reason } = req.body;
    if (!amount || amount <= 0) {
      return res.status(400).json({ error: 'Montant invalide' });
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
    return res.json(wrap({ success: true, message: `Décaissement de ${amount} HTG enregistré` }));
  } catch (err) {
    console.error('Erreur POST /api/v1/money/payout:', err);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
});

export default router;
