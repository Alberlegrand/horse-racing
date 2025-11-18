import { pool } from "../config/db.js";

// Créer un log d'audit
export async function createLog({ user_id, action, entity_type, entity_id, old_value = null, new_value = null, ip_address = null }) {
  const res = await pool.query(
    `INSERT INTO transaction_logs (user_id, action, entity_type, entity_id, old_value, new_value, ip_address, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, CURRENT_TIMESTAMP)
     RETURNING *`,
    [user_id, action, entity_type, entity_id, old_value, new_value, ip_address]
  );
  return res.rows[0];
}

// Récupérer les logs d'un utilisateur
export async function getLogsByUser(user_id, limit = 50) {
  const res = await pool.query(
    `SELECT * FROM transaction_logs WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2`,
    [user_id, limit]
  );
  return res.rows;
}

// Récupérer les logs par entité
export async function getLogsByEntity(entity_type, entity_id, limit = 50) {
  const res = await pool.query(
    `SELECT * FROM transaction_logs WHERE entity_type = $1 AND entity_id = $2 ORDER BY created_at DESC LIMIT $3`,
    [entity_type, entity_id, limit]
  );
  return res.rows;
}
