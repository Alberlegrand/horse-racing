import { pool } from "../config/db.js";

// Créer une statistique de round
export async function createStat({ round_id, total_receipts = 0, total_bets = 0, total_stakes = 0, total_prize_pool = 0, total_paid = 0, house_balance = 0 }) {
  const res = await pool.query(
    `INSERT INTO game_statistics (round_id, total_receipts, total_bets, total_stakes, total_prize_pool, total_paid, house_balance, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, CURRENT_TIMESTAMP)
     RETURNING *`,
    [round_id, total_receipts, total_bets, total_stakes, total_prize_pool, total_paid, house_balance]
  );
  return res.rows[0];
}

// Récupérer les statistiques d'un round
export async function getStatByRound(round_id) {
  const res = await pool.query(
    `SELECT * FROM game_statistics WHERE round_id = $1 ORDER BY created_at DESC LIMIT 1`,
    [round_id]
  );
  return res.rows[0];
}

// Récupérer les statistiques globales
export async function getGlobalStats(limit = 20) {
  const res = await pool.query(
    `SELECT * FROM game_statistics ORDER BY created_at DESC LIMIT $1`,
    [limit]
  );
  return res.rows;
}
