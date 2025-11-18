import { pool } from "../config/db.js";

// Créer un nouvel utilisateur
export async function createUser({ username, email, password, role = 'cashier', is_active = true }) {
  const res = await pool.query(
    `INSERT INTO users (username, email, password, role, is_active, created_at)
     VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP)
     RETURNING *`,
    [username, email, password, role, is_active]
  );
  return res.rows[0];
}

// Récupérer un utilisateur par son ID
export async function getUserById(user_id) {
  const res = await pool.query(
    `SELECT * FROM users WHERE user_id = $1`,
    [user_id]
  );
  return res.rows[0];
}

// Récupérer un utilisateur par son nom d'utilisateur
export async function getUserByUsername(username) {
  const res = await pool.query(
    `SELECT * FROM users WHERE username = $1`,
    [username]
  );
  return res.rows[0];
}

// Mettre à jour le statut d'un utilisateur
export async function updateUserStatus(user_id, { is_active, is_suspended, is_blocked }) {
  await pool.query(
    `UPDATE users SET is_active = $2, is_suspended = $3, is_blocked = $4, updated_at = CURRENT_TIMESTAMP WHERE user_id = $1`,
    [user_id, is_active, is_suspended, is_blocked]
  );
}

// Récupérer tous les utilisateurs
export async function getAllUsers(limit = 50) {
  const res = await pool.query(
    `SELECT * FROM users ORDER BY created_at DESC LIMIT $1`,
    [limit]
  );
  return res.rows;
}
