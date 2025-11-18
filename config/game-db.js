import { pool } from "./db.js";

// Charger tous les participants
export async function getParticipants() {
  const res = await pool.query("SELECT * FROM participants WHERE is_active = true ORDER BY number ASC");
  return res.rows;
}

// Créer un nouveau round
export async function createRound({ round_number, winner_id, started_at, next_start_time }) {
  const res = await pool.query(
    `INSERT INTO rounds (round_number, status, winner_id, started_at, next_start_time, created_at)
     VALUES ($1, 'waiting', $2, $3, $4, CURRENT_TIMESTAMP)
     RETURNING *`,
    [round_number, winner_id, started_at, next_start_time]
  );
  return res.rows[0];
}

// Archiver un round terminé
export async function finishRound(round_id, winner_id, total_prize, finished_at) {
  await pool.query(
    `UPDATE rounds SET status = 'finished', winner_id = $2, total_prize = $3, finished_at = $4, updated_at = CURRENT_TIMESTAMP WHERE round_id = $1`,
    [round_id, winner_id, total_prize, finished_at]
  );
}

// Récupérer l’historique des rounds
export async function getRoundsHistory(limit = 10) {
  const res = await pool.query(
    `SELECT * FROM rounds ORDER BY created_at DESC LIMIT $1`,
    [limit]
  );
  return res.rows;
}

// Récupérer un round par son numéro
export async function getRoundByNumber(round_number) {
  const res = await pool.query(
    `SELECT * FROM rounds WHERE round_number = $1`,
    [round_number]
  );
  return res.rows[0];
}
