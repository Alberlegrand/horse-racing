// Shared round number manager to ensure unique sequential round numbers
// across all round creation operations

import { pool } from '../config/db.js';

let currentRoundNumber = 0;

/**
 * Get and increment the next round number FROM DATABASE (atomic operation)
 * ✅ THREAD-SAFE: Utilise la séquence PostgreSQL
 * @returns {number} The next unique round number
 */
export async function getNextRoundNumber() {
    try {
        const result = await pool.query(
            `SELECT nextval('rounds_round_number_seq'::regclass) as next_number`
        );
        const nextNumber = result.rows[0].next_number;
        console.log(`[ROUND-NUMBER] Next round number from DB: ${nextNumber}`);
        return nextNumber;
    } catch (err) {
        console.error('[ROUND-NUMBER] Error fetching from DB sequence:', err.message);
        // Fallback à la version mémoire en cas d'erreur
        currentRoundNumber++;
        console.warn(`[ROUND-NUMBER] Fallback à mémoire: ${currentRoundNumber}`);
        return currentRoundNumber;
    }
}

/**
 * Initialiser le round number manager depuis la BD
 * À appeler au démarrage du serveur
 */
export async function initRoundNumberManager() {
    try {
        const result = await pool.query(
            `SELECT MAX(round_number) as max_number FROM rounds`
        );
        const maxNumber = result.rows[0].max_number || 0;
        currentRoundNumber = maxNumber;
        console.log(`[ROUND-NUMBER] Initialized from DB: ${currentRoundNumber}`);
    } catch (err) {
        console.error('[ROUND-NUMBER] Error initializing from DB:', err.message);
        currentRoundNumber = 0;
    }
}

/**
 * Reset round number (useful for testing)
 */
export function resetRoundNumber() {
    currentRoundNumber = 0;
}

/**
 * Get current round number without incrementing
 */
export function getCurrentRoundNumber() {
    return currentRoundNumber;
}
