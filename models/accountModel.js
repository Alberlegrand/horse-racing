import { pool } from "../config/db.js";
import { systemToPublic } from "../utils.js";

/**
 * Récupère le compte de caisse d'un utilisateur par son ID
 */
export const getAccountByUserId = async (userId) => {
  try {
    const result = await pool.query(
      `SELECT * FROM cashier_accounts WHERE user_id = $1`,
      [userId]
    );
    return result.rows[0] || null;
  } catch (err) {
    console.error("❌ Erreur dans getAccountByUserId:", err);
    throw err;
  }
};

/**
 * Récupère tous les comptes de caisse
 */
export const getAllAccounts = async () => {
  try {
    const result = await pool.query(
      `SELECT ca.*, u.username, u.email 
       FROM cashier_accounts ca
       JOIN users u ON ca.user_id = u.user_id
       ORDER BY ca.created_at DESC`
    );
    return result.rows;
  } catch (err) {
    console.error("❌ Erreur dans getAllAccounts:", err);
    throw err;
  }
};

/**
 * Ouvre un compte de caisse pour un caissier
 */
export const openAccount = async (userId, openingBalance = 0) => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Vérifier que le compte existe
    const accountResult = await client.query(
      `SELECT account_id FROM cashier_accounts WHERE user_id = $1`,
      [userId]
    );

    if (accountResult.rows.length === 0) {
      throw new Error("Compte de caisse non trouvé pour cet utilisateur");
    }

    const accountId = accountResult.rows[0].account_id;

    // Mettre à jour le compte
    const updateResult = await client.query(
      `UPDATE cashier_accounts 
       SET opening_balance = $1,
           current_balance = $1,
           opening_time = CURRENT_TIMESTAMP,
           closing_time = NULL,
           status = 'open',
           updated_at = CURRENT_TIMESTAMP
       WHERE account_id = $2
       RETURNING *`,
      [openingBalance, accountId]
    );

    // Créer une transaction d'ouverture
    await client.query(
      `INSERT INTO account_transactions 
       (account_id, user_id, transaction_type, amount, previous_balance, new_balance, description)
       VALUES ($1, $2, 'opening', $3, 0, $3, $4)`,
      [accountId, userId, openingBalance, `Ouverture de caisse avec ${openingBalance} HTG`]
    );

    await client.query("COMMIT");
    return updateResult.rows[0];
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("❌ Erreur dans openAccount:", err);
    throw err;
  } finally {
    client.release();
  }
};

/**
 * Ferme un compte de caisse
 */
export const closeAccount = async (userId, closingNotes = "") => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const accountResult = await client.query(
      `SELECT * FROM cashier_accounts WHERE user_id = $1`,
      [userId]
    );

    if (accountResult.rows.length === 0) {
      throw new Error("Compte de caisse non trouvé");
    }

    const account = accountResult.rows[0];

    // Mettre à jour le compte
    const updateResult = await client.query(
      `UPDATE cashier_accounts 
       SET status = 'closed',
           closing_time = CURRENT_TIMESTAMP,
           notes = $1,
           updated_at = CURRENT_TIMESTAMP
       WHERE account_id = $2
       RETURNING *`,
      [closingNotes, account.account_id]
    );

    // Créer une transaction de fermeture
    await client.query(
      `INSERT INTO account_transactions 
       (account_id, user_id, transaction_type, amount, previous_balance, new_balance, description)
       VALUES ($1, $2, 'closing', 0, $3, $3, $4)`,
      [
        account.account_id,
        userId,
        account.current_balance,
        `Fermeture de caisse. Solde final: ${account.current_balance} HTG`
      ]
    );

    await client.query("COMMIT");
    return updateResult.rows[0];
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("❌ Erreur dans closeAccount:", err);
    throw err;
  } finally {
    client.release();
  }
};

/**
 * Ajoute une transaction au compte
 */
export const addTransaction = async (
  userId,
  transactionType,
  amount,
  reference = null,
  description = ""
) => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Récupérer le compte
    const accountResult = await client.query(
      `SELECT * FROM cashier_accounts WHERE user_id = $1`,
      [userId]
    );

    if (accountResult.rows.length === 0) {
      throw new Error("Compte de caisse non trouvé");
    }

    const account = accountResult.rows[0];

    // Vérifier que le compte est ouvert
    if (account.status !== "open") {
      throw new Error(`Compte fermé. Statut: ${account.status}`);
    }

    // Calculer le nouveau solde
    let newBalance = account.current_balance;
    if (
      ["deposit", "cash-in", "pay-receipt"].includes(transactionType)
    ) {
      newBalance += amount;
    } else if (
      ["withdrawal", "cash-out", "payout"].includes(transactionType)
    ) {
      newBalance -= amount;
    }

    // Vérifier qu'on ne descend pas en-dessous de zéro
    if (newBalance < 0) {
      throw new Error(
        `Solde insuffisant. Solde actuel: ${account.current_balance} HTG`
      );
    }

    // Mettre à jour le compte
    await client.query(
      `UPDATE cashier_accounts 
       SET current_balance = $1,
           updated_at = CURRENT_TIMESTAMP
       WHERE account_id = $2`,
      [newBalance, account.account_id]
    );

    // Créer la transaction
    const transactionResult = await client.query(
      `INSERT INTO account_transactions 
       (account_id, user_id, transaction_type, amount, previous_balance, new_balance, reference, description)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [
        account.account_id,
        userId,
        transactionType,
        amount,
        account.current_balance,
        newBalance,
        reference,
        description
      ]
    );

    // Enregistrer dans les logs de transaction du système
    await client.query(
      `INSERT INTO transaction_logs (user_id, action, entity_type, entity_id, old_value, new_value)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        userId,
        `account_transaction_${transactionType}`,
        "account_transaction",
        transactionResult.rows[0].transaction_id.toString(),
        account.current_balance.toString(),
        newBalance.toString()
      ]
    );

    await client.query("COMMIT");
    return transactionResult.rows[0];
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("❌ Erreur dans addTransaction:", err);
    throw err;
  } finally {
    client.release();
  }
};

/**
 * Récupère le solde du compte d'un utilisateur
 */
export const getAccountBalance = async (userId) => {
  try {
    const result = await pool.query(
      `SELECT current_balance, status FROM cashier_accounts WHERE user_id = $1`,
      [userId]
    );

    if (result.rows.length === 0) {
      return null;
    }

    return {
      balance: parseFloat(result.rows[0].current_balance),
      status: result.rows[0].status
    };
  } catch (err) {
    console.error("❌ Erreur dans getAccountBalance:", err);
    throw err;
  }
};

/**
 * Récupère l'historique des transactions d'un compte
 */
export const getAccountTransactions = async (
  userId,
  limit = 50,
  offset = 0
) => {
  try {
    const result = await pool.query(
      `SELECT at.* 
       FROM account_transactions at
       JOIN cashier_accounts ca ON at.account_id = ca.account_id
       WHERE ca.user_id = $1
       ORDER BY at.created_at DESC
       LIMIT $2 OFFSET $3`,
      [userId, limit, offset]
    );

    return result.rows;
  } catch (err) {
    console.error("❌ Erreur dans getAccountTransactions:", err);
    throw err;
  }
};

/**
 * Récupère le nombre total de transactions d'un compte
 */
export const getTransactionCount = async (userId) => {
  try {
    const result = await pool.query(
      `SELECT COUNT(*) as count
       FROM account_transactions at
       JOIN cashier_accounts ca ON at.account_id = ca.account_id
       WHERE ca.user_id = $1`,
      [userId]
    );

    return parseInt(result.rows[0].count, 10);
  } catch (err) {
    console.error("❌ Erreur dans getTransactionCount:", err);
    throw err;
  }
};

/**
 * Récupère un relevé de compte pour une période
 */
export const getAccountStatement = async (userId, fromDate, toDate) => {
  try {
    const result = await pool.query(
      `SELECT at.*, u.username
       FROM account_transactions at
       JOIN cashier_accounts ca ON at.account_id = ca.account_id
       JOIN users u ON at.user_id = u.user_id
       WHERE ca.user_id = $1 
       AND at.created_at >= $2 
       AND at.created_at < $3
       ORDER BY at.created_at DESC`,
      [userId, fromDate, toDate]
    );

    return result.rows;
  } catch (err) {
    console.error("❌ Erreur dans getAccountStatement:", err);
    throw err;
  }
};

/**
 * Récupère les statistiques du compte
 */
export const getAccountStats = async (userId) => {
  try {
    const result = await pool.query(
      `SELECT 
         SUM(CASE WHEN transaction_type IN ('deposit', 'cash-in', 'pay-receipt') THEN amount ELSE 0 END) as total_in,
         SUM(CASE WHEN transaction_type IN ('withdrawal', 'cash-out', 'payout') THEN amount ELSE 0 END) as total_out,
         COUNT(*) as transaction_count
       FROM account_transactions at
       JOIN cashier_accounts ca ON at.account_id = ca.account_id
       WHERE ca.user_id = $1`,
      [userId]
    );

    const stats = result.rows[0];
    return {
      totalIn: parseFloat(stats.total_in) || 0,
      totalOut: parseFloat(stats.total_out) || 0,
      transactionCount: parseInt(stats.transaction_count, 10)
    };
  } catch (err) {
    console.error("❌ Erreur dans getAccountStats:", err);
    throw err;
  }
};

/**
 * Récupère les statistiques de tickets pour une période
 * Inclut: tickets imprimés, gagnés, perdus, annulés, total misé, total payé
 */
export const getCashierReportStats = async (userId, fromDate, toDate) => {
  try {
    // 1. Récupérer les transactions de type "payout" du caissier pendant la période
    const payoutTransactions = await pool.query(
      `SELECT reference, amount, created_at
       FROM account_transactions at
       JOIN cashier_accounts ca ON at.account_id = ca.account_id
       WHERE ca.user_id = $1 
       AND at.transaction_type = 'payout'
       AND at.created_at >= $2 
       AND at.created_at < $3
       ORDER BY at.created_at DESC`,
      [userId, fromDate, toDate]
    );

    // 2. Extraire les IDs de tickets depuis les références (format: "Receipt #123")
    const receiptIds = [];
    let totalPaid = 0;
    payoutTransactions.rows.forEach(tx => {
      if (tx.reference && tx.reference.startsWith('Receipt #')) {
        const receiptId = parseInt(tx.reference.replace('Receipt #', ''), 10);
        if (!isNaN(receiptId)) {
          receiptIds.push(receiptId);
        }
      }
      totalPaid += parseFloat(tx.amount) || 0;
    });

    // 3. Récupérer les statistiques des tickets payés par ce caissier
    let paidTicketsStats = {
      total: 0,
      won: 0,
      lost: 0,
      cancelled: 0,
      totalWagered: 0,
      totalPrize: 0
    };

    if (receiptIds.length > 0) {
      const placeholders = receiptIds.map((_, i) => `$${i + 1}`).join(',');
      const ticketsResult = await pool.query(
        `SELECT 
           COUNT(*) as total,
           SUM(CASE WHEN status = 'won' OR status = 'paid' THEN 1 ELSE 0 END) as won,
           SUM(CASE WHEN status = 'lost' THEN 1 ELSE 0 END) as lost,
           SUM(CASE WHEN status = 'cancelled' THEN 1 ELSE 0 END) as cancelled,
           COALESCE(SUM(total_amount), 0) as total_wagered,
           COALESCE(SUM(prize), 0) as total_prize
         FROM receipts
         WHERE receipt_id IN (${placeholders})`,
        receiptIds
      );

      const stats = ticketsResult.rows[0];
      paidTicketsStats = {
        total: parseInt(stats.total, 10) || 0,
        won: parseInt(stats.won, 10) || 0,
        lost: parseInt(stats.lost, 10) || 0,
        cancelled: parseInt(stats.cancelled, 10) || 0,
        totalWagered: systemToPublic(parseFloat(stats.total_wagered) || 0),
        totalPrize: systemToPublic(parseFloat(stats.total_prize) || 0)
      };
    }

    // 4. Récupérer les statistiques de tous les tickets créés pendant la période
    // (tickets imprimés par tous les joueurs, pas seulement ceux payés par ce caissier)
    const allTicketsResult = await pool.query(
      `SELECT 
         COUNT(*) as total_printed,
         SUM(CASE WHEN status = 'won' OR status = 'paid' THEN 1 ELSE 0 END) as won,
         SUM(CASE WHEN status = 'lost' THEN 1 ELSE 0 END) as lost,
         SUM(CASE WHEN status = 'cancelled' THEN 1 ELSE 0 END) as cancelled,
         COALESCE(SUM(total_amount), 0) as total_wagered_all
       FROM receipts
       WHERE created_at >= $1 
       AND created_at < $2`,
      [fromDate, toDate]
    );

    const allTicketsStats = allTicketsResult.rows[0];

    // 5. Récupérer le solde actuel du compte
    const account = await getAccountByUserId(userId);
    const currentBalance = account ? parseFloat(account.current_balance) || 0 : 0;

    return {
      currentBalance,
      ticketsPrinted: parseInt(allTicketsStats.total_printed, 10) || 0,
      ticketsWon: parseInt(allTicketsStats.won, 10) || 0,
      ticketsLost: parseInt(allTicketsStats.lost, 10) || 0,
      ticketsCancelled: parseInt(allTicketsStats.cancelled, 10) || 0,
      totalWagered: systemToPublic(parseFloat(allTicketsStats.total_wagered_all) || 0),
      totalPaid,
      paidTicketsCount: paidTicketsStats.total,
      paidTicketsWon: paidTicketsStats.won,
      paidTicketsLost: paidTicketsStats.lost,
      paidTicketsCancelled: paidTicketsStats.cancelled,
      period: {
        from: fromDate,
        to: toDate
      }
    };
  } catch (err) {
    console.error("❌ Erreur dans getCashierReportStats:", err);
    throw err;
  }
};