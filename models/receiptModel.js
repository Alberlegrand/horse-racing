import { pool } from "../config/db.js";

// Créer un ticket (receipt)
export async function createReceipt({ round_id, user_id, total_amount, status = 'pending', prize = 0, receipt_id = null }) {
  if (receipt_id) {
    const res = await pool.query(
      `INSERT INTO receipts (receipt_id, round_id, user_id, total_amount, status, prize, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP)
       RETURNING *`,
      [receipt_id, round_id, user_id, total_amount, status, prize]
    );
    return res.rows[0];
  } else {
    const res = await pool.query(
      `INSERT INTO receipts (round_id, user_id, total_amount, status, prize, created_at)
       VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP)
       RETURNING *`,
      [round_id, user_id, total_amount, status, prize]
    );
    return res.rows[0];
  }
}

// Créer un pari (bet) pour un ticket
export async function createBet({ receipt_id, participant_id, participant_number, participant_name, coefficient, value, status = 'pending', prize = 0 }) {
  const res = await pool.query(
    `INSERT INTO bets (receipt_id, participant_id, participant_number, participant_name, coefficient, value, status, prize, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, CURRENT_TIMESTAMP)
     RETURNING *`,
    [receipt_id, participant_id, participant_number, participant_name, coefficient, value, status, prize]
  );
  return res.rows[0];
}

// Récupérer tous les tickets d'un utilisateur
export async function getReceiptsByUser(user_id, limit = 20) {
  const res = await pool.query(
    `SELECT * FROM receipts WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2`,
    [user_id, limit]
  );
  return res.rows;
}

// Récupérer les paris d'un ticket
export async function getBetsByReceipt(receipt_id) {
  const res = await pool.query(
    `SELECT * FROM bets WHERE receipt_id = $1 ORDER BY created_at ASC`,
    [receipt_id]
  );
  return res.rows;
}

export async function getReceiptById(receipt_id) {
  const res = await pool.query(
    `SELECT * FROM receipts WHERE receipt_id = $1`,
    [receipt_id]
  );
  return res.rows[0];
}

// Mettre à jour le statut et le gain d'un ticket
export async function updateReceiptStatus(receipt_id, status, prize = null) {
  const query = prize !== null
    ? `UPDATE receipts SET status = $1, prize = $2, updated_at = CURRENT_TIMESTAMP WHERE receipt_id = $3`
    : `UPDATE receipts SET status = $1, updated_at = CURRENT_TIMESTAMP WHERE receipt_id = $2`;
  const params = prize !== null ? [status, prize, receipt_id] : [status, receipt_id];
  await pool.query(query, params);
}
