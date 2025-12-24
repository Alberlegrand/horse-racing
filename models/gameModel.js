import { pool } from "../config/db.js";

// Charger tous les participants
export async function getParticipants() {
  const res = await pool.query("SELECT * FROM participants WHERE is_active = true ORDER BY number ASC");
  return res.rows;
}

// Créer un nouveau round
export async function createRound({ round_id, round_number, winner_id, started_at, next_start_time }) {
  // ✅ CONVERSION: Convertir le round_id formaté (string) en nombre pour l'insertion DB
  // Le round_id est stocké comme BIGINT en DB mais formaté comme string dans le code
  const roundIdForDb = typeof round_id === 'string' ? parseInt(round_id, 10) : round_id;
  
  // Insert with idempotency: if round_id already exists, return existing row
  const insertRes = await pool.query(
    `INSERT INTO rounds (round_id, round_number, status, winner_id, started_at, next_start_time, created_at)
     VALUES ($1, $2, 'waiting', $3, $4, $5, CURRENT_TIMESTAMP)
     ON CONFLICT (round_id) DO NOTHING
     RETURNING *`,
    [roundIdForDb, round_number, winner_id, started_at, next_start_time]
  );

  if (insertRes.rows && insertRes.rows[0]) {
    return insertRes.rows[0];
  }

  // If nothing was inserted (conflict), fetch the existing round
  const res = await pool.query(`SELECT * FROM rounds WHERE round_id = $1`, [roundIdForDb]);
  return res.rows[0];
}

// Archiver un round terminé
export async function finishRound(round_id, winner_id, total_prize, finished_at) {
  // ✅ CONVERSION: Convertir le round_id formaté (string) en nombre pour la requête DB
  const roundIdForDb = typeof round_id === 'string' ? parseInt(round_id, 10) : round_id;
  await pool.query(
    `UPDATE rounds SET status = 'finished', winner_id = $2, total_prize = $3, finished_at = $4, updated_at = CURRENT_TIMESTAMP WHERE round_id = $1`,
    [roundIdForDb, winner_id, total_prize, finished_at]
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
