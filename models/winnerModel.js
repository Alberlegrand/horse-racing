import { pool } from '../config/db.js';

/**
 * Sauvegarde un gagnant dans la base de données
 */
export async function saveWinner(roundId, winner) {
  if (!roundId || !winner || !winner.id) {
    console.warn('[WINNERS-MODEL] ⚠️ Données invalides pour saveWinner');
    return null;
  }

  try {
    const result = await pool.query(
      `INSERT INTO winners 
       (round_id, participant_id, participant_number, participant_name, family, total_prize)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (round_id) DO UPDATE SET
       participant_id = $2,
       participant_number = $3,
       participant_name = $4,
       family = $5,
       total_prize = $6
       RETURNING *`,
      [
        roundId,
        winner.id,
        winner.number || null,
        winner.name || null,
        winner.family || null,
        winner.prize || 0
      ]
    );

    console.log(`[WINNERS-MODEL] ✅ Gagnant sauvegardé pour la manche #${roundId}`);
    return result.rows[0];
  } catch (err) {
    console.error('[WINNERS-MODEL] ❌ Erreur lors de la sauvegarde du gagnant:', err.message);
    return null;
  }
}

/**
 * Récupère les N derniers gagnants (pour l'affichage sur screen)
 */
export async function getRecentWinners(limit = 6) {
  try {
    const result = await pool.query(
      `SELECT 
        w.winner_id,
        w.round_id as id,
        w.participant_id,
        w.participant_number as number,
        w.participant_name as name,
        w.family,
        w.total_prize as prize,
        w.created_at
       FROM winners w
       ORDER BY w.round_id DESC
       LIMIT $1`,
      [limit]
    );

    console.log(`[WINNERS-MODEL] ✅ ${result.rows.length} gagnants récupérés`);
    
    // ✅ CORRECTION: Retourner dans l'ordre DESC (plus récent en premier) pour l'affichage
    // L'API retourne déjà les gagnants triés par round_id DESC (plus récent en premier)
    // On garde cet ordre car l'affichage veut le plus récent en premier
    
    // ✅ Log pour debugging
    if (result.rows.length > 0) {
        console.log(`[WINNERS-MODEL] 📊 Exemple gagnant: Round #${result.rows[0].id}, Winner: ${result.rows[0].name} (№${result.rows[0].number})`);
    }
    
    return result.rows;
  } catch (err) {
    console.error('[WINNERS-MODEL] ❌ Erreur lors de la récupération des gagnants:', err.message);
    return [];
  }
}

/**
 * Récupère tous les gagnants pour les statistiques
 */
export async function getAllWinners() {
  try {
    const result = await pool.query(
      `SELECT 
        w.winner_id,
        w.round_id as id,
        w.participant_id,
        w.participant_number as number,
        w.participant_name as name,
        w.family,
        w.total_prize as prize,
        w.created_at
       FROM winners w
       ORDER BY w.round_id DESC`
    );

    console.log(`[WINNERS-MODEL] ✅ ${result.rows.length} gagnants totaux récupérés`);
    return result.rows;
  } catch (err) {
    console.error('[WINNERS-MODEL] ❌ Erreur lors de la récupération de tous les gagnants:', err.message);
    return [];
  }
}

/**
 * Récupère le gagnant d'une manche spécifique
 */
export async function getWinnerByRoundId(roundId) {
  try {
    const result = await pool.query(
      `SELECT 
        w.winner_id,
        w.round_id as id,
        w.participant_id,
        w.participant_number as number,
        w.participant_name as name,
        w.family,
        w.total_prize as prize,
        w.created_at
       FROM winners w
       WHERE w.round_id = $1`,
      [roundId]
    );

    if (result.rows.length > 0) {
      console.log(`[WINNERS-MODEL] ✅ Gagnant trouvé pour manche #${roundId}`);
      return result.rows[0];
    }
    
    console.log(`[WINNERS-MODEL] ℹ️ Aucun gagnant trouvé pour manche #${roundId}`);
    return null;
  } catch (err) {
    console.error('[WINNERS-MODEL] ❌ Erreur lors de la récupération du gagnant:', err.message);
    return null;
  }
}

/**
 * Supprime tous les gagnants (pour nettoyage ou reset)
 */
export async function deleteAllWinners() {
  try {
    const result = await pool.query('DELETE FROM winners');
    console.log(`[WINNERS-MODEL] ✅ Tous les gagnants supprimés`);
    return true;
  } catch (err) {
    console.error('[WINNERS-MODEL] ❌ Erreur lors de la suppression des gagnants:', err.message);
    return false;
  }
}

/**
 * Récupère les statistiques des gagnants
 */
export async function getWinnersStats() {
  try {
    const result = await pool.query(
      `SELECT 
        participant_id,
        participant_number as number,
        participant_name as name,
        COUNT(*) as win_count,
        SUM(total_prize) as total_winnings,
        AVG(total_prize) as avg_prize
       FROM winners
       GROUP BY participant_id, participant_number, participant_name
       ORDER BY win_count DESC`
    );

    console.log(`[WINNERS-MODEL] ✅ Statistiques générées pour ${result.rows.length} participants`);
    return result.rows;
  } catch (err) {
    console.error('[WINNERS-MODEL] ❌ Erreur lors de la génération des statistiques:', err.message);
    return [];
  }
}


