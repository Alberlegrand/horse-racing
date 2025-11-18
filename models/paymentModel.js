import { pool } from "../config/db.js";

// Créer un paiement
export async function createPayment({ receipt_id, user_id, amount, method = 'cash', status = 'completed', transaction_ref = null }) {
  const res = await pool.query(
    `INSERT INTO payments (receipt_id, user_id, amount, method, status, transaction_ref, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP)
     RETURNING *`,
    [receipt_id, user_id, amount, method, status, transaction_ref]
  );
  return res.rows[0];
}

// Récupérer les paiements d'un utilisateur
export async function getPaymentsByUser(user_id, limit = 20) {
  const res = await pool.query(
    `SELECT * FROM payments WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2`,
    [user_id, limit]
  );
  return res.rows;
}

// Récupérer les paiements d'un ticket
export async function getPaymentsByReceipt(receipt_id) {
  const res = await pool.query(
    `SELECT * FROM payments WHERE receipt_id = $1 ORDER BY created_at ASC`,
    [receipt_id]
  );
  return res.rows;
}

// Mettre à jour le statut d'un paiement
export async function updatePaymentStatus(payment_id, status) {
  await pool.query(
    `UPDATE payments SET status = $2, updated_at = CURRENT_TIMESTAMP WHERE payment_id = $1`,
    [payment_id, status]
  );
}
