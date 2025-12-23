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
// ✅ CORRECTION: Filtre par user_id pour isolation des données par caissier
router.get("/", cacheResponse(30), async (req, res) => {
  try {
    // ✅ OBLIGATOIRE: Récupérer user_id depuis req.user (JWT)
    const userId = req.user?.userId || req.user?.user_id;
    if (!userId) {
      return res.status(401).json({ error: 'Authentification requise' });
    }
    
    // ✅ CORRECTION: Calculer les stats depuis les tickets de l'utilisateur
    // Cela fonctionne pour tous les utilisateurs (caissiers et autres)
    const stats = await getSalesStats(userId);
    
    const totalReceivedSystem = Number(stats.total_received) || 0;
    const totalPayoutsSystem = Number(stats.total_payouts) || 0;
    
    const totalReceived = systemToPublic(totalReceivedSystem);
    const totalPayouts = systemToPublic(totalPayoutsSystem);
    
    // ✅ CORRECTION: Pour les caissiers, utiliser le solde du compte de caisse si disponible
    // Sinon, calculer depuis les tickets (totalReceived - totalPayouts)
    let cashBalance;
    if (req.user?.role === 'cashier') {
      try {
        const account = await accountModel.getAccountByUserId(userId);
        if (account && account.current_balance !== null && account.current_balance !== undefined) {
          cashBalance = Number(account.current_balance) || 0;
          // ✅ CORRECTION: Si le compte existe mais a un solde de 0 et qu'il y a des recettes,
          // utiliser le calcul depuis les tickets comme valeur plus précise
          const calculatedBalance = totalReceived - totalPayouts;
          if (cashBalance === 0 && calculatedBalance > 0) {
            console.log(`💰 Money (Cashier ${userId}): Compte existe mais solde=0, utilisation du calcul depuis tickets: ${calculatedBalance} HTG`);
            cashBalance = calculatedBalance;
          } else {
            console.log(`💰 Money (Cashier ${userId}): balance=${cashBalance} HTG depuis compte de caisse, received=${totalReceived}, payouts=${totalPayouts}`);
          }
          return res.json(wrap({ 
            money: cashBalance, 
            totalReceived, 
            totalPayouts,
            source: account.current_balance > 0 ? 'cashier_account' : 'calculated_from_tickets'
          }));
        } else {
          // Compte n'existe pas ou solde null, utiliser calcul depuis tickets
          cashBalance = totalReceived - totalPayouts;
          console.log(`💰 Money (Cashier ${userId}): Compte non trouvé ou solde null, utilisation du calcul depuis tickets: ${cashBalance} HTG`);
        }
      } catch (accountErr) {
        console.warn(`⚠️ Erreur récupération compte caissier:`, accountErr.message);
        // Fallback sur calcul depuis tickets si compte non trouvé
        cashBalance = totalReceived - totalPayouts;
      }
    } else {
      // Pour les non-caissiers, calculer depuis les tickets
      cashBalance = totalReceived - totalPayouts;
    }

    console.log(`💰 Money (User ${userId}): received=${totalReceived}, payouts=${totalPayouts}, balance=${cashBalance}`);
    return res.json(wrap({ money: cashBalance, totalReceived, totalPayouts }));
  } catch (err) {
    console.error('Erreur /api/v1/money:', err);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
});

// Support legacy clients that POST to /api/v1/money/ (some frontends expect POST)
// ✅ CORRECTION: Filtre par user_id pour isolation des données par caissier
router.post("/", async (req, res) => {
  try {
    // ✅ OBLIGATOIRE: Récupérer user_id depuis req.user (JWT)
    const userId = req.user?.userId || req.user?.user_id;
    if (!userId) {
      return res.status(401).json({ error: 'Authentification requise' });
    }
    
    // ✅ CORRECTION: Calculer les stats depuis les tickets de l'utilisateur
    const stats = await getSalesStats(userId);
    
    const totalReceivedSystem = Number(stats.total_received) || 0;
    const totalPayoutsSystem = Number(stats.total_payouts) || 0;
    
    const totalReceived = systemToPublic(totalReceivedSystem);
    const totalPayouts = systemToPublic(totalPayoutsSystem);
    
    // ✅ CORRECTION: Pour les caissiers, utiliser le solde du compte de caisse si disponible
    let cashBalance;
    if (req.user?.role === 'cashier') {
      try {
        const account = await accountModel.getAccountByUserId(userId);
        if (account && account.current_balance !== null && account.current_balance !== undefined) {
          cashBalance = Number(account.current_balance) || 0;
          // ✅ CORRECTION: Si le compte existe mais a un solde de 0 et qu'il y a des recettes,
          // utiliser le calcul depuis les tickets comme valeur plus précise
          const calculatedBalance = totalReceived - totalPayouts;
          if (cashBalance === 0 && calculatedBalance > 0) {
            console.log(`💰 Money (POST, Cashier ${userId}): Compte existe mais solde=0, utilisation du calcul depuis tickets: ${calculatedBalance} HTG`);
            cashBalance = calculatedBalance;
          } else {
            console.log(`💰 Money (POST, Cashier ${userId}): balance=${cashBalance} HTG depuis compte de caisse, received=${totalReceived}, payouts=${totalPayouts}`);
          }
        } else {
          // Compte n'existe pas ou solde null, utiliser calcul depuis tickets
          cashBalance = totalReceived - totalPayouts;
          console.log(`💰 Money (POST, Cashier ${userId}): Compte non trouvé ou solde null, utilisation du calcul depuis tickets: ${cashBalance} HTG`);
        }
      } catch (accountErr) {
        console.warn(`⚠️ Erreur récupération compte caissier:`, accountErr.message);
        cashBalance = totalReceived - totalPayouts;
      }
    } else {
      cashBalance = totalReceived - totalPayouts;
    }

    console.log(`💰 Money (POST, User ${userId}): received=${totalReceived}, payouts=${totalPayouts}, balance=${cashBalance}`);
    
    // Invalidate cache after money state change (pour ce user)
    await invalidateCachePattern(`sales_stats:user:${userId}`);
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
