import { pool } from "./db.js";

/**
 * Migration des données de jeu en mémoire vers PostgreSQL
 * À utiliser au démarrage du serveur ou en script distinct
 */

/**
 * Sauvegarder un round en base de données
 * @param {Object} round - L'objet round de gameState
 * @param {number} round.roundNumber
 * @param {number} round.prize
 * @param {Object} round.winner - {number, name}
 * @param {Array} round.places - [{number, name, coeff}, ...]
 * @param {Array} round.receipts
 */
export const saveRound = async (round) => {
  const client = await pool.connect();
  
  try {
    await client.query("BEGIN");

    // 1. Créer ou mettre à jour le round
    const roundResult = await client.query(
      `INSERT INTO rounds (round_number, status, winner_id, created_at)
       VALUES ($1, 'finished', (SELECT participant_id FROM participants WHERE number = $2), CURRENT_TIMESTAMP)
       ON CONFLICT (round_number) DO UPDATE SET status = 'finished'
       RETURNING round_id`,
      [round.roundNumber, round.winner.number]
    );
    const roundId = roundResult.rows[0].round_id;

    // 2. Insérer les positions du round
    for (const place of round.places) {
      const participantResult = await client.query(
        "SELECT participant_id FROM participants WHERE number = $1",
        [place.number]
      );
      
      if (participantResult.rows.length > 0) {
        await client.query(
          `INSERT INTO round_participants (round_id, participant_id, place)
           VALUES ($1, $2, (SELECT COUNT(*) FROM round_participants WHERE round_id = $1) + 1)
           ON CONFLICT DO NOTHING`,
          [roundId, participantResult.rows[0].participant_id]
        );
      }
    }

    // 3. Créer les tickets (receipts) et paris (bets)
    for (const receipt of round.receipts) {
      // Insérer le ticket
      const receiptResult = await client.query(
        `INSERT INTO receipts (receipt_id, round_id, status, total_amount, created_at)
         VALUES ($1, $2, 'won', $3, CURRENT_TIMESTAMP)
         ON CONFLICT (receipt_id) DO NOTHING
         RETURNING receipt_id`,
        [receipt.id, roundId, receipt.value]
      );

      if (receiptResult.rows.length > 0) {
        const receiptId = receiptResult.rows[0].receipt_id;

        // Insérer les bets associés
        for (const bet of receipt.bets) {
          const participantResult = await client.query(
            "SELECT participant_id FROM participants WHERE number = $1",
            [bet.participant.number]
          );

          if (participantResult.rows.length > 0) {
            await client.query(
              `INSERT INTO bets (receipt_id, participant_id, participant_number, participant_name, 
                                 coefficient, value, status, created_at)
               VALUES ($1, $2, $3, $4, $5, $6, 'pending', CURRENT_TIMESTAMP)
               ON CONFLICT DO NOTHING`,
              [
                receiptId,
                participantResult.rows[0].participant_id,
                bet.participant.number,
                bet.participant.name,
                bet.participant.coeff,
                bet.value
              ]
            );
          }
        }
      }
    }

    await client.query("COMMIT");
    console.log(`✅ Round ${round.roundNumber} migré avec succès`);
    return roundId;
  } catch (err) {
    await client.query("ROLLBACK");
    console.error(`❌ Erreur lors de la migration du round ${round.roundNumber}:`, err);
    throw err;
  } finally {
    client.release();
  }
};

/**
 * Récupérer tous les rounds depuis la base de données
 */
export const fetchAllRounds = async () => {
  try {
    const result = await pool.query(`
      SELECT 
        r.round_id,
        r.round_number,
        r.status,
        r.total_prize,
        p.participant_id,
        p.number as winner_number,
        p.name as winner_name,
        p.coeff as winner_coeff
      FROM rounds r
      LEFT JOIN participants p ON r.winner_id = p.participant_id
      ORDER BY r.created_at DESC
    `);
    
    return result.rows;
  } catch (err) {
    console.error("❌ Erreur lors de la récupération des rounds:", err);
    return [];
  }
};

/**
 * Récupérer un round spécifique avec tous ses tickets et paris
 */
export const fetchRoundDetails = async (roundNumber) => {
  try {
    const roundResult = await pool.query(
      `SELECT r.*, p.name as winner_name FROM rounds r 
       LEFT JOIN participants p ON r.winner_id = p.participant_id 
       WHERE r.round_number = $1`,
      [roundNumber]
    );

    if (roundResult.rows.length === 0) return null;

    const roundId = roundResult.rows[0].round_id;

    // Récupérer les positions
    const placesResult = await pool.query(
      `SELECT rp.place, p.* FROM round_participants rp 
       JOIN participants p ON rp.participant_id = p.participant_id 
       WHERE rp.round_id = $1 
       ORDER BY rp.place`,
      [roundId]
    );

    // Récupérer les tickets
    const receiptsResult = await pool.query(
      `SELECT * FROM receipts WHERE round_id = $1`,
      [roundId]
    );

    // Récupérer tous les paris
    const betsResult = await pool.query(
      `SELECT b.*, r.receipt_id FROM bets b 
       JOIN receipts r ON b.receipt_id = r.receipt_id 
       WHERE r.round_id = $1`,
      [roundId]
    );

    return {
      ...roundResult.rows[0],
      places: placesResult.rows,
      receipts: receiptsResult.rows,
      bets: betsResult.rows
    };
  } catch (err) {
    console.error(`❌ Erreur lors de la récupération du round ${roundNumber}:`, err);
    return null;
  }
};

/**
 * Mettre à jour le statut d'un ticket et calculer les gains
 */
export const updateReceiptStatus = async (receiptId, status, prize = null) => {
  try {
    const query = prize !== null
      ? `UPDATE receipts SET status = $1, prize = $2, updated_at = CURRENT_TIMESTAMP WHERE receipt_id = $3`
      : `UPDATE receipts SET status = $1, updated_at = CURRENT_TIMESTAMP WHERE receipt_id = $2`;

    const params = prize !== null 
      ? [status, prize, receiptId]
      : [status, receiptId];

    await pool.query(query, params);
    console.log(`✅ Ticket ${receiptId} mis à jour: ${status}`);
  } catch (err) {
    console.error(`❌ Erreur lors de la mise à jour du ticket ${receiptId}:`, err);
    throw err;
  }
};

/**
 * Récupérer les statistiques d'un round
 */
export const getRoundStatistics = async (roundNumber) => {
  try {
    const result = await pool.query(`
      SELECT 
        r.round_number,
        COUNT(DISTINCT rec.receipt_id) as total_receipts,
        COUNT(b.bet_id) as total_bets,
        SUM(CASE WHEN rec.status = 'won' THEN rec.prize ELSE 0 END) as total_prizes_paid,
        SUM(rec.total_amount) as total_stakes,
        AVG(rec.prize) as avg_prize
      FROM rounds r
      LEFT JOIN receipts rec ON r.round_id = rec.round_id
      LEFT JOIN bets b ON rec.receipt_id = b.receipt_id
      WHERE r.round_number = $1
      GROUP BY r.round_number
    `, [roundNumber]);

    return result.rows[0] || null;
  } catch (err) {
    console.error(`❌ Erreur lors de la récupération des stats du round ${roundNumber}:`, err);
    return null;
  }
};

/**
 * Enregistrer une action dans le journal d'audit
 */
export const logTransaction = async (userId, action, entityType, entityId, oldValue = null, newValue = null) => {
  try {
    await pool.query(
      `INSERT INTO transaction_logs (user_id, action, entity_type, entity_id, old_value, new_value, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP)`,
      [userId, action, entityType, entityId, oldValue, newValue]
    );
  } catch (err) {
    console.error("❌ Erreur lors de l'enregistrement du journal:", err);
  }
};
