import { pool } from "../config/db.js";

// Créer un ticket (receipt)
// ✅ OBLIGATOIRE: receipt_id et round_id ne peuvent PAS être null
export async function createReceipt({ round_id, user_id, total_amount, status = 'pending', prize = 0, receipt_id }) {
  // ✅ VALIDATION: receipt_id est obligatoire
  if (!receipt_id && receipt_id !== 0) {
    throw new Error('receipt_id est obligatoire et ne peut pas être null');
  }
  
  // ✅ VALIDATION: round_id est obligatoire
  if (!round_id && round_id !== 0) {
    throw new Error('round_id est obligatoire et ne peut pas être null');
  }
  
  const res = await pool.query(
    `INSERT INTO receipts (receipt_id, round_id, user_id, total_amount, status, prize, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP)
     RETURNING *`,
    [receipt_id, round_id, user_id, total_amount, status, prize]
  );
  return res.rows[0];
}

// Créer un pari (bet) pour un ticket - OPTIMISÉ
export async function createBet({ receipt_id, participant_id, participant_number, participant_name, coefficient, value, status = 'pending', prize = 0 }) {
  const res = await pool.query(
    `INSERT INTO bets (receipt_id, participant_id, participant_number, participant_name, coefficient, value, status, prize, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, CURRENT_TIMESTAMP)
     RETURNING *`,
    [receipt_id, participant_id, participant_number, participant_name, coefficient, value, status, prize]
  );
  return res.rows[0];
}

// Créer plusieurs bets en batch pour plus de performance
export async function createBetsBatch(bets) {
  if (!bets || bets.length === 0) return [];
  
  const placeholders = bets
    .map((_, i) => `($${i * 9 + 1},$${i * 9 + 2},$${i * 9 + 3},$${i * 9 + 4},$${i * 9 + 5},$${i * 9 + 6},$${i * 9 + 7},$${i * 9 + 8},CURRENT_TIMESTAMP)`)
    .join(',');
  
  const values = bets.flatMap(b => [
    b.receipt_id, b.participant_id, b.participant_number, b.participant_name,
    b.coefficient, b.value, b.status || 'pending', b.prize || 0
  ]);
  
  const res = await pool.query(
    `INSERT INTO bets (receipt_id, participant_id, participant_number, participant_name, coefficient, value, status, prize, created_at)
     VALUES ${placeholders}
     RETURNING *`,
    values
  );
  return res.rows;
}

// Récupérer tous les tickets d'un utilisateur
export async function getReceiptsByUser(user_id, limit = 20) {
  const res = await pool.query(
    `SELECT * FROM receipts WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2`,
    [user_id, limit]
  );
  return res.rows;
}

// Récupérer les paris d'un ticket - OPTIMISÉ avec index
export async function getBetsByReceipt(receipt_id) {
  const res = await pool.query(
    `SELECT * FROM bets WHERE receipt_id = $1 ORDER BY created_at ASC`,
    [receipt_id]
  );
  return res.rows;
}

// Récupérer les paris de plusieurs tickets en batch
export async function getBetsByReceiptsBatch(receipt_ids) {
  if (!receipt_ids || receipt_ids.length === 0) return [];
  
  const placeholders = receipt_ids.map((_, i) => `$${i + 1}`).join(',');
  const res = await pool.query(
    `SELECT * FROM bets WHERE receipt_id IN (${placeholders}) ORDER BY receipt_id, created_at ASC`,
    receipt_ids
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

// Récupérer plusieurs receipts par ID
export async function getReceiptsByIdBatch(receipt_ids) {
  if (!receipt_ids || receipt_ids.length === 0) return [];
  
  const placeholders = receipt_ids.map((_, i) => `$${i + 1}`).join(',');
  const res = await pool.query(
    `SELECT * FROM receipts WHERE receipt_id IN (${placeholders})`,
    receipt_ids
  );
  return res.rows;
}

// Mettre à jour le statut et le gain d'un ticket
export async function updateReceiptStatus(receipt_id, status, prize = null) {
  // ✅ NOUVEAU: Vérifier que le ticket existe d'abord
  const checkRes = await pool.query(
    `SELECT receipt_id FROM receipts WHERE receipt_id = $1`,
    [receipt_id]
  );
  
  if (!checkRes.rows || checkRes.rows.length === 0) {
    console.warn(`[UPDATE-RECEIPT] ⚠️ Ticket #${receipt_id} non trouvé en DB, skip update`);
    return { success: false, rowsAffected: 0, reason: 'not_found' };
  }
  
  const query = prize !== null
    ? `UPDATE receipts SET status = $1, prize = $2, updated_at = CURRENT_TIMESTAMP WHERE receipt_id = $3`
    : `UPDATE receipts SET status = $1, updated_at = CURRENT_TIMESTAMP WHERE receipt_id = $2`;
  const params = prize !== null ? [status, prize, receipt_id] : [status, receipt_id];
  
  const res = await pool.query(query, params);
  
  // ✅ NOUVEAU: Retourner le nombre de lignes affectées
  return { 
    success: true, 
    rowsAffected: res.rowCount || 0,
    receipt_id 
  };
}
