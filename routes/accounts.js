import express from "express";
import { requireAuthHTML, requireRoleHTML } from "../middleware/session.js";
import * as accountModel from "../models/accountModel.js";
import { pool } from "../config/db.js";

const router = express.Router();

/**
 * GET /api/v1/accounts/me
 * Récupère le compte du caissier connecté
 * IMPORTANT: Cette route doit être définie AVANT /:userId pour éviter les conflits
 */
router.get("/me", requireRoleHTML("cashier"), async (req, res) => {
  try {
    console.log("🔍 [ACCOUNTS] Route /me appelée");
    console.log("🔍 [ACCOUNTS] req.user:", req.user);
    
    const userId = req.user?.user_id || req.user?.userId;
    
    if (!userId) {
      console.error("❌ Pas d'ID utilisateur dans req.user:", req.user);
      return res.status(401).json({ error: "ID utilisateur non trouvé" });
    }

    console.log(`🔍 Recherche du compte pour l'utilisateur ${userId}`);
    
    const account = await accountModel.getAccountByUserId(userId);

    if (!account) {
      console.warn(`⚠️ Compte non trouvé pour l'utilisateur ${userId}`);
      return res.status(404).json({ error: "Compte de caisse non trouvé" });
    }

    console.log(`✅ Compte trouvé pour l'utilisateur ${userId}:`, account);

    res.json({
      success: true,
      account: {
        accountId: account.account_id,
        userId: account.user_id,
        currentBalance: parseFloat(account.current_balance),
        openingBalance: parseFloat(account.opening_balance),
        openingTime: account.opening_time,
        closingTime: account.closing_time,
        status: account.status,
        notes: account.notes,
        createdAt: account.created_at,
        updatedAt: account.updated_at
      }
    });
  } catch (err) {
    console.error("❌ Erreur dans GET /me:", err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/v1/accounts/:userId
 * Récupère le compte d'un utilisateur (admin/manager only)
 */
router.get("/:userId", requireAuthHTML, requireRoleHTML("admin"), async (req, res) => {
  try {
    const { userId } = req.params;
    const account = await accountModel.getAccountByUserId(userId);

    if (!account) {
      return res.status(404).json({ error: "Compte de caisse non trouvé" });
    }

    res.json({
      success: true,
      account: {
        accountId: account.account_id,
        userId: account.user_id,
        currentBalance: parseFloat(account.current_balance),
        openingBalance: parseFloat(account.opening_balance),
        openingTime: account.opening_time,
        closingTime: account.closing_time,
        status: account.status,
        notes: account.notes,
        createdAt: account.created_at,
        updatedAt: account.updated_at
      }
    });
  } catch (err) {
    console.error("❌ Erreur dans GET /:userId:", err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/v1/accounts
 * Récupère tous les comptes (admin only)
 */
router.get("/", requireAuthHTML, requireRoleHTML("admin"), async (req, res) => {
  try {
    const accounts = await accountModel.getAllAccounts();

    res.json({
      success: true,
      accounts: accounts.map((acc) => ({
        accountId: acc.account_id,
        userId: acc.user_id,
        username: acc.username,
        email: acc.email,
        currentBalance: parseFloat(acc.current_balance),
        openingBalance: parseFloat(acc.opening_balance),
        openingTime: acc.opening_time,
        closingTime: acc.closing_time,
        status: acc.status,
        notes: acc.notes,
        createdAt: acc.created_at,
        updatedAt: acc.updated_at
      }))
    });
  } catch (err) {
    console.error("❌ Erreur dans GET /:", err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/v1/accounts/me/open
 * Ouvre le compte du caissier connecté
 */
router.post("/me/open", requireAuthHTML, requireRoleHTML("cashier"), async (req, res) => {
  try {
    const userId = req.user.user_id;
    const { openingBalance } = req.body;

    const account = await accountModel.openAccount(
      userId,
      openingBalance || 0
    );

    res.json({
      success: true,
      message: "Compte ouvert avec succès",
      account: {
        accountId: account.account_id,
        userId: account.user_id,
        currentBalance: parseFloat(account.current_balance),
        openingBalance: parseFloat(account.opening_balance),
        openingTime: account.opening_time,
        status: account.status,
        createdAt: account.created_at,
        updatedAt: account.updated_at
      }
    });
  } catch (err) {
    console.error("❌ Erreur dans POST /me/open:", err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/v1/accounts/me/close
 * Ferme le compte du caissier connecté
 */
router.post("/me/close", requireAuthHTML, requireRoleHTML("cashier"), async (req, res) => {
  try {
    const userId = req.user.user_id;
    const { closingNotes } = req.body;

    const account = await accountModel.closeAccount(userId, closingNotes || "");

    res.json({
      success: true,
      message: "Compte fermé avec succès",
      account: {
        accountId: account.account_id,
        userId: account.user_id,
        currentBalance: parseFloat(account.current_balance),
        closingTime: account.closing_time,
        status: account.status,
        notes: account.notes,
        createdAt: account.created_at,
        updatedAt: account.updated_at
      }
    });
  } catch (err) {
    console.error("❌ Erreur dans POST /me/close:", err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/v1/accounts/me/balance
 * Récupère le solde du caissier connecté
 */
router.get("/me/balance", requireAuthHTML, requireRoleHTML("cashier"), async (req, res) => {
  try {
    const userId = req.user.user_id;
    const balance = await accountModel.getAccountBalance(userId);

    if (!balance) {
      return res.status(404).json({ error: "Compte non trouvé" });
    }

    res.json({
      success: true,
      balance: balance.balance,
      status: balance.status
    });
  } catch (err) {
    console.error("❌ Erreur dans GET /me/balance:", err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/v1/accounts/me/transactions
 * Récupère l'historique des transactions
 */
router.get("/me/transactions", requireAuthHTML, requireRoleHTML("cashier"), async (req, res) => {
  try {
    const userId = req.user.user_id;
    const { limit = 50, offset = 0 } = req.query;

    const transactions = await accountModel.getAccountTransactions(
      userId,
      parseInt(limit, 10),
      parseInt(offset, 10)
    );
    const count = await accountModel.getTransactionCount(userId);

    res.json({
      success: true,
      transactions: transactions.map((t) => ({
        transactionId: t.transaction_id,
        accountId: t.account_id,
        userId: t.user_id,
        type: t.transaction_type,
        amount: parseFloat(t.amount),
        previousBalance: parseFloat(t.previous_balance),
        newBalance: parseFloat(t.new_balance),
        reference: t.reference,
        description: t.description,
        createdAt: t.created_at
      })),
      pagination: {
        limit: parseInt(limit, 10),
        offset: parseInt(offset, 10),
        total: count
      }
    });
  } catch (err) {
    console.error("❌ Erreur dans GET /me/transactions:", err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/v1/accounts/me/stats
 * Récupère les statistiques du compte
 */
router.get("/me/stats", requireAuthHTML, requireRoleHTML("cashier"), async (req, res) => {
  try {
    const userId = req.user.user_id;
    const stats = await accountModel.getAccountStats(userId);
    const account = await accountModel.getAccountByUserId(userId);

    res.json({
      success: true,
      stats: {
        totalIn: stats.totalIn,
        totalOut: stats.totalOut,
        transactionCount: stats.transactionCount,
        currentBalance: account ? parseFloat(account.current_balance) : 0,
        accountStatus: account ? account.status : "closed"
      }
    });
  } catch (err) {
    console.error("❌ Erreur dans GET /me/stats:", err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/v1/accounts/me/transaction
 * Ajoute une transaction au compte
 */
router.post("/me/transaction", requireAuthHTML, requireRoleHTML("cashier"), async (req, res) => {
  try {
    const userId = req.user.user_id;
    const { type, amount, reference, description } = req.body;

    if (!type || !amount) {
      return res.status(400).json({ error: "Type et montant requis" });
    }

    const transaction = await accountModel.addTransaction(
      userId,
      type,
      parseFloat(amount),
      reference,
      description
    );

    res.json({
      success: true,
      message: "Transaction ajoutée avec succès",
      transaction: {
        transactionId: transaction.transaction_id,
        accountId: transaction.account_id,
        type: transaction.transaction_type,
        amount: parseFloat(transaction.amount),
        previousBalance: parseFloat(transaction.previous_balance),
        newBalance: parseFloat(transaction.new_balance),
        reference: transaction.reference,
        description: transaction.description,
        createdAt: transaction.created_at
      }
    });
  } catch (err) {
    console.error("❌ Erreur dans POST /me/transaction:", err);
    res.status(400).json({ error: err.message });
  }
});

/**
 * POST /api/v1/accounts/me/statement
 * Récupère un relevé de compte pour une période
 */
router.post("/me/statement", requireAuthHTML, requireRoleHTML("cashier"), async (req, res) => {
  try {
    const userId = req.user.user_id;
    const { fromDate, toDate } = req.body;

    if (!fromDate || !toDate) {
      return res.status(400).json({ error: "Dates de début et fin requises" });
    }

    const statement = await accountModel.getAccountStatement(
      userId,
      new Date(fromDate),
      new Date(toDate)
    );

    res.json({
      success: true,
      statement: statement.map((t) => ({
        transactionId: t.transaction_id,
        accountId: t.account_id,
        type: t.transaction_type,
        amount: parseFloat(t.amount),
        previousBalance: parseFloat(t.previous_balance),
        newBalance: parseFloat(t.new_balance),
        reference: t.reference,
        description: t.description,
        createdAt: t.created_at
      })),
      period: {
        from: fromDate,
        to: toDate
      }
    });
  } catch (err) {
    console.error("❌ Erreur dans POST /me/statement:", err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/v1/accounts/me/report
 * Génère un rapport de caisse pour une période avec statistiques de tickets
 * Query params: fromDate, toDate (format ISO 8601 ou timestamp)
 */
router.get("/me/report", requireAuthHTML, requireRoleHTML("cashier"), async (req, res) => {
  try {
    const userId = req.user.user_id;
    const { fromDate, toDate } = req.query;

    if (!fromDate || !toDate) {
      return res.status(400).json({ error: "Dates de début et fin requises (fromDate, toDate)" });
    }

    const from = new Date(fromDate);
    const to = new Date(toDate);

    if (isNaN(from.getTime()) || isNaN(to.getTime())) {
      return res.status(400).json({ error: "Format de date invalide" });
    }

    if (from >= to) {
      return res.status(400).json({ error: "La date de début doit être antérieure à la date de fin" });
    }

    const report = await accountModel.getCashierReportStats(userId, from, to);

    // Récupérer aussi les informations du compte et de l'utilisateur
    const account = await accountModel.getAccountByUserId(userId);
    const userResult = await pool.query(
      `SELECT username, email FROM users WHERE user_id = $1`,
      [userId]
    );
    const user = userResult.rows[0] || {};

    res.json({
      success: true,
      report: {
        ...report,
        cashier: {
          username: user.username || 'N/A',
          email: user.email || 'N/A',
          accountId: account?.account_id || null,
          accountStatus: account?.status || 'closed'
        }
      }
    });
  } catch (err) {
    console.error("❌ Erreur dans GET /me/report:", err);
    res.status(500).json({ error: err.message });
  }
});

export default router;
